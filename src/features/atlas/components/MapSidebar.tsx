import { Notice } from "../../../components/RetryNotice";
import { Button } from "../../../components/Button";
import { Pencil, Shapes } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nContext";
import { getErrorTranslationKey } from "../../../i18n/errors";
import type { MapProject, MapListPage } from "../domain/mapTypes";
import { MinecraftAvatar } from "./MinecraftAvatar";
import { listMapProjects } from "../data/mapRepository";
import { atlasConfig } from "../domain/atlasConfig";

interface MapSidebarProps {
  mapId: string;
  scope: string;
  revision: number;
  canEditProject: (project: MapProject) => boolean;
  onFocusProject: (project: MapProject) => void;
  onEditProject: (project: MapProject) => void;
  onHoverProject: (id: string | null) => void;
}

export function MapSidebar(props: MapSidebarProps) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ key: string; value: MapListPage } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const requests = useRef(new Map<string, { promise: Promise<MapListPage>; revision: string; dirty: boolean }>());
  const scopeKey = JSON.stringify([props.scope, props.mapId]);
  const previousScope = useRef(scopeKey);
  const effectivePage = previousScope.current === scopeKey ? page : 0;
  const requestKey = `${scopeKey}:${effectivePage}:${props.revision}:${retryRevision}`;
  const listKey = `${scopeKey}:${effectivePage}`;
  // 同一列表后台刷新时保留内容，身份、地图或页码变化时立即隔离。
  const visible = result?.key === listKey ? result.value : null;
  const projects = visible?.projects ?? [];
  const loading = !visible && !error;

  useEffect(() => {
    if (previousScope.current !== scopeKey) {
      previousScope.current = scopeKey;
      setPage(0);
    }
    let cancelled = false;
    setError(null);
    let entry = requests.current.get(listKey);
    if (entry) {
      if (entry.revision !== requestKey) { entry.revision = requestKey; entry.dirty = true; }
    } else {
      const next: { promise: Promise<MapListPage>; revision: string; dirty: boolean } = {
        promise: Promise.resolve({ projects: [], total: 0 }), revision: requestKey, dirty: false
      };
      next.promise = (async () => {
        let value: MapListPage;
        do {
          next.dirty = false;
          value = await listMapProjects(props.mapId, effectivePage);
        } while (next.dirty);
        return value;
      })();
      entry = next;
      requests.current.set(listKey, entry);
      void entry.promise.finally(() => requests.current.delete(listKey)).catch(() => { /* 查询错误由下方 Notice 呈现。 */ });
    }
    void entry.promise.then(value => {
      if (cancelled) return;
      const lastPage = Math.max(0, Math.ceil(value.total / atlasConfig.listPageSize) - 1);
      if (effectivePage > lastPage) { setPage(lastPage); return; }
      setResult({ key: listKey, value });
    }).catch(error => { if (!cancelled) setError(error); });
    return () => { cancelled = true; };
  }, [scopeKey, requestKey, listKey, props.mapId, effectivePage]);

  return (
    <aside className="map-sidebar" aria-label={t("map.sidebar.claims")}>
      <div className="map-project-list-heading"><Shapes size={18} /><h2>{t("map.sidebar.claims")}</h2><span>{visible?.total ?? "…"}</span></div>
      <div className="map-sidebar-list">
        {projects.map(project => (
          <article
            className="map-sidebar-item claim-item"
            style={{ "--claim-color": project.color } as React.CSSProperties}
            key={project.id}
            onMouseEnter={() => props.onHoverProject(project.id)}
            onMouseLeave={() => props.onHoverProject(null)}
            onFocusCapture={() => props.onHoverProject(project.id)}
            onBlurCapture={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onHoverProject(null);
            }}
          >
            <button type="button" className="map-item-main" onClick={() => props.onFocusProject(project)}>
              <MinecraftAvatar username={project.minecraftUsername} alt="" loading="lazy" />
              <span><strong>{project.projectName}</strong><small>{project.minecraftUsername}</small></span>
              <em>{project.cellCount ?? project.cells.length}</em>
            </button>
            {props.canEditProject(project) ? <button type="button" className="map-item-edit" onClick={() => props.onEditProject(project)} aria-label={t("map.claim.editTitle")}><Pencil size={15} /></button> : null}
          </article>
        ))}
        {visible && !projects.length ? <p className="map-list-empty">{t("map.sidebar.empty")}</p> : null}
      </div>
      {loading ? <p className="map-list-empty" role="status">{t("app.loading.terrain")}</p> : null}
      {error ? <Notice>{t(getErrorTranslationKey(error))}<Button type="button" className="secondary small" onClick={() => setRetryRevision(value => value + 1)}>{t("app.retry")}</Button></Notice> : null}
      <nav className="map-list-pagination" aria-label={t("map.sidebar.pagination")}>
        <Button type="button" className="secondary small" disabled={loading || effectivePage === 0} onClick={() => setPage(value => value - 1)}>{t("map.sidebar.previous")}</Button>
        <span role="status">{t("map.sidebar.total")} {visible?.total ?? "…"} · {effectivePage + 1} / {visible ? Math.max(1, Math.ceil(visible.total / atlasConfig.listPageSize)) : "…"}</span>
        <Button type="button" className="secondary small" disabled={!visible || (effectivePage + 1) * atlasConfig.listPageSize >= visible.total} onClick={() => setPage(value => value + 1)}>{t("map.sidebar.next")}</Button>
      </nav>
    </aside>
  );
}
