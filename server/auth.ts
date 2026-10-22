import type { FastifyReply, FastifyRequest } from "fastify";
import { supabaseAdmin } from "./supabaseAdmin.js";

type AppRole = "owner" | "admin" | "member" | "viewer";

declare module "fastify" {
  interface FastifyRequest {
    actor?: { id: string; role: AppRole; mustChangePassword: boolean };
  }
}

// Fastify validates the bearer token against Supabase Auth, then reads the
// current database role. Client claims are never trusted for authorization.
async function authenticate(request: FastifyRequest, reply: FastifyReply, allowPasswordChange = false) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    await reply.code(401).send({ code: "error.session" });
    return null;
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    await reply.code(401).send({ code: "error.session" });
    return null;
  }
  const profile = await supabaseAdmin.from("profiles").select("role,must_change_password,qq_registration_pending").eq("id", data.user.id).single();
  if (profile.error || !profile.data) {
    await reply.code(403).send({ code: "error.permission" });
    return null;
  }
  const mustChangePassword = Boolean(profile.data.must_change_password);
  if (profile.data.qq_registration_pending) {
    await reply.code(403).send({ code: "error.qqVerificationRequired" });
    return null;
  }
  if (mustChangePassword && !allowPasswordChange) {
    await reply.code(403).send({ code: "error.passwordChangeRequired" });
    return null;
  }
  request.actor = { id: data.user.id, role: profile.data.role as AppRole, mustChangePassword };
  return request.actor;
}

// This is the only authenticated guard that permits a temporary-password
// account. It is reserved for the password replacement endpoint itself.
export async function requirePasswordChangeSession(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply, true);
}

export async function requireAuthenticated(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply);
}

export async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
  const actor = await authenticate(request, reply);
  if (!actor) return;
  if (actor && actor.role !== "owner") return reply.code(403).send({ code: "error.permission" });
}

export async function requireMapManager(request: FastifyRequest, reply: FastifyReply) {
  const actor = await authenticate(request, reply);
  if (!actor) return;
  if (actor && actor.role !== "admin" && actor.role !== "owner") {
    return reply.code(403).send({ code: "error.permission" });
  }
}

export async function requireMember(request: FastifyRequest, reply: FastifyReply) {
  const actor = await authenticate(request, reply);
  if (!actor) return;
  if (actor && actor.role === "viewer") return reply.code(403).send({ code: "error.permission" });
}
