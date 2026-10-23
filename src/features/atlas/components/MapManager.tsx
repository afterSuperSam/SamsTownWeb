import { Button, SaveButton } from "../../../components/Button";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Dialog } from "../../../components/Dialog";
import { getErrorTranslationKey } from "../../../i18n/errors";
import { useI18n } from "../../../i18n/I18nContext";
import { deleteMap, replaceMapImage, updateMapMetadata, uploadMap } from "../data/mapApi";
import type { MapUploadFields, TownMap } from "../domain/mapTypes";

const emptyFields: MapUploadFields = { name: "", description: "", shortLabel: "", visible: true, sortOrder: 0 };

export function MapManager({ maps, activeMap, onClose, onChanged, onNotice }: {
  maps: TownMap[];
  activeMap: TownMap | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(activeMap?.id ?? "new");
  const selected = maps.find(map => map.id === selectedId) ?? null;
  const [fields, setFields] = useState<MapUploadFields>(emptyFields);
  const [file, setFile] = useState<File | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [confirmDimensionClear, setConfirmDimensionClear] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFields(selected ? {
      name: selected.name,
      description: selected.description,
      shortLabel: selected.shortLabel,
      visible: selected.visible,
      sortOrder: selected.sortOrder
    } : emptyFields);
    setFile(null);
    setReplaceFile(null);
    setDeleteName("");
    setConfirmDimensionClear(false);
  }, [selected]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (file.size >= 50 * 1024 * 1024) {
      onNotice(t("map.error.imageSize"), "error");
      return;
    }
    await run(async () => {
      const created = await uploadMap(file, fields);
      await onChanged();
      setSelectedId(created.id);
    });
  }

  async function saveMetadata(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    await run(async () => {
      await updateMapMetadata(selected.id, fields);
      await onChanged();
    });
  }

  async function replace(clearExisting = false) {
    if (!selected || !replaceFile) return;
    setBusy(true);
    try {
      await replaceMapImage(selected.id, replaceFile, clearExisting);
      setReplaceFile(null);
      setConfirmDimensionClear(false);
      await onChanged();
      onNotice(t("admin.saved"));
    } catch (error) {
      if (error instanceof Error && error.message === "error.mapDimensionsChanged") setConfirmDimensionClear(true);
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || deleteName !== selected.name) return;
    await run(async () => {
      await deleteMap(selected.id, deleteName);
      setSelectedId("new");
      await onChanged();
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      onNotice(t("admin.saved"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("map.manage.title")} onClose={onClose} dismissible={!busy} className="map-manager-dialog">
      <div className="map-manager-layout">
        <nav className="map-manager-list">
          <button type="button" className={selectedId === "new" ? "active" : ""} onClick={() => setSelectedId("new")}><ImagePlus size={16} />{t("map.manage.upload")}</button>
          {maps.map(map => <button type="button" className={selectedId === map.id ? "active" : ""} onClick={() => setSelectedId(map.id)} key={map.id}><span>{map.shortLabel || map.name.slice(0, 2)}</span>{map.name}</button>)}
        </nav>
        {!selected ? (
          <form className="map-editor-form map-manager-form" onSubmit={create}>
            <MapFields fields={fields} setFields={setFields} />
            <FilePicker file={file} onFile={setFile} label={t("map.manage.file")} />
            <div className="button-row end map-field-wide"><Button type="submit" className="primary" disabled={busy || !file}><Upload size={16} />{t(busy ? "map.manage.uploading" : "map.manage.upload")}</Button></div>
          </form>
        ) : (
          <div className="map-manager-sections">
            <form className="map-editor-form map-manager-form" onSubmit={saveMetadata}>
              <MapFields fields={fields} setFields={setFields} />
              <div className="button-row end map-field-wide"><SaveButton type="submit" busy={busy}></SaveButton></div>
            </form>
            <section className="map-manager-danger">
              <h3>{t("map.manage.replace")}</h3>
              <FilePicker file={replaceFile} onFile={setReplaceFile} label={t("map.manage.file")} />
              {confirmDimensionClear ? <p className="form-error">{t("error.mapDimensionsChanged")}</p> : null}
              <button type="button" className={confirmDimensionClear ? "button danger" : "button secondary"} disabled={busy || !replaceFile} onClick={() => void replace(confirmDimensionClear)}>{t(confirmDimensionClear ? "app.confirm" : "map.manage.replace")}</button>
            </section>
            <section className="map-manager-danger">
              <h3>{t("map.manage.delete")}</h3>
              <p>{t("map.manage.deleteHint", { name: selected.name })}</p>
              <input value={deleteName} onChange={event => setDeleteName(event.target.value)} />
              <Button type="button" className="danger" disabled={busy || deleteName !== selected.name} onClick={() => void remove()}><Trash2 size={16} />{t("map.manage.delete")}</Button>
            </section>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function MapFields({ fields, setFields }: { fields: MapUploadFields; setFields: (fields: MapUploadFields) => void }) {
  const { t } = useI18n();
  return <>
    <label>{t("map.manage.name")}<input required maxLength={80} value={fields.name} onChange={event => setFields({ ...fields, name: event.target.value })} /></label>
    <label>{t("map.manage.label")}<input maxLength={24} value={fields.shortLabel} onChange={event => setFields({ ...fields, shortLabel: event.target.value })} /></label>
    <label className="map-field-wide">{t("map.manage.description")}<textarea rows={4} maxLength={4000} value={fields.description} onChange={event => setFields({ ...fields, description: event.target.value })} /></label>
    <label>{t("map.manage.visibility")}<span className="map-checkbox"><input type="checkbox" checked={fields.visible} onChange={event => setFields({ ...fields, visible: event.target.checked })} />{t(fields.visible ? "app.visible" : "app.hidden")}</span></label>
    <label>{t("map.manage.order")}<input type="number" value={fields.sortOrder ?? 0} onChange={event => setFields({ ...fields, sortOrder: Number(event.target.value) })} /></label>
  </>;
}

function FilePicker({ file, onFile, label }: { file: File | null; onFile: (file: File | null) => void; label: string }) {
  return <label className="map-file-picker map-field-wide"><Upload size={17} /><span>{file?.name ?? label}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/tiff" onChange={event => onFile(event.target.files?.[0] ?? null)} /></label>;
}
