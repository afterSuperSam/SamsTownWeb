import {
  Download,
  ExternalLink,
  File,
  FileArchive,
  Image,
  PackagePlus,
  RefreshCw,
  Search,
  Trash2,
  Upload
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { ConfirmDialog, Dialog } from "../components/Dialog";
import { HeroTransition } from "../components/HeroTransition";
import { ResourceIcon } from "../components/ResourceIcon";
import { RetryNotice } from "../components/RetryNotice";
import { SelectField } from "../components/SelectField";
import { PageLoading } from "../components/TerrainLoading";
import { TownImage } from "../components/TownImage";
import { can } from "../domain/permissions";
import type { Resource, SharedFile } from "../domain/types";
import { ResourceImportDialog } from "../features/resources/ResourceImportDialog";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { useTownHero } from "../hooks/useTownHero";
import { safeExternalUrl } from "../lib/externalUrl";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  checkResourceUpdate,
  deleteResource,
  deleteSharedFile,
  getResourceStats,
  getSharedFileDownloadUrl,
  listCheckableResources,
  listResourceLoaders,
  listResourcesPage,
  listSharedFilesPage,
  uploadSharedFile,
  type ResourceFilter,
  type ResourceStats
} from "../services/resourceRepository";
import { useAuth } from "../state/AuthContext";

type DeleteTarget = { kind: "resource"; value: Resource } | { kind: "file"; value: SharedFile };
type ResourceNotice = { text: string; tone: "success" | "error" } | null;
const filters: ResourceFilter[] = ["all", "plugin", "datapack", "github", "updates"];
const emptyStats: ResourceStats = { total: 0, plugin: 0, datapack: 0, github: 0, updates: 0 };
const pageSize = 10;

// Resource center -----------------------------------------------------------
export function ResourcesPage() {
  const { profile } = useAuth();
  const { language, t } = useI18n();
  const canContribute = can(profile?.role, "resources");
  const canDelete = can(profile?.role, "admin");
  const [resources, setResources] = useState<Resource[]>([]);
  const { image: heroImage, ready: heroReady, error: heroError, retry: retryHero } = useTownHero("resources");
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [stats, setStats] = useState<ResourceStats>(emptyStats);
  const [loaders, setLoaders] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [loader, setLoader] = useState("all");
  const [projectPage, setProjectPage] = useState(1);
  const [projectTotal, setProjectTotal] = useState(0);
  const [filePage, setFilePage] = useState(1);
  const [fileTotal, setFileTotal] = useState(0);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(true);
  const [projectsReady, setProjectsReady] = useState(false);
  const [filesReady, setFilesReady] = useState(false);
  const [dialog, setDialog] = useState<"import" | "file" | null>(null);
  const [detail, setDetail] = useState<Resource | null>(null);
  const [message, setMessage] = useState<ResourceNotice>(null);
  const [checking, setChecking] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const requestRevision = useRef(0);
  const fileRequestRevision = useRef(0);
  const summaryRequestRevision = useRef(0);

  const loadProjects = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setProjectsLoading(false);
      setProjectsReady(true);
      return;
    }
    const revision = ++requestRevision.current;
    setProjectsLoading(true);
    try {
      const result = await listResourcesPage({
        page: projectPage,
        pageSize,
        search: deferredQuery,
        filter,
        loader
      });
      if (revision !== requestRevision.current) return;
      setResources(result.items);
      setProjectTotal(result.total);
      setMessage(null);
    } catch (error) {
      if (revision === requestRevision.current) setMessage({ text: t(getErrorTranslationKey(error)), tone: "error" });
    } finally {
      if (revision === requestRevision.current) {
        setProjectsLoading(false);
        setProjectsReady(true);
      }
    }
  }, [deferredQuery, filter, loader, projectPage, t]);

  const loadFiles = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setFilesLoading(false);
      setFilesReady(true);
      return;
    }
    const revision = ++fileRequestRevision.current;
    setFilesLoading(true);
    try {
      const result = await listSharedFilesPage(filePage, pageSize);
      if (revision !== fileRequestRevision.current) return;
      setFiles(result.items);
      setFileTotal(result.total);
    } catch (error) {
      if (revision === fileRequestRevision.current) setMessage({ text: t(getErrorTranslationKey(error)), tone: "error" });
    } finally {
      if (revision === fileRequestRevision.current) {
        setFilesLoading(false);
        setFilesReady(true);
      }
    }
  }, [filePage, t]);

  const loadSummary = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const revision = ++summaryRequestRevision.current;
    try {
      const [nextStats, nextLoaders] = await Promise.all([getResourceStats(), listResourceLoaders()]);
      if (revision !== summaryRequestRevision.current) return;
      setStats(nextStats);
      setLoaders(nextLoaders);
    } catch (error) {
      if (revision === summaryRequestRevision.current) setMessage({ text: t(getErrorTranslationKey(error)), tone: "error" });
    }
  }, [t]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);
  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);
  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    setProjectPage(1);
  }, [deferredQuery, filter, loader]);
  useEffect(() => () => {
    requestRevision.current += 1;
    fileRequestRevision.current += 1;
    summaryRequestRevision.current += 1;
  }, []);

  const projectPages = Math.max(1, Math.ceil(projectTotal / pageSize));
  const filePages = Math.max(1, Math.ceil(fileTotal / pageSize));
  useEffect(() => {
    if (projectPage > projectPages) setProjectPage(projectPages);
  }, [projectPage, projectPages]);
  useEffect(() => {
    if (filePage > filePages) setFilePage(filePages);
  }, [filePage, filePages]);
  const statsCards = useMemo(() => [
    { filter: "all" as const, key: "resources.stats.total" as const, value: stats.total },
    { filter: "plugin" as const, key: "resources.stats.plugin" as const, value: stats.plugin },
    { filter: "datapack" as const, key: "resources.stats.datapack" as const, value: stats.datapack },
    { filter: "github" as const, key: "resources.stats.github" as const, value: stats.github },
    { filter: "updates" as const, key: "resources.stats.updates" as const, value: stats.updates },
    { filter: null, key: "resources.stats.shared" as const, value: fileTotal }
  ], [fileTotal, stats]);

  async function refreshAfterMutation() {
    await Promise.all([loadProjects(), loadFiles(), loadSummary()]);
  }

  function selectStatsCard(nextFilter: ResourceFilter | null) {
    if (nextFilter) {
      setFilter(nextFilter);
      return;
    }
    document.getElementById("shared-files")?.scrollIntoView({ behavior: "smooth" });
  }

  async function confirmDelete() {
    if (!deleteTarget || !canDelete) return;
    setDeleting(true);
    setMessage(null);
    try {
      if (deleteTarget.kind === "resource") {
        await deleteResource(deleteTarget.value.id);
        setDetail(null);
      } else {
        await deleteSharedFile(deleteTarget.value);
      }
      setDeleteTarget(null);
      await refreshAfterMutation();
    } catch (error) {
      setMessage({ text: t(getErrorTranslationKey(error)), tone: "error" });
    } finally {
      setDeleting(false);
    }
  }

  async function checkUpdates() {
    setChecking(true);
    setMessage(null);
    try {
      const checkable = await listCheckableResources();
      const results: PromiseSettledResult<Resource>[] = [];
      for (let start = 0; start < checkable.length; start += 4) {
        results.push(...await Promise.allSettled(checkable.slice(start, start + 4).map(checkResourceUpdate)));
      }
      const updated = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      const failed = results.length - updated.length;
      const byId = new Map(updated.map(resource => [resource.id, resource]));
      setResources(current => current.map(resource => byId.get(resource.id) ?? resource));
      setMessage({
        text: t(failed ? "resources.updateResultPartial" : "resources.updateResult", {
          count: updated.length,
          updates: updated.filter(resource => resource.updateAvailable).length,
          failed
        }),
        tone: failed ? "error" : "success"
      });
      await loadSummary();
    } catch (error) {
      setMessage({ text: t(getErrorTranslationKey(error)), tone: "error" });
    } finally {
      setChecking(false);
    }
  }

  async function downloadFile(item: SharedFile) {
    try {
      const url = await getSharedFileDownloadUrl(item.storagePath);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName;
      anchor.click();
    } catch (error) {
      setMessage({ text: t(getErrorTranslationKey(error)), tone: "error" });
    }
  }

  if (!projectsReady || !filesReady || !heroReady) return <PageLoading label={t("app.loading.terrain")} />;

  return (
    <main className="resource-manager-page ambient-page">
      <header className="rm-header page-hero">
        {heroImage ? (
          <TownImage
            className="page-hero-image"
            source={heroImage.sourceUrl}
            alt={language === "zh-CN" ? heroImage.altZh : heroImage.altEn}
            loading="eager"
            fetchPriority="high"
          />
        ) : null}
        <div className="page-hero-shade" />
        <div className="hero-copy-sequence"><span className="eyebrow">{t("resources.eyebrow")}</span><h1>{t("resources.title")}</h1><p>{t("resources.body")}</p></div>
        {canContribute ? (
          <div className="button-row">
            <button type="button" className="button secondary" onClick={() => setDialog("file")}><Upload size={16} />{t("resources.share")}</button>
            <button type="button" className="button modrinth" onClick={() => setDialog("import")}><PackagePlus size={16} />{t("resources.import")}</button>
          </div>
        ) : null}
      </header>
      <HeroTransition />
      <RetryNotice error={heroError} onRetry={retryHero} />

      <div className="rm-workspace">
        {!isSupabaseConfigured ? <div className="notice">{t("resources.notConfigured")}</div> : null}
        {message ? <div className={`rm-status ${message.tone}`} role={message.tone === "error" ? "alert" : "status"} aria-live="polite">{message.text}</div> : null}

        <section className="rm-stats" aria-label={t("resources.stats.total")}>
          {statsCards.map(card => (
            <Stat
              key={card.key}
              label={t(card.key)}
              value={card.value}
              active={card.filter ? filter === card.filter : undefined}
              onSelect={() => selectStatsCard(card.filter)}
              alert={card.filter === "updates" && card.value > 0}
            />
          ))}
        </section>

        <section className="rm-projects">
          <div className="rm-section-head">
            <div><span>{t("resources.projects.eyebrow")}</span><h2>{t("resources.projects.title")}</h2></div>
            <button type="button" className="button secondary small" disabled={checking || stats.total === 0} onClick={() => void checkUpdates()}>
              <RefreshCw size={15} className={checking ? "spin" : ""} />
              {t(checking ? "resources.projects.checking" : "resources.projects.check")}
            </button>
          </div>
          <div className="rm-toolbar">
            <label className="rm-search">
              <Search size={17} />
              <input aria-label={t("resources.search")} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("resources.search")} />
            </label>
            <SelectField
              className="rm-loader-select"
              value={loader}
              label={t("resources.loaders")}
              options={[
                { value: "all", label: t("resources.loader.all") },
                ...loaders.map(value => ({ value, label: value }))
              ]}
              onChange={setLoader}
            />
            <div className="rm-filter-row segmented-control">
              {filters.map(value => (
                <button type="button" className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>
                  {t(`resources.filter.${value}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="rm-list">
            {projectsLoading ? <ResourceListSkeleton label={t("resources.loading")} /> : resources.map((resource, index) => (
              <ProjectRow
                key={resource.id}
                resource={resource}
                index={index}
                canDelete={canDelete}
                onDetail={setDetail}
                onDelete={value => setDeleteTarget({ kind: "resource", value })}
              />
            ))}
            {!projectsLoading && !resources.length ? (
              <div className="rm-empty"><PackagePlus /><h3>{t("resources.empty.title")}</h3><p>{t("resources.empty.body")}</p></div>
            ) : null}
          </div>
          <Pagination page={projectPage} pages={projectPages} setPage={setProjectPage} />
        </section>

        <section className="rm-files" id="shared-files">
          <div className="rm-section-head">
            <div><span>{t("resources.files.eyebrow")}</span><h2>{t("resources.files.title")}</h2></div>
            <small>{t("resources.files.count", { count: fileTotal })}</small>
          </div>
          <div className="rm-file-list">
            {filesLoading ? <ResourceListSkeleton label={t("resources.loading")} /> : files.map(item => (
              <article className="rm-file-row" key={item.id}>
                <FileGlyph mime={item.mimeType} extension={item.fileName.split(".").pop() ?? ""} />
                <div>
                  <span>{fileCategory(item.category, t)}</span>
                  <h3>{item.name}</h3>
                  <p>{item.description || item.fileName} · {item.author || t("resources.unknownAuthor")} · {formatBytes(item.fileSize)}</p>
                </div>
                <div className="rm-actions">
                  <button className="icon-button" type="button" onClick={() => void downloadFile(item)} aria-label={t("resources.files.download", { name: item.name })}><Download size={17} /></button>
                  {canDelete ? <button type="button" className="icon-button danger" onClick={() => setDeleteTarget({ kind: "file", value: item })} aria-label={t("resources.deleteFile")}><Trash2 size={17} /></button> : null}
                </div>
              </article>
            ))}
            {!filesLoading && !files.length ? (
              <div className="rm-empty compact"><FileArchive /><h3>{t("resources.files.emptyTitle")}</h3><p>{t("resources.files.emptyBody")}</p></div>
            ) : null}
          </div>
          <Pagination page={filePage} pages={filePages} setPage={setFilePage} />
        </section>
      </div>

      {dialog === "import" ? <ResourceImportDialog onClose={() => setDialog(null)} onSaved={refreshAfterMutation} /> : null}
      {dialog === "file" ? <FileDialog onClose={() => setDialog(null)} onSaved={refreshAfterMutation} /> : null}
      {detail ? <DetailDialog resource={detail} canDelete={canDelete} onClose={() => setDetail(null)} onDelete={value => { setDetail(null); setDeleteTarget({ kind: "resource", value }); }} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={t(deleteTarget.kind === "resource" ? "resources.deleteProject" : "resources.deleteFile")}
          description={t("resources.deleteConfirm", { name: deleteTarget.value.name })}
          busy={deleting}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </main>
  );
}

function Stat({ label, value, active, onSelect, alert = false }: {
  label: string;
  value: number;
  active?: boolean;
  onSelect: () => void;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${active ? "active" : ""} ${alert ? "alert" : ""}`}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span>{label}</span><strong>{value}</strong>
    </button>
  );
}

function ProjectRow({ resource, index, canDelete, onDetail, onDelete }: {
  resource: Resource;
  index: number;
  canDelete: boolean;
  onDetail: (value: Resource) => void;
  onDelete: (value: Resource) => void;
}) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const sourceUrl = safeExternalUrl(resource.url);
  return (
    <motion.article
      className="rm-project-row"
      initial={reducedMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay: Math.min(index, 9) * 0.035, ease: [0.22, 1, 0.36, 1] }}
      layout="position"
    >
      <button type="button" className="rm-project-open" onClick={() => onDetail(resource)} aria-label={t("resources.details", { name: resource.name })}>
        <ResourceIcon source={resource.source} iconUrl={resource.iconUrl} />
        <div className="rm-project-copy">
          <div className="rm-title-line">
            <h3>{resource.name}</h3>
            <span className={`rm-type ${resource.resourceType}`}>{resource.resourceType}</span>
            {resource.updateAvailable ? <span className="rm-update">{t("resources.update")}</span> : null}
          </div>
          <p>{resource.description || t("resources.noDescription")}</p>
          <div className="rm-tags">
            {resource.loaders.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}
            {resource.gameVersions.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}
          </div>
        </div>
        <div className="rm-version">
          <span>{t("resources.current")}</span><strong>{resource.currentVersion}</strong>
          {resource.updateAvailable ? <small>→ {resource.latestVersion}</small> : null}
        </div>
      </button>
      <div className="rm-actions">
        {sourceUrl ? <a className="icon-button" href={sourceUrl} target="_blank" rel="noreferrer" aria-label={t("resources.openSource")}><ExternalLink size={17} /></a> : null}
        {canDelete ? <button type="button" className="icon-button danger" onClick={() => onDelete(resource)} aria-label={t("resources.deleteProject")}><Trash2 size={17} /></button> : null}
      </div>
    </motion.article>
  );
}

function DetailDialog({ resource, canDelete, onClose, onDelete }: {
  resource: Resource;
  canDelete: boolean;
  onClose: () => void;
  onDelete: (value: Resource) => void;
}) {
  const { t } = useI18n();
  const sourceUrl = safeExternalUrl(resource.url);
  return (
    <Dialog title={resource.name} onClose={onClose} className="rm-detail">
      <div className="rm-detail-head">
        <ResourceIcon source={resource.source} iconUrl={resource.iconUrl} className="rm-project-icon large" />
        <div><span className={`rm-type ${resource.resourceType}`}>{resource.resourceType}</span><p>{t("resources.author")}: {resource.author || t("resources.unknownAuthor")}</p></div>
      </div>
      <p className="rm-detail-description">{resource.description || t("resources.noDescription")}</p>
      <dl className="rm-detail-grid">
        <div><dt>{t("resources.current")}</dt><dd>{resource.currentVersion}</dd></div>
        <div><dt>{t("resources.latest")}</dt><dd>{resource.latestVersion}</dd></div>
        <div><dt>{t("resources.loaders")}</dt><dd>{resource.loaders.join(", ") || "—"}</dd></div>
        <div><dt>{t("resources.gameVersions")}</dt><dd>{resource.gameVersions.slice(0, 8).join(", ") || "—"}</dd></div>
      </dl>
      <div className="button-row">
        {sourceUrl ? <a className="button modrinth" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t("resources.openSource")}</a> : null}
        {canDelete ? <button type="button" className="button danger" onClick={() => onDelete(resource)}><Trash2 size={16} />{t("resources.deleteProject")}</button> : null}
      </div>
    </Dialog>
  );
}

function FileDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ name: "", author: "", description: "" });
  const [errorKey, setErrorKey] = useState<ReturnType<typeof getErrorTranslationKey> | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setErrorKey("error.requiredFile");
      return;
    }
    setBusy(true);
    setErrorKey(null);
    try {
      await uploadSharedFile(file, form);
      await onSaved();
      onClose();
    } catch (error) {
      setErrorKey(getErrorTranslationKey(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("resources.file.title")} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label className="file-picker">
          <input
            type="file"
            onChange={event => {
              const next = event.target.files?.[0] ?? null;
              setFile(next);
              if (next) setForm(current => current.name ? current : { ...current, name: next.name.replace(/\.[^.]+$/, "") });
            }}
            required
          />
          <span><Upload /><strong>{file ? file.name : t("resources.file.choose")}</strong><small>{t("resources.file.limit")}</small></span>
        </label>
        <label>{t("resources.file.name")}<input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required /></label>
        <label>{t("resources.file.author")}<input value={form.author} onChange={event => setForm(current => ({ ...current, author: event.target.value }))} /></label>
        <label>{t("resources.file.description")}<textarea rows={3} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>
        {errorKey ? <div className="notice error" role="alert">{t(errorKey)}</div> : null}
        <div className="button-row end">
          <button type="button" className="button secondary" onClick={onClose}>{t("app.cancel")}</button>
          <button type="submit" className="button modrinth" disabled={busy}>{t(busy ? "resources.file.busy" : "resources.file.submit")}</button>
        </div>
      </form>
    </Dialog>
  );
}

function Pagination({ page, pages, setPage }: { page: number; pages: number; setPage: (page: number) => void }) {
  const { t } = useI18n();
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label={t("app.page", { page, pages })}>
      <button type="button" className="button small" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("app.previous")}</button>
      <span>{t("app.page", { page, pages })}</span>
      <button type="button" className="button small" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("app.next")}</button>
    </nav>
  );
}

function ResourceListSkeleton({ label }: { label: string }) {
  return <div className="rm-skeleton-list" aria-label={label}><span /><span /><span /></div>;
}

function FileGlyph({ mime, extension }: { mime: string; extension: string }) {
  return <div className="file-glyph">{mime.startsWith("image/") ? <Image /> : extension.toLowerCase() === "litematic" ? <FileArchive /> : <File />}</div>;
}

function fileCategory(category: string, t: ReturnType<typeof useI18n>["t"]) {
  const normalized = ({ "建筑投影": "schematic", "模组 / 插件": "mod", "图片": "image", "文本": "text", "其他文件": "other" } as Record<string, string>)[category] ?? category;
  if (normalized === "schematic") return t("resources.file.category.schematic");
  if (normalized === "mod") return t("resources.file.category.mod");
  if (normalized === "image") return t("resources.file.category.image");
  if (normalized === "text") return t("resources.file.category.text");
  return t("resources.file.category.other");
}

function formatBytes(bytes: number) {
  return bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}
