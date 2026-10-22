import { z } from "zod";

const ITEM_INDEX_URL = "https://mcitemgallery.com/metadata/items-index.json";
const ZH_LANGUAGE_URL = "https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.5/assets/minecraft/lang/zh_cn.json";
const IMAGE_ROOT = "https://mcitemgallery.com/images";
const CACHE_DURATION = 12 * 60 * 60 * 1000;

const itemIndexSchema = z.record(z.string(), z.object({
  displayName: z.string(),
  latestVersion: z.string(),
  removed: z.boolean().optional().default(false)
}));
const languageSchema = z.record(z.string(), z.string());

interface MetadataCache {
  expiresAt: number;
  index: z.infer<typeof itemIndexSchema>;
  zh: z.infer<typeof languageSchema>;
}

export interface ResolvedMaterialMetadata {
  itemId: string;
  nameZh: string;
  nameEn: string;
  imageUrl: string | null;
}

let cached: MetadataCache | null = null;
let pending: Promise<MetadataCache> | null = null;

// A single cached catalogue request enriches every imported namespace. Modded
// ids remain valid and receive deterministic names even without vanilla art.
export async function resolveMaterialMetadata(
  itemIds: string[],
  fetcher: typeof fetch = fetch
): Promise<ResolvedMaterialMetadata[]> {
  const needsVanillaCatalogue = itemIds.some(itemId => itemId.startsWith("minecraft:"));
  const catalogue = needsVanillaCatalogue ? await loadCatalogue(fetcher) : null;
  return itemIds.map(itemId => {
    const [namespace, path] = itemId.split(":", 2);
    const fallback = titleCase(path).slice(0, 160);
    if (namespace !== "minecraft") {
      return { itemId, nameZh: fallback, nameEn: fallback, imageUrl: null };
    }
    const indexEntry = catalogue?.index[`${path}.png`];
    return {
      itemId,
      nameZh: (catalogue?.zh[`block.minecraft.${path}`] ?? catalogue?.zh[`item.minecraft.${path}`] ?? fallback).slice(0, 160),
      nameEn: indexEntry?.displayName ?? fallback,
      imageUrl: indexEntry && !indexEntry.removed
        ? `${IMAGE_ROOT}/${encodeURIComponent(indexEntry.latestVersion)}/${encodeURIComponent(path)}.png`
        : null
    };
  });
}

async function loadCatalogue(fetcher: typeof fetch): Promise<MetadataCache> {
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (pending) return pending;
  pending = Promise.all([
    fetchJson(ITEM_INDEX_URL, itemIndexSchema, fetcher),
    fetchJson(ZH_LANGUAGE_URL, languageSchema, fetcher)
  ]).then(([index, zh]) => ({ expiresAt: Date.now() + CACHE_DURATION, index, zh }));
  try {
    cached = await pending;
    return cached;
  } finally {
    pending = null;
  }
}

async function fetchJson<T>(url: string, schema: z.ZodType<T>, fetcher: typeof fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 YingwuTown/1.1" },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw productError("error.materialMetadata");
  }
  if (!response.ok) throw productError("error.materialMetadata");
  try {
    return schema.parse(await response.json());
  } catch {
    throw productError("error.materialMetadata");
  }
}

function titleCase(value: string) {
  return value.split("_").filter(Boolean).map(part => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ") || value;
}

function productError(code: string) {
  return Object.assign(new Error(code), { statusCode: 424, code });
}

export function clearMaterialMetadataCacheForTests() {
  cached = null;
  pending = null;
}
