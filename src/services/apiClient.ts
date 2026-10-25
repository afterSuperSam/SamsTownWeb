import { env } from "../lib/env";
import { supabase } from "../lib/supabase";

// 请求统一处理会话、请求头、取消、超时和错误码。
async function request<T>(path: string, init: RequestInit, sessionMode: "none" | "optional" | "required" = "none", timeoutMs = env.VITE_API_TIMEOUT_MS, baseUrl = env.VITE_API_URL): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (sessionMode !== "none") {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (sessionMode === "required" && !data.session) throw new Error("error.session");
    if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  let response: Response;
  let payload: unknown;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (init.signal?.aborted) abortFromCaller();
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    if (response.status !== 204) {
      payload = await response.json().catch(error => {
        if (response.ok || controller.signal.aborted) throw error;
        return null;
      });
    }
  } catch {
    throw new Error(controller.signal.reason === "timeout" ? "error.apiTimeout" : "error.apiUnavailable");
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
  if (!response.ok) {
    const failure = payload && typeof payload === "object" ? payload as { code?: unknown; details?: unknown } : null;
    const error = new Error(typeof failure?.code === "string" ? failure.code : "error.generic") as Error & { details?: unknown };
    error.details = failure?.details;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return payload as T;
}

export function publicApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init);
}

// 公开首页资料始终同域读取，不等待会话，也不把访客带到数据库域名。
export function publicSiteRequest<T>(resource: "content" | "images" | "members" | "faqs"): Promise<T> {
  const origin = typeof window !== "undefined" ? window.location.origin : env.VITE_API_URL;
  return request<T>(`/api/site/public/${resource}`, {}, "none", env.VITE_API_TIMEOUT_MS, origin);
}

export function sessionAwareApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, "optional");
}

export function authenticatedApiRequest<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  return request<T>(path, init, "required", timeoutMs);
}
