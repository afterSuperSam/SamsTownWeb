// 退役迁移与业务清空共用的引用预检和稳定分页。
const retiredAreas = new Set(["resources", "materialHero"]);
const retiredTables = new Set(["resources", "schematics", "material_projects", "material_items", "material_assignments"]);
const retiredContentKeys = new Set(["resources", "materials", "schematics", "resourceHero", "materialHero"]);
const retiredTranslationKeys = new Set([
  "app.nav.resources", "app.nav.materials", "admin.nav.resources",
  "admin.images.area.resources", "admin.images.area.materialHero",
  "admin.analytics.category.material", "admin.analytics.category.resource",
  "admin.analytics.table.material_projects", "admin.analytics.table.material_items",
  "admin.analytics.table.material_assignments", "admin.analytics.table.resources",
  "admin.analytics.table.schematics", "error.duplicateResource", "error.invalidResourceDetails",
  "error.invalidProjectUrl", "error.invalidModrinthUrl", "error.invalidGithubUrl",
  "error.projectMetadata", "error.requiredFile", "error.fileTooLarge"
]);

class RetirementError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new RetirementError(code);
}

// 路径只按实际对象名处理；URL 仅接受本项目明确的 Storage API 路径。
export function validObjectPath(value) {
  return typeof value === "string" && value.length > 0
    && !/[\\\u0000-\u001f\u007f]/u.test(value)
    && !value.split("/").some(part => !part || part === "." || part === "..");
}

export function siteImagePath(value, projectUrl) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const project = new URL(projectUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.hostname !== project.hostname
      || url.port !== project.port || url.username || url.password) return null;
    // 防止 URL 构造器提前消解原始路径中的点段。
    const originalPath = value.match(/^https?:\/\/[^/?#]+([^?#]*)/iu)?.[1];
    const matched = originalPath?.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/site-images\/(.+)$/u);
    if (!matched) return null;
    const path = decodeURIComponent(matched[1]);
    return validObjectPath(path) ? path : null;
  } catch {
    return null;
  }
}

export function cleanSiteContent(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return content;
  const cleaned = Object.fromEntries(Object.entries(content).filter(([key]) => !retiredContentKeys.has(key)));
  if (cleaned.translations && typeof cleaned.translations === "object" && !Array.isArray(cleaned.translations)) {
    cleaned.translations = Object.fromEntries(Object.entries(cleaned.translations).filter(([key]) =>
      !/^(resources|materials|schematics|admin\.resources)\./u.test(key)
      && !/^error\.(resource|material|schematic|invalidMaterial)/u.test(key)
      && !retiredTranslationKeys.has(key)
    ));
  }
  return cleaned;
}

// 只扫描真实字符串值；解码用于保留判断，绝不用于扩大删除候选范围。
export function referenceStrings(value, references = new Set(), depth = 0) {
  requireCondition(depth <= 64, "reference-nesting-limit");
  if (typeof value === "string") {
    let variant = value;
    for (let level = 0; level < 4; level += 1) {
      references.add(variant);
      if (/^\s*[\[{]/u.test(variant)) {
        let parsed;
        try { parsed = JSON.parse(variant); } catch { /* 正文不是 JSON，保留原字符串。 */ }
        if (parsed && typeof parsed === "object") referenceStrings(parsed, references, depth + 1);
      }
      const decoded = variant.replace(/(?:%[0-9a-f]{2})+/giu, encoded => {
        try { return decodeURIComponent(encoded); } catch { return encoded; }
      });
      if (decoded === variant) break;
      variant = decoded;
    }
  } else if (Array.isArray(value)) {
    for (const item of value) referenceStrings(item, references, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) referenceStrings(item, references, depth + 1);
  }
  return references;
}

export function hasReference(references, value) {
  if (typeof value !== "string" || !value) return false;
  const variants = [value, encodeURI(value), encodeURIComponent(value)];
  for (const reference of references) {
    if (variants.some(variant => reference.includes(variant))) return true;
  }
  return false;
}

export function buildPlan(tables, objects, projectUrl) {
  const references = new Set();
  const images = tables.get("town_images") ?? [];
  const oldImages = images.filter(image => retiredAreas.has(image.area));
  const candidates = new Set();
  for (const image of oldImages) {
    if (image.storage_path !== null && image.storage_path !== undefined) {
      requireCondition(validObjectPath(image.storage_path), "invalid-retired-image-path");
      candidates.add(image.storage_path);
    }
    const path = siteImagePath(image.source_url, projectUrl);
    if (path) candidates.add(path);
  }
  for (const row of tables.get("resources") ?? []) {
    for (const url of [row.icon_url, row.url]) {
      const path = siteImagePath(url, projectUrl);
      if (path) candidates.add(path);
    }
  }
  for (const row of tables.get("material_items") ?? []) {
    const path = siteImagePath(row.image_url, projectUrl);
    if (path) candidates.add(path);
  }
  for (const [table, rows] of tables) {
    if (retiredTables.has(table)) continue;
    for (const row of rows) {
      if (table === "town_images" && retiredAreas.has(row.area)) continue;
      // 清理队列只是删除任务，不是共享使用；候选映射在迁移中注销。
      if (table === "storage_cleanup_queue") continue;
      // 迁移会删除退役审计行；这些快照不属于保留引用。
      if (table === "audit_logs") {
        if (["material", "resource", "schematic", "resources", "schematics", "material_projects", "material_items", "material_assignments"].includes(row.target_type)
          || ["material", "resource", "schematic"].includes(row.details?.category)
          || retiredTables.has(row.details?.table)) continue;
        const details = row.details && typeof row.details === "object" && !Array.isArray(row.details)
          ? Object.fromEntries(Object.entries(row.details).filter(([key]) => key !== "releasedMaterialClaims")) : row.details;
        referenceStrings({ ...row, details }, references);
        continue;
      }
      referenceStrings(table === "site_content" ? { ...row, content: cleanSiteContent(row.content) } : row, references);
    }
  }
  // 旧栏目图片被其他栏目引用 ID 时，其全部物理路径一并保留。
  const sharedImages = new Set();
  let added;
  do {
    added = false;
    for (const image of oldImages) {
      if (!sharedImages.has(image) && [image.id, image.storage_path, image.source_url]
        .some(value => hasReference(references, value))) {
        sharedImages.add(image); referenceStrings(image, references); added = true;
      }
    }
  } while (added);
  const schematicPaths = new Set([...objects.get("schematics").keys(),
    ...(tables.get("schematics") ?? []).map(row => row.storage_path),
    ...(tables.get("material_projects") ?? []).map(row => row.projection_storage_path)].filter(Boolean));
  requireCondition(![...references].some(value => value.includes("schematics/"))
    && ![...schematicPaths].some(path => hasReference(references, path)), "shared-schematics-reference");
  const sharedPaths = [...candidates].filter(path => hasReference(references, path));
  const shared = new Set(sharedPaths);
  const siteObjects = objects.get("site-images");
  return {
    candidates,
    sharedPaths,
    sharedImages: sharedImages.size,
    deletions: new Map([
      ["schematics", [...objects.get("schematics").keys()]],
      ["site-images", [...candidates].filter(path => siteObjects.has(path) && !shared.has(path))]
    ])
  };
}

// 使用当前生成类型发现全部保留表，并为每张表采用稳定分页顺序。
export function retainedTableNames(source) {
  const tableSection = source.match(/    Tables: \{([\s\S]*?)\n    Views:/u)?.[1];
  requireCondition(tableSection, "invalid-generated-table-list");
  const names = [...tableSection.matchAll(/^ {6}([a-z][a-z0-9_]*): \{/gmu)].map(match => match[1]);
  requireCondition(names.includes("town_images") && names.includes("site_content"), "incomplete-generated-table-list");
  return names.filter(name => !retiredTables.has(name));
}

export async function readRows(client, table, config) {
  const orders = table === "map_claim_cells" ? ["map_id", "chunk_column", "chunk_row"]
    : table === "daily_page_views" ? ["view_date"]
      : table === "account_deletion_queue" ? ["user_id"] : ["id"];
  const rows = [];
  const identities = new Set();
  let total = null;
  do {
    let query = client.from(table).select("*", { count: "exact" });
    for (const column of orders) query = query.order(column, { ascending: true });
    const result = await query.range(rows.length, rows.length + config.pageSize - 1);
    requireCondition(!result.error && Array.isArray(result.data) && Number.isInteger(result.count), "table-read-failed");
    if (total === null) total = result.count;
    requireCondition(total === result.count, "table-changed-during-pagination");
    for (const row of result.data) {
      const identity = JSON.stringify(orders.map(column => row[column]));
      requireCondition(!identities.has(identity), "duplicate-table-page");
      identities.add(identity);
      rows.push(row);
    }
    requireCondition(rows.length <= total && (result.data.length > 0 || rows.length === total), "incomplete-table-pagination");
  } while (rows.length < total);
  return rows;
}
