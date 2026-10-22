import { CHUNK_SIZE, type ChunkCoordinate } from "./mapTypes";

export interface ClaimRegion {
  cells: ChunkCoordinate[];
  label: ChunkCoordinate;
}

export const cellKey = ({ column, row }: ChunkCoordinate) => `${column}:${row}`;

export function pixelToChunk(x: number, y: number): ChunkCoordinate {
  return {
    column: Math.max(0, Math.floor(x / CHUNK_SIZE)),
    row: Math.max(0, Math.floor(y / CHUNK_SIZE))
  };
}

export function clampChunk(cell: ChunkCoordinate, imageWidth: number, imageHeight: number): ChunkCoordinate {
  return {
    column: Math.min(Math.max(0, cell.column), Math.ceil(imageWidth / CHUNK_SIZE) - 1),
    row: Math.min(Math.max(0, cell.row), Math.ceil(imageHeight / CHUNK_SIZE) - 1)
  };
}

export function rectangleCells(start: ChunkCoordinate, end: ChunkCoordinate): ChunkCoordinate[] {
  const cells: ChunkCoordinate[] = [];
  const minColumn = Math.min(start.column, end.column);
  const maxColumn = Math.max(start.column, end.column);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) cells.push({ column, row });
  }
  return cells;
}

export function toggleCells(current: ChunkCoordinate[], incoming: ChunkCoordinate[], remove = false): ChunkCoordinate[] {
  const next = new Map(current.map(cell => [cellKey(cell), cell]));
  for (const cell of incoming) {
    const key = cellKey(cell);
    if (remove) next.delete(key);
    else next.set(key, cell);
  }
  return [...next.values()].sort((a, b) => a.row - b.row || a.column - b.column);
}

// Orthogonal flood-fill turns one Claim into independently labelled regions.
export function splitClaimRegions(cells: ChunkCoordinate[]): ClaimRegion[] {
  const remaining = new Map(cells.map(cell => [cellKey(cell), cell]));
  const regions: ClaimRegion[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as ChunkCoordinate;
    const queue = [first];
    const region: ChunkCoordinate[] = [];
    remaining.delete(cellKey(first));
    while (queue.length) {
      const cell = queue.pop() as ChunkCoordinate;
      region.push(cell);
      for (const neighbor of [
        { column: cell.column - 1, row: cell.row },
        { column: cell.column + 1, row: cell.row },
        { column: cell.column, row: cell.row - 1 },
        { column: cell.column, row: cell.row + 1 }
      ]) {
        const key = cellKey(neighbor);
        const found = remaining.get(key);
        if (found) {
          remaining.delete(key);
          queue.push(found);
        }
      }
    }
    const averageColumn = region.reduce((sum, cell) => sum + cell.column, 0) / region.length;
    const averageRow = region.reduce((sum, cell) => sum + cell.row, 0) / region.length;
    const label = region.reduce((best, cell) => {
      const distance = Math.abs(cell.column - averageColumn) + Math.abs(cell.row - averageRow);
      const bestDistance = Math.abs(best.column - averageColumn) + Math.abs(best.row - averageRow);
      return distance < bestDistance ? cell : best;
    }, region[0]);
    regions.push({ cells: region, label });
  }
  return regions;
}

function isBoundaryEdge(cell: ChunkCoordinate, direction: "top" | "right" | "bottom" | "left", occupied: ReadonlySet<string>) {
  const neighbor = direction === "top" ? { column: cell.column, row: cell.row - 1 }
    : direction === "right" ? { column: cell.column + 1, row: cell.row }
      : direction === "bottom" ? { column: cell.column, row: cell.row + 1 }
        : { column: cell.column - 1, row: cell.row };
  return !occupied.has(cellKey(neighbor));
}

// One compound fill plus boundary-only strokes keeps adjacent chunks visually
// merged. It is shared by saved claims and live selections.
export function buildCellPaths(cells: ChunkCoordinate[]) {
  const occupied = new Set(cells.map(cellKey));
  let fill = "";
  let edge = "";
  for (const cell of cells) {
    const x = cell.column * CHUNK_SIZE;
    const y = cell.row * CHUNK_SIZE;
    fill += `M${x} ${y}h${CHUNK_SIZE}v${CHUNK_SIZE}h-${CHUNK_SIZE}Z`;
    if (isBoundaryEdge(cell, "top", occupied)) edge += `M${x} ${y}H${x + CHUNK_SIZE}`;
    if (isBoundaryEdge(cell, "right", occupied)) edge += `M${x + CHUNK_SIZE} ${y}V${y + CHUNK_SIZE}`;
    if (isBoundaryEdge(cell, "bottom", occupied)) edge += `M${x + CHUNK_SIZE} ${y + CHUNK_SIZE}H${x}`;
    if (isBoundaryEdge(cell, "left", occupied)) edge += `M${x} ${y + CHUNK_SIZE}V${y}`;
  }
  return { fill, edge };
}
