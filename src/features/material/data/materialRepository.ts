import type { RealtimeChannel } from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "../../../lib/supabase";
import { authenticatedApiRequest } from "../../../services/apiClient";
import type {
  ImportedMaterialList,
  MaterialProject,
  MaterialProjectionTransform,
  MaterialWorkspace
} from "../domain/materialTypes";

const nonnegativeInteger = z.number().int().nonnegative();
const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  storageLocation: z.string(),
  sourceTitle: z.string(),
  sourceDate: z.string(),
  creatorId: z.string().uuid().nullable(),
  creatorUsername: z.string(),
  originX: z.number().int(),
  originY: z.number().int(),
  originZ: z.number().int(),
  mirror: z.enum(["none", "left_right", "front_back"]),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  projectionFileName: z.string().nullable(),
  projectionFileSize: nonnegativeInteger.nullable(),
  projectionStoragePath: z.string().nullable(),
  hasProjectionFile: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  itemCount: nonnegativeInteger,
  totalCount: nonnegativeInteger,
  missingCount: nonnegativeInteger
});
const itemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  itemId: z.string(),
  nameZh: z.string(),
  nameEn: z.string(),
  imageUrl: z.string().url().nullable(),
  totalCount: nonnegativeInteger,
  sourceMissingCount: nonnegativeInteger,
  initialAvailableCount: nonnegativeInteger,
  mismatchedCount: nonnegativeInteger,
  existingCount: nonnegativeInteger,
  missingCount: nonnegativeInteger,
  reservedCount: nonnegativeInteger,
  sortOrder: nonnegativeInteger
});
const assignmentSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  claimantId: z.string().uuid().nullable(),
  claimantUsername: z.string(),
  amount: z.number().int().positive(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  note: z.string(),
  updatedById: z.string().uuid().nullable(),
  updatedByUsername: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
const leaderboardSchema = z.object({
  claimantId: z.string().uuid().nullable(),
  username: z.string(),
  collectedCount: nonnegativeInteger
});
const workspaceSchema = z.object({
  projects: z.array(projectSchema),
  items: z.array(itemSchema),
  assignments: z.array(assignmentSchema),
  leaderboard: z.array(leaderboardSchema)
});
const throwIfError = (error: { message: string } | null) => {
  if (error) throw error;
};

export async function getMaterialWorkspace(): Promise<MaterialWorkspace> {
  const { data, error } = await supabase.rpc("get_material_workspace");
  throwIfError(error);
  const parsed = workspaceSchema.safeParse(data);
  if (!parsed.success) throw new Error("error.invalidMaterialWorkspace");
  return parsed.data;
}

export async function createMaterialProject(
  list: ImportedMaterialList,
  values: { name: string; priority: 1 | 2 | 3; storageLocation: string } & MaterialProjectionTransform
): Promise<string> {
  const result = await authenticatedApiRequest<{ id: string }>("/api/materials/projects", {
    method: "POST",
    body: JSON.stringify({
      name: values.name.trim(),
      priority: values.priority,
      storageLocation: values.storageLocation.trim(),
      sourceTitle: list.title,
      sourceDate: list.date,
      materials: list.materials,
      originX: values.originX,
      originY: values.originY,
      originZ: values.originZ,
      mirror: values.mirror,
      rotation: values.rotation
    })
  });
  return result.id;
}

const MAX_PROJECTION_FILE_SIZE = 6 * 1024 * 1024;

export async function saveMaterialProjection(
  project: Pick<MaterialProject, "id" | "projectionStoragePath">,
  transform: MaterialProjectionTransform,
  file: File | null
) {
  const extension = file?.name.toLowerCase().match(/\.(litematic|schem|schematic|nbt)$/)?.[1];
  if (file && (!extension || file.size === 0)) throw new Error("error.invalidMaterialProjection");
  if (file && file.size > MAX_PROJECTION_FILE_SIZE) throw new Error("error.materialProjectionTooLarge");
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) throw new Error("error.session");
  const storagePath = file
    ? `${userResult.data.user.id}/material-projects/${project.id}/${crypto.randomUUID()}.${extension}`
    : null;
  if (file && storagePath) {
    const upload = await supabase.storage.from("schematics").upload(storagePath, file, {
      contentType: "application/octet-stream",
      upsert: false
    });
    if (upload.error) throw upload.error;
  }
  const result = await supabase.rpc("update_material_projection", {
    p_project_id: project.id,
    p_origin_x: transform.originX,
    p_origin_y: transform.originY,
    p_origin_z: transform.originZ,
    p_mirror: transform.mirror,
    p_rotation: transform.rotation,
    p_file_name: file?.name ?? null,
    p_storage_path: storagePath,
    p_file_size: file?.size ?? null
  });
  if (result.error) {
    if (storagePath) await cleanupProjection(storagePath);
    throw result.error;
  }
  // Replacement cleanup is queued atomically by the RPC. The browser only
  // cleans a new upload when the database update itself fails.
}

export async function downloadMaterialProjection(project: MaterialProject) {
  if (!project.projectionStoragePath || !project.projectionFileName) throw new Error("error.materialProjectionMissing");
  const result = await supabase.storage.from("schematics").createSignedUrl(project.projectionStoragePath, 60, {
    download: project.projectionFileName
  });
  if (result.error) throw result.error;
  window.location.assign(result.data.signedUrl);
}

async function cleanupProjection(storagePath: string) {
  const cleanup = await supabase.storage.from("schematics").remove([storagePath]);
  if (cleanup.error) {
    await supabase.rpc("queue_own_storage_cleanup", { p_bucket: "schematics", p_path: storagePath });
  }
}

export async function updateMaterialProject(id: string, priority: 1 | 2 | 3, storageLocation: string) {
  const { error } = await supabase.rpc("update_material_project", {
    p_project_id: id,
    p_priority: priority,
    p_storage_location: storageLocation.trim()
  });
  throwIfError(error);
}

export async function administerMaterialProject(
  id: string,
  values: { name: string; priority: 1 | 2 | 3; storageLocation: string }
) {
  const { error } = await supabase.rpc("admin_update_material_project", {
    p_project_id: id,
    p_name: values.name.trim(),
    p_priority: values.priority,
    p_storage_location: values.storageLocation.trim()
  });
  throwIfError(error);
}

export async function deleteMaterialProject(id: string) {
  const { error } = await supabase.rpc("admin_delete_material_project", { p_project_id: id });
  throwIfError(error);
}

export async function setMaterialClaim(itemId: string, amount: number, note: string) {
  const { error } = await supabase.rpc("set_material_claim", {
    p_item_id: itemId,
    p_amount: amount,
    p_note: note.trim()
  });
  throwIfError(error);
}

export async function setMaterialClaims(itemIds: string[], amounts: number[] | null, note: string) {
  const { error } = await supabase.rpc("set_material_claims", {
    p_item_ids: itemIds,
    p_amounts: amounts,
    p_note: note.trim()
  });
  throwIfError(error);
}

export async function setMaterialClaimCompleted(assignmentId: string, completed: boolean, note?: string) {
  const { error } = await supabase.rpc("set_material_claim_completed", {
    p_assignment_id: assignmentId,
    p_completed: completed,
    p_note: note
  });
  throwIfError(error);
}

export async function setMaterialClaimsCompleted(assignmentIds: string[], completed: boolean, note?: string) {
  const { error } = await supabase.rpc("set_material_claims_completed", {
    p_assignment_ids: assignmentIds,
    p_completed: completed,
    p_note: note
  });
  throwIfError(error);
}

export function subscribeToMaterialWorkspace(onChange: () => void): RealtimeChannel {
  return supabase.channel("material-workspace")
    .on("postgres_changes", { event: "*", schema: "public", table: "material_projects" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "material_items" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "material_assignments" }, onChange)
    .subscribe();
}

export const unsubscribeFromMaterialWorkspace = (channel: RealtimeChannel) => supabase.removeChannel(channel);
