import { Notice } from "../../components/RetryNotice";
import { Button } from "../../components/Button";
import { MessageSquareText, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/Dialog";
import { SelectField } from "../../components/SelectField";
import { TerrainLoading } from "../../components/TerrainLoading";
import type { ForumPost, ForumPostDraft, ForumPostKind } from "../../domain/types";
import { ForumEditorDialog } from "../forum/ForumEditorDialog";
import { ForumPostCard } from "../forum/ForumPostCard";
import {
  createForumPost,
  deleteForumPost,
  listForumPosts,
  updateForumPost
} from "../forum/forumRepository";
import { getErrorTranslationKey } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nContext";

type ForumAdminFilter = "all" | ForumPostKind;
const PAGE_SIZE = 20;

interface ForumManagementPanelProps {
  onNotice: (message: string, tone?: "success" | "error") => void;
}

// Owner forum workspace -----------------------------------------------------
// Mutations use the same repository as the public page; RLS grants Owner the
// additional ability to maintain posts whose original author is another user.
export function ForumManagementPanel({ onNotice }: ForumManagementPanelProps) {
  const { language, t } = useI18n();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [filter, setFilter] = useState<ForumAdminFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ForumPost | "new" | null>(null);
  const [deleting, setDeleting] = useState<ForumPost | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const revision = useRef(0);

  const load = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    try {
      const next = await listForumPosts({
        kind: filter === "all" ? undefined : filter,
        limit: PAGE_SIZE + 1,
        offset: (page - 1) * PAGE_SIZE
      });
      if (request !== revision.current) return;
      setPosts(next.slice(0, PAGE_SIZE));
      setHasNextPage(next.length > PAGE_SIZE);
      setError("");
    } catch (caught) {
      if (request === revision.current) setError(t(getErrorTranslationKey(caught)));
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [filter, page, t]);

  useEffect(() => {
    void load();
    return () => {
      revision.current += 1;
    };
  }, [load]);

  async function save(draft: ForumPostDraft) {
    const isNew = editing === "new";
    if (isNew) {
      await createForumPost(draft);
    } else if (editing) {
      await updateForumPost(editing.id, draft);
    }
    setEditing(null);
    if (isNew && page !== 1) setPage(1);
    else await load();
    onNotice(t("forum.saved"));
  }

  async function remove() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteForumPost(deleting.id);
      setDeleting(null);
      if (posts.length === 1 && page > 1) {
        setPage(current => current - 1);
      } else {
        await load();
      }
      onNotice(t("forum.deleted"));
    } catch (caught) {
      onNotice(t(getErrorTranslationKey(caught)), "error");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section className="forum-admin-section">
      <header className="admin-heading">
        <div><h2>{t("forum.manage.title")}</h2><p>{t("forum.manage.body")}</p></div>
        <Button type="button" className="primary" onClick={() => setEditing("new")}>
          <Plus size={17} />{t("forum.create")}
        </Button>
      </header>

      <SelectField
        className="forum-admin-filter"
        value={filter}
        label={t("forum.filter")}
        options={[
          { value: "all", label: t("forum.filter.all") },
          { value: "task", label: t("forum.kind.task") },
          { value: "anecdote", label: t("forum.kind.anecdote") },
          { value: "event", label: t("forum.kind.event") }
        ]}
        onChange={value => {
          setFilter(value);
          setPage(1);
        }}
      />

      {loading ? <div className="forum-loading"><TerrainLoading label={t("forum.loading")} compact /></div> : null}
      {!loading && error ? <Notice>{error}<Button type="button" className="small" onClick={() => void load()}>{t("app.retry")}</Button></Notice> : null}
      {!loading && !error && !posts.length ? <div className="forum-empty"><MessageSquareText size={22} /><p>{t("forum.empty")}</p></div> : null}
      {!loading && !error ? (
        <>
          <div className="forum-admin-list">
            {posts.map(post => (
              <ForumPostCard
                post={post}
                language={language}
                canManage
                compact
                onEdit={() => setEditing(post)}
                onDelete={() => setDeleting(post)}
                key={post.id}
              />
            ))}
          </div>
          {page > 1 || hasNextPage ? (
            <nav className="pagination" aria-label={t("app.page", { page, pages: page + Number(hasNextPage) })}>
              <Button type="button" className="small" disabled={loading || page <= 1} onClick={() => setPage(current => current - 1)}>{t("app.previous")}</Button>
              <span>{page}</span>
              <Button type="button" className="small" disabled={loading || !hasNextPage} onClick={() => setPage(current => current + 1)}>{t("app.next")}</Button>
            </nav>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <ForumEditorDialog
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={t("forum.delete")}
          description={t("forum.deleteBody", { title: deleting.title })}
          confirmLabel={t("app.delete")}
          busy={deleteBusy}
          onClose={() => {
            if (!deleteBusy) setDeleting(null);
          }}
          onConfirm={() => void remove()}
        />
      ) : null}
    </section>
  );
}
