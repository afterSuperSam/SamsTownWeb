import { describe, expect, it } from "vitest";
import { parseLitematicaMaterialList } from "./materialList";

describe("Litematica material list parser", () => {
  it("parses the exported namespaced material counters", () => {
    const result = parseLitematicaMaterialList(JSON.stringify({
      Name: "楹雾仓库",
      Title: "原理图材料列表",
      Multiplier: 1,
      Date: "Sun, 26 Jul 2026 15:12:23 +0800",
      Materials: [
        { Item: "minecraft:spruce_planks", Total: 3355, Missing: 3200, Mismatched: 2, Available: 155 }
      ]
    }));

    expect(result).toMatchObject({ name: "楹雾仓库", multiplier: 1 });
    expect(result.materials[0]).toEqual({
      itemId: "minecraft:spruce_planks",
      totalCount: 3355,
      missingCount: 3200,
      mismatchedCount: 2,
      availableCount: 155,
      sortOrder: 0
    });
  });

  it("rejects malformed or non-namespaced entries", () => {
    expect(() => parseLitematicaMaterialList("not json")).toThrow("error.invalidMaterialList");
    expect(() => parseLitematicaMaterialList(JSON.stringify({ Name: "x", Materials: [{ Item: "stone", Total: 1, Missing: 1 }] })))
      .toThrow("error.invalidMaterialList");
  });
});
