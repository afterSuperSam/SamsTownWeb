import type { FaqItem, HistoryEvent, SiteContent, TownImage, TownMember } from "./types";

// Supabase is the only source of admin-managed content. These values model an
// empty installation and never contain a checked-in copy of production data.
export const defaultContent: SiteContent = {
  translations: {},
  settings: {
    qqGroup: "",
    kookUrl: ""
  }
};
export const defaultMembers: TownMember[] = [];
export const defaultHistory: HistoryEvent[] = [];
export const defaultImages: TownImage[] = [];
export const defaultFaqs: FaqItem[] = [];
