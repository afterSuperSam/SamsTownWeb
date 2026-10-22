import {
  ExternalLink,
  Layers3,
  PackagePlus,
  Pencil,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { ResourceIcon } from "../../components/ResourceIcon";
import type { Resource } from "../../domain/types";
import {
  ImportProjectDialog,
  StarPicker,
  formatCount
} from "../material/components/MaterialDialogs";
import {
  administerMaterialProject,
  deleteMaterialProject,
  getMaterialWorkspace
} from "../material/data/materialRepository";
import type { MaterialProject, MaterialWorkspace } from "../material/domain/materialTypes";
import { ResourceImportDialog } from "../resources/ResourceImportDialog";
import { getErrorTranslationKey } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nContext";
import { safeExternalUrl } from "../../lib/externalUrl";
import {
  checkResourceUpdate,
  deleteResource,
  listResourcesPage,
  updateResourceDetails
} from "../../services/resourceRepository";

type Section = "catalogue" | "materials";
type DialogState =
  | { kind: "importResource" }
  | { kind: "editResource"; value: Resource }
  | { kind: "importMaterial" }
  | { kind: "editMaterial"; value: MaterialProject }
  | null;
type DeleteTarget =
  | { kind: "resource"; value: Resource }
  | { kind: "material"; value: MaterialProject }
  | null;

const emptyWorkspace: MaterialWorkspace = {
  projects: [],
  items: [],
  assignments: [],
  leaderboard: []
};
const pageSize = 10;

// One administration module owns both project catalogues. AdminPage only
// selects this module; loading, mutation refreshes, and destructive confirms
// stay local to the resource-management seam.
export function ResourceManagementPanel({ onNotice }: {
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("catalogue");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourcePage, setResourcePage] = useState(1);
  const [resourceTotal, setResourceTotal] = useState(0);
  const [workspace, setWorkspace] = useState<MaterialWorkspace>(emptyWorkspace);
  const [loadingResources, setLoadingResources] = useState(true);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const resourceRevision = useRef(0);
  const materialRevision = useRef(0);

  const loadResources = useCallback(async () => {
    const revision = ++resourceRevision.current;
    setLoadingResources(true);
    try {
      const result = await listResourcesPage({
        page: resourcePage,
        pageSize,
        search: deferredQuery
      });
      if (revision === resourceRevision.current) {
        const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
        if (resourcePage > lastPage) {
          setResourcePage(lastPage);
          return;
        }
        setResources(result.items);
        setResourceTotal(result.total);
      }
    } catch (error) {
      if (revision === resourceRevision.current) onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      if (revision === resourceRevision.current) setLoadingResources(false);
    }
  }, [deferredQuery, onNotice, resourcePage, t]);

  const loadMaterials = useCallback(async () => {
    const revision = ++materialRevision.current;
    setLoadingMaterials(true);
    try {
      const nextWorkspace = await getMaterialWorkspace();
      if (revision === materialRevision.current) setWorkspace(nextWorkspace);
    } catch (error) {
      if (revision === materialRevision.current) onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      if (revision === materialRevision.current) setLoadingMaterials(false);
    }
  }, [onNotice, t]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);
  useEffect(() => {
    if (section === "materials") void loadMaterials();
  }, [loadMaterials, section]);
  useEffect(() => () => {
    resourceRevision.current += 1;
    materialRevision.current += 1;
  }, []);
  useEffect(() => {
    setResourcePage(1);
  }, [deferredQuery]);

  const materialProjects = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase();
    if (!search) return workspace.projects;
    return workspace.projects.filter(project =>
      `${project.name} ${project.storageLocation} ${project.creatorUsername}`.toLowerCase().includes(search)
    );
  }, [deferredQuery, workspace.projects]);
  const resourcePages = Math.max(1, Math.ceil(resourceTotal / pageSize));
  const currentLoading = section === "catalogue" ? loadingResources : loadingMaterials;

  async function checkUpdate(resource: Resource) {
    setBusyId(resource.id);
    try {
      await checkResourceUpdate(resource);
      await loadResources();
      onNotice(t("admin.resources.updateChecked"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusyId("");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyId(target.value.id);
    try {
      if (target.kind === "resource") {
        await deleteResource(target.value.id);
        await loadResources();
      } else {
        await deleteMaterialProject(target.value.id);
        await loadMaterials();
      }
      setDeleteTarget(null);
      onNotice(t("admin.resources.deleted"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="admin-resource-manager">
      <header className="admin-heading">
        <div><h2>{t("admin.resources.title")}</h2><p>{t("admin.resources.body")}</p></div>
        <button
          type="button"
          className="button primary"
          onClick={() => setDialog({ kind: section === "catalogue" ? "importResource" : "importMaterial" })}
        ><PackagePlus size={17} />{t(section === "catalogue" ? "admin.resources.addResource" : "admin.resources.addMaterial")}</button>
      </header>

      <div className="admin-resource-summary">
        <span><strong>{formatCount(resourceTotal)}</strong>{t("admin.resources.catalogueCount")}</span>
        <span><strong>{formatCount(workspace.projects.length)}</strong>{t("admin.resources.materialCount")}</span>
        <span><strong>{formatCount(workspace.projects.reduce((sum, project) => sum + project.missingCount, 0))}</strong>{t("admin.resources.missingCount")}</span>
      </div>

      <div className="admin-resource-toolbar">
        <div className="segmented-control admin-resource-sections" role="group" aria-label={t("admin.resources.section")}>
          <button type="button" aria-pressed={section === "catalogue"} onClick={() => setSection("catalogue")}>{t("admin.resources.catalogue")}</button>
          <button type="button" aria-pressed={section === "materials"} onClick={() => setSection("materials")}>{t("admin.resources.materials")}</button>
        </div>
        <label className="admin-resource-search">
          <Search size={16} /><span className="sr-only">{t("admin.resources.search")}</span>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("admin.resources.search")} />
        </label>
      </div>

      {currentLoading ? <div className="admin-resource-empty">{t("admin.resources.loading")}</div> : section === "catalogue" ? (
        <div className="admin-resource-list">
          {resources.map(resource => {
            const sourceUrl = safeExternalUrl(resource.url);
            return <article className="admin-resource-row" key={resource.id}>
              <ResourceIcon source={resource.source} iconUrl={resource.iconUrl} className="admin-resource-icon" />
              <div className="admin-resource-copy">
                <span>{resource.source} · {resource.resourceType}</span>
                <h3>{resource.name}</h3>
                <p>{resource.description || t("resources.noDescription")}</p>
              </div>
              <div className="admin-resource-meta">
                <small>{t("resources.current")}</small><strong>{resource.currentVersion}</strong>
                {resource.updateAvailable ? <em>{t("resources.update")}: {resource.latestVersion}</em> : null}
              </div>
              <div className="admin-resource-actions">
                <button type="button" className="icon-button" disabled={busyId === resource.id} onClick={() => void checkUpdate(resource)} aria-label={t("resources.projects.check")}><RefreshCw size={16} /></button>
                {sourceUrl ? <a className="icon-button" href={sourceUrl} target="_blank" rel="noreferrer" aria-label={t("resources.openSource")}><ExternalLink size={16} /></a> : null}
                <button type="button" className="icon-button" onClick={() => setDialog({ kind: "editResource", value: resource })} aria-label={t("admin.resources.edit")}><Pencil size={16} /></button>
                <button type="button" className="icon-button danger" onClick={() => setDeleteTarget({ kind: "resource", value: resource })} aria-label={t("app.delete")}><Trash2 size={16} /></button>
              </div>
            </article>;
          })}
          {!resources.length ? <div className="admin-resource-empty">{t("admin.resources.empty")}</div> : null}
          <AdminPagination page={resourcePage} pages={resourcePages} onChange={setResourcePage} />
        </div>
      ) : (
        <div className="admin-resource-list">
          {materialProjects.map(project => (
            <article className="admin-resource-row material" key={project.id}>
              <span className="admin-resource-glyph"><Layers3 size={22} /></span>
              <div className="admin-resource-copy">
                <span>{t("admin.resources.materialProject")} · P{project.priority}</span>
                <h3>{project.name}</h3>
                <p>{project.storageLocation || t("materials.project.locationEmpty")}</p>
              </div>
              <div className="admin-resource-metrics">
                <span><strong>{formatCount(project.itemCount)}</strong>{t("admin.resources.itemTypes")}</span>
                <span><strong>{formatCount(project.totalCount)}</strong>{t("materials.item.total")}</span>
                <span><strong>{formatCount(project.missingCount)}</strong>{t("materials.item.missing")}</span>
              </div>
              <div className="admin-resource-actions">
                <button type="button" className="icon-button" onClick={() => setDialog({ kind: "editMaterial", value: project })} aria-label={t("admin.resources.edit")}><Pencil size={16} /></button>
                <button type="button" className="icon-button danger" onClick={() => setDeleteTarget({ kind: "material", value: project })} aria-label={t("app.delete")}><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
          {!materialProjects.length ? <div className="admin-resource-empty">{t("admin.resources.empty")}</div> : null}
        </div>
      )}

      {dialog?.kind === "importResource" ? <ResourceImportDialog
        onClose={() => setDialog(null)}
        onSaved={async () => { await loadResources(); onNotice(t("admin.resources.saved")); }}
      /> : null}
      {dialog?.kind === "editResource" ? <EditResourceDialog
        resource={dialog.value}
        onClose={() => setDialog(null)}
        onSaved={async () => { await loadResources(); onNotice(t("admin.resources.saved")); }}
      /> : null}
      {dialog?.kind === "importMaterial" ? <ImportProjectDialog
        onClose={() => setDialog(null)}
        onCreated={loadMaterials}
        onNotice={onNotice}
      /> : null}
      {dialog?.kind === "editMaterial" ? <AdminMaterialDialog
        project={dialog.value}
        onClose={() => setDialog(null)}
        onSaved={async () => { await loadMaterials(); onNotice(t("admin.resources.saved")); }}
      /> : null}
      {deleteTarget ? <ConfirmDialog
        title={t(deleteTarget.kind === "material" ? "admin.resources.deleteMaterial" : "admin.resources.deleteResource")}
        description={t(deleteTarget.kind === "material" ? "admin.resources.deleteMaterialBody" : "admin.resources.deleteResourceBody", { name: deleteTarget.value.name })}
        busy={busyId === deleteTarget.value.id}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      /> : null}
    </div>
  );
}

function EditResourceDialog({ resource, onClose, onSaved }: {
  resource: Resource;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(resource.name);
  const [description, setDescription] = useState(resource.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await updateResourceDetails(resource.id, { name, description });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(t(getErrorTranslationKey(caught)));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={t("admin.resources.editResource")} onClose={onClose} dismissible={!busy}>
    <form className="form-stack" onSubmit={submit}>
      <label>{t("admin.resources.name")}<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{t("admin.resources.note")}<textarea rows={5} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <button type="submit" className="button primary" disabled={busy || !name.trim()}>{t(busy ? "app.saving" : "app.save")}</button>
    </form>
  </Dialog>;
}

function AdminMaterialDialog({ project, onClose, onSaved }: {
  project: MaterialProject;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(project.name);
  const [priority, setPriority] = useState(project.priority);
  const [storageLocation, setStorageLocation] = useState(project.storageLocation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await administerMaterialProject(project.id, { name, priority, storageLocation });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(t(getErrorTranslationKey(caught)));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={t("admin.resources.editMaterial")} onClose={onClose} dismissible={!busy}>
    <form className="material-dialog-form" onSubmit={submit}>
      <label>{t("admin.resources.name")}<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{t("admin.resources.note")}<textarea rows={4} maxLength={500} value={storageLocation} onChange={event => setStorageLocation(event.target.value)} /></label>
      <div className="material-field"><span>{t("materials.priority")}</span><StarPicker value={priority} onChange={setPriority} /></div>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <button type="submit" className="button primary" disabled={busy || !name.trim()}>{t(busy ? "app.saving" : "app.save")}</button>
    </form>
  </Dialog>;
}

function AdminPagination({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  const { t } = useI18n();
  if (pages <= 1) return null;
  return <nav className="pagination" aria-label={t("app.page", { page, pages })}>
    <button type="button" className="button small" disabled={page <= 1} onClick={() => onChange(page - 1)}>{t("app.previous")}</button>
    <span>{t("app.page", { page, pages })}</span>
    <button type="button" className="button small" disabled={page >= pages} onClick={() => onChange(page + 1)}>{t("app.next")}</button>
  </nav>;
}
