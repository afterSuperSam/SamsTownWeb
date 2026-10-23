import { Button } from "../../../components/Button";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmDialog, Dialog, DialogActions } from "../../../components/Dialog";
import { SelectField } from "../../../components/SelectField";
import type { Profile } from "../../../domain/types";
import { roleLabels } from "../../../domain/permissions";
import { useI18n } from "../../../i18n/I18nContext";
import type { ChunkCoordinate, ProjectDraft, MapProject } from "../domain/mapTypes";
import { MapColorPicker } from "./MapColorPicker";

interface ProjectEditorProps {
  mapId: string;
  initial?: MapProject;
  cells: ChunkCoordinate[];
  owners: Profile[];
  currentUserId?: string;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: ProjectDraft) => void;
  onDelete: (project: MapProject) => void;
}

export function ProjectEditor({ mapId, initial, cells, owners, currentUserId, canManage, busy, onClose, onSave, onDelete }: ProjectEditorProps) {
  const { t } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<ProjectDraft>({
    id: initial?.id,
    mapId,
    ownerId: initial?.ownerId ?? currentUserId,
    projectName: initial?.projectName ?? "",
    minecraftUsername: initial?.minecraftUsername ?? "",
    description: initial?.description ?? "",
    color: initial?.color ?? "#e9a43a",
    cells
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ ...draft, projectName: draft.projectName.trim(), minecraftUsername: draft.minecraftUsername.trim() });
  }

  if (confirmDelete && initial) {
    return <ConfirmDialog title={t("map.claim.delete")} description={initial.projectName} busy={busy} onClose={() => setConfirmDelete(false)} onConfirm={() => onDelete(initial)} />;
  }

  return <Dialog title={t(initial ? "map.claim.editTitle" : "map.claim.title")} onClose={onClose} dismissible={!busy} className="map-dialog">
      <form className="map-editor-form" onSubmit={submit}>
        <label>{t("map.claim.project")}<input required maxLength={100} value={draft.projectName} onChange={event => setDraft({ ...draft, projectName: event.target.value })} /></label>
        <label>{t("map.claim.minecraft")}<input required maxLength={16} pattern="[A-Za-z0-9_]{1,16}" value={draft.minecraftUsername} onChange={event => setDraft({ ...draft, minecraftUsername: event.target.value })} /></label>
        <label className="map-field-wide">{t("map.claim.description")}<textarea rows={8} maxLength={4000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <div className="map-color-field"><span>{t("map.claim.color")}</span><MapColorPicker value={draft.color} label={t("map.claim.color")} onChange={color => setDraft({ ...draft, color })} /></div>
        {canManage ? <label className="map-field-wide">{t("map.claim.transfer")}<SelectField value={draft.ownerId ?? ""} label={t("map.claim.transfer")} options={owners.map(owner => ({ value: owner.id, label: `${owner.username} · ${t(roleLabels[owner.role])}` }))} onChange={ownerId => setDraft({ ...draft, ownerId })} disabled={!owners.length} /></label> : null}
        <p className="map-editor-meta">{t("map.claim.cells", { count: cells.length })}</p>
        <DialogActions busy={busy} onClose={onClose} className="map-field-wide" saveLabel={t("map.claim.save")} disabled={!cells.length}>
          {initial ? <Button type="button" className="danger" onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 size={16} />{t("map.claim.delete")}</Button> : null}
        </DialogActions>
      </form>
    </Dialog>;
}
