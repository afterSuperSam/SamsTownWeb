import type { RealtimeChannel } from "@supabase/supabase-js";
import { z } from "zod";
import type { Profile } from "../../../domain/types";
import type { Database, Tables } from "../../../lib/database.types";
import { env } from "../../../lib/env";
import { toJson } from "../../../lib/json";
import { supabase } from "../../../lib/supabase";
import { atlasConfig, type ChunkBounds } from "../domain/atlasConfig";
import type {
  ProjectDraft,
  MapProject,
  MapSnapshot,
  SaveProjectResult,
  TownMap
} from "../domain/mapTypes";
import type { MapListPage } from "../domain/mapTypes";

type MapRow = Tables<"town_maps">;
type ProjectRow = Tables<"map_claims">;

type MapFunctions = Database["public"]["Functions"];
type MapRpcName = Extract<keyof MapFunctions, "get_map_claim_detail" | "list_map_claim_summaries" | "get_map_snapshot">;

// RPC 签名来自 Database；JSON 在唯一边界解析后交给现有 mapper。
const coordinateSchema = z.object({ column: z.number().int().nonnegative(), row: z.number().int().nonnegative() });
const cellsSchema = z.array(coordinateSchema).refine(cells =>
  new Set(cells.map(cell => `${cell.column}:${cell.row}`)).size === cells.length);
const boundsSchema = z.object({
  minColumn: z.number().int().nonnegative(), minRow: z.number().int().nonnegative(),
  maxColumn: z.number().int().nonnegative(), maxRow: z.number().int().nonnegative()
}).refine(bounds => bounds.maxColumn >= bounds.minColumn && bounds.maxRow >= bounds.minRow);
const projectRowSchema = z.object({
  id: z.string().min(1), map_id: z.string().min(1), owner_id: z.string().min(1),
  project_name: z.string(), minecraft_username: z.string(), description: z.string(), color: z.string(),
  created_at: z.string(), updated_at: z.string()
});
const projectDetailSchema = projectRowSchema.extend({ cells: cellsSchema });
const mapSnapshotSchema = z.object({ projects: z.array(projectDetailSchema) });
const projectSummarySchema = projectRowSchema.extend({ cellCount: z.number().int().nonnegative(), bounds: boundsSchema.nullable() });
const projectListSchema = z.object({
  total: z.number().int().nonnegative(), items: z.array(projectSummarySchema).max(atlasConfig.listPageSize)
});

async function requestMapJson<Name extends MapRpcName, Result>(
  name: Name, args: MapFunctions[Name]["Args"], schema: z.ZodType<Result>, invalidKey = "error.generic"
): Promise<Result> {
  const { data, error } = await supabase.rpc(name, args);
  throwIfError(error);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(invalidKey);
  return parsed.data;
}

function projectFromRow(row: ProjectRow, cells: MapProject["cells"] = [], summary?: { cellCount?: number; bounds?: ChunkBounds | null }): MapProject {
  return {
    id: row.id, mapId: row.map_id, ownerId: row.owner_id, projectName: row.project_name,
    minecraftUsername: row.minecraft_username, description: row.description, color: row.color,
    cells, createdAt: row.created_at, updatedAt: row.updated_at,
    ...summary
  };
}

export async function getProjectDetail(mapId: string, projectId: string): Promise<MapProject> {
  const row = await requestMapJson("get_map_claim_detail", { p_map_id: mapId, p_claim_id: projectId },
    projectDetailSchema.nullable(), "error.mapDetailIncomplete");
  if (!row) throw new Error("error.mapNotFound");
  if (row.id !== projectId || row.map_id !== mapId) throw new Error("error.mapDetailIncomplete");
  return projectFromRow(row, row.cells);
}

// 同一数据库快照读取全部边界，避免分页期间增删项目造成漏格或混合版本。
export async function getMapSnapshot(mapId: string): Promise<MapSnapshot> {
  const snapshot = await requestMapJson("get_map_snapshot", { p_map_id: mapId }, mapSnapshotSchema, "error.mapDetailIncomplete");
  if (snapshot.projects.some(project => project.map_id !== mapId)) throw new Error("error.mapDetailIncomplete");
  return { projects: snapshot.projects.map(project => projectFromRow(project, project.cells)) };
}

export async function listMapProjects(mapId: string, pageIndex: number): Promise<MapListPage> {
  const args: MapFunctions["list_map_claim_summaries"]["Args"] = {
    p_map_id: mapId,
    p_offset: pageIndex * atlasConfig.listPageSize, p_limit: atlasConfig.listPageSize
  };
  const page = await requestMapJson("list_map_claim_summaries", args, projectListSchema);
  if (page.items.some(row => row.map_id !== mapId)) throw new Error("error.mapDetailIncomplete");
  return { projects: page.items.map(row => projectFromRow(row, [], { cellCount: row.cellCount, bounds: row.bounds })), total: page.total };
}

const throwIfError = (error: { message: string } | null) => {
  if (error) throw error;
};

const mapFromRow = (row: MapRow): TownMap => ({
  id: row.id,
  name: row.name,
  description: row.description,
  shortLabel: row.short_label,
  imageWidth: row.image_width,
  imageHeight: row.image_height,
  tileSize: row.tile_size,
  maxLevel: row.max_level,
  tileRevision: row.tile_revision,
  storagePrefix: row.storage_prefix,
  visible: row.is_visible,
  sortOrder: row.sort_order,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export async function listTownMaps(): Promise<TownMap[]> {
  const maps = await collectPages<MapRow>(async (from, to) => supabase.from("town_maps").select("*")
    .order("sort_order").order("created_at").order("id").range(from, to));
  return maps.map(mapFromRow);
}

// 地图目录使用稳定分页，避免单次查询行数上限造成静默截断。
async function collectPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const pageSize = atlasConfig.pageSize;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    throwIfError(error);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function saveProject(draft: ProjectDraft): Promise<SaveProjectResult> {
  const { data, error } = await supabase.rpc("save_map_claim", {
    p_claim_id: draft.id ?? null,
    p_map_id: draft.mapId,
    p_project_name: draft.projectName,
    p_minecraft_username: draft.minecraftUsername,
    p_description: draft.description,
    p_color: draft.color,
    p_cells: toJson(draft.cells),
    ...(draft.ownerId ? { p_owner_id: draft.ownerId } : {})
  });
  throwIfError(error);
  const result = saveProjectResultSchema.parse(data);
  return { projectId: result.claimId, conflicts: result.conflicts };
}

const saveProjectResultSchema = z.object({ claimId: z.string().nullable(), conflicts: z.array(coordinateSchema) });

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("map_claims").delete().eq("id", id);
  throwIfError(error);
}

export async function listMapOwners(): Promise<Profile[]> {
  const { data, error } = await supabase.rpc("list_map_owners");
  throwIfError(error);
  return (data ?? []).map(row => ({
    id: row.id, username: row.username, role: row.role === "owner" ? "owner" : "member", mustChangePassword: row.must_change_password
  }));
}

export async function getTileRequest(map: Pick<TownMap, "storagePrefix">) {
  const { data } = await supabase.auth.getSession();
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error("error.notConfigured");
  const accessToken = data.session?.access_token ?? env.VITE_SUPABASE_ANON_KEY;
  const base = `${env.VITE_SUPABASE_URL}/storage/v1/object/authenticated/town-maps/${map.storagePrefix}/tiles`;
  return {
    base,
    headers: tileHeaders(accessToken)
  };
}

function tileHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: env.VITE_SUPABASE_ANON_KEY!
  };
}

export function subscribeToTileAuthentication(onChange: (headers: Record<string, string>) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!env.VITE_SUPABASE_ANON_KEY) return;
    onChange(tileHeaders(session?.access_token ?? env.VITE_SUPABASE_ANON_KEY));
  });
  return () => data.subscription.unsubscribe();
}

export function subscribeToMap(mapId: string, onChange: () => void): RealtimeChannel {
  return supabase.channel(`town-map:${mapId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "map_claims", filter: `map_id=eq.${mapId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "map_claim_cells", filter: `map_id=eq.${mapId}` }, onChange)
    .subscribe(status => {
      if (status !== "SUBSCRIBED") return;
      onChange();
    });
}

export function subscribeToMapList(onChange: () => void): RealtimeChannel {
  return supabase.channel("town-map-list")
    .on("postgres_changes", { event: "*", schema: "public", table: "town_maps" }, onChange)
    .subscribe(status => { if (status === "SUBSCRIBED") onChange(); });
}

export const unsubscribeFromMap = (channel: RealtimeChannel) => supabase.removeChannel(channel);
