import { Readable } from "node:stream";
import {
  assertSafeMapDimensions,
  cleanupStagedMap,
  generateMapTiles,
  MAX_MAP_DIMENSION,
  MAX_MAP_PIXELS,
  stageMapUpload
} from "./mapTilePipeline.js";


import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), queue: vi.fn(), from: vi.fn(), list: vi.fn() }));
vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  readFile: vi.fn(async () => Buffer.from("image"))
}));
vi.mock("../supabaseAdmin.js", () => ({
  supabaseAdmin: { from: mocks.from, storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) } }
}));
vi.mock("../storageCleanupQueue.js", () => ({ queueStorageCleanup: mocks.queue, listStorageFiles: mocks.list }));

const { uploadMapAssets } = await import("./mapStorage.js");
const { deleteTownMap } = await import("./mapService.js");
const logger = { error: vi.fn() } as unknown as FastifyBaseLogger;
const image = { path: "source.png", directory: "staged", filename: "source.png", mimetype: "image/png" };
const tiles = { width: 16, height: 16, tileSize: 256, maxLevel: 4, tileRoot: "tiles",
  files: [{ relativePath: "4/0_0.webp", absolutePath: "tile.webp" }] };

describe("地图上传失败补偿", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error("Tile upload failed") });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.queue.mockResolvedValue(undefined);
  });

  it("回滚成功后保留原始上传错误，不产生补偿任务", async () => {
    await expect(uploadMapAssets(image, tiles, "map/revision", "png", logger)).rejects.toThrow("Tile upload failed");
    expect(mocks.remove).toHaveBeenCalledWith(["map/revision/original/source.png"]);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it.each(["returned", "rejected"])("回滚%s错误时将唯一上传前缀加入队列", async mode => {
    const cleanupError = new Error("Storage removal failed");
    if (mode === "returned") mocks.remove.mockResolvedValue({ error: cleanupError });
    else mocks.remove.mockRejectedValue(cleanupError);
    await expect(uploadMapAssets(image, tiles, "map/revision", "png", logger)).rejects.toThrow("rollback queued for retry");
    expect(mocks.queue).toHaveBeenCalledWith("town-maps", "map/revision", true, cleanupError, logger);
  });

  it("入队失败不能被报告为已安排清理", async () => {
    mocks.remove.mockResolvedValue({ error: new Error("Storage removal failed") });
    mocks.queue.mockRejectedValue(new Error("Queue unavailable"));
    await expect(uploadMapAssets(image, tiles, "map/revision", "png", logger)).rejects.toThrow("Queue unavailable");
  });
});

describe("地图删除并发", () => {
  it("读取确认信息后底图发生变化时，不删除新版本和文件", async () => {
    mocks.list.mockResolvedValue([]);
    mocks.list.mockClear();
    let deleted: { id: string } | null = null;
    const deletion = {
      eq: vi.fn(() => deletion),
      select: () => ({ maybeSingle: async () => ({ data: deleted, error: null }) }),
      then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve)
    };
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({
        data: { name: "Town", storage_prefix: "map/old" }, error: null
      }) }) }),
      delete: () => deletion
    });
    await expect(deleteTownMap("map", "Town", logger)).rejects.toMatchObject({ message: "error.mapDataChanged", statusCode: 409 });
    expect(mocks.list).not.toHaveBeenCalled();
    deleted = { id: "map" };
    await expect(deleteTownMap("map", "Town", logger)).resolves.toEqual({ ok: true });
    expect(mocks.list).toHaveBeenCalledWith("town-maps", "map/old");
  });
});

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
