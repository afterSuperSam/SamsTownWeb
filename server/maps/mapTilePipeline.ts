import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import sharp from "sharp";

export const MAX_MAP_PIXELS = 64_000_000;
export const MAX_MAP_DIMENSION = 16_384;
const MAX_MAP_TILES = 2_500;
const TILE_SIZE = 256;
const formatByMime: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/tiff": "tiff"
};

export interface StagedMapImage {
  directory: string;
  path: string;
  filename: string;
  mimetype: string;
}

export interface GeneratedTiles {
  width: number;
  height: number;
  tileSize: number;
  maxLevel: number;
  tileRoot: string;
  files: Array<{ absolutePath: string; relativePath: string }>;
}

export async function stageMapUpload(stream: Readable, filename: string, mimetype: string): Promise<StagedMapImage> {
  const directory = await mkdtemp(join(tmpdir(), "yingwu-map-"));
  const path = join(directory, "source-image");
  try {
    await pipeline(stream, createWriteStream(path, { flags: "wx" }));
    return { directory, path, filename: basename(filename), mimetype };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function generateMapTiles(image: StagedMapImage): Promise<GeneratedTiles> {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(image.path, { limitInputPixels: MAX_MAP_PIXELS, sequentialRead: true }).metadata();
  } catch {
    throw invalidMapImageError();
  }
  if (
    !metadata.width
    || !metadata.height
    || metadata.format !== formatByMime[image.mimetype]
    || (metadata.pages ?? 1) !== 1
  ) throw invalidMapImageError();
  assertSafeMapDimensions(metadata.width, metadata.height);
  const tileSize = TILE_SIZE;
  const maxLevel = Math.ceil(Math.log2(Math.max(metadata.width, metadata.height)));
  // Sharp appends .dzi and _files itself; passing an existing extension would
  // produce map.dzi_files and break the deterministic Storage path.
  const descriptorPath = join(image.directory, "map");
  await sharp(image.path, { limitInputPixels: MAX_MAP_PIXELS, sequentialRead: true })
    .webp({ quality: 84, effort: 4 })
    .tile({ size: tileSize, overlap: 0, layout: "dz" })
    .toFile(descriptorPath);
  const tileRoot = join(image.directory, "map_files");
  // libvips also emits vips-properties.xml beside the tile levels. The viewer
  // never requests it, so keep Storage restricted to actual WebP tiles.
  const files = (await walkFiles(tileRoot)).filter(path => path.toLowerCase().endsWith(".webp"));
  return {
    width: metadata.width,
    height: metadata.height,
    tileSize,
    maxLevel,
    tileRoot,
    files: files.map(absolutePath => ({
      absolutePath,
      relativePath: relative(tileRoot, absolutePath).replaceAll("\\", "/")
    }))
  };
}

export function assertSafeMapDimensions(width: number, height: number): void {
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > MAX_MAP_DIMENSION
    || height > MAX_MAP_DIMENSION
    || pixelCount > MAX_MAP_PIXELS
    || estimateTileCount(width, height) > MAX_MAP_TILES
  ) {
    throw invalidMapImageError();
  }
}

function estimateTileCount(width: number, height: number): number {
  let levelWidth = width;
  let levelHeight = height;
  let count = 0;
  while (levelWidth > 1 || levelHeight > 1) {
    count += Math.ceil(levelWidth / TILE_SIZE) * Math.ceil(levelHeight / TILE_SIZE);
    levelWidth = Math.ceil(levelWidth / 2);
    levelHeight = Math.ceil(levelHeight / 2);
  }
  return count + 1;
}

function invalidMapImageError() {
  const error = new Error("error.invalidMapImage") as Error & { statusCode?: number };
  error.statusCode = 400;
  return error;
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  }));
  return nested.flat();
}

export const cleanupStagedMap = (image: StagedMapImage) => rm(image.directory, { recursive: true, force: true });
