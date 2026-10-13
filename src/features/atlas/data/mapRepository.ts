import type { RealtimeChannel } from "@supabase/supabase-js";
import { z } from "zod";
import type { Profile } from "../../../domain/types";
import type { Database, Tables } from "../../../lib/database.types";
import { env } from "../../../lib/env";
import { toJson } from "../../../lib/json";
import { supabase } from "../../../lib/supabase";
import { atlasConfig, containsCell, type ChunkBounds } from "../domain/atlasConfig";
import type {
  ClaimDraft,
  MapClaim,
  MapMarker,
  MapSnapshot,
  MarkerDraft,
  SaveClaimResult,
  TownMap
} from "../domain/mapTypes";
import type { MapListFilters, MapListPage, MapOccupancy } from "../domain/mapTypes";

type MapRow = Tables<"town_maps">;
type ClaimRow = Tables<"map_claims">;
type MarkerRow = Tables<"map_markers">;

const MAP_CELL_PAGE_SIZE = atlasConfig.pageSize;

type MapFunctions = Database["public"]["Functions"];
type MapRpcName = Extract<keyof MapFunctions, "get_map_claim_detail" | "get_map_occupancy" | "get_map_viewport" | "list_map_claim_summaries">;

// RPC 签名来自 Database；JSON 在唯一边界解析后交给现有 mapper。
const coordinateSchema = z.object({ column: z.number().int().nonnegative(), row: z.number().int().nonnegative() });
const cellsSchema = z.array(coordinateSchema).refine(cells =>
  new Set(cells.map(cell => `${cell.column}:${cell.row}`)).size === cells.length);
const boundsSchema = z.object({
  minColumn: z.number().int().nonnegative(), minRow: z.number().int().nonnegative(),
  maxColumn: z.number().int().nonnegative(), maxRow: z.number().int().nonnegative()
}).refine(bounds => bounds.maxColumn >= bounds.minColumn && bounds.maxRow >= bounds.minRow);
const claimRowSchema = z.object({
  id: z.string().min(1), map_id: z.string().min(1), owner_id: z.string().min(1),
  project_name: z.string(), minecraft_username: z.string(), description: z.string(), color: z.string(),
  status: z.enum(["planned", "in_progress", "completed", "paused", "abandoned"]),
  created_at: z.string(), updated_at: z.string()
});
const claimDetailSchema = claimRowSchema.extend({ cells: cellsSchema });
const spatialClaimSchema = claimRowSchema.extend({ cells: cellsSchema, partial: z.boolean().optional() });
const claimSummarySchema = claimRowSchema.extend({ cellCount: z.number().int().nonnegative(), bounds: boundsSchema.nullable() });
const markerRowSchema = z.object({
  id: z.string().min(1), map_id: z.string().min(1), name: z.string(),
  icon_type: z.enum(["building", "machine", "other"]), color: z.string(), description: z.string(),
  pixel_x: z.number().int().nonnegative(), pixel_y: z.number().int().nonnegative(),
  created_by: z.string().min(1), created_at: z.string(), updated_at: z.string()
});
const viewportSchema = z.object({
  claims: z.array(spatialClaimSchema), markers: z.array(markerRowSchema).max(atlasConfig.pageSize),
  hasMore: z.boolean(), markerTotal: z.number().int().nonnegative(), markerRevision: z.string(),
  cellTotal: z.number().int().min(0).max(atlasConfig.exactCellLimit), cellRevision: z.string()
}).refine(page => page.claims.reduce((count, claim) => count + claim.cells.length, 0) <= atlasConfig.pageSize);
const occupancySchema = z.object({
  blockSize: z.number().int().positive(), totalCells: z.number().int().nonnegative(),
  blocks: z.array(z.object({ column: z.number().int().nonnegative(), row: z.number().int().nonnegative(), count: z.number().int().positive() }))
});
const listMetadataSchema = z.object({
  total: z.number().int().nonnegative(), members: z.array(z.string()), colors: z.array(z.string())
});
const claimListSchema = listMetadataSchema.extend({ items: z.array(claimSummarySchema).max(atlasConfig.listPageSize) });
const markerListSchema = listMetadataSchema.extend({ items: z.array(markerRowSchema).max(atlasConfig.listPageSize) });

async function requestMapJson<Name extends MapRpcName, Result>(
  name: Name, args: MapFunctions[Name]["Args"], schema: z.ZodType<Result>, invalidKey = "error.generic"
): Promise<Result> {
  const { data, error } = await supabase.rpc(name, args);
  throwIfError(error);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(invalidKey);
  return parsed.data;
}

function claimFromRow(row: ClaimRow, cells: MapClaim["cells"] = [], summary?: { cellCount?: number; bounds?: ChunkBounds | null; partial?: boolean }): MapClaim {
  return {
    id: row.id, mapId: row.map_id, ownerId: row.owner_id, projectName: row.project_name,
    minecraftUsername: row.minecraft_username, description: row.description, color: row.color,
    status: row.status as MapClaim["status"], cells, createdAt: row.created_at, updatedAt: row.updated_at,
    ...summary
  };
}

export async function getClaimDetail(mapId: string, claimId: string): Promise<MapClaim> {
  const row = await requestMapJson("get_map_claim_detail", { p_map_id: mapId, p_claim_id: claimId },
    claimDetailSchema.nullable(), "error.mapDetailIncomplete");
  if (!row) throw new Error("error.mapNotFound");
  if (row.id !== claimId || row.map_id !== mapId) throw new Error("error.mapDetailIncomplete");
  return claimFromRow(row, row.cells);
}

export async function getMapOccupancy(map: TownMap): Promise<MapOccupancy> {
  const blockSize = Math.max(1, Math.ceil(Math.max(map.imageWidth, map.imageHeight) / 16 / atlasConfig.overviewAxisBlocks));
  return requestMapJson("get_map_occupancy", { p_map_id: map.id, p_block_size: blockSize }, occupancySchema);
}

export async function getMapViewport(mapId: string, bounds: ChunkBounds, area: MapChangeArea): Promise<MapSnapshot> {
  const claims = new Map<string, MapClaim>();
  const markers = new Map<string, MapMarker>();
  const seenCells = new Set<string>();
  let cellRevision: string | undefined;
  let cellTotal: number | undefined;
  let markerRevision: string | undefined;
  let markerTotal: number | undefined;
  for (let offset = 0; ; offset += atlasConfig.pageSize) {
    const page = await requestMapJson("get_map_viewport", {
      p_map_id: mapId, p_min_column: bounds.minColumn, p_min_row: bounds.minRow,
      p_max_column: bounds.maxColumn, p_max_row: bounds.maxRow, p_offset: offset,
      p_limit: atlasConfig.pageSize, p_area: area
    }, viewportSchema, "error.mapDetailIncomplete");
    if (area === "claims") {
      if (cellRevision !== undefined && (cellRevision !== page.cellRevision || cellTotal !== page.cellTotal)) throw new Error("error.mapDataChanged");
    } else if (markerRevision !== undefined && (markerRevision !== page.markerRevision || markerTotal !== page.markerTotal)) throw new Error("error.mapDataChanged");
    cellRevision = page.cellRevision;
    cellTotal = page.cellTotal;
    markerRevision = page.markerRevision;
    markerTotal = page.markerTotal;
    const pageCount = area === "claims" ? page.claims.reduce((count, claim) => count + claim.cells.length, 0) : page.markers.length;
    const total = area === "claims" ? page.cellTotal : page.markerTotal;
    if (pageCount !== Math.min(atlasConfig.pageSize, Math.max(0, total - offset))
      || page.hasMore !== (pageCount === atlasConfig.pageSize)) throw new Error("error.mapDataChanged");
    for (const row of page.claims) {
      if (row.map_id !== mapId || row.cells.some(cell => !containsCell(bounds, cell))) throw new Error("error.mapDetailIncomplete");
      const previous = claims.get(row.id);
      if (previous && previous.updatedAt !== row.updated_at) throw new Error("error.mapDataChanged");
      for (const cell of row.cells) {
        const key = `${cell.column}:${cell.row}`;
        if (seenCells.has(key)) throw new Error("error.mapDataChanged");
        seenCells.add(key);
      }
      claims.set(row.id, claimFromRow(row, [...(previous?.cells ?? []), ...(row.cells ?? [])], { partial: row.partial }));
    }
    for (const row of page.markers) {
      if (row.map_id !== mapId || !containsCell(bounds, { column: Math.floor(row.pixel_x / 16), row: Math.floor(row.pixel_y / 16) })) throw new Error("error.mapDetailIncomplete");
      if (markers.has(row.id)) throw new Error("error.mapDataChanged");
      markers.set(row.id, markerFromRow(row));
    }
    if (!page.hasMore) {
      if ((area === "claims" && seenCells.size !== cellTotal) || (area === "markers" && markers.size !== markerTotal)) throw new Error("error.mapDataChanged");
      return { claims: [...claims.values()], markers: [...markers.values()] };
    }
  }
}

export async function listMapSummaries(mapId: string, kind: "claims" | "markers", filters: MapListFilters): Promise<MapListPage> {
  const args: MapFunctions["list_map_claim_summaries"]["Args"] = {
    p_map_id: mapId, p_query: filters.query.slice(0, 200), p_status: filters.status,
    p_member: filters.member, p_color: filters.color, p_mine: filters.mine,
    p_offset: filters.page * atlasConfig.listPageSize, p_limit: atlasConfig.listPageSize, p_kind: kind
  };
  if (kind === "claims") {
    const page = await requestMapJson("list_map_claim_summaries", args, claimListSchema);
    if (page.items.some(row => row.map_id !== mapId)) throw new Error("error.mapDetailIncomplete");
    return { claims: page.items.map(row => claimFromRow(row, [], { cellCount: row.cellCount, bounds: row.bounds })),
      markers: [], total: page.total, members: page.members, colors: page.colors };
  }
  const page = await requestMapJson("list_map_claim_summaries", args, markerListSchema);
  if (page.items.some(row => row.map_id !== mapId)) throw new Error("error.mapDetailIncomplete");
  return { claims: [], markers: page.items.map(markerFromRow), total: page.total, members: page.members, colors: page.colors };
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
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = MAP_CELL_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    throwIfError(error);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function saveClaim(draft: ClaimDraft): Promise<SaveClaimResult> {
  const { data, error } = await supabase.rpc("save_map_claim", {
    p_claim_id: draft.id ?? null,
    p_map_id: draft.mapId,
    p_project_name: draft.projectName,
    p_minecraft_username: draft.minecraftUsername,
    p_description: draft.description,
    p_color: draft.color,
    p_status: draft.status,
    p_cells: toJson(draft.cells),
    ...(draft.ownerId ? { p_owner_id: draft.ownerId } : {})
  });
  throwIfError(error);
  return saveClaimResultSchema.parse(data);
}

const saveClaimResultSchema = z.object({ claimId: z.string().nullable(), conflicts: z.array(coordinateSchema) });

export async function deleteClaim(id: string): Promise<void> {
  const { error } = await supabase.from("map_claims").delete().eq("id", id);
  throwIfError(error);
}

export async function saveMarker(draft: MarkerDraft): Promise<MapMarker> {
  const values = {
    map_id: draft.mapId,
    name: draft.name.trim(),
    icon_type: draft.iconType,
    color: draft.color,
    description: draft.description,
    pixel_x: Math.round(draft.pixelX),
    pixel_y: Math.round(draft.pixelY)
  };
  if (draft.id) {
    const { data, error } = await supabase.from("map_markers").update(values).eq("id", draft.id).select().single();
    throwIfError(error);
    return markerFromRow(data);
  }
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) throw new Error("error.session");
  const { data, error } = await supabase.from("map_markers")
    .insert({ ...values, created_by: session.user.id }).select().single();
  throwIfError(error);
  return markerFromRow(data);
}

function markerFromRow(row: MarkerRow | null): MapMarker {
  if (!row) throw new Error("error.generic");
  return {
    id: row.id, mapId: row.map_id, name: row.name, iconType: row.icon_type as MapMarker["iconType"],
    color: row.color, description: row.description, pixelX: row.pixel_x,
    pixelY: row.pixel_y, createdBy: row.created_by, createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function deleteMarker(id: string): Promise<void> {
  const { error } = await supabase.from("map_markers").delete().eq("id", id);
  throwIfError(error);
}

export async function listMapOwners(): Promise<Profile[]> {
  const { data, error } = await supabase.rpc("list_map_owners");
  throwIfError(error);
  return (data ?? []).map(row => ({
    id: row.id, username: row.username, role: row.role, mustChangePassword: row.must_change_password
  }));
}

export async function getTileRequest(map: TownMap) {
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

export type MapChangeArea = "claims" | "markers";

export function subscribeToMap(mapId: string, onChange: (area: MapChangeArea, affected: ChunkBounds | null) => void): RealtimeChannel {
  const changedBounds = (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }, marker = false): ChunkBounds | null => {
    const records = payload.eventType === "INSERT" ? [payload.new] : payload.eventType === "DELETE" ? [payload.old] : [payload.old, payload.new];
    const cells = records.map(row => ({
      column: marker ? Number(row.pixel_x) / 16 : Number(row.chunk_column),
      row: marker ? Number(row.pixel_y) / 16 : Number(row.chunk_row)
    }));
    if (cells.some(cell => !Number.isFinite(cell.column) || !Number.isFinite(cell.row))) return null;
    return { minColumn: Math.floor(Math.min(...cells.map(cell => cell.column))), minRow: Math.floor(Math.min(...cells.map(cell => cell.row))),
      maxColumn: Math.floor(Math.max(...cells.map(cell => cell.column))), maxRow: Math.floor(Math.max(...cells.map(cell => cell.row))) };
  };
  return supabase.channel(`town-map:${mapId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "map_claims", filter: `map_id=eq.${mapId}` }, () => onChange("claims", null))
    .on("postgres_changes", { event: "*", schema: "public", table: "map_claim_cells", filter: `map_id=eq.${mapId}` }, payload => onChange("claims", changedBounds(payload)))
    .on("postgres_changes", { event: "*", schema: "public", table: "map_markers", filter: `map_id=eq.${mapId}` }, payload => onChange("markers", changedBounds(payload, true)))
    .subscribe();
}

export function subscribeToMapList(onChange: () => void): RealtimeChannel {
  return supabase.channel("town-map-list")
    .on("postgres_changes", { event: "*", schema: "public", table: "town_maps" }, onChange)
    .subscribe();
}

export const unsubscribeFromMap = (channel: RealtimeChannel) => supabase.removeChannel(channel);
