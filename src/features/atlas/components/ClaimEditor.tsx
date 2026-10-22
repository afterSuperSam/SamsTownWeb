import { Save, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmDialog, Dialog } from "../../../components/Dialog";
import { SelectField } from "../../../components/SelectField";
import type { Profile } from "../../../domain/types";
import { roleLabels } from "../../../domain/permissions";
import { useI18n } from "../../../i18n/I18nContext";
import type { TranslationKey } from "../../../i18n/translations";
import type { ChunkCoordinate, ClaimDraft, MapClaim, MapStatus } from "../domain/mapTypes";
import { MapColorPicker } from "./MapColorPicker";

const statuses: MapStatus[] = ["planned", "in_progress", "completed", "paused", "abandoned"];

interface ClaimEditorProps {
  mapId: string;
  initial?: MapClaim;
  cells: ChunkCoordinate[];
  owners: Profile[];
  currentUserId?: string;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: ClaimDraft) => void;
  onDelete: (claim: MapClaim) => void;
}

export function ClaimEditor({ mapId, initial, cells, owners, currentUserId, canManage, busy, onClose, onSave, onDelete }: ClaimEditorProps) {
  const { t } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<ClaimDraft>({
    id: initial?.id,
    mapId,
    ownerId: initial?.ownerId ?? currentUserId,
    projectName: initial?.projectName ?? "",
    minecraftUsername: initial?.minecraftUsername ?? "",
    description: initial?.description ?? "",
    color: initial?.color ?? "#e9a43a",
    status: initial?.status ?? "planned",
    cells
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ ...draft, projectName: draft.projectName.trim(), minecraftUsername: draft.minecraftUsername.trim() });
  }

  if (confirmDelete && initial) {
    return <ConfirmDialog title={t("map.claim.delete")} description={initial.projectName} busy={busy} onClose={() => setConfirmDelete(false)} onConfirm={() => onDelete(initial)} />;
  }

  return <Dialog title={t(initial ? "map.claim.editTitle" : "map.claim.title")} onClose={() => { if (!busy) onClose(); }} className="map-dialog">
      <form className="map-editor-form" onSubmit={submit}>
        <label>{t("map.claim.project")}<input required maxLength={100} value={draft.projectName} onChange={event => setDraft({ ...draft, projectName: event.target.value })} /></label>
        <label>{t("map.claim.minecraft")}<input required maxLength={16} pattern="[A-Za-z0-9_]{1,16}" value={draft.minecraftUsername} onChange={event => setDraft({ ...draft, minecraftUsername: event.target.value })} /></label>
        <label className="map-field-wide">{t("map.claim.description")}<textarea rows={4} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <label>{t("map.claim.status")}<SelectField value={draft.status} label={t("map.claim.status")} options={statuses.map(status => ({ value: status, label: t(`map.status.${status}` as TranslationKey) }))} onChange={status => setDraft({ ...draft, status })} /></label>
        <label>{t("map.claim.color")}<MapColorPicker value={draft.color} label={t("map.claim.color")} onChange={color => setDraft({ ...draft, color })} /></label>
        {canManage ? <label className="map-field-wide">{t("map.claim.transfer")}<SelectField value={draft.ownerId ?? ""} label={t("map.claim.transfer")} options={owners.map(owner => ({ value: owner.id, label: `${owner.username} · ${roleLabels[owner.role]}` }))} onChange={ownerId => setDraft({ ...draft, ownerId })} disabled={!owners.length} /></label> : null}
        <p className="map-editor-meta">{t("map.claim.cells", { count: cells.length })}</p>
        <div className="button-row end map-field-wide">
          {initial ? <button type="button" className="button danger" onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 size={16} />{t("map.claim.delete")}</button> : null}
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>{t("app.cancel")}</button>
          <button type="submit" className="button primary" disabled={busy || !cells.length}><Save size={16} />{t(busy ? "app.saving" : "map.claim.save")}</button>
        </div>
      </form>
    </Dialog>;
}
