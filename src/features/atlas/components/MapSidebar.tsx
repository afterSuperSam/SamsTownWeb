import { Building2, Cpu, MapPin, Pencil, Search, Shapes } from "lucide-react";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { SelectField } from "../../../components/SelectField";
import { useI18n } from "../../../i18n/I18nContext";
import type { TranslationKey } from "../../../i18n/translations";
import type { MapClaim, MapMarker, MapStatus } from "../domain/mapTypes";
import { MinecraftAvatar } from "./MinecraftAvatar";

const statusKeys: Record<MapStatus, TranslationKey> = {
  planned: "map.status.planned",
  in_progress: "map.status.in_progress",
  completed: "map.status.completed",
  paused: "map.status.paused",
  abandoned: "map.status.abandoned"
};

interface MapSidebarProps {
  claims: MapClaim[];
  markers: MapMarker[];
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
  const claimsTabId = useId();
  const markersTabId = useId();
  const claimsPanelId = useId();
  const markersPanelId = useId();
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const members = useMemo(() => [...new Set(props.claims.map(claim => claim.minecraftUsername))].sort(), [props.claims]);
  const colors = useMemo(() => [...new Set(props.claims.map(claim => claim.color))], [props.claims]);
  const claims = useMemo(() => props.claims.filter(claim => {
    const matchesText = !deferredQuery || `${claim.projectName} ${claim.minecraftUsername} ${claim.description}`.toLowerCase().includes(deferredQuery);
    return matchesText
      && (status === "all" || claim.status === status)
      && (member === "all" || claim.minecraftUsername === member)
      && (color === "all" || claim.color === color)
      && (!mine || claim.ownerId === props.currentUserId);
  }), [color, deferredQuery, member, mine, props.claims, props.currentUserId, status]);
  const markers = useMemo(() => props.markers.filter(marker =>
    !deferredQuery || `${marker.name} ${marker.description}`.toLowerCase().includes(deferredQuery)
  ), [deferredQuery, props.markers]);

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
          <Shapes size={16} />{t("map.sidebar.claims")}<span>{props.claims.length}</span>
        </button>
        <button type="button" role="tab" id={markersTabId} tabIndex={tab === "markers" ? 0 : -1} aria-selected={tab === "markers"} aria-controls={markersPanelId} className={tab === "markers" ? "active" : ""} onClick={() => setTab("markers")} onKeyDown={moveTab}>
          <MapPin size={16} />{t("map.sidebar.markers")}<span>{props.markers.length}</span>
        </button>
      </div>
      <label className="map-search">
        <Search size={16} />
        <input aria-label={t("map.sidebar.search")} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("map.sidebar.search")} />
      </label>

      {tab === "claims" ? (
        <div role="tabpanel" id={claimsPanelId} aria-labelledby={claimsTabId}>
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
                  <em>{claim.cells.length}</em>
                </button>
                {props.canEditClaim(claim) ? <button type="button" className="map-item-edit" onClick={() => props.onEditClaim(claim)} aria-label={t("map.claim.editTitle")}><Pencil size={15} /></button> : null}
              </article>
            ))}
            {!claims.length ? <p className="map-list-empty">{t("map.sidebar.empty")}</p> : null}
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
          {!markers.length ? <p className="map-list-empty">{t("map.sidebar.empty")}</p> : null}
        </div>
      )}
    </aside>
  );
}
