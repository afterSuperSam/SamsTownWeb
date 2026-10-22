import { CircleHelp, FileArchive, FileJson, PackagePlus, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Dialog } from "../../../components/Dialog";
import { SelectField } from "../../../components/SelectField";
import { getErrorTranslationKey } from "../../../i18n/errors";
import { useI18n } from "../../../i18n/I18nContext";
import { createMaterialProject, saveMaterialProjection, updateMaterialProject } from "../data/materialRepository";
import { MAX_MATERIAL_FILE_SIZE, parseLitematicaMaterialList } from "../domain/materialList";
import type { ImportedMaterialList, MaterialProject, MaterialProjectionTransform } from "../domain/materialTypes";
import { formatCount, StarPicker } from "./MaterialPrimitives";

type Notice = (message: string, tone?: "success" | "error") => void;
const emptyProjection: MaterialProjectionTransform = { originX: 0, originY: 0, originZ: 0, mirror: "none", rotation: 0 };

export function ImportProjectDialog({ onClose, onCreated, onNotice }: {
  onClose: () => void;
  onCreated: () => Promise<void>;
  onNotice: Notice;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<ImportedMaterialList | null>(null);
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3>(1);
  const [storageLocation, setStorageLocation] = useState("");
  const [projection, setProjection] = useState<MaterialProjectionTransform>(emptyProjection);
  const [projectionFile, setProjectionFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      if (file.size > MAX_MATERIAL_FILE_SIZE) throw new Error("error.materialFileTooLarge");
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("error.invalidMaterialList");
      const parsed = parseLitematicaMaterialList(await file.text());
      setList(parsed);
      setFileName(file.name);
      setName(parsed.name);
    } catch (caught) {
      setList(null);
      setFileName("");
      setError(t(getErrorTranslationKey(caught)));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!list || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const projectId = await createMaterialProject(list, { name, priority, storageLocation, ...projection });
      if (projectionFile) {
        await saveMaterialProjection({ id: projectId, projectionStoragePath: null }, projection, projectionFile);
      }
      await onCreated();
      onNotice(t("materials.saved"));
      onClose();
    } catch (caught) {
      setError(t(getErrorTranslationKey(caught)));
    } finally {
      setBusy(false);
    }
  }

  const totalBlocks = list?.materials.reduce((sum, material) => sum + material.totalCount, 0) ?? 0;
  return <Dialog title={t("materials.import.title")} onClose={onClose} className="material-dialog" dismissible={!busy}>
    <p className="material-dialog-lead">{t("materials.import.body")}</p>
    <form className="material-dialog-form" onSubmit={submit}>
      <label className="material-file-picker">
        <FileJson size={23} />
        <span><strong>{fileName || t("materials.import.choose")}</strong><small>JSON · MAX 5 MB</small></span>
        <input type="file" accept="application/json,.json" onChange={event => void chooseFile(event.target.files?.[0])} />
      </label>
      <label>{t("materials.import.name")}<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{t("materials.import.location")}<textarea className="material-location-input" rows={2} maxLength={500} value={storageLocation} onChange={event => setStorageLocation(event.target.value)} /></label>
      <ProjectionFields value={projection} onChange={setProjection} />
      <ProjectionFilePicker fileName={projectionFile?.name ?? ""} onChange={setProjectionFile} />
      <div className="material-field"><span>{t("materials.priority")}</span><StarPicker value={priority} onChange={setPriority} /></div>
      <aside className="material-import-guide">
        <CircleHelp size={20} />
        <div>
          <strong>{t("materials.import.guideTitle")}</strong>
          <p>{t("materials.import.guideStep")}</p>
          <p>{t("materials.import.guidePath")}</p>
        </div>
      </aside>
      {list ? <div className="material-import-preview"><PackagePlus size={19} /><span>{t("materials.import.preview", { items: list.materials.length, blocks: formatCount(totalBlocks) })}</span></div> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="submit" className="button primary" disabled={busy || !list || !name.trim()}>
        <PackagePlus size={17} />{t(busy ? "materials.import.busy" : "materials.import.submit")}
      </button>
    </form>
  </Dialog>;
}

export function EditProjectDialog({ project, onClose, onSaved, onNotice }: {
  project: MaterialProject;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onNotice: Notice;
}) {
  const { t } = useI18n();
  const [priority, setPriority] = useState(project.priority);
  const [storageLocation, setStorageLocation] = useState(project.storageLocation);
  const [projection, setProjection] = useState<MaterialProjectionTransform>({
    originX: project.originX,
    originY: project.originY,
    originZ: project.originZ,
    mirror: project.mirror,
    rotation: project.rotation
  });
  const [projectionFile, setProjectionFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await updateMaterialProject(project.id, priority, storageLocation);
      await saveMaterialProjection(project, projection, projectionFile);
      await onSaved();
      onNotice(t("materials.saved"));
      onClose();
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={t("materials.edit.title")} onClose={onClose} className="material-dialog" dismissible={!busy}>
    <form className="material-dialog-form" onSubmit={submit}>
      <div className="material-field"><span>{t("materials.priority")}</span><StarPicker value={priority} onChange={setPriority} /></div>
      <label>{t("materials.import.location")}<textarea className="material-location-input" rows={2} maxLength={500} value={storageLocation} onChange={event => setStorageLocation(event.target.value)} /></label>
      <ProjectionFields value={projection} onChange={setProjection} />
      <ProjectionFilePicker fileName={projectionFile?.name ?? project.projectionFileName ?? ""} onChange={setProjectionFile} replacing={Boolean(project.projectionFileName)} />
      <button type="submit" className="button primary" disabled={busy}><Save size={17} />{t(busy ? "app.saving" : "materials.edit.save")}</button>
    </form>
  </Dialog>;
}

function ProjectionFields({ value, onChange }: {
  value: MaterialProjectionTransform;
  onChange: (value: MaterialProjectionTransform) => void;
}) {
  const { t } = useI18n();
  const setCoordinate = (key: "originX" | "originY" | "originZ", raw: string) =>
    onChange({ ...value, [key]: Number.parseInt(raw || "0", 10) || 0 });
  return <fieldset className="material-projection-fields">
    <legend>{t("materials.projection.title")}</legend>
    <div className="material-projection-control material-coordinate-control">
      <div className="material-coordinate-grid">
        {(["originX", "originY", "originZ"] as const).map(key => <label key={key}>{key.slice(-1)}<input type="number" value={value[key]} onChange={event => setCoordinate(key, event.target.value)} /></label>)}
      </div>
    </div>
    <div className="material-projection-control">
      <span>{t("materials.projection.mirror")}</span>
      <SelectField value={value.mirror} label={t("materials.projection.mirror")} options={(["none", "left_right", "front_back"] as const).map(mirror => ({ value: mirror, label: t(`materials.projection.mirror.${mirror}`) }))} onChange={mirror => onChange({ ...value, mirror })} />
    </div>
    <div className="material-projection-control">
      <span>{t("materials.projection.rotation")}</span>
      <SelectField value={String(value.rotation)} label={t("materials.projection.rotation")} options={([0, 90, 180, 270] as const).map(rotation => ({ value: String(rotation), label: t(`materials.projection.rotation.${rotation}`) }))} onChange={rotation => onChange({ ...value, rotation: Number(rotation) as MaterialProjectionTransform["rotation"] })} />
    </div>
  </fieldset>;
}

function ProjectionFilePicker({ fileName, onChange, replacing = false }: {
  fileName: string;
  onChange: (file: File | null) => void;
  replacing?: boolean;
}) {
  const { t } = useI18n();
  return <label className="material-file-picker compact">
    <FileArchive size={22} />
    <span><strong>{fileName || t("materials.projection.choose")}</strong><small>{t(replacing ? "materials.projection.replaceHint" : "materials.projection.fileHint")}</small></span>
    <input type="file" accept=".litematic,.schem,.schematic,.nbt" onChange={event => onChange(event.target.files?.[0] ?? null)} />
  </label>;
}
