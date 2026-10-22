import { readFile } from "node:fs/promises";
import { supabaseAdmin } from "../supabaseAdmin.js";
import type { GeneratedTiles, StagedMapImage } from "./mapTilePipeline.js";

const bucket = supabaseAdmin.storage.from("town-maps");

export async function uploadMapAssets(
  image: StagedMapImage,
  tiles: GeneratedTiles,
  prefix: string,
  extension: string
): Promise<string> {
  const uploaded: string[] = [];
  const originalPath = `${prefix}/original/source.${extension}`;
  try {
    await upload(originalPath, await readFile(image.path), image.mimetype);
    uploaded.push(originalPath);
    for (let index = 0; index < tiles.files.length; index += 6) {
      const batch = tiles.files.slice(index, index + 6);
      const results = await Promise.allSettled(batch.map(async file => {
        const path = `${prefix}/tiles/${file.relativePath}`;
        await upload(path, await readFile(file.absolutePath), "image/webp");
        return path;
      }));
      uploaded.push(...results.flatMap(result => result.status === "fulfilled" ? [result.value] : []));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    }
    return originalPath;
  } catch (error) {
    if (uploaded.length) {
      const cleanup = await bucket.remove(uploaded);
      if (cleanup.error) throw new AggregateError([error, cleanup.error], "Map upload and rollback both failed");
    }
    throw error;
  }
}

async function upload(path: string, body: Buffer, contentType: string) {
  const { error } = await bucket.upload(path, body, { contentType, upsert: false });
  if (error) throw error;
}

export async function removeMapPrefix(prefix: string): Promise<void> {
  const paths = await listFiles(prefix);
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await bucket.remove(paths.slice(index, index + 100));
    if (error) throw error;
  }
}

async function listFiles(prefix: string): Promise<string[]> {
  const found: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) found.push(path);
      else found.push(...await listFiles(path));
    }
    if (entries.length < 1000) break;
    offset += entries.length;
  }
  return found;
}
