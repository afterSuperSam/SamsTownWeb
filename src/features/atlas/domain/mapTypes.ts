export const CHUNK_SIZE = 16;

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

export interface MapProject {
  id: string;
  mapId: string;
  ownerId: string;
  projectName: string;
  minecraftUsername: string;
  description: string;
  color: string;
  cells: ChunkCoordinate[];
  createdAt: string;
  updatedAt: string;
  cellCount?: number;
  bounds?: import("./atlasConfig").ChunkBounds | null;
}

export interface MapListPage {
  projects: MapProject[];
  total: number;
}

export interface MapSnapshot {
  projects: MapProject[];
}

export interface ProjectDraft {
  id?: string;
  mapId: string;
  ownerId?: string;
  projectName: string;
  minecraftUsername: string;
  description: string;
  color: string;
  cells: ChunkCoordinate[];
}

export interface SaveProjectResult {
  projectId: string | null;
  conflicts: ChunkCoordinate[];
}

export interface MapUploadFields {
  name: string;
  description: string;
  shortLabel: string;
  visible: boolean;
  sortOrder?: number;
}
