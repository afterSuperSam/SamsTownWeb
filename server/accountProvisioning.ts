import type { User } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin.js";

// 内部认证标识独立于用户名，改名后不会继续占用旧名字。
export async function createInternalAuthUser(
  username: string,
  password: string
): Promise<User> {
  const created = await supabaseAdmin.auth.admin.createUser({
    email: `${randomUUID()}@accounts.yingwu.invalid`,
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
