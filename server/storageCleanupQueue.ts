import type { FastifyBaseLogger } from "fastify";
import { supabaseAdmin } from "./supabaseAdmin.js";

// 地图即时清理和后台补偿共用同一套目录分页。
export async function listStorageFiles(bucketId: string, prefix: string): Promise<string[]> {
  const bucket = supabaseAdmin.storage.from(bucketId);
  const found: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) found.push(path);
      else found.push(...await listStorageFiles(bucketId, path));
    }
    if (entries.length < 1000) break;
    offset += entries.length;
  }
  return found;
}

export async function queueStorageCleanup(
  bucketId: string,
  objectPath: string,
  recursive: boolean,
  error: unknown,
  log: FastifyBaseLogger
): Promise<void> {
  const queued = await supabaseAdmin.from("storage_cleanup_queue").upsert({
    bucket_id: bucketId,
    object_path: objectPath,
    recursive,
    status: "pending",
    next_attempt_at: new Date().toISOString(),
    locked_at: null,
    last_error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
  }, { onConflict: "bucket_id,object_path,recursive" });
  if (queued.error) {
    log.error({ err: queued.error, bucketId, objectPath }, "Storage cleanup could not be queued");
    throw new AggregateError([error, queued.error], "Storage cleanup could not be queued");
  }
}
