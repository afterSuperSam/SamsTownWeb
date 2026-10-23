import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { retryDelayMs } from "./storageCleanup.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

interface AccountDeletionRow {
  user_id: string;
  attempts: number;
}

const MAX_ATTEMPTS = 8;

export function registerAccountCleanup(app: FastifyInstance): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await processAccountCleanup(app);
    } catch (error) {
      app.log.error({ err: error }, "Account cleanup worker crashed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), config.ACCOUNT_CLEANUP_INTERVAL_MS);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}

export async function processAccountCleanup(app: FastifyInstance): Promise<void> {
  const pending = await supabaseAdmin.rpc("claim_account_deletion_batch", { p_limit: 20 });
  if (pending.error) {
    app.log.error({ err: pending.error }, "Pending account deletion claim failed");
    return;
  }
  for (const item of (pending.data ?? []) as AccountDeletionRow[]) {
    const transferred = await supabaseAdmin.rpc("transfer_account_storage", { p_user_id: item.user_id });
    const deleted = transferred.error ? { error: transferred.error } : await supabaseAdmin.auth.admin.deleteUser(item.user_id);
    const alreadyMissing = deleted.error && (deleted.error as { status?: number }).status === 404;
    if (!deleted.error || alreadyMissing) {
      const cleanup = await supabaseAdmin.from("account_deletion_queue").delete().eq("user_id", item.user_id);
      if (cleanup.error) app.log.error({ err: cleanup.error, userId: item.user_id }, "Account deletion queue cleanup failed");
      continue;
    }

    const attempts = item.attempts + 1;
    const failed = await supabaseAdmin.from("account_deletion_queue").update({
      attempts,
      status: attempts >= MAX_ATTEMPTS ? "dead" : "pending",
      next_attempt_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
      locked_at: null,
      last_error: deleted.error.message.slice(0, 500)
    }).eq("user_id", item.user_id);
    if (failed.error) app.log.error({ err: failed.error, userId: item.user_id }, "Account deletion retry update failed");
    app.log.error({ err: deleted.error, userId: item.user_id }, "Supabase Auth deletion remains pending");
  }
}
