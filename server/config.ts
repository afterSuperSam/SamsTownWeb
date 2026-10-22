import { z } from "zod";

// Runtime configuration: service credentials stay server-side ----------------
export const config = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(8787),
  // `true` remains accepted for existing deployments, but is narrowed to the
  // loopback proxy instead of trusting arbitrary X-Forwarded-For chains.
  API_TRUST_PROXY: z.enum(["true", "false", "loopback"]).default("false")
    .transform(value => value === "false" ? false : "loopback" as const),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  STORAGE_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(30_000).default(300_000),
  ACCOUNT_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(30_000).default(300_000),
  BOT_API_URL: z.string().url().refine(value => {
    const host = new URL(value).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }, "BOT_API_URL must use a loopback host").optional(),
  BOT_API_KEY: z.string().min(20).optional(),
  QQ_CODE_PEPPER: z.string().min(32).optional(),
  ANALYTICS_IP_PEPPER: z.string().min(32).optional()
}).superRefine((values, context) => {
  const qqValues = [values.BOT_API_URL, values.BOT_API_KEY, values.QQ_CODE_PEPPER];
  if (qqValues.some(Boolean) && !qqValues.every(Boolean)) {
    context.addIssue({
      code: "custom",
      message: "BOT_API_URL, BOT_API_KEY and QQ_CODE_PEPPER must be configured together"
    });
  }
}).parse(process.env);
