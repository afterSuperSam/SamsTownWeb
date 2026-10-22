import type { TownImage, TownImageLayout } from "./types";

// Homepage and archive consume one ordered gallery source. Presentation stays
// page-specific: motion on the homepage, quiet 2D figures in the archive.
export function selectTownGalleryMedia(images: TownImage[]): TownImage[] {
  return images
    .filter(image => image.visible && image.area === "gallery")
    .sort((first, second) => first.sortOrder - second.sortOrder);
}

function gallerySpan(layout: TownImageLayout, columns: number) {
  return layout === "wide"
    ? { columns: Math.min(2, columns), rows: 1 }
    : layout === "tall"
      ? { columns: 1, rows: 2 }
      : { columns: 1, rows: 1 };
}

// Mirrors CSS grid's dense placement so the collapsed archive ends on a full
// fourth row instead of clipping a tall image at the fold.
export function getGalleryPreviewCount(
  images: Pick<TownImage, "layout">[],
  columns: number,
  maxRows = 4
) {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeRows = Math.max(1, Math.floor(maxRows));
  const occupied = Array.from({ length: safeRows }, () => Array<boolean>(safeColumns).fill(false));
  let placed = 0;

  for (const image of images) {
    const span = gallerySpan(image.layout, safeColumns);
    let position: { row: number; column: number } | null = null;

    for (let row = 0; row <= safeRows - span.rows && !position; row += 1) {
      for (let column = 0; column <= safeColumns - span.columns; column += 1) {
        const available = Array.from({ length: span.rows }, (_, rowOffset) =>
          Array.from({ length: span.columns }, (__, columnOffset) =>
            !occupied[row + rowOffset][column + columnOffset]
          ).every(Boolean)
        ).every(Boolean);
        if (available) position = { row, column };
      }
    }

    if (!position) break;
    for (let rowOffset = 0; rowOffset < span.rows; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < span.columns; columnOffset += 1) {
        occupied[position.row + rowOffset][position.column + columnOffset] = true;
      }
    }
    placed += 1;
  }

  return placed;
}
