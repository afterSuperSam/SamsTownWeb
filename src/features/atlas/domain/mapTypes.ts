export const CHUNK_SIZE = 16;

export type MapStatus = "planned" | "in_progress" | "completed" | "paused" | "abandoned";
export type MarkerIconType = "building" | "machine" | "other";
export type SelectionTool = "point" | "rectangle" | "brush";

export interface ChunkCoordinate {
  column: number;
  row: number;
}

export interface TownMap {
  id: string;
  name: string;
  description: string;
  shortLabel: string;
  imageWidth: number;
  imageHeight: number;
  tileSize: number;
  maxLevel: number;
  tileRevision: string;
  storagePrefix: string;
  visible: boolean;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MapClaim {
  id: string;
  mapId: string;
  ownerId: string;
  projectName: string;
  minecraftUsername: string;
  description: string;
  color: string;
  status: MapStatus;
  cells: ChunkCoordinate[];
  createdAt: string;
  updatedAt: string;
  cellCount?: number;
  partial?: boolean;
  bounds?: import("./atlasConfig").ChunkBounds | null;
}

export interface MapOccupancy {
  blockSize: number;
  totalCells: number;
  blocks: { column: number; row: number; count: number }[];
}

export interface MapListFilters {
  query: string;
  status: MapStatus | "all";
  member: string;
  color: string;
  mine: boolean;
  page: number;
}

export interface MapListPage {
  claims: MapClaim[];
  markers: MapMarker[];
  total: number;
  members: string[];
  colors: string[];
}

export interface MapMarker {
  id: string;
  mapId: string;
  name: string;
  iconType: MarkerIconType;
  color: string;
  description: string;
  pixelX: number;
  pixelY: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MapSnapshot {
  claims: MapClaim[];
  markers: MapMarker[];
}

export interface ClaimDraft {
  id?: string;
  mapId: string;
  ownerId?: string;
  projectName: string;
  minecraftUsername: string;
  description: string;
  color: string;
  status: MapStatus;
  cells: ChunkCoordinate[];
}

export interface SaveClaimResult {
  claimId: string | null;
  conflicts: ChunkCoordinate[];
}

export interface MarkerDraft {
  id?: string;
  mapId: string;
  name: string;
  iconType: MarkerIconType;
  color: string;
  description: string;
  pixelX: number;
  pixelY: number;
}

export interface MapUploadFields {
  name: string;
  description: string;
  shortLabel: string;
  visible: boolean;
  sortOrder?: number;
}
