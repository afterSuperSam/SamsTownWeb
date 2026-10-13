import type { Profile } from "../domain/types";
import { supabase } from "../lib/supabase";
import { authenticatedApiRequest, publicApiRequest } from "./apiClient";

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

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data, error } = await supabase.from("profiles").select("id,username,role,must_change_password").eq("id", userData.user.id).single();
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
  let completedSteps = 0;
  try {
    const { error: profileError } = await supabase.rpc("update_own_username", { next_username: values.username.trim() });
    if (profileError) throw profileError;
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
