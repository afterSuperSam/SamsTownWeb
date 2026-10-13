import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createServer } from "node:net";

// 自建本地数据库验证迁移和 RLS，不读取生产凭据。
const binaryDirectory = process.env.PG_BIN_DIRECTORY;
assert.ok(binaryDirectory && isAbsolute(binaryDirectory), "PG_BIN_DIRECTORY must be an absolute path");
const root = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "samstown-database-fixture-"));
const data = join(scratch, "data");
const listener = createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
function command(name, args) {
  const result = spawnSync(join(binaryDirectory, name + (process.platform === "win32" ? ".exe" : "")), args,
    { cwd: root, encoding: "utf8", windowsHide: true, env: environment, timeout: 60_000,
      stdio: name === "pg_ctl" ? "ignore" : "pipe" });
  if (result.error || result.status !== 0) throw new Error(`${name} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function sql(args) {
  const index = args.indexOf("-f");
  const transaction = index >= 0 && !/^\s*begin\s*;/imu.test(readFileSync(resolve(root, args[index + 1]), "utf8")) ? ["-1"] : [];
  return command("psql", ["-X", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...transaction, ...args]);
}
let started = false;
try {
  command("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"]);
  command("pg_ctl", ["-D", data, "-l", join(scratch, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
  started = true;
  sql(["-f", "tests/database-bootstrap.sql"]);
  const migrations = readdirSync(join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
  for (const file of migrations) {
    if (file === "202610050001_reset_business_data_keep_accounts.sql") {
      // 夹具没有 Storage API，仅在隔离库模拟已完成的空桶退役。
      sql(["-c", "delete from storage.buckets where id='schematics' and not exists (select 1 from storage.objects where bucket_id='schematics');"]);
    }
    if (file === "202610070001_remove_qq_auth.sql") {
      sql(["-c", `insert into auth.users (id,email,encrypted_password,raw_user_meta_data,raw_app_meta_data)
        values ('00000000-0000-4000-8000-000000000099','existing@example.test','fixture-password-hash',
          '{"username":"Existing","qq_registration_pending":false}','{"yingwu_trusted_provisioning":true}');
        update public.profiles set role='owner', must_change_password=false where username='Existing';
        insert into private.qq_identities (user_id,qq_number) values ('00000000-0000-4000-8000-000000000099','123456789');`]);
    }
    sql(["-f", `supabase/migrations/${file}`]);
  }
  sql(["-c", `do $$ begin
    if not exists (select 1 from auth.users u join public.profiles p on p.id=u.id
      where p.username='Existing' and p.role='owner' and not p.must_change_password
        and u.encrypted_password='fixture-password-hash') then raise exception 'Existing account changed'; end if;
    if to_regclass('private.qq_identities') is not null or to_regclass('private.qq_verification_challenges') is not null
      or to_regprocedure('public.list_account_qq_bindings()') is not null then raise exception 'QQ objects remain'; end if;
    begin
      insert into auth.users (id,email,raw_user_meta_data) values (gen_random_uuid(),'untrusted@example.test','{"username":"Untrusted"}');
      raise exception 'Untrusted signup accepted';
    exception when insufficient_privilege then null; end;
  end; $$;`]);
  sql(["-f", "tests/map-database-integration.sql"]);
  console.log(`Validated ${migrations.length} migrations, QQ removal, existing accounts and map RLS. Fixture: ${scratch}`);
} finally {
  if (started) command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
}
