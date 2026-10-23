import { defaultContent, defaultFaqs, defaultHistory, defaultImages, defaultMembers } from "../domain/defaults";
import { MAX_HOME_MEMBERS } from "../domain/memberPolicy";
import { townImageAreas, townImageLayouts } from "../domain/types";
import type {
  BilibiliVideoMetadata,
  BlogPost,
  FaqItem,
  HistoryEvent,
  SiteContent,
  TownImage,
  TownMember
} from "../domain/types";
import { translations as defaultTranslations, type TranslationKey, type TranslationOverrides } from "../i18n/translations";
import { toJson } from "../lib/json";
import { env } from "../lib/env";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { authenticatedApiRequest, publicApiRequest } from "./apiClient";
import { z } from "zod";

// 博客公告独立于首页资料加载，避免外部站点拖慢首屏。
export function getBlogPosts(signal?: AbortSignal): Promise<BlogPost[]> {
  return publicApiRequest("/api/blog/posts", { signal });
}

export interface SiteBundle {
  content: SiteContent;
  members: TownMember[];
  images: TownImage[];
  faqs: FaqItem[];
}

let cachedSiteContent: SiteContent | null = null;
let contentRequest: Promise<SiteContent> | null = null;
let bundleRequest: Promise<SiteBundle> | null = null;
let homeRequests: ReturnType<typeof loadHomeData> | null = null;
let publicImagesRequest: Promise<TownImage[]> | null = null;

type EditableCollection = "town_members" | "town_history" | "faq_items";
const collectionRevisions = new Map<EditableCollection, { revision: string | null }>();
const collectionSnapshot = z.object({ items: z.array(z.record(z.string(), z.unknown())), revision: z.string() });

// 一次读取完整快照；独立的草稿基线不受公开刷新或旧请求迟到影响。
async function readCollection(collection: EditableCollection, forEditing = false): Promise<Record<string, unknown>[]> {
  const baseline = forEditing ? { revision: null as string | null } : null;
  if (baseline) collectionRevisions.set(collection, baseline);
  const { data, error } = await supabase.rpc("get_site_collection", { p_collection: collection });
  if (error) throw error;
  const snapshot = collectionSnapshot.parse(data);
  if (baseline) baseline.revision = snapshot.revision;
  return snapshot.items;
}

async function replaceCollection(collection: EditableCollection, items: unknown[]): Promise<void> {
  const baseline = collectionRevisions.get(collection);
  if (!baseline?.revision) throw new Error("error.contentChanged");
  const { data, error } = await supabase.rpc("save_site_collection", {
    p_collection: collection, p_revision: baseline.revision, p_items: toJson(items)
  });
  if (error) throw error;
  baseline.revision = z.string().parse(data);
}

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
        ["qqGroup", "kookUrl"]
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

// 只合并同时发生的读取，不长期缓存列表，后台更新后仍能获得新数据。
export function getSiteContent(): Promise<SiteContent> {
  return contentRequest ??= loadSiteContent().finally(() => { contentRequest = null; });
}

async function loadSiteContent(): Promise<SiteContent> {
  if (!isSupabaseConfigured) return structuredClone(defaultContent);
  const initialContent = typeof window !== "undefined" ? window.__yingwuContent : undefined;
  if (initialContent) {
    delete window.__yingwuContent;
    cachedSiteContent = normalizeSiteContent(await initialContent);
    return structuredClone(cachedSiteContent);
  }
  const { data, error } = await supabase.from("site_content").select("content").eq("id", 1).maybeSingle();
  if (error) {
    cachedSiteContent ??= structuredClone(defaultContent);
    throw error;
  }
  cachedSiteContent = normalizeSiteContent(data?.content);
  return structuredClone(cachedSiteContent);
}

export function getTownImages(options: { forDisplay?: boolean } = {}): Promise<TownImage[]> {
  if (options.forDisplay) {
    return publicImagesRequest ??= loadTownImages(true).finally(() => { publicImagesRequest = null; });
  }
  return loadTownImages(false);
}

// 公开预取只交给展示页；后台始终读取完整、新鲜的媒体资料。
async function loadTownImages(forDisplay: boolean): Promise<TownImage[]> {
  if (!isSupabaseConfigured) return defaultImages;
  const initialImages = forDisplay && typeof window !== "undefined" ? window.__yingwuImages : undefined;
  if (initialImages) {
    delete window.__yingwuImages;
    return (await initialImages).map(mapImage);
  }
  let query = supabase.from("town_images").select("*").order("sort_order").order("id");
  if (forDisplay) query = query.eq("is_visible", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapImage);
}

export async function getTownMembers(options: { forEditing?: boolean } = {}): Promise<TownMember[]> {
  if (!isSupabaseConfigured) return defaultMembers;
  return (await readCollection("town_members", options.forEditing)).map(mapMember);
}

export async function getTownArchive(): Promise<{ members: TownMember[]; history: HistoryEvent[]; images: TownImage[] }> {
  const [members, history, images] = await Promise.all([getTownMembers(), getTownHistory(), getTownImages({ forDisplay: true })]);
  return { members, history, images };
}

// 历史只在档案与后台读取，不再进入首页加载链。
export async function getTownHistory(options: { forEditing?: boolean } = {}): Promise<HistoryEvent[]> {
  if (!isSupabaseConfigured) return defaultHistory;
  return (await readCollection("town_history", options.forEditing)).map(mapHistory);
}

// 并行加载站点数据；数据库异常直接交给界面错误处理。
export function preloadHomeData(): void {
  homeRequests ??= loadHomeData();
  for (const request of Object.values(homeRequests)) void request.catch(() => undefined);
}

function loadHomeData() {
  return {
    images: getTownImages({ forDisplay: true }),
    members: getFeaturedMembers(),
    faqs: isSupabaseConfigured ? readCollection("faq_items").then(rows => rows.map(mapFaq)) : Promise.resolve(defaultFaqs)
  };
}

// 首页只取已选成员；完整名单与编辑快照仍走原有读取流程。
async function getFeaturedMembers(): Promise<TownMember[]> {
  if (!isSupabaseConfigured) return defaultMembers;
  const { data, error } = await supabase.from("town_members").select("*")
    .eq("show_on_home", true).order("sort_order").order("id").limit(MAX_HOME_MEMBERS);
  if (error) throw error;
  return (data ?? []).map(mapMember);
}

// 首页按区域接收数据；非首屏请求不参与头图就绪判断。
export function getHomeData() {
  const requests = homeRequests ??= loadHomeData();
  // 保留预取结果直到页面消费；并发挂载共享，消费完成后再释放。
  void Promise.allSettled(Object.values(requests)).then(() => {
    if (homeRequests === requests) homeRequests = null;
  });
  return requests;
}

export function getSiteBundle(options: { refreshContent?: boolean } = {}): Promise<SiteBundle> {
  if (options.refreshContent) return loadSiteBundle(options);
  bundleRequest ??= loadSiteBundle(options)
    .finally(() => { bundleRequest = null; });
  return bundleRequest;
}

async function loadSiteBundle(options: { refreshContent?: boolean }): Promise<SiteBundle> {
  if (!isSupabaseConfigured) {
    return {
      content: structuredClone(defaultContent),
      members: defaultMembers,
      images: defaultImages,
      faqs: defaultFaqs
    };
  }
  const [content, members, images, faqRows] = await Promise.all([
    options.refreshContent ? getSiteContent()
      : cachedSiteContent ?? getSiteContent().catch(() => structuredClone(defaultContent)),
    getTownMembers({ forEditing: options.refreshContent }),
    getTownImages(),
    readCollection("faq_items", options.refreshContent)
  ]);
  return {
    content: structuredClone(content),
    members,
    images,
    faqs: faqRows.map(mapFaq)
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
  await replaceCollection("town_members", normalized.map(member => ({
      username: member.username,
      role_zh: member.roleZh.trim(),
      role_en: member.roleEn.trim(),
      variant: member.variant,
      member_group: member.group,
      show_on_home: member.showOnHome,
      intro_zh: member.introZh.trim(),
      intro_en: member.introEn.trim()
    })));
}

export async function replaceHistory(history: HistoryEvent[]): Promise<void> {
  const items = history.map(event => ({
    event_date: event.date,
    title_zh: event.titleZh,
    title_en: event.titleEn,
    body_zh: event.bodyZh,
    body_en: event.bodyEn,
    image_id: event.imageId
  }));
  await replaceCollection("town_history", items);
}

export async function replaceFaqs(faqs: FaqItem[]): Promise<void> {
  await replaceCollection("faq_items", faqs.map(item => ({
      question_zh: item.questionZh,
      question_en: item.questionEn,
      answer_zh: item.answerZh,
      answer_en: item.answerEn,
      is_visible: item.visible
    })));
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

export async function uploadTownImage(
  file: File,
  values: Pick<TownImage, "area" | "captionZh" | "captionEn" | "altZh" | "altEn" | "layout">
): Promise<TownImage> {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.append(key, value);
  body.append("file", file);
  return mapImage(await authenticatedApiRequest<Record<string, unknown>>("/api/site/images", { method: "POST", body }, env.VITE_IMAGE_UPLOAD_TIMEOUT_MS));
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
    // 退役页面的媒体保留在“其他”，不让旧分类穿透到编辑器翻译映射。
    area: townImageAreas.find(area => area === row.area) ?? "other",
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
    layout: townImageLayouts.find(layout => layout === row.layout) ?? "standard",
    visible: Boolean(row.is_visible ?? true),
    sortOrder: Number(row.sort_order ?? 0)
  };
}
