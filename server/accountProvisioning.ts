import { createClient, type User } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { normalizeUsername } from "./authCredentials.js";
import { config } from "./config.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

function internalAccountEmail(username: string): string {
  const normalized = normalizeUsername(username);
  return `${createHash("sha256").update(normalized).digest("hex")}@accounts.yingwu.invalid`;
}

export async function createInternalAuthUser(
  username: string,
  password: string,
  options: { qqRegistrationPending?: boolean } = {}
): Promise<User> {
  const created = await supabaseAdmin.auth.admin.createUser({
    email: internalAccountEmail(username),
    password,
    email_confirm: true,
    app_metadata: { yingwu_trusted_provisioning: true },
    user_metadata: {
      username: username.trim(),
      qq_registration_pending: Boolean(options.qqRegistrationPending)
    }
  });
  if (created.error) throw created.error;
  return created.data.user;
}

export async function deleteInternalAuthUser(userId: string): Promise<void> {
  const deleted = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleted.error) throw deleted.error;
}

export async function createInternalSession(email: string, password: string) {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) throw result.error ?? new Error("error.loginInvalid");
  return {
    accessToken: result.data.session.access_token,
    refreshToken: result.data.session.refresh_token
  };
}
