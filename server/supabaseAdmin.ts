import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

// 所有服务端 Supabase 请求共享截止时间，避免上游挂起占住串行任务队列。
export const supabaseFetch: typeof fetch = (input, options) => {
  const signal = options?.signal ?? (input instanceof Request ? input.signal : undefined);
  return fetch(input, { ...options, signal: AbortSignal.any([
    AbortSignal.timeout(config.SUPABASE_REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])
  ]) });
};

// 此客户端仅供可信服务端使用。
export const supabaseAdmin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: supabaseFetch },
  auth: { autoRefreshToken: false, persistSession: false }
});
