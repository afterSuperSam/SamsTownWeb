import type { ForumPost, ForumPostDraft, ForumPostKind } from "../../domain/types";
import { supabase } from "../../lib/supabase";

export interface ForumAnnouncement {
  id: string;
  titleZh: string;
  titleEn: string;
  subtitleZh: string;
  subtitleEn: string;
  bodyZh: string;
  bodyEn: string;
  createdAt: string;
}

export interface ForumPostQuery {
  kind?: ForumPostKind;
  limit?: number;
  offset?: number;
  authorId?: string;
}

const forumKinds = new Set<ForumPostKind>(["task", "anecdote", "event"]);

// Forum persistence ---------------------------------------------------------
// This interface accepts only editable text fields. Author identity and all
// timestamps are assigned by the database trigger and cannot be spoofed.
export async function listForumPosts(query: ForumPostQuery = {}): Promise<ForumPost[]> {
  const limit = Math.max(1, Math.min(query.limit ?? 5, 100));
  const offset = Math.max(0, Math.min(query.offset ?? 0, 5000));
  const { data, error } = await supabase.rpc("list_forum_posts", {
    p_kind: query.kind ?? null,
    p_limit: limit,
    p_offset: offset,
    p_author_id: query.authorId ?? null
  });
  if (error) throw error;
  return (data ?? []).map(mapForumPost);
}

export async function listForumAnnouncements(limit = 5): Promise<ForumAnnouncement[]> {
  const { data, error } = await supabase
    .from("town_announcements")
    .select("id,title_zh,title_en,subtitle_zh,subtitle_en,body_zh,body_en,created_at")
    .eq("is_visible", true)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 20)));
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id,
    titleZh: row.title_zh,
    titleEn: row.title_en,
    subtitleZh: row.subtitle_zh,
    subtitleEn: row.subtitle_en,
    bodyZh: row.body_zh,
    bodyEn: row.body_en,
    createdAt: row.created_at
  }));
}

export async function createForumPost(draft: ForumPostDraft): Promise<ForumPost> {
  const values = normalizeForumDraft(draft);
  const { data, error } = await supabase
    .from("forum_posts")
    .insert(values)
    .select("*")
    .single();
  if (error) throw error;
  return mapForumPost(data);
}

export async function updateForumPost(id: string, draft: ForumPostDraft): Promise<ForumPost> {
  const values = normalizeForumDraft(draft);
  const { data, error } = await supabase
    .from("forum_posts")
    .update(values)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("error.forumNotFound");
  return mapForumPost(data);
}

export async function deleteForumPost(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("forum_posts")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("error.forumNotFound");
}

export function normalizeForumDraft(draft: ForumPostDraft): ForumPostDraft {
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (!title || title.length > 120) throw new Error("error.forumTitle");
  if (!body || body.length > 8000) throw new Error("error.forumBody");
  if (!forumKinds.has(draft.kind)) throw new Error("error.forumKind");
  return { title, kind: draft.kind, body };
}

export function mapForumPost(row: {
  id: string;
  title: string;
  kind: string;
  body: string;
  author_id: string | null;
  author_username: string;
  created_at: string;
  updated_at: string;
}): ForumPost {
  if (!forumKinds.has(row.kind as ForumPostKind)) throw new Error("error.forumKind");
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as ForumPostKind,
    body: row.body,
    authorId: row.author_id,
    authorUsername: row.author_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
