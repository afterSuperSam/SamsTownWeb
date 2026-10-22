interface ImportedMaterial {
  itemId: string;
  totalCount: number;
  missingCount: number;
  availableCount: number;
  mismatchedCount: number;
  sortOrder: number;
}

export interface ImportedMaterialList {
  name: string;
  title: string;
  date: string;
  multiplier: number;
  materials: ImportedMaterial[];
}

type MaterialProjectionMirror = "none" | "left_right" | "front_back";
type MaterialProjectionRotation = 0 | 90 | 180 | 270;
export interface MaterialProjectionTransform {
  originX: number;
  originY: number;
  originZ: number;
  mirror: MaterialProjectionMirror;
  rotation: MaterialProjectionRotation;
}

export interface MaterialProject {
  id: string;
  name: string;
  priority: 1 | 2 | 3;
  storageLocation: string;
  sourceTitle: string;
  sourceDate: string;
  creatorId: string | null;
  creatorUsername: string;
  originX: number;
  originY: number;
  originZ: number;
  mirror: MaterialProjectionMirror;
  rotation: MaterialProjectionRotation;
  projectionFileName: string | null;
  projectionFileSize: number | null;
  projectionStoragePath: string | null;
  hasProjectionFile: boolean;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  totalCount: number;
  missingCount: number;
}

export interface MaterialItem {
  id: string;
  projectId: string;
  itemId: string;
  nameZh: string;
  nameEn: string;
  imageUrl: string | null;
  totalCount: number;
  sourceMissingCount: number;
  initialAvailableCount: number;
  mismatchedCount: number;
  existingCount: number;
  missingCount: number;
  reservedCount: number;
  sortOrder: number;
}

export interface MaterialAssignment {
  id: string;
  itemId: string;
  claimantId: string | null;
  claimantUsername: string;
  amount: number;
  completed: boolean;
  completedAt: string | null;
  note: string;
  updatedById: string | null;
  updatedByUsername: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialLeaderboardEntry {
  claimantId: string | null;
  username: string;
  collectedCount: number;
}

export interface MaterialWorkspace {
  projects: MaterialProject[];
  items: MaterialItem[];
  assignments: MaterialAssignment[];
  leaderboard: MaterialLeaderboardEntry[];
}
