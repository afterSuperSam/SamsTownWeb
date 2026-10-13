import { Button } from "../components/Button";
import { Layers3, Menu, Plus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ConfirmDialog } from "../components/Dialog";
import { HeroTransition } from "../components/HeroTransition";
import { TownImage } from "../components/TownImage";
import { SelectField } from "../components/SelectField";
import { PageLoading } from "../components/TerrainLoading";
import { Notice, RetryNotice } from "../components/RetryNotice";
import { can } from "../domain/permissions";
import type { Profile } from "../domain/types";
import { ClaimEditor } from "../features/atlas/components/ClaimEditor";
import { MapManager } from "../features/atlas/components/MapManager";
import { MarkerEditor } from "../features/atlas/components/MarkerEditor";
import { MapSidebar } from "../features/atlas/components/MapSidebar";
import { MapToolbar } from "../features/atlas/components/MapToolbar";
import { MapViewport, type MapViewportHandle } from "../features/atlas/components/MapViewport";
import {
  deleteClaim,
  deleteMarker,
  listMapOwners,
  saveClaim,
  saveMarker
} from "../features/atlas/data/mapRepository";
import { mayEditClaim } from "../features/atlas/domain/mapPermissions";
import type { ChunkCoordinate, MapClaim, MapMarker, MarkerDraft, SelectionTool } from "../features/atlas/domain/mapTypes";
import { useMapData } from "../features/atlas/hooks/useMapData";
import { atlasConfig, containsCell } from "../features/atlas/domain/atlasConfig";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { useTownHero } from "../hooks/useTownHero";
import { useAuth } from "../state/AuthContext";

// 地图读取错误保留分类，部署异常转换为访客可理解的恢复提示。
function getMapLoadErrorTranslationKey(error: unknown) {
  const key = getErrorTranslationKey(error);
  return key === "error.migrationRequired" ? "map.error.dataUnavailable" : key;
}

export function AtlasPage() {
  const { user, profile } = useAuth();
  const { language, t } = useI18n();
  const data = useMapData(JSON.stringify([
    user?.id ?? null, profile?.id ?? null, profile?.role ?? null, Boolean(profile?.mustChangePassword)
  ]));
  const navigate = useNavigate();
  const viewportRef = useRef<MapViewportHandle>(null);
  const noticeTimer = useRef<number | null>(null);
  const { image: heroImage, ready: heroReady, error: heroError, retry: retryHero } = useTownHero("mapHero");
  const [selection, setSelection] = useState<ChunkCoordinate[]>([]);
  const validatedChanges = useRef(new Set<string>());
  const operationScope = `${data.scope}:${data.activeMapId}:${data.activeMap?.tileRevision}`;
  const operationScopeRef = useRef(operationScope);
  operationScopeRef.current = operationScope;
  const [tool, setTool] = useState<SelectionTool>("point");
  const [subtract, setSubtract] = useState(false);
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [claimEditor, setClaimEditor] = useState<MapClaim | "new" | null>(null);
  const [editingClaim, setEditingClaim] = useState<MapClaim | null>(null);
  const [markerEditor, setMarkerEditor] = useState<{ marker?: MapMarker; point: { x: number; y: number } } | null>(null);
  const [markerPlacement, setMarkerPlacement] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [owners, setOwners] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingLeave, setPendingLeave] = useState<
    { kind: "map"; id: string } | { kind: "route"; href: string } | null
  >(null);
  const mapAccessReady = Boolean(user && profile && user.id === profile.id && !profile.mustChangePassword);
  const canClaim = mapAccessReady && can(profile?.role, "map:claim");
  const canManage = mapAccessReady && can(profile?.role, "map:manage");

  useEffect(() => {
    if (!canManage) { setOwners([]); return; }
    let cancelled = false;
    void listMapOwners().then(nextOwners => {
      if (!cancelled) setOwners(nextOwners);
    }).catch(error => {
      if (!cancelled) showNotice(t(getErrorTranslationKey(error)), "error");
    });
    return () => { cancelled = true; };
  }, [canManage, data.scope, t]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!selection.length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [selection.length]);

  useEffect(() => {
    if (!selection.length) return;
    const interceptNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (`${url.pathname}${url.search}${url.hash}` === `${location.pathname}${location.search}${location.hash}`) return;
      event.preventDefault();
      setPendingLeave({ kind: "route", href: `${url.pathname}${url.search}${url.hash}` });
    };
    document.addEventListener("click", interceptNavigation, true);
    return () => document.removeEventListener("click", interceptNavigation, true);
  }, [selection.length]);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  useLayoutEffect(() => {
    setSelection([]);
    validatedChanges.current.clear();
    setActiveClaimId(null);
    setMarkerPlacement(false);
    setEditingClaim(null);
    setClaimEditor(null);
    setMarkerEditor(null);
    setManagerOpen(false);
  }, [data.activeMapId, data.scope, data.activeMap?.tileRevision]);

  useLayoutEffect(() => { setOwners([]); }, [data.scope]);

  const activeClaim = useMemo(() => data.snapshot.claims.find(claim => claim.id === activeClaimId) ?? null, [activeClaimId, data.snapshot.claims]);

  function showNotice(message: string, tone: "success" | "error" = "success") {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), atlasConfig.noticeDuration);
  }

  function changeMap(id: string) {
    if (id === data.activeMapId) return;
    if (selection.length) {
      setPendingLeave({ kind: "map", id });
      return;
    }
    data.setActiveMapId(id);
  }

  function confirmLeave() {
    if (!pendingLeave) return;
    const action = pendingLeave;
    setPendingLeave(null);
    setSelection([]);
    if (action.kind === "map") data.setActiveMapId(action.id);
    else navigate(action.href);
  }

  async function editClaim(claim: MapClaim) {
    if (!(canClaim || canManage)) return;
    const requestScope = operationScope;
    setBusy(true);
    try {
      const detail = await data.loadClaimDetail(claim.id);
      if (!detail || requestScope !== operationScopeRef.current || !mayEditClaim(profile?.role, user?.id, detail)) return;
      validatedChanges.current.clear();
      setSelection(detail.cells);
      setActiveClaimId(detail.id);
      setEditingClaim(detail);
      setClaimEditor(null);
      setSidebarOpen(false);
      showNotice(t("map.claim.editingArea", { name: detail.projectName }));
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally { setBusy(false); }
  }

  async function persistClaim(draft: Parameters<typeof saveClaim>[0]) {
    if (!(canClaim || canManage) || (draft.id && editingClaim?.id !== draft.id)) return;
    const originalCells = new Set(editingClaim?.cells.map(cell => `${cell.column}:${cell.row}`) ?? []);
    const desiredCells = new Set(draft.cells.map(cell => `${cell.column}:${cell.row}`));
    const changedCells = [
      ...draft.cells.filter(cell => !originalCells.has(`${cell.column}:${cell.row}`)),
      ...(editingClaim?.cells.filter(cell => !desiredCells.has(`${cell.column}:${cell.row}`)) ?? [])
    ];
    if (!changedCells.every(cell => validatedChanges.current.has(`${cell.column}:${cell.row}`))) {
      showNotice(t("map.error.unloadedSelection"), "error");
      return;
    }
    if (!online) {
      showNotice(t("map.offline"), "error");
      return;
    }
    setBusy(true);
    const requestScope = operationScope;
    try {
      const result = await saveClaim(draft);
      if (requestScope !== operationScopeRef.current) return;
      await data.refreshSnapshot("claims");
      if (requestScope !== operationScopeRef.current) return;
      setClaimEditor(null);
      setEditingClaim(null);
      setActiveClaimId(result.claimId);
      setSelection(result.conflicts);
      validatedChanges.current = new Set(result.conflicts.map(cell => `${cell.column}:${cell.row}`));
      showNotice(t(result.conflicts.length ? "map.error.conflict" : "admin.saved"), result.conflicts.length ? "error" : "success");
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeClaim(claim: MapClaim) {
    if (!(canClaim || canManage) || !mayEditClaim(profile?.role, user?.id, claim)) return;
    const requestScope = operationScope;
    setBusy(true);
    try {
      await deleteClaim(claim.id);
      if (requestScope !== operationScopeRef.current) return;
      await data.refreshSnapshot("claims");
      if (requestScope !== operationScopeRef.current) return;
      setClaimEditor(null);
      setEditingClaim(null);
      setSelection([]);
      setActiveClaimId(null);
      showNotice(t("admin.saved"));
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function persistMarker(draft: MarkerDraft) {
    const requestScope = operationScope;
    if (!canManage) return;
    if (!containsCell(data.loadedBounds, { column: Math.floor(draft.pixelX / 16), row: Math.floor(draft.pixelY / 16) })) {
      showNotice(t("map.error.unloadedSelection"), "error");
      return;
    }
    setBusy(true);
    try {
      await saveMarker(draft);
      if (requestScope !== operationScopeRef.current) return;
      await data.refreshSnapshot("markers");
      if (requestScope !== operationScopeRef.current) return;
      setMarkerEditor(null);
      showNotice(t("admin.saved"));
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMarker(marker: MapMarker) {
    if (!canManage) return;
    const requestScope = operationScope;
    setBusy(true);
    try {
      await deleteMarker(marker.id);
      if (requestScope !== operationScopeRef.current) return;
      await data.refreshSnapshot("markers");
      if (requestScope !== operationScopeRef.current) return;
      setMarkerEditor(null);
      showNotice(t("admin.saved"));
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  if (data.loading || !heroReady) return <PageLoading label={t("app.loading.terrain")} />;

  return (
    <main className="map-page ambient-page">
      <header className="map-hero page-hero hero-copy-sequence">
        {heroImage ? <TownImage className="map-hero-image page-hero-image" source={heroImage.sourceUrl} alt={language === "zh-CN" ? heroImage.altZh : heroImage.altEn} loading="eager" fetchPriority="high" /> : null}
        <div className="page-hero-shade" />
        <span className="eyebrow">{t("map.eyebrow")}</span>
        <h1>{t("map.title")}</h1>
        <p>{t("map.body")}</p>
      </header>
      <HeroTransition />
      <RetryNotice error={heroError} onRetry={retryHero} />

      <section className="town-map-section">
        <div className="map-section-heading">
          <div className="map-switcher">
            <Layers3 size={17} />
            <SelectField
              value={data.activeMapId ?? ""}
              label={t("app.nav.map")}
              options={data.maps.map(map => ({ value: map.id, label: `${map.shortLabel ? `${map.shortLabel} · ` : ""}${map.name}` }))}
              onChange={changeMap}
              disabled={!data.maps.length}
            />
          </div>
          <button type="button" className="map-mobile-sidebar" onClick={() => setSidebarOpen(open => !open)} aria-expanded={sidebarOpen}>{sidebarOpen ? <X size={17} /> : <Menu size={17} />}{t("map.sidebar.claims")}</button>
        </div>

        {data.activeMap && data.snapshotError ? (
          <Notice className="map-snapshot-notice">
            <span>{t(getMapLoadErrorTranslationKey(data.snapshotError))}</span>
            <Button type="button" className="secondary small" onClick={() => void data.refreshSnapshot().catch(error => showNotice(t(getMapLoadErrorTranslationKey(error)), "error"))}>{t("app.retry")}</Button>
          </Notice>
        ) : null}
        {data.mapsError ? (
          <div className="map-empty-state"><p>{t(getMapLoadErrorTranslationKey(data.mapsError))}</p><Button type="button" className="secondary" onClick={() => void data.refreshMaps().catch(error => showNotice(t(getMapLoadErrorTranslationKey(error)), "error"))}>{t("app.retry")}</Button></div>
        ) : !data.activeMap ? (
          <div className="map-empty-state"><h2>{t("map.empty.title")}</h2><p>{t("map.empty.body")}</p>{canManage ? <Button type="button" className="primary" onClick={() => setManagerOpen(true)}><Plus size={17} />{t("map.manage.upload")}</Button> : null}</div>
        ) : (
          <div className={`map-workspace ${sidebarOpen ? "sidebar-open" : ""}`}>
            <MapSidebar
              key={`${data.scope}:${data.activeMap.id}:${data.activeMap.tileRevision}`}
              mapId={data.activeMap.id}
              scope={data.scope}
              revision={data.listRevision}
              currentUserId={user?.id}
              canManage={canManage}
              canEditClaim={claim => (canClaim || canManage) && mayEditClaim(profile?.role, user?.id, claim)}
              onFocusClaim={claim => { setActiveClaimId(claim.id); viewportRef.current?.focusClaim(claim); setSidebarOpen(false); }}
              onFocusMarker={marker => { viewportRef.current?.focusMarker(marker); setSidebarOpen(false); }}
              onEditClaim={claim => { if (!busy) void editClaim(claim); }}
              onEditMarker={marker => setMarkerEditor({ marker, point: { x: marker.pixelX, y: marker.pixelY } })}
              onHoverClaim={setActiveClaimId}
            />
            <div className="map-canvas-column">
              <div className="map-corner-label"><span>{data.activeMap.shortLabel || data.activeMap.name.slice(0, 2)}</span><strong>{data.activeMap.name}</strong></div>
              <MapViewport
                key={`${data.scope}:${data.activeMap.id}:${data.activeMap.tileRevision}`}
                ref={viewportRef}
                map={data.activeMap}
                claims={data.snapshot.claims}
                markers={data.snapshot.markers}
                selection={selection}
                tool={tool}
                subtract={subtract}
                activeClaimId={activeClaim?.id ?? null}
                editableClaimId={editingClaim?.id ?? null}
                markerPlacement={markerPlacement}
                editable={(canClaim || canManage) && !data.overview}
                loadedBounds={data.loadedBounds}
                occupancy={data.occupancy}
                overview={data.overview}
                onViewportChange={data.setViewport}
                onSelectionChange={next => {
                  const previousKeys = new Set(selection.map(cell => `${cell.column}:${cell.row}`));
                  const nextKeys = new Set(next.map(cell => `${cell.column}:${cell.row}`));
                  const changes = [...next.filter(cell => !previousKeys.has(`${cell.column}:${cell.row}`)),
                    ...selection.filter(cell => !nextKeys.has(`${cell.column}:${cell.row}`))];
                  if (!changes.every(cell => containsCell(data.loadedBounds, cell))) return;
                  changes.forEach(cell => validatedChanges.current.add(`${cell.column}:${cell.row}`));
                  setSelection(next);
                }}
                onClaimHover={setActiveClaimId}
                onClaimSelect={claim => setActiveClaimId(claim.id)}
                onMarkerSelect={marker => canManage && setMarkerEditor({ marker, point: { x: marker.pixelX, y: marker.pixelY } })}
                onMarkerPlace={point => { setMarkerPlacement(false); setMarkerEditor({ point }); }}
              />
              <MapToolbar
                tool={tool}
                subtract={subtract}
                count={selection.length}
                canClaim={canClaim}
                canManage={canManage}
                markerPlacement={markerPlacement}
                editingClaim={Boolean(editingClaim)}
                onTool={setTool}
                onSubtract={() => setSubtract(value => !value)}
                onClear={() => { setSelection([]); setEditingClaim(null); validatedChanges.current.clear(); }}
                onReset={() => viewportRef.current?.reset()}
                onCreateClaim={() => setClaimEditor(editingClaim ?? "new")}
                onMarkerPlacement={() => setMarkerPlacement(value => !value)}
                onManage={() => setManagerOpen(true)}
              />
              {!online ? <div className="map-offline-notice">{t("map.offline")}</div> : null}
            </div>
          </div>
        )}
      </section>

      {claimEditor && data.activeMap ? <ClaimEditor
        key={claimEditor === "new" ? `new-${selection.map(cell => `${cell.column}:${cell.row}`).join(",")}` : claimEditor.id}
        mapId={data.activeMap.id}
        initial={claimEditor === "new" ? undefined : claimEditor}
        cells={selection}
        owners={owners}
        currentUserId={user?.id}
        canManage={canManage}
        busy={busy}
        onClose={() => setClaimEditor(null)}
        onSave={draft => void persistClaim(draft)}
        onDelete={claim => void removeClaim(claim)}
      /> : null}
      {markerEditor && data.activeMap ? <MarkerEditor mapId={data.activeMap.id} point={markerEditor.point} initial={markerEditor.marker} busy={busy} onClose={() => setMarkerEditor(null)} onSave={draft => void persistMarker(draft)} onDelete={marker => void removeMarker(marker)} /> : null}
      {managerOpen ? <MapManager maps={data.maps} activeMap={data.activeMap} onClose={() => setManagerOpen(false)} onChanged={data.refreshMaps} onNotice={showNotice} /> : null}
      {pendingLeave ? (
        <ConfirmDialog
          title={t("map.unsaved")}
          description={t("map.unsaved")}
          onClose={() => setPendingLeave(null)}
          onConfirm={confirmLeave}
        />
      ) : null}
      {notice ? <div className={`admin-toast ${notice.tone}`} role="status">{notice.message}</div> : null}
    </main>
  );
}
