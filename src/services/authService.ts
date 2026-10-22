import type { Profile } from "../domain/types";
import { supabase } from "../lib/supabase";
import { authenticatedApiRequest, publicApiRequest } from "./apiClient";

let profileRequest: { userId: string; promise: Promise<Profile> } | null = null;

// 登录和改密共用会话写入，避免后续请求继续携带旧令牌。
async function storeSession(session: { accessToken: string; refreshToken: string }): Promise<void> {
  profileRequest = null;
  const { error } = await supabase.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken
  });
  if (error) throw error;
}

// 用户名登录成功后交给 Supabase 管理会话。
export async function signIn(username: string, password: string): Promise<void> {
  const session = await publicApiRequest<{ accessToken: string; refreshToken: string }>("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ username: username.trim(), password })
  });
  await storeSession(session);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// 会话已提供用户 ID；资料查询仍由数据库 RLS 验证 token 与访问权限。
export function getCurrentProfile(userId: string): Promise<Profile> {
  if (profileRequest?.userId === userId) return profileRequest.promise;
  const promise = loadCurrentProfile(userId).finally(() => {
    if (profileRequest?.promise === promise) profileRequest = null;
  });
  profileRequest = { userId, promise };
  return promise;
}

async function loadCurrentProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from("profiles").select("id,username,role,must_change_password").eq("id", userId).single();
  if (error) throw error;
  return {
    id: data.id,
    username: data.username,
    role: data.role === "owner" ? "owner" : "member",
    mustChangePassword: data.must_change_password
  };
}

// 临时密码由服务端替换，资料刷新前先保存新会话。
export async function changeOwnPassword(password: string, confirmation = password): Promise<void> {
  const session = await authenticatedApiRequest<{ accessToken: string; refreshToken: string }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ password, confirmation })
  });
  await storeSession(session);
}

// Self-service account details ----------------------------------------------
export async function updateAccountDetails(values: { username: string; password?: string }): Promise<void> {
  let usernameUpdated = false;
  try {
    const { error: profileError } = await supabase.rpc("update_own_username", { next_username: values.username.trim() });
    if (profileError) throw profileError;
    usernameUpdated = true;
    profileRequest = null;
    if (values.password) {
      await changeOwnPassword(values.password);
    }
  } catch (error) {
    if (usernameUpdated) throw new Error("error.accountPartiallyUpdated", { cause: error });
    throw error;
  }
}
