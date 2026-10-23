import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireOwner } from "../auth.js";
import {
  createTownMap,
  deleteTownMap,
  replaceTownMapImage,
  updateTownMap
} from "../maps/mapService.js";
import type { MapFields } from "../maps/mapService.js";
import { cleanupStagedMap, stageMapUpload, type StagedMapImage } from "../maps/mapTilePipeline.js";
import { TaskSemaphore } from "../taskQueue.js";

const mapFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(4000).default(""),
  shortLabel: z.string().max(24).default(""),
  visible: z.boolean().default(true),
  sortOrder: z.number().int().default(0)
});
const idSchema = z.string().uuid();
const mapUploads = new TaskSemaphore(1, 2);

export async function mapRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { files: 1, fields: 8, fileSize: config.MAP_UPLOAD_MAX_BYTES, parts: 9 }
  });

  app.post("/api/maps", {
    preHandler: requireOwner,
    config: { rateLimit: { max: config.MAP_UPLOAD_RATE_MAX, timeWindow: config.AUTH_RATE_WINDOW_MS } }
  }, async (request, reply) => {
    return mapUploads.run(async () => {
      await requireOwner(request, reply);
      if (reply.sent) return;
      const parsed = await parseMapMultipart(request);
      let fields: MapFields;
      try {
        fields = mapFieldsSchema.parse({
          name: parsed.fields.name,
          description: parsed.fields.description ?? "",
          shortLabel: parsed.fields.shortLabel ?? "",
          visible: parsed.fields.visible !== "false",
          sortOrder: Number(parsed.fields.sortOrder ?? 0)
        });
      } catch (error) {
        await cleanupStagedMap(parsed.image);
        throw error;
      }
      const map = await createTownMap(parsed.image, fields, request.actor!.id, request.log);
      return reply.code(201).send(map);
    });
  });

  app.patch("/api/maps/:id", { preHandler: requireOwner }, async request => {
    const id = idSchema.parse((request.params as { id: string }).id);
    return updateTownMap(id, mapFieldsSchema.parse(request.body));
  });

  app.put("/api/maps/:id/image", {
    preHandler: requireOwner,
    config: { rateLimit: { max: config.MAP_UPLOAD_RATE_MAX, timeWindow: config.AUTH_RATE_WINDOW_MS } }
  }, async (request, reply) => {
    return mapUploads.run(async () => {
      await requireOwner(request, reply);
      if (reply.sent) return;
      const id = idSchema.parse((request.params as { id: string }).id);
      const parsed = await parseMapMultipart(request);
      return replaceTownMapImage(id, parsed.image, parsed.fields.clearExisting === "true", request.actor!.id, request.log);
    });
  });

  app.delete("/api/maps/:id", { preHandler: requireOwner }, async request => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const body = z.object({ confirmName: z.string() }).parse(request.body);
    return deleteTownMap(id, body.confirmName, request.actor!.id);
  });
}

async function parseMapMultipart(request: FastifyRequest): Promise<{ fields: Record<string, string>; image: StagedMapImage }> {
  const fields: Record<string, string> = {};
  let image: StagedMapImage | null = null;
  try {
    for await (const part of request.parts()) {
      if (part.type === "field") {
        fields[part.fieldname] = String(part.value ?? "");
      } else {
        if (image || !allowedImageTypes.has(part.mimetype)) throw invalidMapError();
        image = await stageMapUpload(part.file, part.filename, part.mimetype);
        if (part.file.truncated) throw Object.assign(new Error("error.mapFileTooLarge"), { statusCode: 413 });
      }
    }
    if (!image) throw invalidMapError();
    return { fields, image };
  } catch (error) {
    if (image) await cleanupStagedMap(image);
    throw error;
  }
}

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/tiff"]);

function invalidMapError() {
  return Object.assign(new Error("error.invalidMapImage"), { statusCode: 400 });
}
