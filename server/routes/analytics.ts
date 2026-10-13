import type { FastifyPluginAsync } from "fastify";
import { createVisitorIdentity } from "../analyticsPrivacy.js";
import { config } from "../config.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

// Page views pass through Fastify so the public counter cannot be called
// without the same per-IP rate limit used by other public-facing endpoints.
export const analyticsRoutes: FastifyPluginAsync = async app => {
  app.post("/api/analytics/view", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const authenticated = token
      ? Boolean((await supabaseAdmin.auth.getUser(token)).data.user)
      : false;
    const visitor = config.ANALYTICS_IP_PEPPER
      ? createVisitorIdentity(request.ip, config.ANALYTICS_IP_PEPPER)
      : null;
    const { error } = await supabaseAdmin.rpc("record_page_view", {
      p_authenticated: authenticated,
      p_visitor_digest: visitor?.digest ?? null,
      p_masked_ip: visitor?.maskedIp ?? null
    });
    if (error) throw error;
    return reply.code(204).send();
  });
};
