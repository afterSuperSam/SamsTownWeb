import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createInternalAuthUser, createInternalSession, deleteInternalAuthUser } from "../accountProvisioning.js";
import { requireAuthenticated } from "../auth.js";
import { accountPasswordSchema, normalizeUsername, usernameSchema } from "../authCredentials.js";
import {
  createClaimDigest,
  createCodeDigest,
  createQqVerificationCode,
  createRequestIpDigest,
  isQqRegistrationConfigured,
  qqChallengeIdSchema,
  qqCodeSchema,
  qqNumberSchema,
  sendQqVerificationCode,
  type QqVerificationPurpose
} from "../qqVerification.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

const sendCodeSchema = z.object({ qqNumber: qqNumberSchema });
const challengeSchema = z.object({
  challengeId: qqChallengeIdSchema,
  qqNumber: qqNumberSchema,
  code: qqCodeSchema
});
const registerSchema = challengeSchema.extend({
  username: usernameSchema,
  password: accountPasswordSchema,
  confirmation: accountPasswordSchema
}).refine(value => value.password === value.confirmation, { path: ["confirmation"] });

type ChallengeStatus = "ok" | "invalid" | "locked" | "cooldown" | "daily_limit" | "unavailable";

function routeError(code: string, statusCode: number): Error {
  return Object.assign(new Error(code), { statusCode });
}

function assertQqConfigured(): void {
  if (!isQqRegistrationConfigured()) throw routeError("error.qqServiceUnavailable", 503);
}

function challengeError(status: ChallengeStatus): Error {
  if (status === "locked") return routeError("error.qqCodeLocked", 423);
  if (status === "cooldown" || status === "daily_limit") return routeError("error.qqRateLimit", 429);
  if (status === "unavailable") return routeError("error.qqUnavailable", 409);
  return routeError("error.qqInvalidCode", 400);
}

async function issueChallenge(
  request: FastifyRequest,
  purpose: QqVerificationPurpose,
  qqNumber: string,
  requestedBy: string | null
) {
  assertQqConfigured();
  const challengeId = randomUUID();
  const code = createQqVerificationCode();
  const issued = await supabaseAdmin.rpc("issue_qq_verification_challenge", {
    p_id: challengeId,
    p_purpose: purpose,
    p_qq_number: qqNumber,
    p_requested_by: requestedBy,
    p_code_digest: createCodeDigest(challengeId, purpose, qqNumber, code),
    p_ip_digest: createRequestIpDigest(request.ip)
  });
  if (issued.error) throw issued.error;
  const status = String(issued.data) as ChallengeStatus;
  if (status !== "ok") throw challengeError(status);

  try {
    await sendQqVerificationCode(qqNumber, code);
    const delivered = await supabaseAdmin.rpc("set_qq_challenge_delivery", {
      p_id: challengeId,
      p_delivered: true
    });
    if (delivered.error || !delivered.data) throw delivered.error ?? new Error("error.generic");
  } catch (error) {
    const invalidated = await supabaseAdmin.rpc("set_qq_challenge_delivery", { p_id: challengeId, p_delivered: false });
    if (invalidated.error) request.log.error({ err: invalidated.error, challengeId }, "QQ challenge delivery rollback failed");
    throw error;
  }
  return { challengeId, expiresIn: 300, retryAfter: 300 };
}

async function claimChallenge(
  purpose: QqVerificationPurpose,
  values: z.infer<typeof challengeSchema>,
  requestedBy: string | null
) {
  const claimToken = randomUUID();
  const claimDigest = createClaimDigest(values.challengeId, claimToken);
  const claimed = await supabaseAdmin.rpc("claim_qq_verification_challenge", {
    p_id: values.challengeId,
    p_purpose: purpose,
    p_qq_number: values.qqNumber,
    p_requested_by: requestedBy,
    p_code_digest: createCodeDigest(values.challengeId, purpose, values.qqNumber, values.code),
    p_claim_digest: claimDigest
  });
  if (claimed.error) throw claimed.error;
  const status = String(claimed.data) as ChallengeStatus;
  if (status !== "ok") throw challengeError(status);
  return claimDigest;
}

async function releaseClaim(challengeId: string, claimDigest: string): Promise<void> {
  const released = await supabaseAdmin.rpc("release_qq_verification_claim", {
    p_id: challengeId,
    p_claim_digest: claimDigest
  });
  if (released.error) throw released.error;
}

export async function qqAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/qq/status", async () => ({ enabled: isQqRegistrationConfigured() }));

  app.post("/api/auth/qq/send-registration-code", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
  }, async request => {
    const values = sendCodeSchema.parse(request.body);
    try {
      return await issueChallenge(request, "register", values.qqNumber, null);
    } catch (error) {
      // A bound number and an unbound number intentionally share the same
      // outward response. The decoy id cannot pass the later claim RPC.
      if (error instanceof Error && error.message === "error.qqUnavailable") {
        return { challengeId: randomUUID(), expiresIn: 300, retryAfter: 300 };
      }
      throw error;
    }
  });

  app.post("/api/auth/register", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
  }, async (request, reply) => {
    assertQqConfigured();
    const values = registerSchema.parse(request.body);
    const existing = await supabaseAdmin.rpc("resolve_profile_id", {
      login_username: normalizeUsername(values.username)
    });
    if (existing.error) throw existing.error;
    if (existing.data) return reply.code(409).send({ code: "error.accountExists" });

    const claimDigest = await claimChallenge("register", values, null);
    let userId: string | null = null;
    try {
      const user = await createInternalAuthUser(values.username, values.password, { qqRegistrationPending: true });
      userId = user.id;
      const session = await createInternalSession(user.email!, values.password);
      const completed = await supabaseAdmin.rpc("complete_qq_verification", {
        p_id: values.challengeId,
        p_claim_digest: claimDigest,
        p_user_id: user.id
      });
      if (completed.error) throw completed.error;
      const completionStatus = String(completed.data) as ChallengeStatus;
      if (completionStatus !== "ok") throw challengeError(completionStatus);
      return reply.code(201).send(session);
    } catch (error) {
      if (userId) {
        try {
          await deleteInternalAuthUser(userId);
        } catch (rollbackError) {
          const queued = await supabaseAdmin.from("account_deletion_queue").upsert({
            user_id: userId,
            requested_by: userId,
            status: "pending",
            next_attempt_at: new Date().toISOString(),
            locked_at: null,
            last_error: rollbackError instanceof Error ? rollbackError.message.slice(0, 500) : "QQ registration rollback failed"
          });
          if (queued.error) app.log.error({ err: queued.error, userId }, "QQ registration rollback could not be queued");
          app.log.error({ err: rollbackError, userId }, "QQ registration rollback failed");
        }
      }
      try {
        await releaseClaim(values.challengeId, claimDigest);
      } catch (releaseError) {
        app.log.error({ err: releaseError, challengeId: values.challengeId }, "QQ registration claim release failed");
      }
      if (error instanceof Error && error.message.startsWith("error.")) throw error;
      throw routeError("error.accountCreate", 400);
    }
  });

  app.get("/api/profile/qq", { preHandler: requireAuthenticated }, async request => {
    const result = await supabaseAdmin.rpc("get_qq_binding_status", { p_user_id: request.actor!.id });
    if (result.error) throw result.error;
    return result.data;
  });

  app.post("/api/profile/qq/send-code", {
    preHandler: requireAuthenticated,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
  }, async request => {
    const values = sendCodeSchema.parse(request.body);
    return issueChallenge(request, "bind", values.qqNumber, request.actor!.id);
  });

  app.post("/api/profile/qq/bind", {
    preHandler: requireAuthenticated,
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
  }, async request => {
    assertQqConfigured();
    const values = challengeSchema.parse(request.body);
    const claimDigest = await claimChallenge("bind", values, request.actor!.id);
    try {
      const completed = await supabaseAdmin.rpc("complete_qq_verification", {
        p_id: values.challengeId,
        p_claim_digest: claimDigest,
        p_user_id: request.actor!.id
      });
      if (completed.error) throw completed.error;
      const status = String(completed.data) as ChallengeStatus;
      if (status !== "ok") throw challengeError(status);
      return { ok: true };
    } catch (error) {
      try {
        await releaseClaim(values.challengeId, claimDigest);
      } catch (releaseError) {
        app.log.error({ err: releaseError, challengeId: values.challengeId }, "QQ binding claim release failed");
      }
      throw error;
    }
  });
}
