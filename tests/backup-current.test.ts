import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error 独立维护脚本不纳入应用 TypeScript 编译。
import { backupCurrent, validateBackupDirectory } from "../scripts/backup-current.mjs";
// @ts-expect-error 独立维护脚本不纳入应用 TypeScript 编译。
import { resetBusinessStorage, validateResetSnapshot } from "../scripts/reset-business-storage.mjs";
let fixture: string;
beforeEach(async () => { fixture = await mkdtemp(join(tmpdir(), "samstown-maintenance-test-")); });
afterEach(async () => { await rm(fixture, { recursive: true, force: true }); });
describe("maintenance boundaries", () => {
  it("rejects roots, project and home directories", async () => {
    const workspace = join(fixture, "workspace"), home = join(fixture, "home");
    for (const directory of ["relative", parse(fixture).root, workspace, join(workspace, "backup"), home]) {
      await expect(validateBackupDirectory(directory, workspace, home)).rejects.toThrow();
    }
    await expect(validateBackupDirectory(join(fixture, "backup"), workspace, home)).resolves.toBe(join(fixture, "backup"));
  });
  it("preserves the current backup when restore verification is unconfigured", async () => {
    const directory = join(fixture, "backup"); await mkdir(directory); await writeFile(join(directory, "current"), "old-copy");
    const runner = vi.fn();
    await expect(backupCurrent({ BACKUP_DIRECTORY: directory, SUPABASE_URL: "https://fixture.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key", BACKUP_ENCRYPTION_KEY: "07".repeat(32),
      PG_DUMP_PATH: join(fixture, "pg_dump"), PG_RESTORE_PATH: join(fixture, "pg_restore")
    }, { commandRunner: runner })).rejects.toThrow("BACKUP_VERIFY_DATABASE_URL");
    expect(await readFile(join(directory, "current"), "utf8")).toBe("old-copy");
    expect(runner).not.toHaveBeenCalled();
  });
  it("keeps reset read-only by default and rejects traversal paths", async () => {
    const object = { bucket: "site-images", path: "example.png", id: "fixture", updated_at: "fixture", metadata: {} };
    const snapshot = { buckets: [{ id: "site-images" }], objects: [object] };
    expect(() => validateResetSnapshot({ ...snapshot, objects: [{ ...object, path: "../outside" }] })).toThrow();
    const remove = vi.fn(), backupRunner = vi.fn();
    const result = await resetBusinessStorage({ SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key" }, {
      clientFactory: () => ({ storage: { from: () => ({ remove }) } }), backupRunner, report: vi.fn(), retained: ["profiles", "town_images"],
      snapshotReader: async () => snapshot, catalogReader: async () => ({ paths: { "/profiles": {}, "/town_images": {} } }),
      tableInventoryReader: async () => ["auth.users", "public.profiles", "public.town_images", "private.qq_identities", "private.qq_verification_challenges", "private.daily_visitor_views"]
        .map(value => ({ schema_name: value.split(".")[0], table_name: value.split(".")[1], table_kind: "r" })),
      preflightReader: async () => ({ enabled_truncate_trigger: false, external_business_foreign_key: false, unexpected_inheritance: false })
    });
    expect(result).toEqual({ deleted: 0, planned: 1 });
    expect(remove).not.toHaveBeenCalled(); expect(backupRunner).not.toHaveBeenCalled();
  });
});
