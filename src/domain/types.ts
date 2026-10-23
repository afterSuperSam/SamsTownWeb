export type Language = "zh-CN" | "en";
export type AppRole = "owner" | "member";
export const townImageAreas = ["hero", "story", "gallery", "join", "history", "other"] as const;
export type TownImageArea = typeof townImageAreas[number];
export const townImageLayouts = ["standard", "wide", "tall"] as const;
export type TownImageLayout = typeof townImageLayouts[number];
type TownMediaType = "image" | "bilibili";
type TownMemberGroup = "primary" | "town" | "friend";

export interface LocalizedText {
  "zh-CN": string;
  en: string;
}

interface SiteSettings {
  qqGroup: string;
  kookUrl: string;
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
  sortOrder: number;
}

export interface BlogPost {
  title: string;
  url: string;
  coverUrl: string | null;
  description: string;
  publishedAt: string;
}

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

export interface Profile {
  id: string;
  username: string;
  role: AppRole;
  mustChangePassword: boolean;
}

export interface Account extends Profile {
  createdAt: string;
}
