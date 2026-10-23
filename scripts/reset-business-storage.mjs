// 仅供 QQ／论坛旧表退役前的历史维护窗口；当前数据库不适用，目录校验必须保持严格。
import { open, readFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { backupCurrent, storageSnapshot } from "./backup-current.mjs";
import { buildPlan, readRows, retainedTableNames, validObjectPath } from "./retire-storage.mjs";

const root = new URL("../", import.meta.url);
const knownBuckets = ["site-images", "town-maps", "schematics"];
const retiredTables = ["resources", "schematics", "material_projects", "material_items", "material_assignments"];
const businessTables = [
  "public.account_deletion_queue", "public.audit_logs", "public.daily_page_views",
  "public.faq_items", "public.forum_posts", "public.game_servers",
  "public.map_claim_cells", "public.map_claims", "public.map_markers",
  "public.player_profiles", "public.server_commands", "public.server_metrics",
  "public.site_content", "public.storage_cleanup_queue", "public.town_announcements",
  "public.town_history", "public.town_images", "public.town_maps", "public.town_members",
  "private.qq_verification_challenges", "private.daily_visitor_views"
];
const configuration = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  DATA_RESET_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  DATA_RESET_PAGE_SIZE: z.coerce.number().int().min(1).max(1000).default(500),
  DATA_RESET_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  DATA_RESET_MAINTENANCE_WINDOW: z.literal("confirmed").optional(),
  BACKUP_SUPABASE_CLI_PATH: z.string().refine(isAbsolute).optional()
});
class ResetError extends Error { constructor(code) { super(code); this.code = code; } }
const requireCondition = (condition, code) => { if (!condition) throw new ResetError(code); };
const identity = object => JSON.stringify([object.id, object.created_at, object.updated_at, object.metadata]);
const objectKey = object => `${object.bucket}/${object.path}`;

export function classifyResetJournalError(error) {
  if (error.code === "EEXIST") return "existing-reset-operation-requires-review";
  if (["EACCES", "EPERM"].includes(error.code)) return "reset-journal-permission-denied";
  if (error.code === "ENOSPC") return "reset-journal-disk-full";
  if (error.code === "ENOENT") return "reset-journal-parent-missing";
  return "reset-journal-create-failed";
}

async function synchronizeJournalDirectory(directory) {
  try {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (process.platform === "win32" && ["EISDIR", "EINVAL", "ENOTSUP", "ENOSYS"].includes(error.code)) {
      throw new ResetError("reset-journal-directory-sync-unsupported");
    }
    throw error;
  }
}

// 独占标记持续存在；文件及父目录同步后才继续，失败保留已发布标记与临时文件。
export async function createResetJournal(path, initialRecord, {
  renameFile = rename, directorySynchronizer = synchronizeJournalDirectory
} = {}) {
  const marker = await open(path, "wx", 0o600)
    .catch(error => { throw new ResetError(classifyResetJournalError(error)); });
  try { await marker.writeFile(JSON.stringify(initialRecord)); await marker.sync(); }
  finally { await marker.close(); }
  const markerPath = path instanceof URL ? fileURLToPath(path) : path;
  const directory = dirname(markerPath);
  await directorySynchronizer(directory);
  return async record => {
    const temporaryPath = `${markerPath}.${randomUUID()}.tmp`;
    const temporary = await open(temporaryPath, "wx", 0o600);
    try { await temporary.writeFile(JSON.stringify(record)); await temporary.sync(); }
    finally { await temporary.close(); }
    await renameFile(temporaryPath, markerPath);
    await directorySynchronizer(directory);
  };
}

export function validateRetirementSequence(tables, objects, projectUrl) {
  const byBucket = new Map(knownBuckets.map(bucket => [bucket,
    new Map([...objects.values()].filter(object => object.bucket === bucket).map(object => [object.path, object]))]));
  try { buildPlan(tables, byBucket, projectUrl); }
  catch { throw new ResetError("pending-retirement-sequence-precondition-failed"); }
}

// 仅清空已审定项目的上传数据，不调用 Auth 删除、改密或绑定接口。
export function validateResetSnapshot(snapshot) {
  requireCondition(Array.isArray(snapshot.buckets) && Array.isArray(snapshot.objects), "invalid-storage-snapshot");
  const buckets = new Set();
  for (const bucket of snapshot.buckets) {
    requireCondition(knownBuckets.includes(bucket.id) && !buckets.has(bucket.id), "unreviewed-storage-bucket");
    buckets.add(bucket.id);
  }
  const objects = new Map();
  for (const object of snapshot.objects) {
    requireCondition(buckets.has(object.bucket) && validObjectPath(object.path)
      && typeof object.id === "string" && object.id.length > 0 && !objects.has(objectKey(object)), "invalid-storage-object");
    objects.set(objectKey(object), object);
  }
  return objects;
}

export function validateRemainingObjects(original, current) {
  requireCondition(original.size === current.size, "storage-changed-during-reset");
  for (const [key, object] of current) {
    requireCondition(original.has(key) && identity(original.get(key)) === identity(object), "storage-changed-during-reset");
  }
}

export function validateResetCatalog(specification, retained) {
  requireCondition(specification?.paths && typeof specification.paths === "object", "live-table-catalog-unavailable");
  const actual = Object.keys(specification.paths).filter(path => /^\/[^/]+$/u.test(path)).map(path => path.slice(1)).sort();
  const current = [...retained].sort();
  const beforeRetirement = [...retained, ...retiredTables].sort();
  requireCondition(JSON.stringify(actual) === JSON.stringify(current)
    || JSON.stringify(actual) === JSON.stringify(beforeRetirement), "unreviewed-live-table-catalog");
}

export function validateResetTableInventory(rows, retained) {
  requireCondition(Array.isArray(rows), "authoritative-table-inventory-unavailable");
  const current = [...retained.map(name => `public.${name}`),
    "private.qq_identities", "private.qq_verification_challenges", "private.daily_visitor_views"].sort();
  const beforeRetirement = [...current, ...retiredTables.map(name => `public.${name}`)].sort();
  requireCondition(rows.every(row => typeof row.table_name === "string"
    && (row.schema_name === "auth" ? ["r", "p"].includes(row.table_kind)
      : ["public", "private"].includes(row.schema_name) && row.table_kind === "r"))
    && rows.some(row => row.schema_name === "auth" && row.table_name === "users" && row.table_kind === "r"), "unsupported-base-table-inventory");
  const actual = rows.filter(row => row.schema_name !== "auth").map(row => `${row.schema_name}.${row.table_name}`).sort();
  requireCondition(JSON.stringify(actual) === JSON.stringify(current)
    || JSON.stringify(actual) === JSON.stringify(beforeRetirement), "unreviewed-authoritative-table-inventory");
}

// 通过 linked Management API 只读查询目录；输出只在内存验证，不打印数据库记录。
async function readCatalogQuery(config, query) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.BACKUP_SUPABASE_CLI_PATH ?? "supabase", ["db", "query", "--linked", query, "-o", "json"], {
      cwd: fileURLToPath(root), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new ResetError("authoritative-table-inventory-timeout")); }, config.DATA_RESET_REQUEST_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.length > 1048576) { child.kill(); reject(new ResetError("authoritative-table-inventory-too-large")); }
    });
    child.once("error", () => { clearTimeout(timer); reject(new ResetError("authoritative-table-inventory-cli-failed")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new ResetError("authoritative-table-inventory-cli-failed")); return; }
      try { resolve(JSON.parse(output).rows); }
      catch { reject(new ResetError("authoritative-table-inventory-invalid-json")); }
    });
  });
}

async function readTableInventory(config) {
  return readCatalogQuery(config, "select n.nspname as schema_name,c.relname as table_name,c.relkind::text as table_kind from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth') and c.relkind in ('r','p','f','m') order by 1,2");
}

async function readResetPreflight(config) {
  const rows = await readCatalogQuery(config, `
    with business as (
      select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname || '.' || c.relname in (${businessTables.map(name => `'${name}'`).join(",")})
    ), retired as (
      select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (${retiredTables.map(name => `'${name}'`).join(",")})
    ), protected as (
      select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private','auth') and c.relkind in ('r','p','f','m')
    ) select
      exists (select 1 from pg_catalog.pg_trigger where tgrelid in (select oid from business)
        and (tgtype::integer & 32) <> 0 and tgenabled <> 'D') as enabled_truncate_trigger,
      exists (select 1 from pg_catalog.pg_constraint where contype='f'
        and confrelid in (select oid from business) and conrelid not in (select oid from business)
        and conrelid not in (select oid from retired)) as external_business_foreign_key,
      exists (select 1 from pg_catalog.pg_inherits where inhrelid in (select oid from protected)
        or inhparent in (select oid from protected)) as unexpected_inheritance`);
  requireCondition(Array.isArray(rows) && rows.length === 1, "reset-preflight-unavailable");
  return rows[0];
}

function validateResetPreflight(summary) {
  const guards = [
    ["enabled_truncate_trigger", "enabled-business-truncate-trigger"],
    ["external_business_foreign_key", "external-business-foreign-key"],
    ["unexpected_inheritance", "unexpected-table-inheritance"]
  ];
  for (const [field, code] of guards) {
    requireCondition(typeof summary?.[field] === "boolean", "reset-preflight-unavailable");
    requireCondition(!summary[field], code);
  }
}

export async function resetBusinessStorage(environment, {
  apply = false, clientFactory = createClient, backupRunner = backupCurrent, snapshotReader = storageSnapshot,
  catalogReader, tableInventoryReader = readTableInventory, preflightReader = readResetPreflight,
  tableReader = readRows, retained = [], report = value => console.log(JSON.stringify(value))
} = {}) {
  const config = configuration.parse(environment);
  if (apply) requireCondition(config.DATA_RESET_MAINTENANCE_WINDOW === "confirmed", "maintenance-window-required");
  const client = clientFactory(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, options = {}) => fetch(input, { ...options,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(config.DATA_RESET_REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(config.DATA_RESET_REQUEST_TIMEOUT_MS) }) }
  });
  const readCatalog = catalogReader ?? (async () => {
    const response = await fetch(`${config.SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: config.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/openapi+json" }, signal: AbortSignal.timeout(config.DATA_RESET_REQUEST_TIMEOUT_MS)
    });
    requireCondition(response.ok, "live-table-catalog-unavailable");
    return response.json();
  });
  const inspect = async () => {
    const inventory = await tableInventoryReader(config);
    validateResetTableInventory(inventory, retained);
    validateResetCatalog(await readCatalog(), retained);
    validateResetPreflight(await preflightReader(config));
    const objects = validateResetSnapshot(await snapshotReader(client, knownBuckets));
    const tables = new Map();
    const readTable = async name => {
      if (!tables.has(name)) tables.set(name, await tableReader(client, name, {
        pageSize: config.DATA_RESET_PAGE_SIZE, timeoutMilliseconds: config.DATA_RESET_REQUEST_TIMEOUT_MS
      }));
      return tables.get(name);
    };
    // 地图旧迁移的已知前置在每次盘点中核验；错误只报告类别，不输出业务行。
    const mapTables = ["map_claims", "map_claim_cells"];
    if (inventory.some(row => row.schema_name === "public" && mapTables.includes(row.table_name))) {
      requireCondition(mapTables.every(name => inventory.some(row => row.schema_name === "public" && row.table_name === name)),
        "map-integrity-inventory-incomplete");
      const claims = await readTable("map_claims");
      const cells = await readTable("map_claim_cells");
      requireCondition(Array.isArray(claims) && Array.isArray(cells), "map-integrity-rows-unavailable");
      const claimMaps = new Map(claims.map(claim => [claim.id, claim.map_id]));
      requireCondition(cells.every(cell => claimMaps.has(cell.claim_id) && claimMaps.get(cell.claim_id) === cell.map_id),
        "pending-map-integrity-precondition-failed");
    }
    // 旧退役迁移仍在前方时，先验证共享投影引用不会阻断按序迁移。
    if (inventory.some(row => row.schema_name === "public" && row.table_name === "schematics")) {
      for (const name of [...retained, ...retiredTables]) await readTable(name);
      validateRetirementSequence(tables, objects, config.SUPABASE_URL);
    }
    return objects;
  };
  const initial = await inspect();
  report({ stage: apply ? "apply-plan" : "dry-run", storageObjects: initial.size, preserves: "Auth/profiles; QQ data is handled by its retirement migration" });
  if (!apply) return { deleted: 0, planned: initial.size };
  // 当次备份必须完整成功，不能以人工布尔确认替代恢复验证。
  try { await backupRunner({ ...environment, BACKUP_BUCKETS: knownBuckets.join(",") }); }
  catch { throw new ResetError("current-backup-verification-failed"); }
  const afterBackup = await inspect();
  requireCondition(initial.size === afterBackup.size, "storage-changed-during-backup");
  validateRemainingObjects(initial, afterBackup);
  const expectedRemaining = new Map(initial);
  let deleted = 0;
  for (const bucket of knownBuckets) {
    const paths = [...initial.values()].filter(object => object.bucket === bucket).map(object => object.path);
    for (let offset = 0; offset < paths.length; offset += config.DATA_RESET_BATCH_SIZE) {
      const current = await inspect();
      validateRemainingObjects(expectedRemaining, current);
      const batch = paths.slice(offset, offset + config.DATA_RESET_BATCH_SIZE);
      const result = await client.storage.from(bucket).remove(batch);
      requireCondition(!result.error, "storage-delete-failed");
      const remaining = await inspect();
      requireCondition(batch.every(path => !remaining.has(`${bucket}/${path}`)), "storage-delete-not-confirmed");
      const expectedAfterBatch = new Map(expectedRemaining);
      for (const path of batch) expectedAfterBatch.delete(`${bucket}/${path}`);
      validateRemainingObjects(expectedAfterBatch, remaining);
      for (const path of batch) expectedRemaining.delete(`${bucket}/${path}`);
      deleted += batch.length;
      report({ stage: "deleted", bucket, count: batch.length });
    }
  }
  validateRemainingObjects(expectedRemaining, await inspect());
  requireCondition(expectedRemaining.size === 0, "remaining-storage-objects");
  report({ stage: "storage-empty", deleted, databaseResetApplied: false });
  return { deleted, planned: initial.size };
}

async function main() {
  const argumentsList = process.argv.slice(2);
  requireCondition(argumentsList.length <= 1 && argumentsList.every(value => value === "--apply"), "invalid-arguments");
  const environment = { ...parseEnv(await readFile(new URL(".env", root), "utf8")), ...process.env };
  environment.SUPABASE_URL ??= environment.VITE_SUPABASE_URL;
  const linked = (await readFile(new URL("supabase/.temp/project-ref", root), "utf8")).trim();
  const url = new URL(environment.SUPABASE_URL);
  requireCondition(/^[a-z0-9]+$/u.test(linked) && url.origin === `https://${linked}.supabase.co`
    && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password, "linked-project-mismatch");
  const retained = retainedTableNames(await readFile(new URL("src/lib/database.types.ts", root), "utf8"));
  const apply = argumentsList.includes("--apply");
  if (!apply) { await resetBusinessStorage(environment, { retained }); return; }
  requireCondition(configuration.parse(environment).DATA_RESET_MAINTENANCE_WINDOW === "confirmed", "maintenance-window-required");
  // 一次性操作日志阻止中断后重跑覆盖原始完整备份；人工恢复先核验清理阶段。
  const journalRecord = phase => ({ format: 1, project: linked, phase, updatedAt: new Date().toISOString() });
  const publishRecord = await createResetJournal(new URL("supabase/.temp/business-reset-operation.json", root), journalRecord("prepared"));
  await resetBusinessStorage(environment, { apply, retained, backupRunner: async values => {
    const result = await backupCurrent(values);
    await publishRecord(journalRecord("backup-verified-before-storage-delete"));
    return result;
  } });
  await publishRecord(journalRecord("storage-empty-database-migration-pending"));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    const code = error instanceof ResetError ? error.code : error instanceof z.ZodError ? "invalid-configuration" : "inspection-or-journal-failed";
    console.error(JSON.stringify({ stage: "failed", code }));
    console.error("业务数据清空已停止，未应用数据库迁移；如已开始删除，保留当次备份与操作日志，不要重新备份覆盖原副本。");
    process.exitCode = 1;
  });
}
