import { describe, expect, it } from "vitest";
import { getGalleryPreviewCount } from "./townGallery";
import type { TownImageLayout } from "./types";

const layouts = (...values: TownImageLayout[]) => values.map(layout => ({ layout }));

describe("getGalleryPreviewCount", () => {
  it("fits exactly four desktop rows without clipping the next item", () => {
    expect(getGalleryPreviewCount(layouts(...Array<TownImageLayout>(13).fill("standard")), 3)).toBe(12);
  });

  it("accounts for wide and tall media spans", () => {
    expect(getGalleryPreviewCount(layouts(
      "wide", "tall", "standard", "standard", "wide", "tall", "standard", "standard", "standard"
    ), 3)).toBe(8);
  });
});
