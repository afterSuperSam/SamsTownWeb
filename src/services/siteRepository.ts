import { defaultAnnouncements, defaultContent, defaultFaqs, defaultHistory, defaultImages, defaultMembers } from "../domain/defaults";
import { MAX_HOME_MEMBERS } from "../domain/memberPolicy";
import type {
  BilibiliVideoMetadata,
  FaqItem,
  HistoryEvent,
  SiteContent,
  TownAnnouncement,
  TownImage,
  TownMember
} from "../domain/types";
import { translations as defaultTranslations, type TranslationKey, type TranslationOverrides } from "../i18n/translations";
import { toJson } from "../lib/json";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { authenticatedApiRequest } from "./apiClient";

export interface SiteBundle {
  content: SiteContent;
  members: TownMember[];
  history: HistoryEvent[];
  images: TownImage[];
  faqs: FaqItem[];
  announcements: TownAnnouncement[];
}

let cachedSiteContent: SiteContent | null = null;

// Normalize the current content envelope. Obsolete flat copy fields were
// retired after the translation-based editor became the production schema.
function normalizeSiteContent(value: unknown): SiteContent {
  if (!value || typeof value !== "object") return structuredClone(defaultContent);
  const raw = value as Record<string, unknown>;
  const translations: TranslationOverrides = {};
  if (raw.translations && typeof raw.translations === "object") {
    for (const [key, candidate] of Object.entries(raw.translations)) {
      if (isTranslationKey(key) && isLocalizedText(candidate)) translations[key] = candidate;
    }
  }
  const settings = raw.settings && typeof raw.settings === "object"
    ? raw.settings as Record<string, unknown>
    : {};
  return {
    translations,
    settings: {
      ...defaultContent.settings,
      ...Object.fromEntries(
        ["qqGroup", "mayorQq", "kookUrl"]
          .flatMap(key => typeof settings[key] === "string" ? [[key, settings[key]]] : [])
      )
    } as SiteContent["settings"]
  };
}

function isTranslationKey(key: string): key is TranslationKey {
  return Object.hasOwn(defaultTranslations, key);
}

function isLocalizedText(value: unknown): value is { "zh-CN": string; en: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["zh-CN"] === "string" && typeof candidate.en === "string";
}

export async function getSiteContent(): Promise<SiteContent> {
  if (!isSupabaseConfigured) return structuredClone(defaultContent);
  const { data, error } = await supabase.from("site_content").select("content").eq("id", 1).maybeSingle();
  if (error) throw error;
  cachedSiteContent = normalizeSiteContent(data?.content);
  return structuredClone(cachedSiteContent);
}

export async function getTownImages(area?: TownImage["area"]): Promise<TownImage[]> {
  if (!isSupabaseConfigured) {
    return defaultImages.filter(image => !area || image.area === area);
  }
  let query = supabase.from("town_images").select("*").order("sort_order");
  if (area) query = query.eq("area", area);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapImage);
}

export async function getTownMembers(): Promise<TownMember[]> {
  if (!isSupabaseConfigured) return defaultMembers;
  const { data, error } = await supabase.from("town_members").select("*").order("sort_order");
  if (error) throw error;
  return (data ?? []).map(mapMember);
}

export async function getTownArchive(): Promise<{ members: TownMember[]; history: HistoryEvent[]; images: TownImage[] }> {
  if (!isSupabaseConfigured) {
    return { members: defaultMembers, history: defaultHistory, images: defaultImages };
  }
  const [membersResult, historyResult, imagesResult] = await Promise.all([
    supabase.from("town_members").select("*").order("sort_order"),
    supabase.from("town_history").select("*").order("sort_order"),
    supabase.from("town_images").select("*").order("sort_order")
  ]);
  if (membersResult.error) throw membersResult.error;
  if (historyResult.error) throw historyResult.error;
  if (imagesResult.error) throw imagesResult.error;
  return {
    members: (membersResult.data ?? []).map(mapMember),
    history: (historyResult.data ?? []).map(mapHistory),
    images: (imagesResult.data ?? []).map(mapImage)
  };
}

// 并行加载站点数据；数据库异常直接交给界面错误处理。
export async function getSiteBundle(options: { refreshContent?: boolean } = {}): Promise<SiteBundle> {
  if (!isSupabaseConfigured) {
    return {
      content: structuredClone(defaultContent),
      members: defaultMembers,
      history: defaultHistory,
      images: defaultImages,
      faqs: defaultFaqs,
      announcements: defaultAnnouncements
    };
  }
  const contentRequest = cachedSiteContent && !options.refreshContent
    ? Promise.resolve(null)
    : supabase.from("site_content").select("content").eq("id", 1).maybeSingle();
  const [contentResult, membersResult, historyResult, imagesResult, faqResult, announcementsResult] = await Promise.all([
    contentRequest,
    supabase.from("town_members").select("*").order("sort_order"),
    supabase.from("town_history").select("*").order("sort_order"),
    supabase.from("town_images").select("*").order("sort_order"),
    supabase.from("faq_items").select("*").order("sort_order"),
    supabase.from("town_announcements").select("*").order("sort_order")
  ]);
  const error = contentResult?.error
    ?? membersResult.error
    ?? historyResult.error
    ?? imagesResult.error
    ?? faqResult.error
    ?? announcementsResult.error;
  if (error) throw error;
  if (contentResult) cachedSiteContent = normalizeSiteContent(contentResult.data?.content);
  return {
    content: structuredClone(cachedSiteContent ?? defaultContent),
    members: (membersResult.data ?? []).map(mapMember),
    history: (historyResult.data ?? []).map(mapHistory),
    images: (imagesResult.data ?? []).map(mapImage),
    faqs: (faqResult.data ?? []).map(mapFaq),
    announcements: (announcementsResult.data ?? []).map(mapAnnouncement)
  };
}

// Owner-editable singleton content -------------------------------------------
export async function saveContent(content: SiteContent): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("site_content").upsert({
    id: 1,
    content: toJson(content),
    updated_by: userData.user?.id ?? null
  });
  if (error) throw error;
  cachedSiteContent = structuredClone(content);
}

// Ordered content replacement functions keep deletes/inserts transactional. --
export async function replaceMembers(members: TownMember[]): Promise<void> {
  const normalized = members.map(member => ({ ...member, username: member.username.trim() }));
  if (normalized.some(member => !member.username)) throw new Error("error.requiredMember");
  if (normalized.filter(member => member.showOnHome).length > MAX_HOME_MEMBERS) throw new Error("error.tooManyHomeMembers");
  const seen = new Set<string>();
  if (normalized.some(member => {
    const key = member.username.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  })) throw new Error("error.duplicateMember");
  const { error } = await supabase.rpc("replace_town_members", {
    items: normalized.map(member => ({
      username: member.username,
      role_zh: member.roleZh.trim(),
      role_en: member.roleEn.trim(),
      variant: member.variant,
      member_group: member.group,
      show_on_home: member.showOnHome,
      intro_zh: member.introZh.trim(),
      intro_en: member.introEn.trim()
    }))
  });
  if (error) throw error;
}

export async function replaceHistory(history: HistoryEvent[]): Promise<void> {
  const items = history.map(event => ({
    event_date: event.date,
    title_zh: event.titleZh,
    title_en: event.titleEn,
    body_zh: event.bodyZh,
    body_en: event.bodyEn,
    image_id: event.imageId,
    show_on_home: event.showOnHome
  }));
  const { error } = await supabase.rpc("replace_town_history", { items });
  if (error) throw error;
}

export async function replaceAnnouncements(announcements: TownAnnouncement[]): Promise<void> {
  const { error } = await supabase.rpc("replace_town_announcements", {
    items: announcements.map(item => ({
      kind: item.kind,
      title_zh: item.titleZh.trim(),
      title_en: item.titleEn.trim(),
      subtitle_zh: item.subtitleZh.trim(),
      subtitle_en: item.subtitleEn.trim(),
      body_zh: item.bodyZh.trim(),
      body_en: item.bodyEn.trim(),
      image_id: item.imageId,
      is_visible: item.visible
    }))
  });
  if (error) throw error;
}

export async function replaceFaqs(faqs: FaqItem[]): Promise<void> {
  const { error } = await supabase.rpc("replace_faq_items", {
    items: faqs.map(item => ({
      question_zh: item.questionZh,
      question_en: item.questionEn,
      answer_zh: item.answerZh,
      answer_en: item.answerEn,
      is_visible: item.visible
    }))
  });
  if (error) throw error;
}

// Image metadata and Storage operations --------------------------------------
export async function saveTownImages(images: TownImage[]): Promise<TownImage[]> {
  const persisted = images.map((image, sortOrder) => ({
    ...image,
    sortOrder
  }));
  const rows = persisted.map(image => ({
    id: image.id,
    media_type: image.mediaType,
    area: image.area,
    source_url: image.sourceUrl,
    storage_path: image.storagePath,
    external_id: image.externalId,
    external_url: image.externalUrl,
    creator_name: image.creatorName,
    duration_seconds: image.durationSeconds,
    caption_zh: image.captionZh,
    caption_en: image.captionEn,
    alt_zh: image.altZh,
    alt_en: image.altEn,
    layout: image.layout,
    is_visible: image.visible,
    sort_order: image.sortOrder
  }));
  const { error } = await supabase.from("town_images").upsert(rows);
  if (error) throw error;
  return persisted;
}

export class SiteImageCleanupError extends AggregateError {
  readonly code: "SITE_IMAGE_CLEANUP_QUEUED" | "SITE_IMAGE_CLEANUP_QUEUE_FAILED";
  constructor(
    readonly cleanupStatus: "queued" | "queue-failed",
    errors: unknown[]
  ) {
    super(errors, cleanupStatus === "queued" ? "SITE_IMAGE_CLEANUP_QUEUED" : "SITE_IMAGE_CLEANUP_QUEUE_FAILED", { cause: errors[0] });
    this.name = "SiteImageCleanupError";
    this.code = cleanupStatus === "queued" ? "SITE_IMAGE_CLEANUP_QUEUED" : "SITE_IMAGE_CLEANUP_QUEUE_FAILED";
  }
}

export async function uploadTownImage(
  file: File,
  values: Pick<TownImage, "area" | "captionZh" | "captionEn" | "altZh" | "altEn" | "layout">
): Promise<TownImage> {
  const extension = file.name.match(/\.(png|jpe?g|webp|gif)$/i)?.[0].toLowerCase() ?? "";
  const storagePath = `${values.area}/${crypto.randomUUID()}${extension}`;
  const { error: uploadError } = await supabase.storage.from("site-images").upload(storagePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type
  });
  if (uploadError) throw uploadError;
  const sourceUrl = supabase.storage.from("site-images").getPublicUrl(storagePath).data.publicUrl;
  const row = {
    area: values.area,
    source_url: sourceUrl,
    storage_path: storagePath,
    caption_zh: values.captionZh,
    caption_en: values.captionEn,
    alt_zh: values.altZh,
    alt_en: values.altEn,
    layout: values.layout,
    is_visible: true,
    sort_order: 999
  };
  const result = await supabase.from("town_images").insert(row).select("*").single();
  if (result.error) {
    const cleanup = await supabase.storage.from("site-images").remove([storagePath]);
    if (cleanup.error) {
      const queued = await supabase.rpc("queue_own_storage_cleanup", { p_bucket: "site-images", p_path: storagePath });
      if (queued.error) {
        throw new SiteImageCleanupError("queue-failed", [result.error, cleanup.error, queued.error]);
      }
      throw new SiteImageCleanupError("queued", [result.error, cleanup.error]);
    }
    throw result.error;
  }
  return mapImage(result.data);
}

// Bilibili metadata is resolved through Fastify, while Supabase remains the
// single source of truth for placement, captions, visibility, and ordering.
export async function importBilibiliVideo(
  input: string,
  values: Pick<TownImage, "area" | "captionZh" | "captionEn" | "layout">
): Promise<TownImage> {
  const metadata = await authenticatedApiRequest<BilibiliVideoMetadata>("/api/bilibili/resolve", {
    method: "POST",
    body: JSON.stringify({ input })
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("error.session");

  const { data, error } = await supabase.from("town_images").insert({
    media_type: "bilibili",
    area: values.area,
    source_url: metadata.thumbnailUrl,
    storage_path: null,
    external_id: metadata.bvid,
    external_url: metadata.watchUrl,
    creator_name: metadata.author,
    duration_seconds: metadata.durationSeconds,
    caption_zh: values.captionZh.trim() || metadata.title,
    caption_en: values.captionEn.trim(),
    alt_zh: `${metadata.title} 视频封面`,
    alt_en: `${values.captionEn.trim() || metadata.title} video thumbnail`,
    layout: values.layout,
    is_visible: true,
    sort_order: 999,
    created_by: userData.user.id
  }).select("*").single();

  if (error?.code === "23505") throw new Error("error.duplicateVideo");
  if (error) throw error;
  return mapImage(data);
}

export async function deleteTownImage(image: TownImage): Promise<void> {
  const { error } = await supabase.rpc("queue_town_image_deletion", { p_image_id: image.id });
  if (error) throw error;
}

// Database row mapping --------------------------------------------------------
function mapMember(row: Record<string, unknown>): TownMember {
  return {
    id: String(row.id),
    username: String(row.username),
    roleZh: String(row.role_zh ?? ""),
    roleEn: String(row.role_en ?? ""),
    variant: String(row.variant ?? ""),
    group: row.member_group as TownMember["group"],
    showOnHome: Boolean(row.show_on_home),
    introZh: String(row.intro_zh ?? ""),
    introEn: String(row.intro_en ?? ""),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

function mapHistory(row: Record<string, unknown>): HistoryEvent {
  return {
    id: String(row.id),
    date: String(row.event_date),
    titleZh: String(row.title_zh),
    titleEn: String(row.title_en ?? ""),
    bodyZh: String(row.body_zh),
    bodyEn: String(row.body_en ?? ""),
    imageId: row.image_id ? String(row.image_id) : null,
    showOnHome: Boolean(row.show_on_home),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

function mapAnnouncement(row: Record<string, unknown>): TownAnnouncement {
  return {
    id: String(row.id),
    kind: row.kind === "affair" ? "affair" : "announcement",
    titleZh: String(row.title_zh),
    titleEn: String(row.title_en ?? ""),
    subtitleZh: String(row.subtitle_zh ?? ""),
    subtitleEn: String(row.subtitle_en ?? ""),
    bodyZh: String(row.body_zh ?? ""),
    bodyEn: String(row.body_en ?? ""),
    imageId: row.image_id ? String(row.image_id) : null,
    visible: Boolean(row.is_visible ?? true),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

function mapFaq(row: Record<string, unknown>): FaqItem {
  return {
    id: String(row.id),
    questionZh: String(row.question_zh),
    questionEn: String(row.question_en ?? ""),
    answerZh: String(row.answer_zh),
    answerEn: String(row.answer_en ?? ""),
    visible: Boolean(row.is_visible ?? true),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

function mapImage(row: Record<string, unknown>): TownImage {
  return {
    id: String(row.id),
    mediaType: row.media_type === "bilibili" ? "bilibili" : "image",
    area: row.area as TownImage["area"],
    sourceUrl: String(row.source_url),
    storagePath: row.storage_path ? String(row.storage_path) : null,
    externalId: row.external_id ? String(row.external_id) : null,
    externalUrl: row.external_url ? String(row.external_url) : null,
    creatorName: String(row.creator_name ?? ""),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    captionZh: String(row.caption_zh ?? ""),
    captionEn: String(row.caption_en ?? ""),
    altZh: String(row.alt_zh ?? ""),
    altEn: String(row.alt_en ?? ""),
    layout: (row.layout ?? "standard") as TownImage["layout"],
    visible: Boolean(row.is_visible ?? true),
    sortOrder: Number(row.sort_order ?? 0)
  };
}
