import { describe, expect, it } from "vitest";
import { duplicateMaterialIds } from "./materialValidation.js";

describe("duplicateMaterialIds", () => {
  it("returns each repeated id only once", () => {
    expect(duplicateMaterialIds([
      { itemId: "minecraft:stone" },
      { itemId: "minecraft:dirt" },
      { itemId: "minecraft:stone" },
      { itemId: "minecraft:stone" }
    ])).toEqual(["minecraft:stone"]);
  });
});
