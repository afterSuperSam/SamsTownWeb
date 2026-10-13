import { Button } from "../../../components/Button";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmDialog, Dialog, DialogActions } from "../../../components/Dialog";
import { SelectField } from "../../../components/SelectField";
import { useI18n } from "../../../i18n/I18nContext";
import type { TranslationKey } from "../../../i18n/translations";
import type { MapMarker, MarkerDraft, MarkerIconType } from "../domain/mapTypes";
import { MapColorPicker } from "./MapColorPicker";

const icons: MarkerIconType[] = ["building", "machine", "other"];

export function MarkerEditor({ mapId, point, initial, busy, onClose, onSave, onDelete }: {
  mapId: string;
  point: { x: number; y: number };
  initial?: MapMarker;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: MarkerDraft) => void;
  onDelete: (marker: MapMarker) => void;
}) {
  const { t } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<MarkerDraft>({
    id: initial?.id,
    mapId,
    name: initial?.name ?? "",
    iconType: initial?.iconType ?? "other",
    color: initial?.color ?? "#f2b84b",
    description: initial?.description ?? "",
    pixelX: initial?.pixelX ?? point.x,
    pixelY: initial?.pixelY ?? point.y
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ ...draft, name: draft.name.trim() });
  };
  if (confirmDelete && initial) {
    return <ConfirmDialog title={t("map.marker.delete")} description={initial.name} busy={busy} onClose={() => setConfirmDelete(false)} onConfirm={() => onDelete(initial)} />;
  }
  return <Dialog title={t("map.marker.title")} onClose={onClose} dismissible={!busy} className="map-dialog">
      <form className="map-editor-form" onSubmit={submit}>
        <label>{t("map.marker.name")}<input required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>{t("map.marker.icon")}<SelectField value={draft.iconType} label={t("map.marker.icon")} options={icons.map(icon => ({ value: icon, label: t(`map.marker.${icon}` as TranslationKey) }))} onChange={iconType => setDraft({ ...draft, iconType })} /></label>
        <label className="map-field-wide">{t("map.marker.description")}<textarea rows={4} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <label>{t("map.claim.color")}<MapColorPicker value={draft.color} label={t("map.claim.color")} onChange={color => setDraft({ ...draft, color })} /></label>
        <p className="map-editor-meta">{t("map.marker.locationRecorded")}</p>
        <DialogActions busy={busy} onClose={onClose} className="map-field-wide" saveLabel={t("map.marker.save")}>
          {initial ? <Button type="button" className="danger" onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 size={16} />{t("map.marker.delete")}</Button> : null}
        </DialogActions>
      </form>
    </Dialog>;
}
