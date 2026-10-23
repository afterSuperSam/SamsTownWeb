import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createInternalAuthUser } from "../accountProvisioning.js";
import { processAccountCleanup } from "../accountCleanup.js";
import { accountMutations, requireOwner } from "../auth.js";
import { accountPasswordSchema, normalizeUsername, usernameSchema } from "../authCredentials.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

const managedRole = z.enum(["member", "owner"]);
const createSchema = z.object({
  password: accountPasswordSchema,
  username: usernameSchema,
  role: managedRole
});
const updateSchema = z.object({
  role: managedRole.optional(),
  temporaryPassword: accountPasswordSchema.optional()
}).refine(value => value.role || value.temporaryPassword);

const accountFields = "id,username,role,must_change_password,created_at";
function accountFromRow(profile: { id: string; username: string; role: string; must_change_password: boolean; created_at: string }) {
  return { id: profile.id, username: profile.username, role: profile.role === "owner" ? "owner" : "member",
    mustChangePassword: profile.must_change_password, createdAt: profile.created_at };
}

async function audit(app: FastifyInstance, actorId: string, action: string, targetId: string, details: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    actor_id: actorId,
    action,
    target_type: "account",
    target_id: targetId,
    details
  });
  if (error) app.log.error({ err: error, action, targetId }, "Audit log write failed");
}

// Owner-only account lifecycle. Passwords go directly to the Supabase Admin
// API and are never logged or returned to the browser.
export async function accountRoutes(app: FastifyInstance) {
  app.get("/api/accounts", { preHandler: requireOwner }, async () => {
    const profiles = await supabaseAdmin.from("profiles")
      .select(accountFields).order("created_at");
    if (profiles.error) throw profiles.error;
    return (profiles.data ?? []).map(accountFromRow);
  });

  app.post("/api/accounts", { preHandler: requireOwner }, async (request, reply) => {
    const values = createSchema.parse(request.body);
    const normalizedUsername = normalizeUsername(values.username);
    const existing = await supabaseAdmin.rpc("resolve_profile_id", { login_username: normalizedUsername });
    if (existing.error) throw existing.error;
    if (existing.data) {
      return reply.code(409).send({ code: "error.accountExists" });
    }
    let created;
    try {
      created = await createInternalAuthUser(values.username, values.password);
    } catch (error) {
      app.log.error({ err: error }, "Account creation failed");
      return reply.code(400).send({ code: "error.accountCreate" });
    }
    const updated = await supabaseAdmin.from("profiles").update({
      username: values.username,
      role: values.role,
      must_change_password: true
    }).eq("id", created.id).select(accountFields).single();
    if (updated.error) {
      const rollback = await supabaseAdmin.auth.admin.deleteUser(created.id);
      if (rollback.error) {
        const queued = await supabaseAdmin.from("account_deletion_queue").upsert({
          user_id: created.id,
          requested_by: request.actor!.id,
          status: "pending",
          next_attempt_at: new Date().toISOString(),
          locked_at: null,
          last_error: rollback.error.message.slice(0, 500)
        });
        if (queued.error) app.log.error({ err: queued.error, userId: created.id }, "Account rollback could not be queued");
        app.log.error({ err: rollback.error, userId: created.id }, "Account creation rollback deferred");
      }
      throw updated.error;
    }
    await audit(app, request.actor!.id, "account.create", created.id, { role: values.role });
    return reply.code(201).send(accountFromRow(updated.data));
  });

  app.patch("/api/accounts/:id", { preHandler: requireOwner }, async (request, reply) => accountMutations.run(async () => {
    await requireOwner(request, reply);
    if (reply.sent) return;
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const values = updateSchema.parse(request.body);
    const target = await supabaseAdmin.from("profiles").select("role,must_change_password,sessions_valid_after").eq("id", id).single();
    if (target.error) {
      if (target.error.code === "PGRST116") return reply.code(404).send({ code: "error.accountMissing" });
      throw target.error;
    }
    if (target.data.role === "owner" && values.role) {
      return reply.code(409).send({ code: "error.ownerRoleLocked" });
    }

    const profileValues = {
      ...(values.role ? { role: values.role } : {}),
      ...(values.temporaryPassword ? { must_change_password: true, sessions_valid_after: new Date().toISOString() } : {})
    };
    const { error } = await supabaseAdmin.from("profiles").update(profileValues).eq("id", id);
    if (error) throw error;
    if (values.temporaryPassword) {
      const passwordResult = await supabaseAdmin.auth.admin.updateUserById(id, {
        password: values.temporaryPassword
      });
      if (passwordResult.error) {
        // 超时或服务错误不能证明改密失败，保留门禁，避免重新放行可能已被撤销的旧会话。
        const status = passwordResult.error.status ?? 0;
        if (status >= 400 && status < 500 && status !== 408) {
          const rollback = await supabaseAdmin.from("profiles").update({
            role: target.data.role,
            must_change_password: target.data.must_change_password,
            sessions_valid_after: target.data.sessions_valid_after
          }).eq("id", id);
          if (rollback.error) app.log.error({ err: rollback.error, userId: id }, "Account update rollback failed");
        } else {
          app.log.error({ err: passwordResult.error, userId: id }, "Password reset outcome unknown; old sessions remain blocked");
        }
        return reply.code(400).send({ code: "error.accountUpdate" });
      }
    }
    await audit(app, request.actor!.id, "account.update", id, {
      ...(values.role ? { role: values.role } : {}),
      passwordReset: Boolean(values.temporaryPassword)
    });
    return { ok: true };
  }));

  app.delete("/api/accounts/:id", { preHandler: requireOwner }, async (request, reply) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await accountMutations.run(async () => {
      await requireOwner(request, reply);
      if (reply.sent) return;
      if (id === request.actor!.id) return reply.code(409).send({ code: "error.accountSelfDelete" });
      const prepared = await supabaseAdmin.rpc("prepare_account_deletion", {
        p_actor_id: request.actor!.id,
        p_target_id: id
      });
      if (prepared.error) {
        if (/last owner/i.test(prepared.error.message)) return reply.code(409).send({ code: "error.lastOwner" });
        if (prepared.error.code === "P0002") return reply.code(404).send({ code: "error.accountMissing" });
        throw prepared.error;
      }
    });
    if (reply.sent) return;
    await processAccountCleanup(app);
    const queued = await supabaseAdmin.from("account_deletion_queue").select("status").eq("user_id", id).maybeSingle();
    if (queued.error) throw queued.error;
    return reply.code(queued.data ? 202 : 200).send({ ok: true, pending: Boolean(queued.data) });
  });
}
