import { z } from "zod";
import type { ImportedMaterialList } from "./materialTypes";

export const MAX_MATERIAL_FILE_SIZE = 5 * 1024 * 1024;

const databaseCount = z.number().int().nonnegative().max(2_147_483_647);

const materialSchema = z.object({
  Item: z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/).max(200),
  Total: databaseCount,
  Missing: databaseCount,
  Mismatched: databaseCount.default(0),
  Available: databaseCount.default(0)
});

const listSchema = z.object({
  Name: z.string().trim().min(1).max(100),
  Title: z.string().trim().max(240).optional().default(""),
  Multiplier: z.number().positive().finite().optional().default(1),
  Date: z.string().trim().max(120).optional().default(""),
  Materials: z.array(materialSchema).min(1).max(5000)
});

// Parse the exact Litematica export envelope while merging accidental
// duplicate namespaces into one deterministic project row.
export function parseLitematicaMaterialList(text: string): ImportedMaterialList {
  if (new TextEncoder().encode(text).byteLength > MAX_MATERIAL_FILE_SIZE) {
    throw new Error("error.materialFileTooLarge");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("error.invalidMaterialList");
  }
  const result = listSchema.safeParse(raw);
  if (!result.success) throw new Error("error.invalidMaterialList");

  const merged = new Map<string, Omit<ImportedMaterialList["materials"][number], "sortOrder">>();
  for (const material of result.data.Materials) {
    const current = merged.get(material.Item);
    const next = {
      itemId: material.Item,
      totalCount: (current?.totalCount ?? 0) + material.Total,
      missingCount: (current?.missingCount ?? 0) + material.Missing,
      availableCount: (current?.availableCount ?? 0) + material.Available,
      mismatchedCount: (current?.mismatchedCount ?? 0) + material.Mismatched
    };
    if ([next.totalCount, next.missingCount, next.availableCount, next.mismatchedCount]
      .some(count => count > 2_147_483_647)) throw new Error("error.invalidMaterialList");
    merged.set(material.Item, next);
  }

  return {
    name: result.data.Name,
    title: result.data.Title,
    date: result.data.Date,
    multiplier: result.data.Multiplier,
    materials: [...merged.values()].map((material, sortOrder) => ({ ...material, sortOrder }))
  };
}
