import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMaterialMetadataCacheForTests, resolveMaterialMetadata } from "./materialMetadata.js";

beforeEach(clearMaterialMetadataCacheForTests);

describe("material metadata", () => {
  it("resolves bilingual vanilla names and a stable item image", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      const value = String(url);
      return new Response(JSON.stringify(value.includes("items-index") ? {
        "oak_stairs.png": { displayName: "Oak Stairs", latestVersion: "1.14.4", removed: false }
      } : {
        "block.minecraft.oak_stairs": "橡木楼梯"
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(resolveMaterialMetadata(["minecraft:oak_stairs"], fetcher)).resolves.toEqual([{
      itemId: "minecraft:oak_stairs",
      nameZh: "橡木楼梯",
      nameEn: "Oak Stairs",
      imageUrl: "https://mcitemgallery.com/images/1.14.4/oak_stairs.png"
    }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps modded namespaces importable without inventing an image", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 200 }));
    await expect(resolveMaterialMetadata(["create:brass_casing"], fetcher)).resolves.toEqual([{
      itemId: "create:brass_casing",
      nameZh: "Brass Casing",
      nameEn: "Brass Casing",
      imageUrl: null
    }]);
  });
});
