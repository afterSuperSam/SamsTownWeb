import OpenSeadragon from "openseadragon";
import { Building2, Cog, MapPin } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nContext";
import { getTileRequest, subscribeToTileAuthentication } from "../data/mapRepository";
import {
  cellKey,
  buildCellPaths,
  clampChunk,
  findNearestMarker,
  pixelToChunk,
  rectangleCells,
  splitClaimRegions,
  toggleCells
} from "../domain/claimGeometry";
import { CHUNK_SIZE, type ChunkCoordinate, type MapClaim, type MapMarker, type MapOccupancy, type SelectionTool, type TownMap } from "../domain/mapTypes";
import { atlasConfig, boundedViewport, containsCell, type ChunkBounds } from "../domain/atlasConfig";
import { MinecraftAvatar } from "./MinecraftAvatar";

const MARKER_ART_WIDTH = 52;
const MARKER_SCREEN_WIDTH = 42;

export interface MapViewportHandle {
  reset: () => void;
  focusClaim: (claim: MapClaim) => void;
  focusMarker: (marker: MapMarker) => void;
}

interface MapViewportProps {
  map: TownMap;
  claims: MapClaim[];
  markers: MapMarker[];
  selection: ChunkCoordinate[];
  tool: SelectionTool;
  subtract: boolean;
  activeClaimId: string | null;
  editableClaimId: string | null;
  markerPlacement: boolean;
  editable: boolean;
  loadedBounds: ChunkBounds | null;
  occupancy: MapOccupancy | null;
  overview: boolean;
  onViewportChange: (bounds: ChunkBounds | null) => void;
  onSelectionChange: (cells: ChunkCoordinate[]) => void;
  onClaimHover: (id: string | null) => void;
  onClaimSelect: (claim: MapClaim) => void;
  onMarkerSelect: (marker: MapMarker) => void;
  onMarkerPlace: (point: { x: number; y: number }) => void;
}

export const MapViewport = forwardRef<MapViewportHandle, MapViewportProps>(function MapViewport(props, ref) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const markerScaleRef = useRef(1);
  const markerElementsRef = useRef<SVGGElement[]>([]);
  const labelElementsRef = useRef<SVGTextElement[]>([]);
  const imageScaleRef = useRef(1);
  const propsRef = useRef(props);
  const drawingRef = useRef<{ pointerId: number; start: ChunkCoordinate; cells: ChunkCoordinate[] } | null>(null);
  const pointStartRef = useRef<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<ChunkCoordinate[]>([]);
  const [hoverCell, setHoverCell] = useState<ChunkCoordinate | null>(null);
  const [hoverClaimId, setHoverClaimId] = useState<string | null>(null);
  const [hoverMarkerId, setHoverMarkerId] = useState<string | null>(null);
  const [keyboardCell, setKeyboardCell] = useState<ChunkCoordinate | null>(null);
  const [zoomBand, setZoomBand] = useState(1);
  const [loadError, setLoadError] = useState(false);
  propsRef.current = props;

  const claimByCell = useMemo(() => {
    const index = new Map<string, MapClaim>();
    props.claims.forEach(claim => claim.cells.forEach(cell => index.set(cellKey(cell), claim)));
    return index;
  }, [props.claims]);
  const claimByCellRef = useRef(claimByCell);
  claimByCellRef.current = claimByCell;
  const hoveredClaim = props.claims.find(claim => claim.id === hoverClaimId) ?? null;
  const hoveredMarker = props.markers.find(marker => marker.id === hoverMarkerId) ?? null;
  const selectionPaths = useMemo(() => buildCellPaths(props.selection), [props.selection]);
  const previewPaths = useMemo(() => buildCellPaths(preview), [preview]);

  function activateCell(cell: ChunkCoordinate) {
    const current = propsRef.current;
    if (!containsCell(current.loadedBounds, cell)) return;
    if (current.markerPlacement) {
      if (!current.editable) return;
      current.onMarkerPlace({ x: (cell.column + .5) * CHUNK_SIZE, y: (cell.row + .5) * CHUNK_SIZE });
      return;
    }
    const claim = claimByCellRef.current.get(cellKey(cell));
    if (claim?.id === current.editableClaimId) {
      if (!current.editable) return;
      current.onSelectionChange(toggleCells(current.selection, [cell], current.subtract));
    } else if (claim) {
      current.onClaimSelect(claim);
    } else if (!current.editable) {
      return;
    } else {
      current.onSelectionChange(toggleCells(current.selection, [cell], current.subtract));
    }
  }

  function handleKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const current = keyboardCell ?? {
      column: Math.floor(props.map.imageWidth / CHUNK_SIZE / 2),
      row: Math.floor(props.map.imageHeight / CHUNK_SIZE / 2)
    };
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setKeyboardCell(clampChunk({
        column: current.column + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0),
        row: current.row + (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0)
      }, props.map.imageWidth, props.map.imageHeight));
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      activateCell(current);
    }
  }

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    if (!host || !overlay) return;
    let disposed = false;
    let unsubscribeAuthentication: () => void = () => {};
    setLoadError(false);
    setKeyboardCell(null);
    void getTileRequest(props.map).then(tileRequest => {
      if (disposed) return;
      const viewer = OpenSeadragon({
        element: host,
        showNavigationControl: false,
        animationTime: 0.8,
        blendTime: 0.15,
        maxZoomPixelRatio: 8,
        visibilityRatio: 0.55,
        constrainDuringPan: true,
        gestureSettingsTouch: { pinchToZoom: true, flickEnabled: true, clickToZoom: false },
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
        loadTilesWithAjax: true,
        ajaxHeaders: tileRequest.headers,
        tileSources: {
          width: props.map.imageWidth,
          height: props.map.imageHeight,
          tileSize: props.map.tileSize,
          minLevel: 0,
          maxLevel: props.map.maxLevel,
          getTileUrl: (level: number, x: number, y: number) => `${tileRequest.base}/${level}/${x}_${y}.webp`
        }
      });
      viewerRef.current = viewer;
      unsubscribeAuthentication = subscribeToTileAuthentication(headers => {
        viewer.setAjaxHeaders(headers, true);
      });
      // Keep the React-owned SVG in place. Moving it into OpenSeadragon's DOM
      // would make React unmount from the wrong parent. Its bounds follow the
      // image on every viewport animation instead.
      const updateOverlay = () => {
        const topLeft = viewer.viewport.pixelFromPoint(viewer.viewport.imageToViewportCoordinates(0, 0), true);
        const bottomRight = viewer.viewport.pixelFromPoint(
          viewer.viewport.imageToViewportCoordinates(props.map.imageWidth, props.map.imageHeight),
          true
        );
        overlay.style.left = `${topLeft.x}px`;
        overlay.style.top = `${topLeft.y}px`;
        overlay.style.width = `${bottomRight.x - topLeft.x}px`;
        overlay.style.height = `${bottomRight.y - topLeft.y}px`;
        const imageZoom = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
        const renderedImageScale = Math.max((bottomRight.x - topLeft.x) / props.map.imageWidth, .001);
        imageScaleRef.current = renderedImageScale;
        // The diamond artwork is 52 image units wide. Normalize it to a fixed
        // 42 CSS pixels using the measured rendered image scale; this avoids
        // exaggerated growth at low OpenSeadragon zoom levels.
        const markerScale = MARKER_SCREEN_WIDTH / (MARKER_ART_WIDTH * renderedImageScale);
        markerScaleRef.current = markerScale;
        // Marker artwork is counter-scaled against the image so it keeps a
        // stable screen size at every OpenSeadragon zoom level.
        markerElementsRef.current.forEach(marker => {
          marker.setAttribute("transform", `scale(${markerScale})`);
        });
        labelElementsRef.current.forEach(label => {
          label.style.fontSize = `${atlasConfig.claimLabelScreenSize / renderedImageScale}px`;
        });
        const nextBand = imageZoom < atlasConfig.exactImageZoom ? 0 : imageZoom < 1.2 ? 1 : 2;
        setZoomBand(current => current === nextBand ? current : nextBand);
      };
      const reportViewport = () => {
        const imageZoom = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
        const rect = viewer.viewport.viewportToImageRectangle(viewer.viewport.getBounds(true));
        const next = imageZoom < atlasConfig.exactImageZoom ? null : boundedViewport({
          minColumn: Math.floor(rect.x / CHUNK_SIZE), minRow: Math.floor(rect.y / CHUNK_SIZE),
          maxColumn: Math.ceil((rect.x + rect.width) / CHUNK_SIZE) - 1,
          maxRow: Math.ceil((rect.y + rect.height) / CHUNK_SIZE) - 1
        }, Math.ceil(props.map.imageWidth / CHUNK_SIZE), Math.ceil(props.map.imageHeight / CHUNK_SIZE));
        propsRef.current.onViewportChange(next);
      };
      viewer.addHandler("animation", updateOverlay);
      viewer.addHandler("animation-finish", reportViewport);
      viewer.addHandler("resize", updateOverlay);
      viewer.addHandler("resize", reportViewport);
      viewer.addHandler("open", () => {
        setLoadError(false);
        updateOverlay();
        reportViewport();
      });
      viewer.addHandler("tile-loaded", () => setLoadError(false));
      viewer.addHandler("tile-load-failed", () => setLoadError(true));
    }).catch(() => {
      if (!disposed) setLoadError(true);
    });
    return () => {
      disposed = true;
      unsubscribeAuthentication();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [props.map]);

  useEffect(() => {
    labelElementsRef.current = overlayRef.current ? [...overlayRef.current.querySelectorAll<SVGTextElement>(".map-claim-label")] : [];
    labelElementsRef.current.forEach(label => {
      label.style.fontSize = `${atlasConfig.claimLabelScreenSize / imageScaleRef.current}px`;
    });
  }, [props.claims, zoomBand]);

  useEffect(() => {
    markerElementsRef.current = overlayRef.current
      ? [...overlayRef.current.querySelectorAll<SVGGElement>(".map-marker-visual")]
      : [];
    markerElementsRef.current.forEach(marker => {
      marker.setAttribute("transform", `scale(${markerScaleRef.current})`);
    });
  }, [props.markers, zoomBand]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const imagePoint = (event: PointerEvent) => {
      const viewer = viewerRef.current;
      if (!viewer) return null;
      const bounds = host.getBoundingClientRect();
      const webPoint = new OpenSeadragon.Point(event.clientX - bounds.left, event.clientY - bounds.top);
      const viewportPoint = viewer.viewport.pointFromPixel(webPoint, true);
      const point = viewer.viewport.viewportToImageCoordinates(viewportPoint);
      if (point.x < 0 || point.y < 0 || point.x >= props.map.imageWidth || point.y >= props.map.imageHeight) return null;
      return { point, cell: clampChunk(pixelToChunk(point.x, point.y), props.map.imageWidth, props.map.imageHeight) };
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const located = imagePoint(event);
      if (!located || !containsCell(propsRef.current.loadedBounds, located.cell)) return;
      pointStartRef.current = { x: event.clientX, y: event.clientY };
      if (propsRef.current.markerPlacement && propsRef.current.editable) {
        event.stopPropagation();
        return;
      }
      if (propsRef.current.editable && (propsRef.current.tool === "rectangle" || propsRef.current.tool === "brush")) {
        event.preventDefault();
        event.stopPropagation();
        host.setPointerCapture(event.pointerId);
        viewerRef.current?.setMouseNavEnabled(false);
        const cells = [located.cell];
        drawingRef.current = { pointerId: event.pointerId, start: located.cell, cells };
        setPreview(cells);
      }
    };
    const pointerMove = (event: PointerEvent) => {
      const located = imagePoint(event);
      if (!located) {
        setHoverCell(null);
        setHoverClaimId(null);
        setHoverMarkerId(null);
        propsRef.current.onClaimHover(null);
        return;
      }
      setHoverCell(current => current?.column === located.cell.column && current.row === located.cell.row ? current : located.cell);
      const claim = claimByCellRef.current.get(cellKey(located.cell));
      const nextHoverId = claim?.id ?? null;
      setHoverClaimId(nextHoverId);
      propsRef.current.onClaimHover(nextHoverId);
      const markerRadius = (MARKER_SCREEN_WIDTH / 2 + 8) / Math.max(imageScaleRef.current, .001);
      const marker = findNearestMarker(propsRef.current.markers, located.point, markerRadius);
      setHoverMarkerId(marker?.id ?? null);
      const drawing = drawingRef.current;
      if (!drawing || drawing.pointerId !== event.pointerId || !containsCell(propsRef.current.loadedBounds, located.cell)
        || !containsCell(propsRef.current.loadedBounds, drawing.start)) return;
      event.preventDefault();
      event.stopPropagation();
      if (propsRef.current.tool === "rectangle") {
        setPreview(rectangleCells(drawing.start, located.cell));
      } else {
        drawing.cells = toggleCells(drawing.cells, [located.cell]);
        setPreview(drawing.cells);
      }
    };
    const pointerUp = (event: PointerEvent) => {
      const located = imagePoint(event);
      const drawing = drawingRef.current;
      if (drawing?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        const completed = propsRef.current.tool === "rectangle" && located && containsCell(propsRef.current.loadedBounds, located.cell)
          && containsCell(propsRef.current.loadedBounds, drawing.start)
          ? rectangleCells(drawing.start, located.cell)
          : propsRef.current.tool === "rectangle" ? [] : drawing.cells;
        if (completed.every(cell => containsCell(propsRef.current.loadedBounds, cell))) {
          propsRef.current.onSelectionChange(toggleCells(propsRef.current.selection, completed, propsRef.current.subtract));
        }
        drawingRef.current = null;
        pointStartRef.current = null;
        setPreview([]);
        viewerRef.current?.setMouseNavEnabled(true);
        if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
        return;
      }
      if (!located || !pointStartRef.current || !containsCell(propsRef.current.loadedBounds, located.cell)) return;
      const moved = Math.hypot(event.clientX - pointStartRef.current.x, event.clientY - pointStartRef.current.y);
      pointStartRef.current = null;
      if (moved > 5) return;
      if (propsRef.current.markerPlacement && propsRef.current.editable) {
        propsRef.current.onMarkerPlace({ x: located.point.x, y: located.point.y });
        return;
      }
      const markerRadius = (MARKER_SCREEN_WIDTH / 2 + 6) / Math.max(imageScaleRef.current, .001);
      const marker = findNearestMarker(propsRef.current.markers, located.point, markerRadius);
      if (marker) {
        propsRef.current.onMarkerSelect(marker);
        return;
      }
      if (propsRef.current.tool === "point") {
        activateCell(located.cell);
      }
    };
    const pointerCancel = (event: PointerEvent) => {
      const drawing = drawingRef.current;
      if (drawing?.pointerId !== event.pointerId) return;
      drawingRef.current = null;
      pointStartRef.current = null;
      setPreview([]);
      viewerRef.current?.setMouseNavEnabled(true);
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    };
    const pointerLeave = () => {
      setHoverCell(null);
      setHoverClaimId(null);
      setHoverMarkerId(null);
      propsRef.current.onClaimHover(null);
    };
    host.addEventListener("pointerdown", pointerDown, true);
    host.addEventListener("pointermove", pointerMove, true);
    host.addEventListener("pointerup", pointerUp, true);
    host.addEventListener("pointercancel", pointerCancel, true);
    host.addEventListener("pointerleave", pointerLeave);
    return () => {
      host.removeEventListener("pointerdown", pointerDown, true);
      host.removeEventListener("pointermove", pointerMove, true);
      host.removeEventListener("pointerup", pointerUp, true);
      host.removeEventListener("pointercancel", pointerCancel, true);
      host.removeEventListener("pointerleave", pointerLeave);
    };
  }, [props.map.imageHeight, props.map.imageWidth]);

  useImperativeHandle(ref, () => ({
    reset: () => viewerRef.current?.viewport.goHome(true),
    focusClaim: claim => {
      if (claim.bounds) {
        const bounds = claim.bounds;
        focusImageRect(bounds.minColumn * CHUNK_SIZE, bounds.minRow * CHUNK_SIZE,
          (bounds.maxColumn - bounds.minColumn + 1) * CHUNK_SIZE,
          (bounds.maxRow - bounds.minRow + 1) * CHUNK_SIZE);
        return;
      }
      if (!claim.cells.length) return;
      const bounds = claim.cells.reduce((current, cell) => ({
        minColumn: Math.min(current.minColumn, cell.column), minRow: Math.min(current.minRow, cell.row),
        maxColumn: Math.max(current.maxColumn, cell.column), maxRow: Math.max(current.maxRow, cell.row)
      }), { minColumn: Infinity, minRow: Infinity, maxColumn: -Infinity, maxRow: -Infinity });
      focusImageRect(
        bounds.minColumn * CHUNK_SIZE, bounds.minRow * CHUNK_SIZE,
        (bounds.maxColumn - bounds.minColumn + 1) * CHUNK_SIZE,
        (bounds.maxRow - bounds.minRow + 1) * CHUNK_SIZE
      );
    },
    focusMarker: marker => focusImageRect(marker.pixelX - 32, marker.pixelY - 32, 64, 64)
  }));

  function focusImageRect(x: number, y: number, width: number, height: number) {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const rect = viewer.viewport.imageToViewportRectangle(x, y, width, height);
    viewer.viewport.fitBoundsWithConstraints(rect, false);
  }

  return (
    <div
      className={`map-viewport ${props.markerPlacement ? "is-placing-marker" : ""}`}
      tabIndex={0}
      role="application"
      aria-label={t("map.viewport.instructions")}
      onFocus={event => {
        if (event.target === event.currentTarget && !keyboardCell) {
          setKeyboardCell(clampChunk({
            column: Math.floor(props.map.imageWidth / CHUNK_SIZE / 2),
            row: Math.floor(props.map.imageHeight / CHUNK_SIZE / 2)
          }, props.map.imageWidth, props.map.imageHeight));
        }
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardCell(null);
      }}
      onKeyDown={handleKeyboard}
    >
      <div className="map-osd-host" ref={hostRef} />
      <svg ref={overlayRef} className="map-overlay" viewBox={`0 0 ${props.map.imageWidth} ${props.map.imageHeight}`} aria-hidden="true">
        {(props.overview || !props.loadedBounds) && props.occupancy ? <g className="map-occupancy-overview" fill="var(--amber)" pointerEvents="none">
          {props.occupancy.blocks.map(block => <rect key={`${block.column}:${block.row}`}
            x={block.column * props.occupancy!.blockSize * CHUNK_SIZE} y={block.row * props.occupancy!.blockSize * CHUNK_SIZE}
            width={props.occupancy!.blockSize * CHUNK_SIZE} height={props.occupancy!.blockSize * CHUNK_SIZE}
            opacity={Math.max(.18, Math.min(.8, block.count / props.occupancy!.blockSize ** 2))} />)}
        </g> : null}
        {props.claims.map(claim => <ClaimShape claim={claim} highlighted={claim.id === props.activeClaimId || claim.id === hoverClaimId} showLabels={zoomBand >= 1} key={claim.id} />)}
        <SelectionShape paths={selectionPaths} />
        <SelectionShape paths={previewPaths} preview />
        {keyboardCell ? <rect className="map-keyboard-cell" x={keyboardCell.column * CHUNK_SIZE} y={keyboardCell.row * CHUNK_SIZE} width={CHUNK_SIZE} height={CHUNK_SIZE} /> : null}
        {props.markers.map(marker => <MarkerShape marker={marker} scale={markerScaleRef.current} key={marker.id} />)}
        <path className="map-unloaded-mask" pointerEvents="none" fill="var(--bg)" fillOpacity=".45" fillRule="evenodd"
          d={`M0 0H${props.map.imageWidth}V${props.map.imageHeight}H0Z${props.loadedBounds
            ? `M${props.loadedBounds.minColumn * CHUNK_SIZE} ${props.loadedBounds.minRow * CHUNK_SIZE}H${(props.loadedBounds.maxColumn + 1) * CHUNK_SIZE}V${(props.loadedBounds.maxRow + 1) * CHUNK_SIZE}H${props.loadedBounds.minColumn * CHUNK_SIZE}Z` : ""}`} />
      </svg>
      {props.overview || !props.loadedBounds ? <div className="map-tile-error map-unloaded-notice" role="status">{t("map.viewport.overview")}</div> : null}
      {hoverCell ? <div className="map-chunk-id">R{hoverCell.row + 1} · C{hoverCell.column + 1}</div> : null}
      {hoveredMarker ? (
        <aside className="map-hover-card map-marker-hover-card">
          <MarkerTypeIcon type={hoveredMarker.iconType} />
          <div className="map-hover-copy">
            <strong>{hoveredMarker.name}</strong>
            <span>{t(`map.marker.${hoveredMarker.iconType}`)}</span>
            {hoveredMarker.description ? <p>{hoveredMarker.description}</p> : null}
          </div>
        </aside>
      ) : hoveredClaim ? (
        <aside className="map-hover-card">
          <span className="map-hover-avatar"><MinecraftAvatar username={hoveredClaim.minecraftUsername} size={64} alt="" /></span>
          <div className="map-hover-copy"><strong>{hoveredClaim.projectName}</strong><span>{hoveredClaim.minecraftUsername}</span><small>{t(`map.status.${hoveredClaim.status}`)}</small>{hoveredClaim.description ? <p>{hoveredClaim.description}</p> : null}</div>
        </aside>
      ) : null}
      {loadError ? <div className="map-tile-error">{t("error.generic")}</div> : null}
    </div>
  );
});

function ClaimShape({ claim, highlighted, showLabels }: { claim: MapClaim; highlighted: boolean; showLabels: boolean }) {
  const regions = useMemo(() => splitClaimRegions(claim.cells), [claim.cells]);
  const paths = useMemo(() => buildCellPaths(claim.cells), [claim.cells]);
  return <g className={`map-claim-shape ${highlighted ? "highlighted" : ""} ${claim.partial ? "partial" : ""}`} style={{ "--claim-color": claim.color } as React.CSSProperties}>
    <path className="map-claim-fill" d={paths.fill} />
    {!claim.partial ? <path className="map-claim-edge" d={paths.edge} /> : null}
    {showLabels && !claim.partial ? regions.map(region => <text className="map-claim-label" x={(region.label.column + .5) * CHUNK_SIZE} y={(region.label.row + .5) * CHUNK_SIZE} key={`label-${cellKey(region.label)}`}>{claim.projectName}</text>) : null}
  </g>;
}

function SelectionShape({ paths, preview = false }: { paths: ReturnType<typeof buildCellPaths>; preview?: boolean }) {
  if (!paths.fill) return null;
  return <g className={`map-selection-shape ${preview ? "preview" : ""}`}>
    <path className="map-selection-fill" d={paths.fill} />
    <path className="map-selection-edge" d={paths.edge} />
  </g>;
}

function MarkerShape({ marker, scale }: { marker: MapMarker; scale: number }) {
  const iconPath = marker.iconType === "building"
    ? "M-8 5V-4L0-11 8-4V5H3V-1H-3V5Z"
    : marker.iconType === "machine"
      ? "M-8-8H8V8H-8ZM-3-3H3V3H-3Z"
      : "M-8 0H8M0-8V8";
  return <g className="map-marker-shape" transform={`translate(${marker.pixelX} ${marker.pixelY})`} style={{ "--claim-color": marker.color } as React.CSSProperties}>
    <g className="map-marker-visual" transform={`scale(${scale})`}>
      <path className="map-marker-halo" d="M-10-46H10V-42H18V-34H26V-10H18V-2H10V6H-10V-2H-18V-10H-26V-34H-18V-42H-10Z" />
      <path className="map-marker-diamond" d="M-8-42H8V-38H16V-30H24V-14H16V-6H8V2H-8V-6H-16V-14H-24V-30H-16V-38H-8Z" />
      <path className="map-marker-facet light" d="M-8-34H8V-30H16V-22H8V-18H-8V-22H-16V-30H-8Z" />
      <path className="map-marker-facet shade" d="M-16-14H16V-8H8V0H-8V-8H-16Z" />
      <path className="map-marker-icon" d={iconPath} transform="translate(0 -19)" />
    </g>
  </g>;
}

function MarkerTypeIcon({ type }: { type: MapMarker["iconType"] }) {
  const Icon = type === "building" ? Building2 : type === "machine" ? Cog : MapPin;
  return <span className="map-marker-type-icon" aria-hidden="true"><Icon size={24} /></span>;
}
