import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Profile } from "../../../domain/types";
import type { Json, Tables } from "../../../lib/database.types";
import { env } from "../../../lib/env";
import { toJson } from "../../../lib/json";
import { supabase } from "../../../lib/supabase";
import type {
  ClaimDraft,
  MapClaim,
  MapMarker,
  MapSnapshot,
  MarkerDraft,
  SaveClaimResult,
  TownMap
} from "../domain/mapTypes";

type MapRow = Tables<"town_maps">;
type ClaimRow = Tables<"map_claims">;
type MarkerRow = Tables<"map_markers">;
type ClaimCellRow = Pick<Tables<"map_claim_cells">, "claim_id" | "chunk_column" | "chunk_row">;

const MAP_CELL_PAGE_SIZE = 1000;

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
  const { data, error } = await supabase.from("town_maps").select("*").order("sort_order").order("created_at");
  throwIfError(error);
  return (data ?? []).map(mapFromRow);
}

export async function getMapSnapshot(mapId: string): Promise<MapSnapshot> {
  const [claims, markers] = await Promise.all([getMapClaims(mapId), getMapMarkers(mapId)]);
  return { claims, markers };
}

export async function getMapClaims(mapId: string): Promise<MapClaim[]> {
  const [claimsResult, cellsResult] = await Promise.all([
    supabase.from("map_claims").select("*").eq("map_id", mapId).order("updated_at", { ascending: false }),
    collectPages<ClaimCellRow>(async (from, to) => {
      const result = await supabase.from("map_claim_cells")
        .select("claim_id,chunk_column,chunk_row")
        .eq("map_id", mapId)
        .order("claim_id")
        .order("chunk_row")
        .order("chunk_column")
        .range(from, to);
      return { data: result.data, error: result.error };
    })
  ]);
  throwIfError(claimsResult.error);
  const cellsByClaim = new Map<string, MapClaim["cells"]>();
  for (const cell of cellsResult) {
    const cells = cellsByClaim.get(cell.claim_id) ?? [];
    cells.push({ column: cell.chunk_column, row: cell.chunk_row });
    cellsByClaim.set(cell.claim_id, cells);
  }
  return (claimsResult.data ?? []).map((row: ClaimRow): MapClaim => ({
    id: row.id,
    mapId: row.map_id,
    ownerId: row.owner_id,
    projectName: row.project_name,
    minecraftUsername: row.minecraft_username,
    description: row.description,
    color: row.color,
    status: parseClaimStatus(row.status),
    cells: cellsByClaim.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

// Supabase projects commonly cap a single select at 1,000 rows. Claims can
// legitimately exceed that size, so map cells are read in stable, inclusive
// ranges until the final short page is reached.
export async function collectPages<T>(
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

export async function getMapMarkers(mapId: string): Promise<MapMarker[]> {
  const markersResult = await supabase.from("map_markers").select("*")
    .eq("map_id", mapId).order("updated_at", { ascending: false });
  throwIfError(markersResult.error);
  return (markersResult.data ?? []).map((row: MarkerRow): MapMarker => ({
    id: row.id,
    mapId: row.map_id,
    name: row.name,
    iconType: parseMarkerIcon(row.icon_type),
    color: row.color,
    description: row.description,
    pixelX: row.pixel_x,
    pixelY: row.pixel_y,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
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
  return parseSaveClaimResult(data);
}

function parseSaveClaimResult(value: Json): SaveClaimResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("error.generic");
  const claimId = value.claimId;
  const conflicts = value.conflicts;
  if ((claimId !== null && typeof claimId !== "string") || !Array.isArray(conflicts)) throw new Error("error.generic");
  const parsedConflicts = conflicts.map(cell => {
    if (!cell || typeof cell !== "object" || Array.isArray(cell)
      || !Number.isInteger(cell.column) || !Number.isInteger(cell.row)) throw new Error("error.generic");
    return { column: Number(cell.column), row: Number(cell.row) };
  });
  return { claimId, conflicts: parsedConflicts };
}

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
    id: row.id, mapId: row.map_id, name: row.name, iconType: parseMarkerIcon(row.icon_type),
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

function parseClaimStatus(value: string): MapClaim["status"] {
  if (["planned", "in_progress", "completed", "paused", "abandoned"].includes(value)) {
    return value as MapClaim["status"];
  }
  throw new Error("error.generic");
}

function parseMarkerIcon(value: string): MapMarker["iconType"] {
  if (["building", "machine", "other"].includes(value)) return value as MapMarker["iconType"];
  throw new Error("error.generic");
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

export function subscribeToMap(mapId: string, onChange: (area: MapChangeArea) => void): RealtimeChannel {
  return supabase.channel(`town-map:${mapId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "map_claims", filter: `map_id=eq.${mapId}` }, () => onChange("claims"))
    .on("postgres_changes", { event: "*", schema: "public", table: "map_claim_cells", filter: `map_id=eq.${mapId}` }, () => onChange("claims"))
    .on("postgres_changes", { event: "*", schema: "public", table: "map_markers", filter: `map_id=eq.${mapId}` }, () => onChange("markers"))
    .subscribe();
}

export function subscribeToMapList(onChange: () => void): RealtimeChannel {
  return supabase.channel("town-map-list")
    .on("postgres_changes", { event: "*", schema: "public", table: "town_maps" }, onChange)
    .subscribe();
}

export const unsubscribeFromMap = (channel: RealtimeChannel) => supabase.removeChannel(channel);
