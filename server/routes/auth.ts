import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { accountMutations, requirePasswordChangeSession } from "../auth.js";
import { accountPasswordSchema, loginSchema, normalizeUsername } from "../authCredentials.js";
import { config } from "../config.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

const passwordChangeSchema = z.object({
  password: accountPasswordSchema,
  confirmation: accountPasswordSchema
}).refine(value => value.password === value.confirmation, { path: ["confirmation"] });

// 独立客户端只负责签发用户会话，不替换共享服务端的管理员授权。
async function passwordSession(email: string, password: string) {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return client.auth.signInWithPassword({ email, password });
}

// 用户名仅由服务端解析，内部邮箱不返回浏览器。
export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/sign-in", {
    config: { rateLimit: { max: config.AUTH_LOGIN_RATE_MAX, timeWindow: config.AUTH_RATE_WINDOW_MS } }
  }, async (request, reply) => {
    const values = loginSchema.parse(request.body);
    const normalized = normalizeUsername(values.username);

    const profile = await supabaseAdmin.rpc("resolve_profile_id", { login_username: normalized });
    if (profile.error) throw profile.error;
    if (!profile.data) return reply.code(401).send({ code: "error.loginInvalid" });
    const user = await supabaseAdmin.auth.admin.getUserById(String(profile.data));
    if (user.error || !user.data.user?.email) return reply.code(401).send({ code: "error.loginInvalid" });

    const result = await passwordSession(user.data.user.email, values.password);
    if (result.error || !result.data.session) return reply.code(401).send({ code: "error.loginInvalid" });
    return {
      accessToken: result.data.session.access_token,
      refreshToken: result.data.session.refresh_token
    };
  });

  // 改密后重新签发会话，旧会话失效时也能继续使用；成功后才解除首次改密门禁。
  app.post("/api/auth/change-password", {
    preHandler: requirePasswordChangeSession,
    config: { rateLimit: { max: config.AUTH_PASSWORD_RATE_MAX, timeWindow: config.AUTH_RATE_WINDOW_MS } }
  }, async (request, reply) => accountMutations.run(async () => {
    await requirePasswordChangeSession(request, reply);
    if (reply.sent) return;
    const values = passwordChangeSchema.parse(request.body);
    const changed = await supabaseAdmin.auth.admin.updateUserById(request.actor!.id, {
      password: values.password
    });
    if (changed.error || !changed.data.user?.email) throw Object.assign(new Error("error.accountUpdate"), { statusCode: 400 });
    const result = await passwordSession(changed.data.user.email, values.password);
    if (result.error || !result.data.session) {
      throw Object.assign(new Error("error.accountUpdate"), { statusCode: 400 });
    }

    const profile = await supabaseAdmin.from("profiles").update({
      must_change_password: false
    }).eq("id", request.actor!.id);
    if (profile.error) throw profile.error;
    return {
      accessToken: result.data.session.access_token,
      refreshToken: result.data.session.refresh_token
    };
  }));
}
