import { Layers3, Menu, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ConfirmDialog } from "../components/Dialog";
import { HeroTransition } from "../components/HeroTransition";
import { TownImage } from "../components/TownImage";
import { SelectField } from "../components/SelectField";
import { PageLoading } from "../components/TerrainLoading";
import { RetryNotice } from "../components/RetryNotice";
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
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { useTownHero } from "../hooks/useTownHero";
import { useAuth } from "../state/AuthContext";

export function AtlasPage() {
  const { user, profile } = useAuth();
  const { language, t } = useI18n();
  const data = useMapData();
  const navigate = useNavigate();
  const viewportRef = useRef<MapViewportHandle>(null);
  const noticeTimer = useRef<number | null>(null);
  const { image: heroImage, ready: heroReady, error: heroError, retry: retryHero } = useTownHero("mapHero");
  const [selection, setSelection] = useState<ChunkCoordinate[]>([]);
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
  const canClaim = can(profile?.role, "map:claim");
  const canManage = can(profile?.role, "map:manage");

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void listMapOwners().then(nextOwners => {
      if (!cancelled) setOwners(nextOwners);
    }).catch(error => {
      if (!cancelled) showNotice(t(getErrorTranslationKey(error)), "error");
    });
    return () => { cancelled = true; };
  }, [canManage, t]);

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

  useEffect(() => {
    setSelection([]);
    setActiveClaimId(null);
    setMarkerPlacement(false);
    setEditingClaim(null);
  }, [data.activeMapId]);

  const activeClaim = useMemo(() => data.snapshot.claims.find(claim => claim.id === activeClaimId) ?? null, [activeClaimId, data.snapshot.claims]);

  function showNotice(message: string, tone: "success" | "error" = "success") {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3600);
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

  function editClaim(claim: MapClaim) {
    setSelection(claim.cells);
    setActiveClaimId(claim.id);
    setEditingClaim(claim);
    setClaimEditor(null);
    setSidebarOpen(false);
    showNotice(t("map.claim.editingArea", { name: claim.projectName }));
  }

  async function persistClaim(draft: Parameters<typeof saveClaim>[0]) {
    if (!online) {
      showNotice(t("map.offline"), "error");
      return;
    }
    setBusy(true);
    try {
      const result = await saveClaim(draft);
      await data.refreshSnapshot();
      setClaimEditor(null);
      setEditingClaim(null);
      setActiveClaimId(result.claimId);
      setSelection(result.conflicts);
      showNotice(t(result.conflicts.length ? "map.error.conflict" : "admin.saved"), result.conflicts.length ? "error" : "success");
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeClaim(claim: MapClaim) {
    setBusy(true);
    try {
      await deleteClaim(claim.id);
      await data.refreshSnapshot();
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
    setBusy(true);
    try {
      await saveMarker(draft);
      await data.refreshSnapshot();
      setMarkerEditor(null);
      showNotice(t("admin.saved"));
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMarker(marker: MapMarker) {
    setBusy(true);
    try {
      await deleteMarker(marker.id);
      await data.refreshSnapshot();
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

        {data.mapsError ? (
          <div className="map-empty-state"><p>{t(getErrorTranslationKey(data.mapsError))}</p><button type="button" className="button secondary" onClick={() => void data.refreshMaps()}>{t("app.retry")}</button></div>
        ) : !data.activeMap ? (
          <div className="map-empty-state"><h2>{t("map.empty.title")}</h2><p>{t("map.empty.body")}</p>{canManage ? <button type="button" className="button primary" onClick={() => setManagerOpen(true)}><Plus size={17} />{t("map.manage.upload")}</button> : null}</div>
        ) : (
          <div className={`map-workspace ${sidebarOpen ? "sidebar-open" : ""}`}>
            <MapSidebar
              claims={data.snapshot.claims}
              markers={data.snapshot.markers}
              currentUserId={user?.id}
              canManage={canManage}
              canEditClaim={claim => mayEditClaim(profile?.role, user?.id, claim)}
              onFocusClaim={claim => { setActiveClaimId(claim.id); viewportRef.current?.focusClaim(claim); setSidebarOpen(false); }}
              onFocusMarker={marker => { viewportRef.current?.focusMarker(marker); setSidebarOpen(false); }}
              onEditClaim={editClaim}
              onEditMarker={marker => setMarkerEditor({ marker, point: { x: marker.pixelX, y: marker.pixelY } })}
              onHoverClaim={setActiveClaimId}
            />
            <div className="map-canvas-column">
              {data.snapshotError ? (
                <div className="notice error map-snapshot-notice" role="alert">
                  <span>{t(getErrorTranslationKey(data.snapshotError))}</span>
                  <button type="button" className="button secondary small" onClick={() => void data.refreshSnapshot()}>{t("app.retry")}</button>
                </div>
              ) : null}
              <div className="map-corner-label"><span>{data.activeMap.shortLabel || data.activeMap.name.slice(0, 2)}</span><strong>{data.activeMap.name}</strong></div>
              <MapViewport
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
                editable={canClaim || canManage}
                onSelectionChange={setSelection}
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
                onClear={() => { setSelection([]); setEditingClaim(null); }}
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
