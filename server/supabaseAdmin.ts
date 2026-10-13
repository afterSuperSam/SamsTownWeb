import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

// Trusted server client; never import this module in browser code --------------
export const supabaseAdmin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
