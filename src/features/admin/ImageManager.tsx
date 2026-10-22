import { ChevronDown, ChevronUp, GripVertical, ImagePlus, Save, Trash2, Upload, Video } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/Dialog";
import { SelectField } from "../../components/SelectField";
import { TownMedia } from "../../components/TownMedia";
import type { TownImage, TownImageArea, TownImageLayout } from "../../domain/types";
import { getErrorTranslationKey } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nContext";
import type { TranslationKey } from "../../i18n/translations";
import {
  deleteTownImage,
  importBilibiliVideo,
  saveTownImages,
  uploadTownImage
} from "../../services/siteRepository";

interface ImageManagerProps {
  images: TownImage[];
  setImages: (images: TownImage[]) => void;
  onNotice: (message: string, tone?: "success" | "error") => void;
}

const areas: TownImageArea[] = ["hero", "story", "gallery", "join", "history", "resources", "mapHero", "materialHero", "forumHero", "other"];
const videoAreas: TownImageArea[] = ["story", "gallery", "history", "other"];
const layouts: TownImageLayout[] = ["standard", "wide", "tall"];
const areaTranslationKeys: Record<TownImageArea, TranslationKey> = {
  hero: "admin.images.area.hero",
  story: "admin.images.area.story",
  gallery: "admin.images.area.gallery",
  join: "admin.images.area.join",
  history: "admin.images.area.history",
  resources: "admin.images.area.resources",
  mapHero: "admin.images.area.mapHero",
  materialHero: "admin.images.area.materialHero",
  forumHero: "admin.images.area.forumHero",
  other: "admin.images.area.other"
};
const layoutTranslationKeys: Record<TownImageLayout, TranslationKey> = {
  standard: "admin.images.layout.standard",
  wide: "admin.images.layout.wide",
  tall: "admin.images.layout.tall"
};

// Image metadata and files are managed together so a successful UI state
// always corresponds to persisted Supabase records.
export function ImageManager({ images, setImages, onNotice }: ImageManagerProps) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TownImage | null>(null);
  const [videoInput, setVideoInput] = useState("");
  const [videoDraft, setVideoDraft] = useState({
    area: "gallery" as TownImageArea,
    layout: "wide" as TownImageLayout,
    captionZh: "",
    captionEn: ""
  });
  const [draft, setDraft] = useState({
    area: "gallery" as TownImageArea,
    layout: "standard" as TownImageLayout,
    captionZh: "",
    captionEn: "",
    altZh: "",
    altEn: ""
  });

  function updateImage(next: TownImage) {
    setImages(images.map(image => image.id === next.id ? next : image));
  }

  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    setImages(next);
  }

  function drop(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const sourceIndex = images.findIndex(image => image.id === draggedId);
    const targetIndex = images.findIndex(image => image.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...images];
    const [source] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, source);
    setImages(next);
    setDraggedId(null);
  }

  async function save() {
    setBusy(true);
    try {
      setImages(await saveTownImages(images));
      onNotice(t("admin.saved"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await uploadTownImage(file, draft);
      setImages([...images, uploaded]);
      setFile(null);
      setDraft({ area: "gallery", layout: "standard", captionZh: "", captionEn: "", altZh: "", altEn: "" });
      onNotice(t("admin.saved"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function importVideo(event: FormEvent) {
    event.preventDefault();
    if (!videoInput.trim()) return;
    setBusy(true);
    try {
      const imported = await importBilibiliVideo(videoInput, videoDraft);
      setImages([...images, imported]);
      setVideoInput("");
      setVideoDraft({ area: "gallery", layout: "wide", captionZh: "", captionEn: "" });
      onNotice(t("admin.saved"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(image: TownImage) {
    setBusy(true);
    try {
      await deleteTownImage(image);
      setImages(images.filter(entry => entry.id !== image.id));
      setPendingDelete(null);
      onNotice(t("admin.saved"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="admin-heading">
        <div><h2>{t("admin.images.title")}</h2><p>{t("admin.images.body")}</p></div>
        <button type="button" className="button primary" onClick={() => void save()} disabled={busy}><Save size={17} />{t(busy ? "app.saving" : "app.save")}</button>
      </header>

      <form className="panel image-upload-form" onSubmit={upload}>
        <label className="image-file-picker">
          <Upload size={18} />
          <span>{file?.name ?? t("admin.images.choose")}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <FieldSelect value={draft.area} label={t("admin.images.area")} values={areas} optionLabel={area => t(areaTranslationKeys[area as TownImageArea])} onChange={area => setDraft({ ...draft, area: area as TownImageArea })} />
        <FieldSelect value={draft.layout} label={t("admin.images.layout")} values={layouts} optionLabel={layout => t(layoutTranslationKeys[layout as TownImageLayout])} onChange={layout => setDraft({ ...draft, layout: layout as TownImageLayout })} />
        <input aria-label={t("admin.images.captionZh")} placeholder={t("admin.images.captionZh")} value={draft.captionZh} onChange={event => setDraft({ ...draft, captionZh: event.target.value })} />
        <input aria-label={t("admin.images.captionEn")} placeholder={t("admin.images.captionEn")} value={draft.captionEn} onChange={event => setDraft({ ...draft, captionEn: event.target.value })} />
        <input aria-label={t("admin.images.altZh")} placeholder={t("admin.images.altZh")} value={draft.altZh} onChange={event => setDraft({ ...draft, altZh: event.target.value })} />
        <input aria-label={t("admin.images.altEn")} placeholder={t("admin.images.altEn")} value={draft.altEn} onChange={event => setDraft({ ...draft, altEn: event.target.value })} />
        <button type="submit" className="button primary" disabled={busy || !file}><ImagePlus size={17} />{t("admin.images.upload")}</button>
      </form>

      <form className="panel video-import-form" onSubmit={importVideo}>
        <div className="video-import-intro">
          <Video size={21} />
          <div><strong>{t("admin.images.videoTitle")}</strong><p>{t("admin.images.videoBody")}</p></div>
        </div>
        <input
          aria-label={t("admin.images.videoInput")}
          placeholder={t("admin.images.videoPlaceholder")}
          value={videoInput}
          onChange={event => setVideoInput(event.target.value)}
        />
        <FieldSelect value={videoDraft.area} label={t("admin.images.area")} values={videoAreas} optionLabel={area => t(areaTranslationKeys[area as TownImageArea])} onChange={area => setVideoDraft({ ...videoDraft, area: area as TownImageArea })} />
        <FieldSelect value={videoDraft.layout} label={t("admin.images.layout")} values={layouts} optionLabel={layout => t(layoutTranslationKeys[layout as TownImageLayout])} onChange={layout => setVideoDraft({ ...videoDraft, layout: layout as TownImageLayout })} />
        <input aria-label={t("admin.images.captionZh")} placeholder={t("admin.images.captionZh")} value={videoDraft.captionZh} onChange={event => setVideoDraft({ ...videoDraft, captionZh: event.target.value })} />
        <input aria-label={t("admin.images.captionEn")} placeholder={t("admin.images.captionEn")} value={videoDraft.captionEn} onChange={event => setVideoDraft({ ...videoDraft, captionEn: event.target.value })} />
        <button type="submit" className="button primary" disabled={busy || !videoInput.trim()}>
          <Video size={17} />{t(busy ? "admin.images.videoImporting" : "admin.images.videoImport")}
        </button>
      </form>

      <div className="image-admin-grid">
        {images.map((image, index) => (
          <article
            className={`image-admin-card panel ${draggedId === image.id ? "is-dragging" : ""}`}
            key={image.id}
            onDragOver={event => event.preventDefault()}
            onDrop={() => drop(image.id)}
          >
            <div className="image-admin-preview">
              <TownMedia media={image} alt={image.altZh} loading="lazy" />
              <span>{t(image.mediaType === "bilibili" ? "admin.images.type.bilibili" : "admin.images.type.image")}</span>
            </div>
            <div className="image-admin-fields">
              <span className="image-order">
                <i className="drag-handle" draggable onDragStart={() => setDraggedId(image.id)} onDragEnd={() => setDraggedId(null)} aria-hidden="true"><GripVertical size={18} /></i>
                <button type="button" className="order-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("app.moveUp")}><ChevronUp size={14} /></button>
                {t("admin.images.order", {
                  index: String(index + 1).padStart(2, "0"),
                  area: t(areaTranslationKeys[image.area])
                })}
                <button type="button" className="order-button" disabled={index === images.length - 1} onClick={() => move(index, 1)} aria-label={t("app.moveDown")}><ChevronDown size={14} /></button>
              </span>
              {image.mediaType === "bilibili" ? (
                <small className="image-video-meta">{image.externalId} · {image.creatorName}</small>
              ) : null}
              <input aria-label={t("admin.images.captionZh")} placeholder={t("admin.images.captionZh")} value={image.captionZh} onChange={event => updateImage({ ...image, captionZh: event.target.value })} />
              <input aria-label={t("admin.images.captionEn")} placeholder={t("admin.images.captionEn")} value={image.captionEn} onChange={event => updateImage({ ...image, captionEn: event.target.value })} />
              <input aria-label={t("admin.images.altZh")} placeholder={t("admin.images.altZh")} value={image.altZh} onChange={event => updateImage({ ...image, altZh: event.target.value })} />
              <input aria-label={t("admin.images.altEn")} placeholder={t("admin.images.altEn")} value={image.altEn} onChange={event => updateImage({ ...image, altEn: event.target.value })} />
              <FieldSelect value={image.area} label={t("admin.images.area")} values={image.mediaType === "bilibili" ? videoAreas : areas} optionLabel={area => t(areaTranslationKeys[area as TownImageArea])} onChange={area => updateImage({ ...image, area: area as TownImageArea })} />
              <FieldSelect value={image.layout} label={t("admin.images.layout")} values={layouts} optionLabel={layout => t(layoutTranslationKeys[layout as TownImageLayout])} onChange={layout => updateImage({ ...image, layout: layout as TownImageLayout })} />
              <label className="visibility-toggle">
                <input type="checkbox" checked={image.visible} onChange={event => updateImage({ ...image, visible: event.target.checked })} />
                {t(image.visible ? "app.visible" : "app.hidden")}
              </label>
            </div>
            <button type="button" className="icon-button danger" disabled={busy} onClick={() => setPendingDelete(image)} aria-label={t("app.delete")}><Trash2 size={17} /></button>
          </article>
        ))}
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          title={t("admin.images.deleteTitle")}
          description={t("admin.images.deleteBody", { name: pendingDelete.captionZh || pendingDelete.sourceUrl })}
          busy={busy}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => void remove(pendingDelete)}
        />
      ) : null}
    </div>
  );
}

function FieldSelect({ value, label, values, optionLabel = value => value, onChange }: {
  value: string;
  label: string;
  values: readonly string[];
  optionLabel?: (value: string) => string;
  onChange: (value: string) => void;
}) {
  return <SelectField value={value} label={label} options={values.map(option => ({ value: option, label: optionLabel(option) }))} onChange={onChange} />;
}
