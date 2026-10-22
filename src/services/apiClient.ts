import { env } from "../lib/env";
import { supabase } from "../lib/supabase";

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (init.signal?.aborted) abortFromCaller();
  const timeout = window.setTimeout(() => controller.abort("timeout"), 15_000);
  try {
    response = await fetch(`${env.VITE_API_URL}${path}`, { ...init, signal: controller.signal });
  } catch {
    throw new Error(controller.signal.reason === "timeout" ? "error.apiTimeout" : "error.apiUnavailable");
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { code?: string; details?: unknown } | null;
    const error = new Error(payload?.code ?? "error.generic") as Error & { details?: unknown };
    error.details = payload?.details;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function publicApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return request<T>(path, { ...init, headers });
}

// Optional session transport for public endpoints that can enrich, but never
// require, an authenticated request.
export async function sessionAwareApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return request<T>(path, { ...init, headers });
}

// Shared authenticated Fastify transport. FormData keeps its browser-generated
// multipart boundary; JSON callers receive the conventional content type.
export async function authenticatedApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("error.session");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return request<T>(path, { ...init, headers });
}
