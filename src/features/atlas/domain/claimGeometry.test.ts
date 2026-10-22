import { describe, expect, it } from "vitest";
import {
  buildCellPaths,
  clampChunk,
  findNearestMarker,
  pixelToChunk,
  rectangleCells,
  splitClaimRegions,
  toggleCells
} from "./claimGeometry";

describe("claim geometry", () => {
  it("maps image pixels to 16 by 16 chunks", () => {
    expect(pixelToChunk(0, 0)).toEqual({ column: 0, row: 0 });
    expect(pixelToChunk(15, 15)).toEqual({ column: 0, row: 0 });
    expect(pixelToChunk(16, 31)).toEqual({ column: 1, row: 1 });
    expect(clampChunk({ column: 99, row: -2 }, 33, 17)).toEqual({ column: 2, row: 0 });
  });

  it("creates and updates deterministic rectangular selections", () => {
    const rectangle = rectangleCells({ column: 2, row: 1 }, { column: 1, row: 2 });
    expect(rectangle).toEqual([
      { column: 1, row: 1 }, { column: 2, row: 1 },
      { column: 1, row: 2 }, { column: 2, row: 2 }
    ]);
    expect(toggleCells(rectangle, [{ column: 1, row: 1 }], true)).toEqual([
      { column: 2, row: 1 }, { column: 1, row: 2 }, { column: 2, row: 2 }
    ]);
  });

  it("splits diagonally separated cells while joining orthogonal neighbours", () => {
    const regions = splitClaimRegions([
      { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 2, row: 1 }
    ]);
    expect(regions).toHaveLength(2);
    expect(regions.map(region => region.cells.length).sort()).toEqual([1, 2]);
  });

  it("draws only the outside edge of adjacent claimed chunks", () => {
    const paths = buildCellPaths([{ column: 0, row: 0 }, { column: 1, row: 0 }]);
    expect(paths.fill.match(/M/g)).toHaveLength(2);
    expect(paths.edge.match(/M/g)).toHaveLength(6);
    expect(paths.edge).not.toContain("M16 0V16");
    expect(paths.edge).not.toContain("M16 16V0");
  });

  it("selects the closest marker when hit areas overlap", () => {
    const marker = (id: string, pixelX: number) => ({
      id,
      mapId: "map",
      name: id,
      description: "",
      iconType: "other" as const,
      color: "#ffffff",
      pixelX,
      pixelY: 10,
      createdBy: "00000000-0000-4000-8000-000000000001",
      createdAt: "",
      updatedAt: ""
    });
    expect(findNearestMarker([marker("far", 18), marker("near", 11)], { x: 10, y: 10 }, 12)?.id)
      .toBe("near");
  });
});
