import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createInternalAuthUser } from "../accountProvisioning.js";
import { processAccountCleanup } from "../accountCleanup.js";
import { requireOwner } from "../auth.js";
import { accountPasswordSchema, normalizeUsername, usernameSchema } from "../authCredentials.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { TaskSemaphore } from "../taskQueue.js";

const managedRole = z.enum(["admin", "member", "viewer"]);
const createSchema = z.object({
  password: accountPasswordSchema,
  username: usernameSchema,
  role: managedRole
});
const updateSchema = z.object({
  role: managedRole.optional(),
  temporaryPassword: accountPasswordSchema.optional()
}).refine(value => value.role || value.temporaryPassword);

interface AccountQqBinding {
  user_id: string;
  qq_number: string;
}
const accountUpdates = new TaskSemaphore(1);

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
    const [profiles, bindings] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,username,role,must_change_password,created_at").order("created_at"),
      supabaseAdmin.rpc("list_account_qq_bindings")
    ]);
    if (profiles.error) throw profiles.error;
    if (bindings.error) throw bindings.error;
    const qqByUser = new Map(((bindings.data as AccountQqBinding[] | null) ?? []).map(binding => [
      String(binding.user_id),
      String(binding.qq_number)
    ]));
    return (profiles.data ?? []).map(profile => ({
      id: profile.id,
      username: profile.username,
      role: profile.role,
      qqNumber: qqByUser.get(profile.id) ?? null,
      mustChangePassword: profile.must_change_password,
      createdAt: profile.created_at
    }));
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
      // The trigger creates this account in a blocked state. Only the profile
      // update below releases the QQ gate while retaining the password gate.
      created = await createInternalAuthUser(values.username, values.password, { qqRegistrationPending: true });
    } catch {
      return reply.code(400).send({ code: "error.accountCreate" });
    }
    const updated = await supabaseAdmin.from("profiles").update({
      username: values.username,
      role: values.role,
      must_change_password: true,
      qq_registration_pending: false
    }).eq("id", created.id).select("id,username,role,must_change_password,created_at").single();
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
    return reply.code(201).send({
      id: updated.data.id,
      username: updated.data.username,
      role: updated.data.role,
      qqNumber: null,
      mustChangePassword: updated.data.must_change_password,
      createdAt: updated.data.created_at
    });
  });

  app.patch("/api/accounts/:id", { preHandler: requireOwner }, async (request, reply) => accountUpdates.run(async () => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const values = updateSchema.parse(request.body);
    const target = await supabaseAdmin.from("profiles").select("role,must_change_password").eq("id", id).single();
    if (target.error) return reply.code(404).send({ code: "error.accountMissing" });
    if (target.data.role === "owner" && values.role) {
      return reply.code(409).send({ code: "error.ownerRoleLocked" });
    }

    const profileValues = {
      ...(values.role ? { role: values.role } : {}),
      ...(values.temporaryPassword ? { must_change_password: true } : {})
    };
    if (Object.keys(profileValues).length) {
      const { error } = await supabaseAdmin.from("profiles").update(profileValues).eq("id", id);
      if (error) throw error;
    }
    if (values.temporaryPassword) {
      const passwordResult = await supabaseAdmin.auth.admin.updateUserById(id, {
        password: values.temporaryPassword
      });
      if (passwordResult.error) {
        const rollback = await supabaseAdmin.from("profiles").update({
          role: target.data.role,
          must_change_password: target.data.must_change_password
        }).eq("id", id);
        if (rollback.error) app.log.error({ err: rollback.error, userId: id }, "Account update rollback failed");
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
    await processAccountCleanup(app);
    return { ok: true };
  });
}
