import { describe, expect, it } from "vitest";
import { can } from "./permissions";
import type { AppRole } from "./types";
import { safeExternalUrl } from "../lib/externalUrl";
import { pixelToChunk, rectangleCells, splitClaimRegions, toggleCells } from "../features/atlas/domain/claimGeometry";

describe("domain rules", () => {
  it("preserves the capability matrix", () => {
    for (const role of ["member", "owner"] as AppRole[]) {
      expect(can(role, "map:view")).toBe(true);
      expect(can(role, "map:project")).toBe(true);
      expect(can(role, "map:manage")).toBe(role === "owner");
      expect(can(role, "admin")).toBe(role === "owner");
    }
    expect(can(null, "admin")).toBe(false);
    expect(can(undefined, "map:project")).toBe(false);
    expect(can(null, "map:view")).toBe(true);
  });
  it("rejects executable and credential-bearing links", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,unsafe", "/relative", "https://user:password@example.com"]) {
      expect(safeExternalUrl(value)).toBeNull();
    }
    expect(safeExternalUrl("https://example.com")).toBe("https://example.com/");
    expect(safeExternalUrl("http://example.com", { httpsOnly: true })).toBeNull();
  });
  it("keeps chunk selection and connected regions deterministic", () => {
    expect(pixelToChunk(16, 31)).toEqual({ column: 1, row: 1 });
    const rectangle = rectangleCells({ column: 0, row: 0 }, { column: 1, row: 1 });
    expect(rectangle).toHaveLength(4);
    expect(toggleCells(rectangle, [{ column: 0, row: 0 }], true)).toHaveLength(3);
    expect(splitClaimRegions([{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 2, row: 1 }]).map(region => region.cells.length).sort()).toEqual([1, 2]);
  });
});
