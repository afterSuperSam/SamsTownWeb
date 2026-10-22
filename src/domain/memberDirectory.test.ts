import { describe, expect, it } from "vitest";
import { defaultContent, defaultFaqs, defaultHistory, defaultImages, defaultMembers } from "./defaults";

describe("bundled content boundary", () => {
  it("does not ship a second copy of admin-managed cloud content", () => {
    expect(defaultContent.translations).toEqual({});
    expect(defaultMembers).toEqual([]);
    expect(defaultHistory).toEqual([]);
    expect(defaultImages).toEqual([]);
    expect(defaultFaqs).toEqual([]);
  });
});
