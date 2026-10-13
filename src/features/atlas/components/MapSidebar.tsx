import { Notice } from "../../../components/RetryNotice";
import { Button } from "../../../components/Button";
import { Building2, Cpu, MapPin, Pencil, Search, Shapes } from "lucide-react";
import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
import { SelectField } from "../../../components/SelectField";
import { useI18n } from "../../../i18n/I18nContext";
import { getErrorTranslationKey } from "../../../i18n/errors";
import type { TranslationKey } from "../../../i18n/translations";
import type { MapClaim, MapMarker, MapStatus } from "../domain/mapTypes";
import { MinecraftAvatar } from "./MinecraftAvatar";
import { listMapSummaries } from "../data/mapRepository";
import { atlasConfig } from "../domain/atlasConfig";
import type { MapListPage } from "../domain/mapTypes";

const statusKeys: Record<MapStatus, TranslationKey> = {
  planned: "map.status.planned",
  in_progress: "map.status.in_progress",
  completed: "map.status.completed",
  paused: "map.status.paused",
  abandoned: "map.status.abandoned"
};

interface MapSidebarProps {
  mapId: string;
  scope: string;
  revision: number;
  currentUserId?: string;
  canManage: boolean;
  canEditClaim: (claim: MapClaim) => boolean;
  onFocusClaim: (claim: MapClaim) => void;
  onFocusMarker: (marker: MapMarker) => void;
  onEditClaim: (claim: MapClaim) => void;
  onEditMarker: (marker: MapMarker) => void;
  onHoverClaim: (id: string | null) => void;
}

export function MapSidebar(props: MapSidebarProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"claims" | "markers">("claims");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MapStatus | "all">("all");
  const [member, setMember] = useState("all");
  const [color, setColor] = useState("all");
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ key: string; value: MapListPage } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const requests = useRef(new Map<string, { promise: Promise<MapListPage>; revision: string; dirty: boolean }>());
  const claimsTabId = useId();
  const markersTabId = useId();
  const claimsPanelId = useId();
  const markersPanelId = useId();
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filterKey = JSON.stringify([props.scope, props.mapId, tab, deferredQuery, status, member, color, mine]);
  const previousFilter = useRef(filterKey);
  const effectivePage = previousFilter.current === filterKey ? page : 0;
  const requestKey = `${filterKey}:${effectivePage}:${props.revision}:${retryRevision}`;
  const listKey = `${filterKey}:${effectivePage}`;
  const visible = result?.key === requestKey ? result.value : null;
  const claims = visible?.claims ?? [];
  const markers = visible?.markers ?? [];
  const sameMapResult = result && result.key.startsWith(`[${JSON.stringify(props.scope)},${JSON.stringify(props.mapId)},`) ? result.value : null;
  const members = visible?.members ?? sameMapResult?.members ?? [];
  const colors = visible?.colors ?? sameMapResult?.colors ?? [];
  const loading = !visible && !error;

  useEffect(() => {
    if (previousFilter.current !== filterKey) {
      previousFilter.current = filterKey;
      setPage(0);
    }
    let cancelled = false;
    setError(null);
    let entry = requests.current.get(listKey);
    if (entry) {
      if (entry.revision !== requestKey) { entry.revision = requestKey; entry.dirty = true; }
    } else {
      const next: { promise: Promise<MapListPage>; revision: string; dirty: boolean } = {
        promise: Promise.resolve({ claims: [], markers: [], total: 0, members: [], colors: [] }), revision: requestKey, dirty: false
      };
      next.promise = (async () => {
        let value: MapListPage;
        do {
          next.dirty = false;
          value = await listMapSummaries(props.mapId, tab, {
            query: deferredQuery, status, member, color, mine, page: effectivePage
          });
        } while (next.dirty);
        return value;
      })();
      entry = next;
      requests.current.set(listKey, entry);
      void entry.promise.finally(() => requests.current.delete(listKey)).catch(() => {});
    }
    void entry.promise.then(value => {
      if (cancelled) return;
      const lastPage = Math.max(0, Math.ceil(value.total / atlasConfig.listPageSize) - 1);
      if (effectivePage > lastPage) { setPage(lastPage); return; }
      setResult({ key: requestKey, value });
    }).catch(error => { if (!cancelled) setError(error); });
    return () => { cancelled = true; };
  }, [filterKey, requestKey, listKey, props.mapId, tab, deferredQuery, status, member, color, mine, effectivePage]);

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "ArrowRight" || event.key === "End" ? "markers" : "claims";
    const id = next === "claims" ? claimsTabId : markersTabId;
    setTab(next);
    document.getElementById(id)?.focus();
  }

  return (
    <aside className="map-sidebar" aria-label={t("app.nav.map")}>
      <div className="map-sidebar-tabs segmented-control" role="tablist">
        <button type="button" role="tab" id={claimsTabId} tabIndex={tab === "claims" ? 0 : -1} aria-selected={tab === "claims"} aria-controls={claimsPanelId} className={tab === "claims" ? "active" : ""} onClick={() => setTab("claims")} onKeyDown={moveTab}>
          <Shapes size={16} />{t("map.sidebar.claims")}{tab === "claims" ? <span>{visible?.total ?? "…"}</span> : null}
        </button>
        <button type="button" role="tab" id={markersTabId} tabIndex={tab === "markers" ? 0 : -1} aria-selected={tab === "markers"} aria-controls={markersPanelId} className={tab === "markers" ? "active" : ""} onClick={() => setTab("markers")} onKeyDown={moveTab}>
          <MapPin size={16} />{t("map.sidebar.markers")}{tab === "markers" ? <span>{visible?.total ?? "…"}</span> : null}
        </button>
      </div>
      <label className="map-search">
        <Search size={16} />
        <input aria-label={t("map.sidebar.search")} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("map.sidebar.search")} />
      </label>

      {tab === "claims" ? (
        <div className="map-claim-panel" role="tabpanel" id={claimsPanelId} aria-labelledby={claimsTabId}>
          <div className="map-filters">
            <SelectField value={status} label={t("map.claim.status")} options={[
              { value: "all", label: t("map.sidebar.allStatuses") },
              ...(Object.keys(statusKeys) as MapStatus[]).map(value => ({ value, label: t(statusKeys[value]) }))
            ]} onChange={setStatus} />
            <SelectField value={member} label={t("map.claim.minecraft")} options={[
              { value: "all", label: t("map.sidebar.allMembers") },
              ...members.map(value => ({ value, label: value }))
            ]} onChange={setMember} />
            <SelectField value={color} label={t("map.claim.color")} options={[
              { value: "all", label: t("map.sidebar.allColors") },
              ...colors.map(value => ({ value, label: value }))
            ]} onChange={setColor} />
            {props.currentUserId ? <label className="map-mine-filter"><input type="checkbox" checked={mine} onChange={event => setMine(event.target.checked)} />{t("map.sidebar.mine")}</label> : null}
          </div>
          <div className="map-sidebar-list">
            {claims.map(claim => (
              <article
                className="map-sidebar-item claim-item"
                style={{ "--claim-color": claim.color } as React.CSSProperties}
                key={claim.id}
                onMouseEnter={() => props.onHoverClaim(claim.id)}
                onMouseLeave={() => props.onHoverClaim(null)}
                onFocusCapture={() => props.onHoverClaim(claim.id)}
                onBlurCapture={event => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onHoverClaim(null);
                }}
              >
                <button type="button" className="map-item-main" onClick={() => props.onFocusClaim(claim)}>
                  <MinecraftAvatar username={claim.minecraftUsername} alt="" loading="lazy" />
                  <span><strong>{claim.projectName}</strong><small>{claim.minecraftUsername} · {t(statusKeys[claim.status])}</small></span>
                  <em>{claim.cellCount ?? claim.cells.length}</em>
                </button>
                {props.canEditClaim(claim) ? <button type="button" className="map-item-edit" onClick={() => props.onEditClaim(claim)} aria-label={t("map.claim.editTitle")}><Pencil size={15} /></button> : null}
              </article>
            ))}
            {visible && !claims.length ? <p className="map-list-empty">{t("map.sidebar.empty")}</p> : null}
          </div>
        </div>
      ) : (
        <div className="map-sidebar-list" role="tabpanel" id={markersPanelId} aria-labelledby={markersTabId}>
          {markers.map(marker => {
            const Icon = marker.iconType === "building" ? Building2 : marker.iconType === "machine" ? Cpu : MapPin;
            return (
              <article className="map-sidebar-item marker-item" key={marker.id} style={{ "--claim-color": marker.color } as React.CSSProperties}>
                <button type="button" className="map-item-main" onClick={() => props.onFocusMarker(marker)}>
                  <i><Icon size={17} /></i><span><strong>{marker.name}</strong><small>{t(`map.marker.${marker.iconType}` as TranslationKey)}</small></span>
                </button>
                {props.canManage ? <button type="button" className="map-item-edit" onClick={() => props.onEditMarker(marker)} aria-label={t("map.marker.title")}><Pencil size={15} /></button> : null}
              </article>
            );
          })}
          {visible && !markers.length ? <p className="map-list-empty">{t("map.sidebar.empty")}</p> : null}
        </div>
      )}
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
