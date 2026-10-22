export type Language = "zh-CN" | "en";
export type AppRole = "owner" | "admin" | "member" | "viewer";
export type ResourceSource = "modrinth" | "github" | "minecraft";
export type TownImageArea = "hero" | "story" | "gallery" | "join" | "history" | "resources" | "mapHero" | "materialHero" | "forumHero" | "other";
export type TownImageLayout = "standard" | "wide" | "tall";
type TownMediaType = "image" | "bilibili";
type TownMemberGroup = "primary" | "town" | "friend";
export type ForumPostKind = "task" | "anecdote" | "event";

export interface LocalizedText {
  "zh-CN": string;
  en: string;
}

interface SiteSettings {
  qqGroup: string;
  mayorQq: string;
  kookUrl: string;
  surveyUrl: string;
}

export interface SiteContent {
  translations: Record<string, LocalizedText>;
  settings: SiteSettings;
}

export interface TownMember {
  id: string;
  username: string;
  roleZh: string;
  roleEn: string;
  variant: string;
  group: TownMemberGroup;
  showOnHome: boolean;
  introZh: string;
  introEn: string;
  sortOrder: number;
}

export interface HistoryEvent {
  id: string;
  date: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  imageId: string | null;
  showOnHome: boolean;
  sortOrder: number;
}

type TownAnnouncementKind = "announcement" | "affair";

export interface TownAnnouncement {
  id: string;
  kind: TownAnnouncementKind;
  titleZh: string;
  titleEn: string;
  subtitleZh: string;
  subtitleEn: string;
  bodyZh: string;
  bodyEn: string;
  imageId: string | null;
  visible: boolean;
  sortOrder: number;
}

export interface ForumPost {
  id: string;
  title: string;
  kind: ForumPostKind;
  body: string;
  authorId: string | null;
  authorUsername: string;
  createdAt: string;
  updatedAt: string;
}

export type ForumPostDraft = Pick<ForumPost, "title" | "kind" | "body">;

export interface FaqItem {
  id: string;
  questionZh: string;
  questionEn: string;
  answerZh: string;
  answerEn: string;
  visible: boolean;
  sortOrder: number;
}

export interface TownImage {
  id: string;
  mediaType: TownMediaType;
  area: TownImageArea;
  sourceUrl: string;
  storagePath: string | null;
  externalId: string | null;
  externalUrl: string | null;
  creatorName: string;
  durationSeconds: number | null;
  captionZh: string;
  captionEn: string;
  altZh: string;
  altEn: string;
  layout: TownImageLayout;
  visible: boolean;
  sortOrder: number;
}

export interface BilibiliVideoMetadata {
  bvid: string;
  title: string;
  thumbnailUrl: string;
  author: string;
  durationSeconds: number;
  watchUrl: string;
}

export interface Resource {
  id: string;
  externalId: string | null;
  name: string;
  description: string;
  source: ResourceSource;
  resourceType: string;
  projectType: string;
  url: string;
  iconUrl: string | null;
  author: string;
  currentVersion: string;
  latestVersion: string;
  gameVersions: string[];
  loaders: string[];
  tags: string[];
  updateAvailable: boolean;
  projectUpdatedAt: string | null;
  updateCheckedAt: string | null;
  createdAt: string;
}

export interface SharedFile {
  id: string;
  name: string;
  description: string;
  author: string;
  fileName: string;
  storagePath: string;
  fileSize: number;
  mimeType: string;
  category: string;
  createdAt: string;
}

export interface Profile {
  id: string;
  username: string;
  role: AppRole;
  mustChangePassword?: boolean;
}

export interface Account extends Profile {
  qqNumber: string | null;
  createdAt: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
