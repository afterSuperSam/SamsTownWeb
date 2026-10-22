import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOwner } from "../auth.js";
import { resolveBilibiliVideo } from "../bilibili.js";

const resolveSchema = z.object({ input: z.string().trim().min(1).max(500) });

export async function bilibiliRoutes(app: FastifyInstance) {
  app.post("/api/bilibili/resolve", {
    preHandler: requireOwner,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
  }, async request => {
    const { input } = resolveSchema.parse(request.body);
    return resolveBilibiliVideo(input);
  });
}
