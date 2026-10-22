import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  assertSafeMapDimensions,
  cleanupStagedMap,
  generateMapTiles,
  MAX_MAP_DIMENSION,
  MAX_MAP_PIXELS,
  stageMapUpload
} from "./mapTilePipeline.js";

describe("map dimension guard", () => {
  it("accepts a practical square map", () => {
    expect(() => assertSafeMapDimensions(4096, 4096)).not.toThrow();
  });

  it("rejects decompression-bomb dimensions", () => {
    expect(() => assertSafeMapDimensions(MAX_MAP_DIMENSION + 1, 128)).toThrow("error.invalidMapImage");
    expect(() => assertSafeMapDimensions(MAX_MAP_PIXELS, 2)).toThrow("error.invalidMapImage");
  });

  it("rejects an SVG disguised as a PNG upload", async () => {
    const image = await stageMapUpload(
      Readable.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>'),
      "fake.png",
      "image/png"
    );
    try {
      await expect(generateMapTiles(image)).rejects.toThrow("error.invalidMapImage");
    } finally {
      await cleanupStagedMap(image);
    }
  });
});
