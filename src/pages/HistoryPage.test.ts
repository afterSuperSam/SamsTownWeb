import { describe, expect, it } from "vitest";
import { buildCurvePath } from "./HistoryPage";

describe("buildCurvePath", () => {
  it("starts at event 01 instead of drawing down from the page top", () => {
    const path = buildCurvePath([
      { id: "01", x: 420, y: 96 },
      { id: "02", x: 500, y: 340 }
    ], 920, 720);

    expect(path).toMatch(/^M 420 96 C /);
    expect(path).not.toContain("M 460 0");
  });

  it("returns no path until event positions are measured", () => {
    expect(buildCurvePath([], 920, 720)).toBe("");
  });
});
