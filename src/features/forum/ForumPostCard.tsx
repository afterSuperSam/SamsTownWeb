import { BookOpenText, CalendarDays, ClipboardList, Pencil, Trash2 } from "lucide-react";
import type { Language, ForumPost } from "../../domain/types";
import { useI18n } from "../../i18n/I18nContext";

interface ForumPostCardProps {
  post: ForumPost;
  canManage?: boolean;
  language: Language;
  onEdit?: () => void;
  onDelete?: () => void;
  compact?: boolean;
}

export function ForumPostCard({
  post,
  canManage = false,
  language,
  onEdit,
  onDelete,
  compact = false
}: ForumPostCardProps) {
  const { t } = useI18n();
  const kindIcon = post.kind === "task"
    ? <ClipboardList size={15} />
    : post.kind === "event"
      ? <CalendarDays size={15} />
      : <BookOpenText size={15} />;
  return (
    <article className={`forum-entry ${compact ? "compact" : ""}`}>
      <div className="forum-entry-meta">
        <span className={`forum-kind ${post.kind}`}>{kindIcon}{t(`forum.kind.${post.kind}`)}</span>
        <time dateTime={post.createdAt}>{formatForumDate(post.createdAt, language)}</time>
      </div>
      <h3>{post.title}</h3>
      <p className="forum-entry-body">{post.body}</p>
      <footer>
        <span>{t("forum.author", { username: post.authorUsername })}</span>
        {canManage ? (
          <div className="forum-entry-actions">
            <button type="button" className="small-action" onClick={onEdit}><Pencil size={14} />{t("forum.edit")}</button>
            <button type="button" className="small-action danger" onClick={onDelete}><Trash2 size={14} />{t("app.delete")}</button>
          </div>
        ) : null}
      </footer>
    </article>
  );
}

export function formatForumDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
