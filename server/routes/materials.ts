import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember } from "../auth.js";
import { duplicateMaterialIds } from "../materialValidation.js";
import { resolveMaterialMetadata } from "../materialMetadata.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

const namespaceSchema = z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/).max(200);
const countSchema = z.number().int().nonnegative().max(2_147_483_647);
const materialSchema = z.object({
  itemId: namespaceSchema,
  totalCount: countSchema,
  missingCount: countSchema,
  availableCount: countSchema,
  mismatchedCount: countSchema,
  sortOrder: countSchema
});
const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  storageLocation: z.string().trim().max(500),
  sourceTitle: z.string().trim().max(240),
  sourceDate: z.string().trim().max(120),
  materials: z.array(materialSchema).min(1).max(5000),
  originX: z.number().int().min(-30_000_000).max(30_000_000),
  originY: z.number().int().min(-2048).max(2048),
  originZ: z.number().int().min(-30_000_000).max(30_000_000),
  mirror: z.enum(["none", "left_right", "front_back"]),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
}).superRefine((value, context) => {
  for (const itemId of duplicateMaterialIds(value.materials)) {
    context.addIssue({
      code: "custom",
      path: ["materials"],
      message: `duplicate material: ${itemId}`
    });
  }
});

export async function materialRoutes(app: FastifyInstance) {
  app.post("/api/materials/projects", {
    preHandler: requireMember,
    bodyLimit: 6 * 1024 * 1024,
    config: { rateLimit: { max: 6, timeWindow: "1 minute" } }
  }, async request => {
    const values = createProjectSchema.parse(request.body);
    const metadata = await resolveMaterialMetadata([...new Set(values.materials.map(item => item.itemId))]);
    const metadataById = new Map(metadata.map(item => [item.itemId, item]));
    const materials = values.materials.map(material => {
      const resolved = metadataById.get(material.itemId);
      if (!resolved) throw Object.assign(new Error("error.materialMetadata"), { statusCode: 424 });
      return { ...material, ...resolved };
    });
    const result = await supabaseAdmin.rpc("create_material_project_server", {
      p_actor_id: request.actor!.id,
      p_name: values.name,
      p_priority: values.priority,
      p_storage_location: values.storageLocation,
      p_source_title: values.sourceTitle,
      p_source_date: values.sourceDate,
      p_materials: materials,
      p_projection_origin_x: values.originX,
      p_projection_origin_y: values.originY,
      p_projection_origin_z: values.originZ,
      p_projection_mirror: values.mirror,
      p_projection_rotation: values.rotation
    });
    if (result.error) throw result.error;
    return { id: result.data };
  });
}
