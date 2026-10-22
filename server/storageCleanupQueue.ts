import type { FastifyBaseLogger } from "fastify";
import { supabaseAdmin } from "./supabaseAdmin.js";

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
  if (queued.error) log.error({ err: queued.error, bucketId, objectPath }, "Storage cleanup could not be queued");
}
