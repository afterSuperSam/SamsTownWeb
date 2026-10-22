import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import { registerAccountCleanup } from "./accountCleanup.js";
import { accountRoutes } from "./routes/accounts.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { authRoutes } from "./routes/auth.js";
import { bilibiliRoutes } from "./routes/bilibili.js";
import { blogRoutes } from "./routes/blog.js";
import { mapRoutes } from "./routes/maps.js";
import { registerStorageCleanup } from "./storageCleanup.js";

export async function buildApp(options: { logger?: boolean; startWorkers?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: config.API_BODY_MAX_BYTES,
    trustProxy: config.API_TRUST_PROXY
  });
  await app.register(cors, { origin: config.WEB_ORIGIN, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  await app.register(rateLimit, {
    global: false,
    hook: "preHandler",
    errorResponseBuilder: (_request, context) => Object.assign(new Error("error.rateLimit"), {
      statusCode: context.statusCode,
      code: "error.rateLimit"
    })
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ code: "error.invalidRequest", details: error.issues.map(issue => ({ path: issue.path.join("."), code: issue.code })) });
    const handledError = error as Error & { code?: string; statusCode?: number };
    if (handledError.code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ code: "error.mapFileTooLarge" });
    const status = handledError.statusCode;
    const code = handledError.message?.startsWith("error.") ? handledError.message : null;
    if (status && status >= 400 && status < 600 && (code || status < 500)) {
      return reply.code(status).send({ code: code ?? "error.invalidRequest" });
    }
    app.log.error(error);
    return reply.code(500).send({ code: "error.generic" });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: "error.notFound" }));
  app.get("/health", async () => ({ ok: true, service: "yingwu-api" }));
  await app.register(accountRoutes);
  await app.register(analyticsRoutes);
  await app.register(authRoutes);
  await app.register(bilibiliRoutes);
  await app.register(blogRoutes);
  await app.register(mapRoutes);
  if (options.startWorkers !== false) {
    registerStorageCleanup(app);
    registerAccountCleanup(app);
  }
  return app;
}
