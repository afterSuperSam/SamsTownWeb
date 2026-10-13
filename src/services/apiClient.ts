import { env } from "../lib/env";
import { supabase } from "../lib/supabase";

// 请求统一处理会话、请求头、取消、超时和错误码。
async function request<T>(path: string, init: RequestInit, sessionMode: "none" | "optional" | "required" = "none"): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (sessionMode !== "none") {
    const { data } = await supabase.auth.getSession();
    if (sessionMode === "required" && !data.session) throw new Error("error.session");
    if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  let response: Response;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (init.signal?.aborted) abortFromCaller();
  const timeout = window.setTimeout(() => controller.abort("timeout"), env.VITE_API_TIMEOUT_MS);
  try {
    response = await fetch(`${env.VITE_API_URL}${path}`, { ...init, headers, signal: controller.signal });
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
  return request<T>(path, init);
}

export function sessionAwareApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, "optional");
}

export function authenticatedApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, "required");
}
