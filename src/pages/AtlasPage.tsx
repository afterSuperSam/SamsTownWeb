import { Button } from "../components/Button";
import { Layers3, Menu, Pencil, Plus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ConfirmDialog, Dialog } from "../components/Dialog";
import { HeroTransition } from "../components/HeroTransition";
import { TownImage } from "../components/TownImage";
import { SelectField } from "../components/SelectField";
import { PageLoading } from "../components/TerrainLoading";
import { Notice, RetryNotice } from "../components/RetryNotice";
import { can } from "../domain/permissions";
import type { Profile } from "../domain/types";
import { ProjectEditor } from "../features/atlas/components/ProjectEditor";
import { MinecraftAvatar } from "../features/atlas/components/MinecraftAvatar";
import { MapManager } from "../features/atlas/components/MapManager";
import { MapSidebar } from "../features/atlas/components/MapSidebar";
import { MapToolbar } from "../features/atlas/components/MapToolbar";
import { MapViewport, type MapViewportHandle } from "../features/atlas/components/MapViewport";
import {
  deleteProject,
  listMapOwners,
  saveProject
} from "../features/atlas/data/mapRepository";
import { mayEditProject } from "../features/atlas/domain/mapPermissions";
import type { ChunkCoordinate, MapProject, SelectionTool } from "../features/atlas/domain/mapTypes";
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
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectEditor, setProjectEditor] = useState<MapProject | "new" | null>(null);
  const [editingProject, setEditingProject] = useState<MapProject | null>(null);
  const [projectDetail, setProjectDetail] = useState<MapProject | null>(null);
  const detailRequest = useRef(0);
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
  const canCreateProject = mapAccessReady && can(profile?.role, "map:project");
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
    setActiveProjectId(null);
    setProjectDetail(null);
    detailRequest.current += 1;
    setEditingProject(null);
    setProjectEditor(null);
    setManagerOpen(false);
  }, [data.activeMapId, data.scope, data.activeMap?.tileRevision]);

  useLayoutEffect(() => { setOwners([]); }, [data.scope]);

  const activeProject = useMemo(() => data.snapshot.projects.find(project => project.id === activeProjectId) ?? null, [activeProjectId, data.snapshot.projects]);

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

  async function viewProject(project: MapProject) {
    const requestScope = operationScope;
    const request = ++detailRequest.current;
    setActiveProjectId(project.id);
    viewportRef.current?.focusProject(project);
    setSidebarOpen(false);
    setProjectDetail(project);
    try {
      const detail = await data.loadProjectDetail(project.id);
      if (detail && request === detailRequest.current && requestScope === operationScopeRef.current) setProjectDetail(detail);
    } catch (error) {
      if (request === detailRequest.current && requestScope === operationScopeRef.current) showNotice(t(getErrorTranslationKey(error)), "error");
    }
  }

  async function editProject(project: MapProject) {
    if (!(canCreateProject || canManage)) return;
    const requestScope = operationScope;
    setBusy(true);
    try {
      const detail = await data.loadProjectDetail(project.id);
      if (!detail || requestScope !== operationScopeRef.current || !mayEditProject(profile?.role, user?.id, detail)) return;
      validatedChanges.current.clear();
      setSelection(detail.cells);
      setActiveProjectId(detail.id);
      setEditingProject(detail);
      setProjectDetail(null);
      detailRequest.current += 1;
      setProjectEditor(null);
      setSidebarOpen(false);
      showNotice(t("map.claim.editingArea", { name: detail.projectName }));
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally { setBusy(false); }
  }

  async function persistProject(draft: Parameters<typeof saveProject>[0]) {
    if (!(canCreateProject || canManage) || (draft.id && editingProject?.id !== draft.id)) return;
    const originalCells = new Set(editingProject?.cells.map(cell => `${cell.column}:${cell.row}`) ?? []);
    const desiredCells = new Set(draft.cells.map(cell => `${cell.column}:${cell.row}`));
    const changedCells = [
      ...draft.cells.filter(cell => !originalCells.has(`${cell.column}:${cell.row}`)),
      ...(editingProject?.cells.filter(cell => !desiredCells.has(`${cell.column}:${cell.row}`)) ?? [])
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
      const result = await saveProject(draft);
      if (requestScope !== operationScopeRef.current) return;
      await data.refreshSnapshot();
      if (requestScope !== operationScopeRef.current) return;
      setProjectEditor(null);
      setEditingProject(null);
      setActiveProjectId(result.projectId);
      setSelection(result.conflicts);
      validatedChanges.current = new Set(result.conflicts.map(cell => `${cell.column}:${cell.row}`));
      showNotice(t(result.conflicts.length ? "map.error.conflict" : "admin.saved"), result.conflicts.length ? "error" : "success");
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(project: MapProject) {
    if (!(canCreateProject || canManage) || !mayEditProject(profile?.role, user?.id, project)) return;
    const requestScope = operationScope;
    setBusy(true);
    try {
      await deleteProject(project.id);
      if (requestScope !== operationScopeRef.current) return;
      await data.refreshSnapshot();
      if (requestScope !== operationScopeRef.current) return;
      setProjectEditor(null);
      setEditingProject(null);
      setSelection([]);
      setActiveProjectId(null);
      showNotice(t("admin.saved"));
    } catch (error) {
      showNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  if (data.loading || data.snapshotLoading || !heroReady) return <PageLoading label={t("app.loading.terrain")} />;

  return (
    <main className="map-page ambient-page">
      <header className="map-hero page-hero hero-copy-sequence">
        {heroImage ? <div className="page-hero-media"><TownImage className="map-hero-image page-hero-image" source={heroImage.sourceUrl} alt={language === "zh-CN" ? heroImage.altZh : heroImage.altEn} loading="eager" fetchPriority="high" /></div> : null}
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
              canEditProject={project => (canCreateProject || canManage) && mayEditProject(profile?.role, user?.id, project)}
              onFocusProject={project => void viewProject(project)}
              onEditProject={project => { if (!busy) void editProject(project); }}
              onHoverProject={setActiveProjectId}
            />
            <div className="map-canvas-column">
              <div className="map-corner-label"><span>{data.activeMap.shortLabel || data.activeMap.name.slice(0, 2)}</span><strong>{data.activeMap.name}</strong></div>
              <MapViewport
                key={`${data.scope}:${data.activeMap.id}:${data.activeMap.tileRevision}`}
                ref={viewportRef}
                map={data.activeMap}
                projects={data.snapshot.projects}
                selection={selection}
                tool={tool}
                subtract={subtract}
                activeProjectId={activeProject?.id ?? null}
                editableProjectId={editingProject?.id ?? null}
                editable={(canCreateProject || canManage) && Boolean(data.loadedBounds)}
                loadedBounds={data.loadedBounds}
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
                onProjectHover={setActiveProjectId}
                onProjectSelect={project => { if (!busy) void viewProject(project); }}
              />
              <MapToolbar
                tool={tool}
                subtract={subtract}
                count={selection.length}
                canCreateProject={canCreateProject}
                canManage={canManage}
                editingProject={Boolean(editingProject)}
                onTool={setTool}
                onSubtract={() => setSubtract(value => !value)}
                onClear={() => { setSelection([]); setEditingProject(null); validatedChanges.current.clear(); }}
                onReset={() => viewportRef.current?.reset()}
                onCreateProject={() => setProjectEditor(editingProject ?? "new")}
                onManage={() => setManagerOpen(true)}
              />
              {!online ? <div className="map-offline-notice">{t("map.offline")}</div> : null}
            </div>
          </div>
        )}
      </section>

      {projectDetail ? <Dialog title={t("map.project.details")} onClose={() => { setProjectDetail(null); detailRequest.current += 1; }} className="map-project-detail">
        <header className="map-project-detail-header">
          <MinecraftAvatar username={projectDetail.minecraftUsername} size={64} alt="" />
          <div><h3>{projectDetail.projectName}</h3><p>{t("map.project.builder")} · {projectDetail.minecraftUsername}</p></div>
        </header>
        <div className="map-project-detail-meta"><span>{t("map.claim.cells", { count: projectDetail.cellCount ?? projectDetail.cells.length })}</span><span>{t("map.project.updated")} · {new Date(projectDetail.updatedAt).toLocaleDateString(language)}</span></div>
        {projectDetail.description ? <div className="map-project-description">{projectDetail.description}</div> : null}
        {(canCreateProject || canManage) && mayEditProject(profile?.role, user?.id, projectDetail) ? <div className="button-row end"><Button className="secondary" disabled={busy} onClick={() => void editProject(projectDetail)}><Pencil size={16} />{t("map.project.edit")}</Button></div> : null}
      </Dialog> : null}
      {projectEditor && data.activeMap ? <ProjectEditor
        key={projectEditor === "new" ? `new-${selection.map(cell => `${cell.column}:${cell.row}`).join(",")}` : projectEditor.id}
        mapId={data.activeMap.id}
        initial={projectEditor === "new" ? undefined : projectEditor}
        cells={selection}
        owners={owners}
        currentUserId={user?.id}
        canManage={canManage}
        busy={busy}
        onClose={() => setProjectEditor(null)}
        onSave={draft => void persistProject(draft)}
        onDelete={project => void removeProject(project)}
      /> : null}
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
