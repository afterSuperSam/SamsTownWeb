import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOwner } from "../auth.js";
import { config } from "../config.js";
import { createDisplayImages, heroImageUrl, storeDisplayImages } from "../siteImages.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { TaskSemaphore } from "../taskQueue.js";
import { queueStorageCleanup } from "../storageCleanupQueue.js";

const fieldsSchema = z.object({
  area: z.enum(["hero", "story", "gallery", "join", "history", "other"]),
  layout: z.enum(["standard", "wide", "tall"]),
  captionZh: z.string().max(500), captionEn: z.string().max(500),
  altZh: z.string().max(300), altEn: z.string().max(300)
});
const uploads = new TaskSemaphore(1, 2);

export async function imageRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { files: 1, fields: 6, parts: 7, fileSize: config.SITE_IMAGE_MAX_BYTES } });
  const heroes = new Map<string, { url: string; expires: number }>();

  // HTML 解析后即可请求头图，不等待 React、成员资料或文案请求。
  app.get("/api/site/hero", async (request, reply) => {
    const { area } = z.object({ area: z.enum(["hero", "history"]).default("hero") }).parse(request.query);
    let cached = heroes.get(area);
    if (!cached || cached.expires <= Date.now()) {
      const result = await supabaseAdmin.from("town_images").select("source_url")
        .eq("area", area).eq("is_visible", true).eq("media_type", "image")
        .order("sort_order").order("id").limit(1).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return reply.code(404).send({ code: "error.notFound" });
      const url = heroImageUrl(String(result.data.source_url));
      const resolved = new URL(url, `${config.WEB_ORIGIN}/`);
      if (!["http:", "https:"].includes(resolved.protocol) || resolved.username || resolved.password) {
        return reply.code(400).send({ code: "error.invalidImage" });
      }
      cached = { url: resolved.href, expires: Date.now() + config.SITE_HERO_CACHE_MS };
      heroes.set(area, cached);
    }
    return reply.header("Cache-Control", `public, max-age=${Math.floor(config.SITE_HERO_CACHE_MS / 1000)}`)
      .redirect(cached.url);
  });

  // 仅管理可上传；同一套 Sharp 处理也供存量图片优化脚本复用。
  app.post("/api/site/images", { preHandler: requireOwner,
    config: { rateLimit: { max: config.MAP_UPLOAD_RATE_MAX, timeWindow: config.AUTH_RATE_WINDOW_MS } }
  }, async (request, reply) => uploads.run(async () => {
    await requireOwner(request, reply);
    if (reply.sent) return;
    const fields: Record<string, string> = {};
    let source: Buffer | undefined;
    for await (const part of request.parts()) {
      if (part.type === "field") fields[part.fieldname] = String(part.value);
      else source = await part.toBuffer();
    }
    const values = fieldsSchema.parse(fields);
    if (!source) return reply.code(400).send({ code: "error.invalidImage" });
    const { versions, format } = await createDisplayImages(source).catch(error => {
      throw Object.assign(new Error("error.invalidImage", { cause: error }), { statusCode: 400 });
    });
    const id = randomUUID();
    const storagePath = `${values.area}/${id}.${format === "jpeg" ? "jpg" : format}`;
    const bucket = supabaseAdmin.storage.from("site-images");
    let displayUrl: string;
    try {
      const original = await bucket.upload(storagePath, source, {
        contentType: `image/${format}`, cacheControl: String(config.SITE_IMAGE_CACHE_SECONDS), upsert: false
      });
      if (original.error) throw original.error;
      displayUrl = await storeDisplayImages(storagePath, versions);
    } catch (error) {
      await queueStorageCleanup("site-images", storagePath, false, error, request.log);
      throw error;
    }
    const result = await supabaseAdmin.from("town_images").insert({
      id, area: values.area, layout: values.layout, storage_path: storagePath,
      source_url: ["hero", "history"].includes(values.area) ? heroImageUrl(displayUrl) : displayUrl,
      caption_zh: values.captionZh, caption_en: values.captionEn, alt_zh: values.altZh, alt_en: values.altEn,
      media_type: "image", is_visible: true, sort_order: 999, created_by: request.actor!.id
    }).select("*").single();
    if (result.error) {
      if (/^(22|23|42|P0)/.test(result.error.code ?? "")) {
        await queueStorageCleanup("site-images", storagePath, false, result.error, request.log);
        throw result.error;
      }
      // 超时可能已经提交：保留文件，避免删掉已被页面引用的图片。
      request.log.error({ err: result.error, storagePath }, "Site image metadata write failed; assets retained");
      throw result.error;
    }
    heroes.clear();
    return reply.code(201).send(result.data);
  }));
}
