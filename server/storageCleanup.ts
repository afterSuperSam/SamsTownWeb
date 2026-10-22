import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

interface CleanupRow {
  id: number;
  bucket_id: string;
  object_path: string;
  recursive: boolean;
  attempts: number;
}
const MAX_ATTEMPTS = 8;

export function registerStorageCleanup(app: FastifyInstance): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await processStorageCleanup(app);
    } catch (error) {
      app.log.error({ err: error }, "Storage cleanup worker crashed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), config.STORAGE_CLEANUP_INTERVAL_MS);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}

async function processStorageCleanup(app: FastifyInstance): Promise<void> {
  const pending = await supabaseAdmin.rpc("claim_storage_cleanup_batch", { p_limit: 50 });
  if (pending.error) {
    app.log.error({ err: pending.error }, "Storage cleanup queue lookup failed");
    return;
  }
  for (const item of (pending.data ?? []) as CleanupRow[]) {
    try {
      const bucket = supabaseAdmin.storage.from(item.bucket_id);
      const paths = item.recursive ? await listFiles(item.bucket_id, item.object_path) : [item.object_path];
      for (let index = 0; index < paths.length; index += 100) {
        const removal = await bucket.remove(paths.slice(index, index + 100));
        if (removal.error) throw removal.error;
      }
      const deleted = await supabaseAdmin.from("storage_cleanup_queue").delete().eq("id", item.id);
      if (deleted.error) throw deleted.error;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = item.attempts + 1;
      const failed = await supabaseAdmin.from("storage_cleanup_queue").update({
        attempts,
        status: attempts >= MAX_ATTEMPTS ? "dead" : "pending",
        next_attempt_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
        locked_at: null,
        last_error: message.slice(0, 500)
      }).eq("id", item.id);
      if (failed.error) app.log.error({ err: failed.error, cleanupId: item.id }, "Storage cleanup retry update failed");
      app.log.error({ err: error, cleanupId: item.id }, "Storage cleanup attempt failed");
    }
  }
}

export function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

async function listFiles(bucketId: string, prefix: string): Promise<string[]> {
  const bucket = supabaseAdmin.storage.from(bucketId);
  const found: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) found.push(path);
      else found.push(...await listFiles(bucketId, path));
    }
    if (entries.length < 1000) break;
    offset += entries.length;
  }
  return found;
}
