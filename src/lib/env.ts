import { z } from "zod";

const optionalEnvironmentValue = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(value => value === "" ? undefined : value, schema.optional());

// Environment parsing must never prevent the public site from rendering. -----
const envSchema = z.object({
  VITE_SUPABASE_URL: optionalEnvironmentValue(z.string().url()),
  VITE_SUPABASE_ANON_KEY: optionalEnvironmentValue(z.string().min(20)),
  VITE_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  VITE_IMAGE_UPLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  VITE_API_URL: z.preprocess(value => value === "" ? undefined : value, z.string().url().default("http://localhost:8787"))
});

const parsedEnvironment = envSchema.safeParse(import.meta.env);

export const env: z.infer<typeof envSchema> = parsedEnvironment.success
  ? parsedEnvironment.data
  : { VITE_API_URL: "http://localhost:8787", VITE_API_TIMEOUT_MS: 15_000, VITE_IMAGE_UPLOAD_TIMEOUT_MS: 120_000 };
export const isSupabaseConfigured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
