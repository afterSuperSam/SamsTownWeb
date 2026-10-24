import OpenSeadragon from "openseadragon";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nContext";
import { getTileRequest, subscribeToTileAuthentication } from "../data/mapRepository";
import {
  cellKey,
  buildCellPaths,
  clampChunk,
  pixelToChunk,
  rectangleCells,
  splitClaimRegions,
  toggleCells
} from "../domain/claimGeometry";
import { CHUNK_SIZE, type ChunkCoordinate, type MapProject, type SelectionTool, type TownMap } from "../domain/mapTypes";
import { atlasConfig, boundedViewport, containsCell, type ChunkBounds } from "../domain/atlasConfig";
import { MinecraftAvatar } from "./MinecraftAvatar";

export interface MapViewportHandle {
  reset: () => void;
  focusProject: (project: MapProject) => void;
}

interface MapViewportProps {
  map: TownMap;
  projects: MapProject[];
  selection: ChunkCoordinate[];
  tool: SelectionTool;
  subtract: boolean;
  activeProjectId: string | null;
  editableProjectId: string | null;
  editable: boolean;
  loadedBounds: ChunkBounds | null;
  onViewportChange: (bounds: ChunkBounds | null) => void;
  onSelectionChange: (cells: ChunkCoordinate[]) => void;
  onProjectHover: (id: string | null) => void;
  onProjectSelect: (project: MapProject) => void;
}

export const MapViewport = forwardRef<MapViewportHandle, MapViewportProps>(function MapViewport(props, ref) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const labelElementsRef = useRef<SVGTextElement[]>([]);
  const imageScaleRef = useRef(1);
  const propsRef = useRef(props);
  const drawingRef = useRef<{ pointerId: number; start: ChunkCoordinate; cells: ChunkCoordinate[] } | null>(null);
  const pointStartRef = useRef<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<ChunkCoordinate[]>([]);
  const [hoverCell, setHoverCell] = useState<ChunkCoordinate | null>(null);
  const [hoverProjectId, setHoverProjectId] = useState<string | null>(null);
  const [keyboardCell, setKeyboardCell] = useState<ChunkCoordinate | null>(null);
  const [loadError, setLoadError] = useState(false);
  propsRef.current = props;

  const projectByCell = useMemo(() => {
    const index = new Map<string, MapProject>();
    props.projects.forEach(project => project.cells.forEach(cell => index.set(cellKey(cell), project)));
    return index;
  }, [props.projects]);
  const projectByCellRef = useRef(projectByCell);
  projectByCellRef.current = projectByCell;
  const hoveredProject = props.projects.find(project => project.id === hoverProjectId) ?? null;
  const selectionPaths = useMemo(() => buildCellPaths(props.selection), [props.selection]);
  const previewPaths = useMemo(() => buildCellPaths(preview), [preview]);
  // 目录重读只更新元数据，底图来源或尺寸变化时才重建画布。
  const tileSource = useMemo(() => ({
    id: props.map.id, tileRevision: props.map.tileRevision, storagePrefix: props.map.storagePrefix,
    imageWidth: props.map.imageWidth, imageHeight: props.map.imageHeight,
    tileSize: props.map.tileSize, maxLevel: props.map.maxLevel
  }), [props.map.id, props.map.tileRevision, props.map.storagePrefix,
    props.map.imageWidth, props.map.imageHeight, props.map.tileSize, props.map.maxLevel]);

  function activateCell(cell: ChunkCoordinate) {
    const current = propsRef.current;
    const project = projectByCellRef.current.get(cellKey(cell));
    if (!project && !containsCell(current.loadedBounds, cell)) return;
    if (project?.id === current.editableProjectId) {
      if (!current.editable || !containsCell(current.loadedBounds, cell)) return;
      current.onSelectionChange(toggleCells(current.selection, [cell], current.subtract));
    } else if (project) {
      current.onProjectSelect(project);
    } else if (!current.editable) {
      return;
    } else {
      current.onSelectionChange(toggleCells(current.selection, [cell], current.subtract));
    }
  }

  function handleKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (["+", "=", "-"].includes(event.key)) {
      event.preventDefault();
      const viewer = viewerRef.current;
      if (viewer) {
        viewer.viewport.zoomBy(event.key === "-" ? 1 / atlasConfig.keyboardZoomFactor : atlasConfig.keyboardZoomFactor);
        viewer.viewport.applyConstraints();
      }
      return;
    }
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
    void getTileRequest(tileSource).then(tileRequest => {
      if (disposed) return;
      const viewer = OpenSeadragon({
        element: host,
        showNavigationControl: false,
        animationTime: 0.8,
        blendTime: 0.15,
        imageSmoothingEnabled: false,
        maxZoomPixelRatio: 8,
        visibilityRatio: 0.55,
        constrainDuringPan: true,
        gestureSettingsTouch: { pinchToZoom: true, flickEnabled: true, clickToZoom: false },
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
        loadTilesWithAjax: true,
        ajaxHeaders: tileRequest.headers,
        tileSources: {
          width: tileSource.imageWidth,
          height: tileSource.imageHeight,
          tileSize: tileSource.tileSize,
          minLevel: 0,
          maxLevel: tileSource.maxLevel,
          getTileUrl: (level: number, x: number, y: number) => `${tileRequest.base}/${level}/${x}_${y}.webp`
        }
      });
      viewerRef.current = viewer;
      unsubscribeAuthentication = subscribeToTileAuthentication(headers => {
        viewer.setAjaxHeaders(headers, true);
      });
      // React 持有的覆盖层跟随底图，不交由地图控件移动节点。
      const updateOverlay = () => {
        const topLeft = viewer.viewport.pixelFromPoint(viewer.viewport.imageToViewportCoordinates(0, 0), true);
        const bottomRight = viewer.viewport.pixelFromPoint(
          viewer.viewport.imageToViewportCoordinates(tileSource.imageWidth, tileSource.imageHeight),
          true
        );
        overlay.style.left = `${topLeft.x}px`;
        overlay.style.top = `${topLeft.y}px`;
        overlay.style.width = `${bottomRight.x - topLeft.x}px`;
        overlay.style.height = `${bottomRight.y - topLeft.y}px`;
        const renderedImageScale = Math.max((bottomRight.x - topLeft.x) / tileSource.imageWidth, .001);
        imageScaleRef.current = renderedImageScale;
        labelElementsRef.current.forEach(label => {
          label.style.fontSize = `${atlasConfig.claimLabelScreenSize / renderedImageScale}px`;
        });
      };
      viewer.addHandler("animation", updateOverlay);
      viewer.addHandler("resize", updateOverlay);
      // 编辑仍限制在已放大的有界窗口；全图边界与名称独立显示。
      const reportViewport = () => {
        const imageZoom = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
        const rect = viewer.viewport.viewportToImageRectangle(viewer.viewport.getBounds(true));
        propsRef.current.onViewportChange(imageZoom < atlasConfig.exactImageZoom ? null : boundedViewport({
          minColumn: Math.floor(rect.x / CHUNK_SIZE), minRow: Math.floor(rect.y / CHUNK_SIZE),
          maxColumn: Math.ceil((rect.x + rect.width) / CHUNK_SIZE) - 1,
          maxRow: Math.ceil((rect.y + rect.height) / CHUNK_SIZE) - 1
        }, Math.ceil(tileSource.imageWidth / CHUNK_SIZE), Math.ceil(tileSource.imageHeight / CHUNK_SIZE)));
      };
      viewer.addHandler("animation-finish", reportViewport);
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
  }, [tileSource]);

  useEffect(() => {
    labelElementsRef.current = overlayRef.current ? [...overlayRef.current.querySelectorAll<SVGTextElement>(".map-claim-label")] : [];
    labelElementsRef.current.forEach(label => {
      label.style.fontSize = `${atlasConfig.claimLabelScreenSize / imageScaleRef.current}px`;
    });
  }, [props.projects]);

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
      if (!located) return;
      pointStartRef.current = { x: event.clientX, y: event.clientY };
      if (propsRef.current.editable && containsCell(propsRef.current.loadedBounds, located.cell) && (propsRef.current.tool === "rectangle" || propsRef.current.tool === "brush")) {
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
        setHoverProjectId(null);
        propsRef.current.onProjectHover(null);
        return;
      }
      setHoverCell(current => current?.column === located.cell.column && current.row === located.cell.row ? current : located.cell);
      const project = projectByCellRef.current.get(cellKey(located.cell));
      const nextHoverId = project?.id ?? null;
      setHoverProjectId(nextHoverId);
      propsRef.current.onProjectHover(nextHoverId);
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
      if (!located || !pointStartRef.current) return;
      const moved = Math.hypot(event.clientX - pointStartRef.current.x, event.clientY - pointStartRef.current.y);
      pointStartRef.current = null;
      if (moved > 5) return;
      if (!propsRef.current.editable || propsRef.current.tool === "point") {
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
      setHoverProjectId(null);
      propsRef.current.onProjectHover(null);
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
    focusProject: project => {
      if (project.bounds) {
        const bounds = project.bounds;
        focusImageRect(bounds.minColumn * CHUNK_SIZE, bounds.minRow * CHUNK_SIZE,
          (bounds.maxColumn - bounds.minColumn + 1) * CHUNK_SIZE,
          (bounds.maxRow - bounds.minRow + 1) * CHUNK_SIZE);
        return;
      }
      if (!project.cells.length) return;
      const bounds = project.cells.reduce((current, cell) => ({
        minColumn: Math.min(current.minColumn, cell.column), minRow: Math.min(current.minRow, cell.row),
        maxColumn: Math.max(current.maxColumn, cell.column), maxRow: Math.max(current.maxRow, cell.row)
      }), { minColumn: Infinity, minRow: Infinity, maxColumn: -Infinity, maxRow: -Infinity });
      focusImageRect(
        bounds.minColumn * CHUNK_SIZE, bounds.minRow * CHUNK_SIZE,
        (bounds.maxColumn - bounds.minColumn + 1) * CHUNK_SIZE,
        (bounds.maxRow - bounds.minRow + 1) * CHUNK_SIZE
      );
    }
  }));

  function focusImageRect(x: number, y: number, width: number, height: number) {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const rect = viewer.viewport.imageToViewportRectangle(x, y, width, height);
    viewer.viewport.fitBoundsWithConstraints(rect, false);
  }

  return (
    <div
      className="map-viewport"
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
        {props.projects.map(project => <ProjectShape project={project} highlighted={project.id === props.activeProjectId || project.id === hoverProjectId} key={project.id} />)}
        <SelectionShape paths={selectionPaths} />
        <SelectionShape paths={previewPaths} preview />
        {keyboardCell ? <rect className="map-keyboard-cell" x={keyboardCell.column * CHUNK_SIZE} y={keyboardCell.row * CHUNK_SIZE} width={CHUNK_SIZE} height={CHUNK_SIZE} /> : null}
      </svg>
      {hoverCell ? <div className="map-chunk-id">R{hoverCell.row + 1} · C{hoverCell.column + 1}</div> : null}
      {hoveredProject ? (
        <aside className="map-hover-card">
          <span className="map-hover-avatar"><MinecraftAvatar username={hoveredProject.minecraftUsername} size={64} alt="" /></span>
          <div className="map-hover-copy"><strong>{hoveredProject.projectName}</strong><span>{hoveredProject.minecraftUsername}</span>{hoveredProject.description ? <p>{hoveredProject.description}</p> : null}</div>
        </aside>
      ) : null}
      {loadError ? <div className="map-tile-error">{t("error.generic")}</div> : null}
    </div>
  );
});

function ProjectShape({ project, highlighted }: { project: MapProject; highlighted: boolean }) {
  const regions = useMemo(() => splitClaimRegions(project.cells), [project.cells]);
  const paths = useMemo(() => buildCellPaths(project.cells), [project.cells]);
  return <g className={`map-claim-shape ${highlighted ? "highlighted" : ""}`} style={{ "--claim-color": project.color } as React.CSSProperties}>
    <path className="map-claim-fill" d={paths.fill} />
    <path className="map-claim-edge" d={paths.edge} />
    {regions.map(region => <text className="map-claim-label" x={(region.label.column + .5) * CHUNK_SIZE} y={(region.label.row + .5) * CHUNK_SIZE} key={`label-${cellKey(region.label)}`}>{project.projectName}</text>)}
  </g>;
}
function SelectionShape({ paths, preview = false }: { paths: ReturnType<typeof buildCellPaths>; preview?: boolean }) {
  if (!paths.fill) return null;
  return <g className={`map-selection-shape ${preview ? "preview" : ""}`}>
    <path className="map-selection-fill" d={paths.fill} />
    <path className="map-selection-edge" d={paths.edge} />
  </g>;
}
