import { PackagePlus, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HeroTransition } from "../components/HeroTransition";
import { RetryNotice } from "../components/RetryNotice";
import { PageLoading } from "../components/TerrainLoading";
import { TownImage } from "../components/TownImage";
import { can } from "../domain/permissions";
import {
  BatchClaimDialog,
  BatchCompletionDialog,
  ClaimDialog,
  EditProjectDialog,
  ImportProjectDialog,
  QuickClaimDialog,
  formatCount,
  type BatchClaimItem
} from "../features/material/components/MaterialDialogs";
import { MaterialLeaderboard } from "../features/material/components/MaterialLeaderboard";
import { MaterialProjectCard } from "../features/material/components/MaterialProjectCard";
import {
  getMaterialWorkspace,
  downloadMaterialProjection,
  setMaterialClaimCompleted,
  subscribeToMaterialWorkspace,
  unsubscribeFromMaterialWorkspace
} from "../features/material/data/materialRepository";
import type {
  MaterialAssignment,
  MaterialItem,
  MaterialProject,
  MaterialWorkspace
} from "../features/material/domain/materialTypes";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { useTownHero } from "../hooks/useTownHero";
import { useAuth } from "../state/AuthContext";

const emptyWorkspace: MaterialWorkspace = {
  projects: [],
  items: [],
  assignments: [],
  leaderboard: []
};

type Notice = { message: string; tone: "success" | "error" } | null;
type ClaimTarget = { item: MaterialItem; assignment: MaterialAssignment | null; maxAmount: number };
type BatchClaimTarget = { items: BatchClaimItem[] };
type BatchCompletionTarget = { assignments: MaterialAssignment[]; completed: boolean };

// Materials workspace -------------------------------------------------------
// A single read model keeps project totals, claims, and the leaderboard in the
// same snapshot. Realtime events only invalidate that snapshot.
export function MaterialPage() {
  const { profile, user } = useAuth();
  const { language, t } = useI18n();
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const { image: heroImage, ready: heroReady, error: heroError, retry: retryHero } = useTownHero("materialHero");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editProject, setEditProject] = useState<MaterialProject | null>(null);
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const [batchClaimTarget, setBatchClaimTarget] = useState<BatchClaimTarget | null>(null);
  const [quickClaimTarget, setQuickClaimTarget] = useState<BatchClaimTarget | null>(null);
  const [batchCompletionTarget, setBatchCompletionTarget] = useState<BatchCompletionTarget | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const revision = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const canEdit = can(profile?.role, "materials:edit");

  const load = useCallback(async (showLoading = false) => {
    const request = ++revision.current;
    if (showLoading) setLoading(true);
    try {
      const next = await getMaterialWorkspace();
      if (request !== revision.current) return;
      setWorkspace(next);
      setError("");
    } catch (caught) {
      if (request === revision.current) setError(t(getErrorTranslationKey(caught)));
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load(true);
    const channel = subscribeToMaterialWorkspace(() => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void load(), 180);
    });
    return () => {
      revision.current += 1;
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      void unsubscribeFromMaterialWorkspace(channel);
    };
  }, [load]);

  const itemsByProject = useMemo(() => groupBy(workspace.items, item => item.projectId), [workspace.items]);
  const assignmentsByProject = useMemo(() => {
    const itemProject = new Map(workspace.items.map(item => [item.id, item.projectId]));
    return groupBy(workspace.assignments, assignment => itemProject.get(assignment.itemId) ?? "");
  }, [workspace.assignments, workspace.items]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredProjects = useMemo(() => workspace.projects.flatMap(project => {
    if (!normalizedSearch) return [{ project, itemSearch: "" }];
    const projectText = `${project.name} ${project.creatorUsername} ${project.storageLocation}`.toLocaleLowerCase();
    if (projectText.includes(normalizedSearch)) return [{ project, itemSearch: "" }];
    const matchesItem = (itemsByProject.get(project.id) ?? []).some(item =>
      `${item.itemId} ${item.nameZh} ${item.nameEn}`.toLocaleLowerCase().includes(normalizedSearch)
    );
    return matchesItem ? [{ project, itemSearch: normalizedSearch }] : [];
  }), [itemsByProject, normalizedSearch, workspace.projects]);

  const collectedCount = useMemo(
    () => workspace.leaderboard.reduce((total, entry) => total + entry.collectedCount, 0),
    [workspace.leaderboard]
  );
  const missingCount = useMemo(
    () => workspace.projects.reduce((total, project) => total + project.missingCount, 0),
    [workspace.projects]
  );

  function showNotice(message: string, tone: "success" | "error" = "success") {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3600);
  }

  async function completeAssignment(assignment: MaterialAssignment, completed: boolean) {
    try {
      await setMaterialClaimCompleted(assignment.id, completed);
      await load();
      showNotice(t("materials.saved"));
    } catch (caught) {
      showNotice(t(getErrorTranslationKey(caught)), "error");
    }
  }

  async function downloadProjection(project: MaterialProject) {
    try {
      await downloadMaterialProjection(project);
    } catch (caught) {
      showNotice(t(getErrorTranslationKey(caught)), "error");
    }
  }

  if (loading || !heroReady) return <PageLoading label={t("app.loading.terrain")} />;

  return <main className="material-page ambient-page">
    <header className="material-hero page-hero">
      {heroImage ? <TownImage
        className="material-hero-image page-hero-image"
        source={heroImage.sourceUrl}
        alt={language === "zh-CN" ? heroImage.altZh : heroImage.altEn}
        loading="eager"
        fetchPriority="high"
      /> : null}
      <div className="page-hero-shade" />
      <div className="material-hero-copy hero-copy-sequence">
        <span className="eyebrow"><Sparkles size={14} />{t("materials.eyebrow")}</span>
        <h1>{t("materials.title")}</h1>
        <p>{t("materials.body")}</p>
      </div>
    </header>
    <HeroTransition />
    <RetryNotice error={heroError} onRetry={retryHero} />

    <section className="material-workspace">
      <div className="material-toolbar">
        <label className="material-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">{t("materials.search")}</span>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("materials.search")} />
        </label>
        <div className="material-toolbar-actions">
          <div className="material-stats" aria-label={t("materials.title")}>
            <span><strong>{formatCount(workspace.projects.length)}</strong>{t("materials.stats.projects")}</span>
            <span><strong>{formatCount(missingCount)}</strong>{t("materials.stats.missing")}</span>
            <span><strong>{formatCount(collectedCount)}</strong>{t("materials.stats.collected")}</span>
          </div>
          {canEdit ? <button type="button" className="button primary" onClick={() => setImportOpen(true)}>
            <PackagePlus size={18} />{t("materials.create")}
          </button> : null}
        </div>
      </div>

      {error ? <div className="material-state" role="alert">
        <h2>{t("error.generic")}</h2><p>{error}</p>
        <button type="button" className="button secondary" onClick={() => void load(true)}>{t("materials.retry")}</button>
      </div> : <div className="material-layout">
        <section className="material-project-list">
          {filteredProjects.map(({ project, itemSearch }) => <MaterialProjectCard
            key={project.id}
            project={project}
            items={itemsByProject.get(project.id) ?? []}
            assignments={assignmentsByProject.get(project.id) ?? []}
            currentUserId={user?.id ?? ""}
            canEdit={canEdit}
            search={itemSearch}
            onEdit={setEditProject}
            onDownload={project => void downloadProjection(project)}
            onClaim={(item, assignment, maxAmount) => setClaimTarget({ item, assignment, maxAmount })}
            onComplete={(assignment, completed) => void completeAssignment(assignment, completed)}
            onQuickClaim={items => setQuickClaimTarget({ items })}
            onBatchClaim={items => setBatchClaimTarget({ items })}
            onBatchComplete={(assignments, completed) => setBatchCompletionTarget({ assignments, completed })}
          />)}
          {!workspace.projects.length ? <div className="material-state">
            <PackagePlus size={30} /><h2>{t("materials.empty.title")}</h2><p>{t("materials.empty.body")}</p>
          </div> : !filteredProjects.length ? <div className="material-state"><Search size={28} /><p>{t("materials.search.empty")}</p></div> : null}
        </section>
        <MaterialLeaderboard entries={workspace.leaderboard} />
      </div>}
    </section>

    {importOpen ? <ImportProjectDialog onClose={() => setImportOpen(false)} onCreated={() => load()} onNotice={showNotice} /> : null}
    {editProject ? <EditProjectDialog project={editProject} onClose={() => setEditProject(null)} onSaved={() => load()} onNotice={showNotice} /> : null}
    {claimTarget ? <ClaimDialog {...claimTarget} onClose={() => setClaimTarget(null)} onSaved={() => load()} onNotice={showNotice} /> : null}
    {batchClaimTarget ? <BatchClaimDialog
      items={batchClaimTarget.items}
      onClose={() => setBatchClaimTarget(null)}
      onSaved={() => load()}
      onNotice={showNotice}
    /> : null}
    {quickClaimTarget ? <QuickClaimDialog
      items={quickClaimTarget.items}
      onClose={() => setQuickClaimTarget(null)}
      onSaved={() => load()}
      onNotice={showNotice}
    /> : null}
    {batchCompletionTarget ? <BatchCompletionDialog
      assignmentIds={batchCompletionTarget.assignments.map(assignment => assignment.id)}
      completed={batchCompletionTarget.completed}
      onClose={() => setBatchCompletionTarget(null)}
      onSaved={() => load()}
      onNotice={showNotice}
    /> : null}
    {notice ? <div className={`admin-toast ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</div> : null}
  </main>;
}

function groupBy<T>(values: T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  values.forEach(value => {
    const key = keyOf(value);
    if (!key) return;
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  });
  return groups;
}
