import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve("supabase/migrations/202607280001_refresh_town_member_directory.sql");

function migrationUsernames() {
  const sql = readFileSync(migrationPath, "utf8");
  const valueRows = sql
    .split("\n")
    .filter(line => {
      const valueRow = line.trimStart().startsWith("('");
      return valueRow && ["'primary'", "'town'", "'friend'"].some(group => line.includes(group));
    })
    .map(line => line.trim().split("'")[1]);
  const arrayStart = sql.indexOf("from unnest(array[") + "from unnest(array[".length;
  const citizenBlock = sql.slice(arrayStart, sql.indexOf("]) with ordinality", arrayStart));
  const citizenNames = citizenBlock.split("'").filter((_, index) => index % 2 === 1);
  return [...valueRows, ...citizenNames];
}

describe("town member data migration", () => {
  it("keeps the bootstrap directory case-insensitively unique", () => {
    const migrated = migrationUsernames();
    const normalized = migrated.map(username => username.toLocaleLowerCase("en-US"));
    expect(migrated.length).toBeGreaterThan(150);
    expect(new Set(normalized).size).toBe(normalized.length);
  });
});
