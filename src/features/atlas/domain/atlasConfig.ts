import { z } from "zod";

// 地图查询、缓存和绘制的行为参数。
export const atlasConfig = z.object({
  pageSize: z.number().int().min(1).max(1000),
  listPageSize: z.number().int().min(1).max(100),
  exactCellLimit: z.number().int().min(1).max(16384),
  bufferChunks: z.number().int().min(0).max(16),
  overviewAxisBlocks: z.number().int().min(1).max(32),
  refreshDelay: z.number().int().min(0).max(1000),
  exactImageZoom: z.number().positive(),
  claimLabelScreenSize: z.number().int().min(10).max(24),
  noticeDuration: z.number().int().positive()
}).parse({
  pageSize: 1000, listPageSize: 30, exactCellLimit: 16384,
  bufferChunks: 4, overviewAxisBlocks: 32, refreshDelay: 120,
  exactImageZoom: .55, claimLabelScreenSize: 13, noticeDuration: 3600
});

export interface ChunkBounds {
  minColumn: number;
  minRow: number;
  maxColumn: number;
  maxRow: number;
}

export function containsCell(bounds: ChunkBounds | null, cell: { column: number; row: number }) {
  return Boolean(bounds && cell.column >= bounds.minColumn && cell.column <= bounds.maxColumn
    && cell.row >= bounds.minRow && cell.row <= bounds.maxRow);
}

export function overlapsBounds(left: ChunkBounds, right: ChunkBounds) {
  return left.minColumn <= right.maxColumn && left.maxColumn >= right.minColumn
    && left.minRow <= right.maxRow && left.maxRow >= right.minRow;
}

export function boundedViewport(bounds: ChunkBounds, columns: number, rows: number): ChunkBounds | null {
  const buffered = {
    minColumn: Math.max(0, bounds.minColumn - atlasConfig.bufferChunks),
    minRow: Math.max(0, bounds.minRow - atlasConfig.bufferChunks),
    maxColumn: Math.min(columns - 1, bounds.maxColumn + atlasConfig.bufferChunks),
    maxRow: Math.min(rows - 1, bounds.maxRow + atlasConfig.bufferChunks)
  };
  const area = (buffered.maxColumn - buffered.minColumn + 1) * (buffered.maxRow - buffered.minRow + 1);
  return area > 0 && area <= atlasConfig.exactCellLimit ? buffered : null;
}
