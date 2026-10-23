import { z } from "zod";

// Runtime configuration: service credentials stay server-side ----------------
export const config = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(8787),
  // `true` remains accepted for existing deployments, but is narrowed to the
  // loopback proxy instead of trusting arbitrary X-Forwarded-For chains.
  API_TRUST_PROXY: z.enum(["true", "false", "loopback"]).default("false")
    .transform(value => value === "false" ? false : "loopback" as const),
  WEB_ORIGIN: z.string().url().refine(value => {
    try {
      const origin = new URL(value);
      return (origin.protocol === "http:" || origin.protocol === "https:")
        && !origin.username && !origin.password
        && origin.pathname === "/" && !origin.search && !origin.hash;
    } catch {
      return false;
    }
  }, "WEB_ORIGIN must be an http(s) origin without credentials or a path")
    .transform(value => new URL(value).origin).default("http://127.0.0.1:5173"),
  STORAGE_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(30_000).default(300_000),
  STORAGE_CLEANUP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  STORAGE_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(50),
  STORAGE_CLEANUP_RETRY_BASE_MS: z.coerce.number().int().min(1_000).default(30_000),
  STORAGE_CLEANUP_RETRY_MAX_MS: z.coerce.number().int().min(1_000).default(3_600_000),
  API_BODY_MAX_BYTES: z.coerce.number().int().positive().default(1_048_576),
  AUTH_RATE_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  AUTH_LOGIN_RATE_MAX: z.coerce.number().int().positive().default(10),
  AUTH_PASSWORD_RATE_MAX: z.coerce.number().int().positive().default(5),
  MAP_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(52_428_800),
  MAP_UPLOAD_RATE_MAX: z.coerce.number().int().positive().default(3),
  SITE_IMAGE_MAX_BYTES: z.coerce.number().int().positive().default(52_428_800),
  SITE_IMAGE_MAX_PIXELS: z.coerce.number().int().positive().default(50_000_000),
  SITE_IMAGE_WEBP_QUALITY: z.coerce.number().int().min(75).max(100).default(90),
  SITE_IMAGE_CACHE_SECONDS: z.coerce.number().int().positive().default(31_536_000),
  SITE_HERO_CACHE_MS: z.coerce.number().int().positive().default(30_000),
  SITE_IMAGE_SIZES: z.object({ hero: z.tuple([z.number().positive(), z.number().positive()]), content: z.tuple([z.number().positive(), z.number().positive()]) })
    .default({ hero: [1920, 1080], content: [1280, 720] }),
  BILIBILI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  BLOG_API_URL: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "BLOG_API_URL must be an HTTPS URL without credentials").default("https://blog.moesam.com/api/public/site-card.json"),
  BLOG_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  BLOG_RESPONSE_MAX_BYTES: z.coerce.number().int().positive().default(1_048_576),
  BLOG_CACHE_MS: z.coerce.number().int().min(1_000).default(300_000),
  BLOG_HOME_POST_LIMIT: z.coerce.number().int().min(1).max(3).default(3),
  ACCOUNT_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(30_000).default(300_000),
  ANALYTICS_IP_PEPPER: z.string().min(32).optional()
}).superRefine((values, context) => {
  if (values.STORAGE_CLEANUP_RETRY_MAX_MS < values.STORAGE_CLEANUP_RETRY_BASE_MS) {
    context.addIssue({
      code: "custom",
      path: ["STORAGE_CLEANUP_RETRY_MAX_MS"],
      message: "STORAGE_CLEANUP_RETRY_MAX_MS must be at least STORAGE_CLEANUP_RETRY_BASE_MS"
    });
  }
}).parse(process.env);
