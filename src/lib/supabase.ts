import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { env, isSupabaseConfigured } from "./env";

// Supabase client creation. Placeholder values keep the offline design preview functional.
export const supabase = createClient<Database>(
  env.VITE_SUPABASE_URL ?? "https://placeholder.supabase.co",
  env.VITE_SUPABASE_ANON_KEY ?? "placeholder-anon-key-placeholder",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

export { isSupabaseConfigured };
