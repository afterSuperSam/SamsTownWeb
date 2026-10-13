import { Button } from "../components/Button";
import { Megaphone, MessageSquareText, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../components/Dialog";
import { HeroTransition } from "../components/HeroTransition";
import { PageLoading } from "../components/TerrainLoading";
import { Notice, RetryNotice } from "../components/RetryNotice";
import { TownImage } from "../components/TownImage";
import { can } from "../domain/permissions";
import type { ForumPost, ForumPostKind } from "../domain/types";
import { ForumEditorDialog } from "../features/forum/ForumEditorDialog";
import { formatForumDate, ForumPostCard } from "../features/forum/ForumPostCard";
import {
  createForumPost,
  deleteForumPost,
  listForumAnnouncements,
  listForumPosts,
  updateForumPost,
  type ForumAnnouncement
} from "../features/forum/forumRepository";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { useTownHero } from "../hooks/useTownHero";
import { useAuth } from "../state/AuthContext";

type ForumFilter = "all" | "mine" | "announcement" | ForumPostKind;
type FeedItem =
  | { type: "post"; createdAt: string; post: ForumPost }
  | { type: "announcement"; createdAt: string; announcement: ForumAnnouncement };
type NoticeTone = "success" | "error";
type Notice = { message: string; tone: NoticeTone } | null;

const publicFilters: ForumFilter[] = ["all", "task", "anecdote", "event", "announcement"];
const MINE_PAGE_SIZE = 20;

// Community forum -----------------------------------------------------------
// The page renders plain text only. Supabase owns identity, timestamps, and
// row-level authorization; UI checks only decide which controls to display.
export function ForumPage() {
  const { language, t } = useI18n();
  const { profile, user } = useAuth();
  const [filter, setFilter] = useState<ForumFilter>("all");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ForumPost | "new" | null>(null);
  const [deleting, setDeleting] = useState<ForumPost | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [minePage, setMinePage] = useState(1);
  const [hasNextMinePage, setHasNextMinePage] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const { image: heroImage, ready: heroReady, error: heroError, retry: retryHero } = useTownHero("forumHero");
  const loadRevision = useRef(0);
  const noticeTimer = useRef<number | null>(null);
  const canWrite = can(profile?.role, "forum:write");

  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    setLoading(true);
    try {
      const wantsAnnouncements = filter === "all" || filter === "announcement";
      const wantsPosts = filter !== "announcement";
      const [posts, announcements] = await Promise.all([
        wantsPosts
          ? listForumPosts({
              kind: filter === "all" || filter === "mine" ? undefined : filter,
              authorId: filter === "mine" ? user?.id : undefined,
              limit: filter === "mine" ? MINE_PAGE_SIZE + 1 : 5,
              offset: filter === "mine" ? (minePage - 1) * MINE_PAGE_SIZE : undefined
            })
          : Promise.resolve([]),
        wantsAnnouncements ? listForumAnnouncements(5) : Promise.resolve([])
      ]);
      if (revision !== loadRevision.current) return;
      setHasNextMinePage(filter === "mine" && posts.length > MINE_PAGE_SIZE);
      const pagePosts = filter === "mine" ? posts.slice(0, MINE_PAGE_SIZE) : posts;
      const next: FeedItem[] = [
        ...pagePosts.map(post => ({ type: "post" as const, createdAt: post.createdAt, post })),
        ...announcements.map(announcement => ({
          type: "announcement" as const,
          createdAt: announcement.createdAt,
          announcement
        }))
      ];
      setItems(next.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, filter === "mine" ? MINE_PAGE_SIZE : 5));
      setError("");
    } catch (caught) {
      if (revision !== loadRevision.current) return;
      setError(t(getErrorTranslationKey(caught)));
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, [filter, minePage, t, user?.id]);

  useEffect(() => {
    void load();
    return () => {
      loadRevision.current += 1;
    };
  }, [load]);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  function showNotice(message: string, tone: NoticeTone = "success") {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3600);
  }

  async function savePost(draft: Pick<ForumPost, "title" | "kind" | "body">) {
    const isNew = editing === "new";
    if (isNew) {
      await createForumPost(draft);
    } else if (editing) {
      await updateForumPost(editing.id, draft);
    }
    setEditing(null);
    if (isNew && filter === "mine" && minePage > 1) {
      setMinePage(1);
    } else {
      await load();
    }
    showNotice(t("forum.saved"));
  }

  async function removePost() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteForumPost(deleting.id);
      setDeleting(null);
      if (filter === "mine" && items.length === 1 && minePage > 1) {
        setMinePage(current => current - 1);
      } else {
        await load();
      }
      showNotice(t("forum.deleted"));
    } catch (caught) {
      showNotice(t(getErrorTranslationKey(caught)), "error");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading || !heroReady) return <PageLoading label={t("app.loading.terrain")} />;

  return (
    <main className="forum-page ambient-page">
      <header className="forum-hero page-hero">
        {heroImage ? (
          <TownImage
            className="forum-hero-image page-hero-image"
            source={heroImage.sourceUrl}
            alt={language === "zh-CN" ? heroImage.altZh : heroImage.altEn || heroImage.altZh}
            loading="eager"
            fetchPriority="high"
          />
        ) : null}
        <div className="page-hero-shade" />
        <div className="forum-hero-copy hero-copy-sequence">
          <span className="eyebrow"><MessageSquareText size={15} />{t("forum.eyebrow")}</span>
          <h1>{t("forum.title")}</h1>
          <p>{t("forum.body")}</p>
        </div>
      </header>
      <HeroTransition />
      <RetryNotice error={heroError} onRetry={retryHero} />

      <section className="forum-workspace">
        <header className="forum-section-heading">
          <div><span className="eyebrow">{t("forum.latest")}</span><h2>{t("forum.latest")}</h2><p>{t("forum.latestBody")}</p></div>
          {canWrite ? <Button type="button" className="primary" onClick={() => setEditing("new")}><Plus size={17} />{t("forum.create")}</Button> : null}
        </header>

        <div className="forum-filter" role="group" aria-label={t("forum.filter")}>
          {[...publicFilters, ...(canWrite ? ["mine" as const] : [])].map(value => (
            <button
              type="button"
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setMinePage(1);
              }}
              key={value}
            >
              {t(value === "all" || value === "mine" || value === "announcement" ? `forum.filter.${value}` : `forum.kind.${value}`)}
            </button>
          ))}
        </div>

        {notice ? <div className={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</div> : null}
        {error ? <Notice>{error}<Button type="button" className="small" onClick={() => void load()}>{t("app.retry")}</Button></Notice> : null}
        {!error && !items.length ? <div className="forum-empty"><MessageSquareText size={24} /><p>{t("forum.empty")}</p></div> : null}

        {!error ? (
          <>
            <div className="forum-feed">
              {items.map(item => item.type === "post" ? (
                <ForumPostCard
                  post={item.post}
                  canManage={Boolean(canWrite && (item.post.authorId === user?.id || profile?.role === "owner"))}
                  language={language}
                  onEdit={() => setEditing(item.post)}
                  onDelete={() => setDeleting(item.post)}
                  key={`post-${item.post.id}`}
                />
              ) : (
                <AnnouncementCard announcement={item.announcement} language={language} key={`announcement-${item.announcement.id}`} />
              ))}
            </div>
            {filter === "mine" && (minePage > 1 || hasNextMinePage) ? (
              <nav className="pagination" aria-label={t("app.page", { page: minePage, pages: minePage + Number(hasNextMinePage) })}>
                <Button type="button" className="small" disabled={loading || minePage <= 1} onClick={() => setMinePage(current => current - 1)}>{t("app.previous")}</Button>
                <span>{minePage}</span>
                <Button type="button" className="small" disabled={loading || !hasNextMinePage} onClick={() => setMinePage(current => current + 1)}>{t("app.next")}</Button>
              </nav>
            ) : null}
          </>
        ) : null}
      </section>

      {editing ? (
        <ForumEditorDialog
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={savePost}
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
          onConfirm={() => void removePost()}
        />
      ) : null}
    </main>
  );
}

function AnnouncementCard({ announcement, language }: {
  announcement: ForumAnnouncement;
  language: "zh-CN" | "en";
}) {
  const { t } = useI18n();
  const title = language === "zh-CN" ? announcement.titleZh : announcement.titleEn || announcement.titleZh;
  const subtitle = language === "zh-CN" ? announcement.subtitleZh : announcement.subtitleEn || announcement.subtitleZh;
  const body = language === "zh-CN" ? announcement.bodyZh : announcement.bodyEn || announcement.bodyZh;
  return (
    <article className="forum-entry forum-announcement">
      <div className="forum-entry-meta">
        <span className="forum-kind announcement"><Megaphone size={15} />{t("forum.announcement")}</span>
        <time dateTime={announcement.createdAt}>{formatForumDate(announcement.createdAt, language)}</time>
      </div>
      <h3>{title}</h3>
      {subtitle ? <strong>{subtitle}</strong> : null}
      {body ? <p className="forum-entry-body">{body}</p> : null}
    </article>
  );
}
