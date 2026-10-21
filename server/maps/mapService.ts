import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { queueStorageCleanup } from "../storageCleanupQueue.js";
import { cleanupStagedMap, generateMapTiles, type StagedMapImage } from "./mapTilePipeline.js";
import { removeMapPrefix, uploadMapAssets } from "./mapStorage.js";

export interface MapFields {
  name: string;
  description: string;
  shortLabel: string;
  visible: boolean;
  sortOrder: number;
}

interface MapRow {
  id: string; name: string; description: string; short_label: string;
  image_width: number; image_height: number; tile_size: number; max_level: number;
  tile_revision: string; original_path: string; storage_prefix: string;
  is_visible: boolean; sort_order: number; created_by: string;
  created_at: string; updated_at: string;
}

const extensionByMime: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/tiff": "tiff"
};
export async function createTownMap(image: StagedMapImage, fields: MapFields, actorId: string, log: FastifyBaseLogger) {
  const id = randomUUID();
  const revision = randomUUID();
  const prefix = `${id}/${revision}`;
  try {
    const tiles = await generateMapTiles(image);
    const originalPath = await uploadMapAssets(image, tiles, prefix, requireExtension(image.mimetype), log);
    const { data, error } = await supabaseAdmin.from("town_maps").insert({
      id,
      name: fields.name,
      description: fields.description,
      short_label: fields.shortLabel,
      image_width: tiles.width,
      image_height: tiles.height,
      tile_size: tiles.tileSize,
      max_level: tiles.maxLevel,
      tile_revision: revision,
      original_path: originalPath,
      storage_prefix: prefix,
      is_visible: fields.visible,
      sort_order: fields.sortOrder,
      created_by: actorId
    }).select().single();
    if (error) {
      await removeMapPrefixSafely(prefix, log);
      throw mapDatabaseError(error);
    }
    return serializeMap(data as MapRow);
  } finally {
    await cleanupStagedMapSafely(image, log);
  }
}

export async function updateTownMap(id: string, fields: MapFields) {
  const { data, error } = await supabaseAdmin.from("town_maps").update({
    name: fields.name,
    description: fields.description,
    short_label: fields.shortLabel,
    is_visible: fields.visible,
    sort_order: fields.sortOrder
  }).eq("id", id).select().single();
  if (error) throw mapDatabaseError(error);
  return serializeMap(data as MapRow);
}

export async function replaceTownMapImage(id: string, image: StagedMapImage, clearExisting: boolean, log: FastifyBaseLogger) {
  const existingResult = await supabaseAdmin.from("town_maps").select("*").eq("id", id).single();
  if (existingResult.error) {
    await cleanupStagedMapSafely(image, log);
    throw mapDatabaseError(existingResult.error);
  }
  const existing = existingResult.data as MapRow;
  const revision = randomUUID();
  const prefix = `${id}/${revision}`;
  try {
    const tiles = await generateMapTiles(image);
    const dimensionsChanged = tiles.width !== existing.image_width || tiles.height !== existing.image_height;
    if (dimensionsChanged && !clearExisting) {
      const error = new Error("error.mapDimensionsChanged") as Error & { statusCode?: number };
      error.statusCode = 409;
      throw error;
    }
    const originalPath = await uploadMapAssets(image, tiles, prefix, requireExtension(image.mimetype), log);
    const { data, error } = await supabaseAdmin.rpc("commit_town_map_image_v2", {
      p_map_id: id,
      p_image_width: tiles.width,
      p_image_height: tiles.height,
      p_tile_size: tiles.tileSize,
      p_max_level: tiles.maxLevel,
      p_tile_revision: revision,
      p_original_path: originalPath,
      p_storage_prefix: prefix,
      p_clear_existing: dimensionsChanged
    });
    if (error) {
      await removeMapPrefixSafely(prefix, log);
      throw mapDatabaseError(error);
    }
    const committed = data as { map: MapRow; replacedStoragePrefix: string };
    await removeMapPrefixSafely(committed.replacedStoragePrefix, log);
    return serializeMap(committed.map);
  } finally {
    await cleanupStagedMapSafely(image, log);
  }
}

export async function deleteTownMap(id: string, confirmName: string, log: FastifyBaseLogger) {
  const existingResult = await supabaseAdmin.from("town_maps").select("name,storage_prefix").eq("id", id).single();
  if (existingResult.error) throw mapDatabaseError(existingResult.error);
  if (confirmName !== existingResult.data.name) {
    const error = new Error("error.mapNameConfirmation") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  // 仅删除已确认的版本，避免换图或改名并发时误删新地图并遗留文件。
  const { data, error } = await supabaseAdmin.from("town_maps").delete().eq("id", id)
    .eq("storage_prefix", existingResult.data.storage_prefix).eq("name", confirmName).select("id").maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) throw Object.assign(new Error("error.mapDataChanged"), { statusCode: 409 });
  await removeMapPrefixSafely(existingResult.data.storage_prefix, log);
  return { ok: true as const };
}

async function removeMapPrefixSafely(prefix: string, log: FastifyBaseLogger): Promise<void> {
  try {
    await removeMapPrefix(prefix);
  } catch (error) {
    log.error({ err: error, prefix }, "Map Storage cleanup deferred");
    await queueStorageCleanup("town-maps", prefix, true, error, log);
  }
}

async function cleanupStagedMapSafely(image: StagedMapImage, log: FastifyBaseLogger): Promise<void> {
  try {
    await cleanupStagedMap(image);
  } catch (error) {
    log.error({ err: error, directory: image.directory }, "Temporary map directory cleanup failed");
  }
}

function requireExtension(mimetype: string) {
  const extension = extensionByMime[mimetype];
  if (!extension) {
    const error = new Error("error.invalidMapImage") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return extension;
}

function mapDatabaseError(error: { code?: string; message?: string }): Error {
  if (error.message?.includes("error.mapDimensionsChanged")) {
    return Object.assign(new Error("error.mapDimensionsChanged"), { statusCode: 409 });
  }
  if (error.code === "PGRST116" || error.code === "P0002") {
    return Object.assign(new Error("error.mapNotFound"), { statusCode: 404 });
  }
  if (error.code === "23505") {
    return Object.assign(new Error("error.mapNameExists"), { statusCode: 409 });
  }
  return error instanceof Error ? error : Object.assign(new Error(error.message ?? "error.generic"), error);
}

function serializeMap(row: MapRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    shortLabel: row.short_label,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    tileSize: row.tile_size,
    maxLevel: row.max_level,
    tileRevision: row.tile_revision,
    storagePrefix: row.storage_prefix,
    visible: row.is_visible,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
