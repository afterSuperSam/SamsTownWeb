import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePasswordChangeSession } from "../auth.js";
import { accountPasswordSchema, loginSchema, normalizeUsername } from "../authCredentials.js";
import { config } from "../config.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;
const passwordChangeSchema = z.object({
  password: accountPasswordSchema,
  confirmation: accountPasswordSchema
}).refine(value => value.password === value.confirmation, { path: ["confirmation"] });

// Username login is resolved only by the trusted API. Internal Auth emails are
// never exposed, and every authentication failure returns the same message.
export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/sign-in", {
    config: { rateLimit: { max: MAX_ATTEMPTS, timeWindow: WINDOW_MS } }
  }, async (request, reply) => {
    const values = loginSchema.parse(request.body);
    const normalized = normalizeUsername(values.username);

    const profile = await supabaseAdmin.rpc("resolve_profile_id", { login_username: normalized });
    if (profile.error) throw profile.error;
    if (!profile.data) return reply.code(401).send({ code: "error.loginInvalid" });
    const registrationGate = await supabaseAdmin.from("profiles")
      .select("qq_registration_pending").eq("id", String(profile.data)).single();
    if (registrationGate.error || registrationGate.data.qq_registration_pending) {
      return reply.code(401).send({ code: "error.loginInvalid" });
    }
    const user = await supabaseAdmin.auth.admin.getUserById(String(profile.data));
    if (user.error || !user.data.user.email) return reply.code(401).send({ code: "error.loginInvalid" });

    // Use an ephemeral client so a user session can never replace the shared
    // service-role authorization used by other server routes.
    const authClient = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const result = await authClient.auth.signInWithPassword({ email: user.data.user.email, password: values.password });
    if (result.error || !result.data.session) return reply.code(401).send({ code: "error.loginInvalid" });
    return {
      accessToken: result.data.session.access_token,
      refreshToken: result.data.session.refresh_token
    };
  });

  // Password replacement is server-authoritative: the browser cannot clear the
  // profile gate independently from a successful Supabase Auth update.
  app.post("/api/auth/change-password", {
    preHandler: requirePasswordChangeSession,
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
  }, async request => {
    const values = passwordChangeSchema.parse(request.body);
    const changed = await supabaseAdmin.auth.admin.updateUserById(request.actor!.id, {
      password: values.password
    });
    if (changed.error) throw Object.assign(new Error("error.accountUpdate"), { statusCode: 400 });

    // Failure here remains fail-closed: the password changed, but the account
    // stays gated and can safely retry with another new password.
    const profile = await supabaseAdmin.from("profiles").update({
      must_change_password: false
    }).eq("id", request.actor!.id);
    if (profile.error) throw profile.error;
    return { ok: true };
  });
}
