import { describe, expect, it } from "vitest";
import { defaultContent } from "../domain/defaults";
import type { TownMember } from "../domain/types";
import { mapHistory, mapMember, normalizeSiteContent, replaceMembers, resolveRows } from "./siteRepository";

const legacyHistoryRow = {
  id: "00000000-0000-4000-8000-000000000001",
  event_date: "2020-07",
  title_zh: "楹雾成立",
  title_en: "Founded",
  body_zh: "测试",
  body_en: "Test",
  image_id: null,
  sort_order: 0
};

describe("mapHistory", () => {
  it("keeps the first four homepage events for databases without show_on_home", () => {
    expect([0, 1, 2, 3, 4].map(index => mapHistory(legacyHistoryRow, index).showOnHome))
      .toEqual([true, true, true, true, false]);
  });

  it("respects an explicit homepage selection after migration", () => {
    expect(mapHistory({ ...legacyHistoryRow, show_on_home: false }, 0).showOnHome).toBe(false);
    expect(mapHistory({ ...legacyHistoryRow, show_on_home: true }, 8).showOnHome).toBe(true);
  });
});

describe("mapMember", () => {
  const row = {
    id: "00000000-0000-4000-8000-000000000002",
    username: "DogSam",
    role_zh: "成员",
    role_en: "Member",
    variant: "",
    member_group: "primary",
    sort_order: 1
  };

  it("keeps the requested featured roster usable before the additive migration", () => {
    expect(mapMember(row)).toMatchObject({ showOnHome: true, introZh: "", introEn: "" });
  });

  it("respects explicit homepage selection after the migration", () => {
    expect(mapMember({ ...row, show_on_home: false }).showOnHome).toBe(false);
  });
});

describe("replaceMembers", () => {
  it("rejects more than four homepage members before writing", async () => {
    const members: TownMember[] = Array.from({ length: 5 }, (_, index) => ({
      id: `member-${index}`,
      username: `Member${index}`,
      roleZh: "成员",
      roleEn: "Member",
      variant: "",
      group: "town",
      showOnHome: true,
      introZh: "简介",
      introEn: "Introduction",
      sortOrder: index
    }));

    await expect(replaceMembers(members)).rejects.toThrow("error.tooManyHomeMembers");
  });
});

describe("content normalization", () => {
  it("ignores malformed translation and setting values", () => {
    const normalized = normalizeSiteContent({
      translations: {
        "home.hero.title": { "zh-CN": null, en: 42 },
        "unknown.key": { "zh-CN": "未知", en: "Unknown" }
      },
      settings: { qqGroup: 123, removedGalleryMode: "flow" }
    });

    expect(normalized.translations).toEqual({});
    expect(normalized.settings).toEqual(defaultContent.settings);
  });

  it("keeps an intentional empty result instead of resurrecting defaults", () => {
    expect(resolveRows([], false, ["default"], String)).toEqual([]);
    expect(resolveRows([], true, ["default"], String)).toEqual(["default"]);
  });
});
