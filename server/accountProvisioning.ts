import type { User } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { normalizeUsername } from "./authCredentials.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

function internalAccountEmail(username: string): string {
  const normalized = normalizeUsername(username);
  return `${createHash("sha256").update(normalized).digest("hex")}@accounts.yingwu.invalid`;
}

export async function createInternalAuthUser(
  username: string,
  password: string
): Promise<User> {
  const created = await supabaseAdmin.auth.admin.createUser({
    email: internalAccountEmail(username),
    password,
    email_confirm: true,
    app_metadata: { yingwu_trusted_provisioning: true },
    user_metadata: {
      username: username.trim()
    }
  });
  if (created.error) throw created.error;
  return created.data.user;
}
