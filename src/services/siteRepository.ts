import { defaultAnnouncements, defaultContent, defaultFaqs, defaultHistory, defaultImages, defaultMembers } from "../domain/defaults";
import { MAX_HOME_MEMBERS } from "../domain/memberPolicy";
import type {
  BilibiliVideoMetadata,
  FaqItem,
  HistoryEvent,
  Resource,
  SiteContent,
  TownAnnouncement,
  TownImage,
  TownMember
} from "../domain/types";
import { translations as defaultTranslations, type TranslationKey, type TranslationOverrides } from "../i18n/translations";
import { toJson } from "../lib/json";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { authenticatedApiRequest } from "./apiClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEATURED_MEMBER_NAMES = new Set(["aresgao", "dogsam", "tabularis", "nani0416", "nanio416"]);
const missingRelation = (error: { code?: string; message?: string } | null | undefined, relation: string) =>
  error?.code === "PGRST205" || new RegExp(`${relation}.*schema cache`, "i").test(error?.message ?? "");
const missingColumn = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "PGRST204" || error?.code === "42703" || /column .* does not exist|schema cache/i.test(error?.message ?? "");

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
export function normalizeSiteContent(value: unknown): SiteContent {
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
        ["qqGroup", "mayorQq", "kookUrl", "surveyUrl"]
          .flatMap(key => typeof settings[key] === "string" ? [[key, settings[key]]] : [])
      ),
      ...(typeof raw.qqGroup === "string" ? { qqGroup: raw.qqGroup } : {})
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

export function resolveRows<Row, Value>(
  data: Row[] | null | undefined,
  relationMissing: boolean,
  fallback: Value[],
  mapper: (row: Row, index: number) => Value
): Value[] {
  return relationMissing ? fallback : (data ?? []).map(mapper);
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
  if (missingRelation(error, "town_images")) {
    return defaultImages.filter(image => !area || image.area === area);
  }
  if (error) throw error;
  return resolveRows(data, false, defaultImages, mapImage);
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
  const imageTableMissing = missingRelation(imagesResult.error, "town_images");
  if (membersResult.error) throw membersResult.error;
  if (historyResult.error) throw historyResult.error;
  if (imagesResult.error && !imageTableMissing) throw imagesResult.error;
  return {
    members: (membersResult.data ?? []).map(mapMember),
    history: (historyResult.data ?? []).map(mapHistory),
    images: resolveRows(imagesResult.data, imageTableMissing, defaultImages, mapImage)
  };
}

// Read public homepage/admin data in parallel. Missing additive tables fall
// back to checked-in defaults until the latest migration has been applied.
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
  const imageMissing = missingRelation(imagesResult.error, "town_images");
  const faqMissing = missingRelation(faqResult.error, "faq_items");
  const announcementsMissing = missingRelation(announcementsResult.error, "town_announcements");
  const error = contentResult?.error
    ?? membersResult.error
    ?? historyResult.error
    ?? (!imageMissing ? imagesResult.error : null)
    ?? (!faqMissing ? faqResult.error : null)
    ?? (!announcementsMissing ? announcementsResult.error : null);
  if (error) throw error;
  if (contentResult) cachedSiteContent = normalizeSiteContent(contentResult.data?.content);
  return {
    content: structuredClone(cachedSiteContent ?? defaultContent),
    members: (membersResult.data ?? []).map(mapMember),
    history: (historyResult.data ?? []).map(mapHistory),
    images: resolveRows(imagesResult.data, imageMissing, defaultImages, mapImage),
    faqs: resolveRows(faqResult.data, faqMissing, defaultFaqs, mapFaq),
    announcements: resolveRows(announcementsResult.data, announcementsMissing, defaultAnnouncements, mapAnnouncement)
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
  let { error } = await supabase.rpc("replace_town_history", { items });
  if (missingColumn(error)) {
    ({ error } = await supabase.rpc("replace_town_history", {
      items: items.map(({ image_id: _imageId, ...item }) => item)
    }));
  }
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
    id: UUID_PATTERN.test(image.id) ? image.id : crypto.randomUUID(),
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
  let { error } = await supabase.from("town_images").upsert(rows);
  if (missingColumn(error)) {
    ({ error } = await supabase.from("town_images").upsert(rows.map(({
      is_visible: _visible,
      media_type: _mediaType,
      external_id: _externalId,
      external_url: _externalUrl,
      creator_name: _creatorName,
      duration_seconds: _durationSeconds,
      ...row
    }) => row)));
  }
  if (error) throw error;
  return persisted;
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
  let result = await supabase.from("town_images").insert(row).select("*").single();
  if (missingColumn(result.error)) {
    const { is_visible: _visible, ...legacyRow } = row;
    result = await supabase.from("town_images").insert(legacyRow).select("*").single();
  }
  if (result.error) {
    const cleanup = await supabase.storage.from("site-images").remove([storagePath]);
    if (cleanup.error) {
      await supabase.rpc("queue_own_storage_cleanup", { p_bucket: "site-images", p_path: storagePath });
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
  if (UUID_PATTERN.test(image.id)) {
    const { error } = await supabase.rpc("queue_town_image_deletion", { p_image_id: image.id });
    if (error) throw error;
    return;
  }
  if (image.storagePath) {
    const cleanup = await supabase.storage.from("site-images").remove([image.storagePath]);
    if (cleanup.error) throw cleanup.error;
  }
}

// Database row mapping --------------------------------------------------------
export function mapMember(row: Record<string, unknown>): TownMember {
  return {
    id: String(row.id),
    username: String(row.username),
    roleZh: String(row.role_zh ?? ""),
    roleEn: String(row.role_en ?? ""),
    variant: String(row.variant ?? ""),
    group: (row.member_group ?? (row.variant === "friend" ? "friend" : "town")) as TownMember["group"],
    showOnHome: row.show_on_home === undefined
      ? FEATURED_MEMBER_NAMES.has(String(row.username).toLowerCase())
      : Boolean(row.show_on_home),
    introZh: String(row.intro_zh ?? ""),
    introEn: String(row.intro_en ?? ""),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

export function mapHistory(row: Record<string, unknown>, index = 0): HistoryEvent {
  return {
    id: String(row.id),
    date: String(row.event_date),
    titleZh: String(row.title_zh),
    titleEn: String(row.title_en ?? ""),
    bodyZh: String(row.body_zh),
    bodyEn: String(row.body_en ?? ""),
    imageId: row.image_id ? String(row.image_id) : null,
    // Installations that have not applied the additive homepage-selection
    // column keep the historical four-item preview instead of rendering empty.
    showOnHome: row.show_on_home === undefined ? index < 4 : Boolean(row.show_on_home),
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

export function mapResource(row: Record<string, unknown>): Resource {
  return {
    id: String(row.id),
    externalId: row.external_id ? String(row.external_id) : null,
    name: String(row.name),
    description: String(row.description ?? ""),
    source: row.source as Resource["source"],
    resourceType: String(row.resource_type ?? "resource"),
    projectType: String(row.project_type ?? row.resource_type ?? "other"),
    url: String(row.url),
    iconUrl: row.icon_url ? String(row.icon_url) : null,
    author: String(row.author ?? ""),
    currentVersion: String(row.current_version ?? "—"),
    latestVersion: String(row.latest_version ?? row.current_version ?? "—"),
    gameVersions: Array.isArray(row.game_versions) ? row.game_versions.map(String) : [],
    loaders: Array.isArray(row.loaders) ? row.loaders.map(String) : [],
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    updateAvailable: Boolean(row.update_available),
    projectUpdatedAt: row.project_updated_at ? String(row.project_updated_at) : null,
    updateCheckedAt: row.update_checked_at ? String(row.update_checked_at) : null,
    createdAt: String(row.created_at)
  };
}
