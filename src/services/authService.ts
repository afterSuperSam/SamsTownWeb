import type { Profile } from "../domain/types";
import { supabase } from "../lib/supabase";
import { authenticatedApiRequest, publicApiRequest } from "./apiClient";

export interface QqChallenge {
  challengeId: string;
  expiresIn: number;
  retryAfter: number;
}

export interface QqBindingStatus {
  bound: boolean;
  maskedNumber: string | null;
}

async function applySession(session: { accessToken: string; refreshToken: string }): Promise<void> {
  const { error } = await supabase.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken
  });
  if (error) throw error;
}

// Supabase Auth session --------------------------------------------------------
export async function signIn(username: string, password: string): Promise<void> {
  const session = await publicApiRequest<{ accessToken: string; refreshToken: string }>("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ username: username.trim(), password })
  });
  await applySession(session);
}

export function sendQqRegistrationCode(qqNumber: string): Promise<QqChallenge> {
  return publicApiRequest("/api/auth/qq/send-registration-code", {
    method: "POST",
    body: JSON.stringify({ qqNumber: qqNumber.trim() })
  });
}

export async function registerWithQq(values: {
  challengeId: string;
  qqNumber: string;
  code: string;
  username: string;
  password: string;
  confirmation: string;
}): Promise<void> {
  const session = await publicApiRequest<{ accessToken: string; refreshToken: string }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ ...values, qqNumber: values.qqNumber.trim(), username: values.username.trim() })
  });
  await applySession(session);
}

export function getQqBindingStatus(): Promise<QqBindingStatus> {
  return authenticatedApiRequest("/api/profile/qq");
}

export function sendQqBindingCode(qqNumber: string): Promise<QqChallenge> {
  return authenticatedApiRequest("/api/profile/qq/send-code", {
    method: "POST",
    body: JSON.stringify({ qqNumber: qqNumber.trim() })
  });
}

export function bindQq(values: { challengeId: string; qqNumber: string; code: string }): Promise<{ ok: true }> {
  return authenticatedApiRequest("/api/profile/qq/bind", {
    method: "POST",
    body: JSON.stringify({ ...values, qqNumber: values.qqNumber.trim() })
  });
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  let result = await supabase.from("profiles").select("id,username,role,must_change_password").eq("id", userData.user.id).single();
  if (result.error?.code === "42703" || result.error?.code === "PGRST204") {
    result = await supabase.from("profiles").select("id,username,role").eq("id", userData.user.id).single();
  }
  const { data, error } = result;
  if (error) throw error;
  return {
    id: data.id,
    username: data.username,
    role: data.role,
    mustChangePassword: data.must_change_password
  } as Profile;
}

// Temporary passwords must be replaced before normal use. The Auth password
// changes first; the profile flag is cleared only after Supabase accepts it.
export async function changeOwnPassword(password: string, confirmation = password): Promise<void> {
  await authenticatedApiRequest("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ password, confirmation })
  });
}

// Self-service account details ----------------------------------------------
export async function updateAccountDetails(values: { username: string; email?: string; password?: string }): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  let completedSteps = 0;
  try {
    const { error: profileError } = await supabase.rpc("update_own_username", { next_username: values.username.trim() });
    if (profileError) {
      const missingRpc = profileError.code === "PGRST202" || /function .* does not exist|schema cache/i.test(profileError.message);
      if (!missingRpc || !userData.user) throw profileError;
      const { error: fallbackError } = await supabase.from("profiles").update({ username: values.username.trim() }).eq("id", userData.user.id);
      if (fallbackError) throw fallbackError;
    }
    completedSteps += 1;
    if (values.email) {
      const { error } = await supabase.auth.updateUser({ email: values.email.trim() });
      if (error) throw error;
      completedSteps += 1;
    }
    if (values.password) {
      await changeOwnPassword(values.password);
      completedSteps += 1;
    }
  } catch (error) {
    if (completedSteps > 0) throw new Error("error.accountPartiallyUpdated", { cause: error });
    throw error;
  }
}
