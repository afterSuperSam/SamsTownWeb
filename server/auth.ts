import type { FastifyReply, FastifyRequest } from "fastify";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { TaskSemaphore } from "./taskQueue.js";

// 单进程内串行处理改密、重置和删号，避免旧操作覆盖新的账号门禁。
export const accountMutations = new TaskSemaphore(1);

type AppRole = "owner" | "member";

declare module "fastify" {
  interface FastifyRequest {
    actor?: { id: string; role: AppRole; mustChangePassword: boolean };
  }
}

// Fastify validates the bearer token against Supabase Auth, then reads the
// current database role. Client claims are never trusted for authorization.
async function authenticate(request: FastifyRequest, reply: FastifyReply, allowPasswordChange = false) {
  const token = request.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    await reply.code(401).send({ code: "error.session" });
    return null;
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    await reply.code(401).send({ code: "error.session" });
    return null;
  }
  // getUser 验证签名后，再核验会话仍存在且未被管理员重置作废。
  let sessionId: unknown;
  try { sessionId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).session_id; }
  catch { sessionId = null; }
  if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    await reply.code(401).send({ code: "error.session" });
    return null;
  }
  const session = await supabaseAdmin.rpc("is_current_auth_session", { p_user_id: data.user.id, p_session_id: sessionId });
  if (session.error) throw session.error;
  if (!session.data) {
    await reply.code(401).send({ code: "error.session" });
    return null;
  }
  const profile = await supabaseAdmin.from("profiles").select("role,must_change_password").eq("id", data.user.id).single();
  if (profile.error || !profile.data) {
    await reply.code(403).send({ code: "error.permission" });
    return null;
  }
  const mustChangePassword = Boolean(profile.data.must_change_password);
  if (mustChangePassword && !allowPasswordChange) {
    await reply.code(403).send({ code: "error.passwordChangeRequired" });
    return null;
  }
  request.actor = { id: data.user.id, role: profile.data.role === "owner" ? "owner" : "member", mustChangePassword };
  return request.actor;
}

// This is the only authenticated guard that permits a temporary-password
// account. It is reserved for the password replacement endpoint itself.
export async function requirePasswordChangeSession(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply, true);
}

export async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
  const actor = await authenticate(request, reply);
  if (!actor) return;
  if (actor.role !== "owner") return reply.code(403).send({ code: "error.permission" });
}
