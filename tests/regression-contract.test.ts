import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const migrationsDirectory = resolve(root, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDirectory)
  .filter(file => file.endsWith(".sql"))
  .sort();
const migrations = migrationFiles.map(file => ({
  file,
  sql: readFileSync(resolve(migrationsDirectory, file), "utf8")
}));
const combinedSql = migrations.map(({ sql }) => sql).join("\n");
const hardeningMigration = migrations.find(({ file }) => file.startsWith("202607270001"))?.sql ?? "";
const materialMigration = migrations.find(({ file }) => file.startsWith("202607300001"))?.sql ?? "";
const materialHeroMigration = migrations.find(({ file }) => file.startsWith("202607300002"))?.sql ?? "";
const workflowMigration = migrations.find(({ file }) => file.startsWith("202607310001"))?.sql ?? "";
const materialBatchMigration = migrations.find(({ file }) => file.startsWith("202607310002"))?.sql ?? "";
const resourceAdminMigration = migrations.find(({ file }) => file.startsWith("202607310003"))?.sql ?? "";
const webDataMigration = migrations.find(({ file }) => file.startsWith("202608010001"))?.sql ?? "";
const releaseMigration = migrations.find(({ file }) => file.startsWith("202608010002"))?.sql ?? "";
const forumMigration = migrations.find(({ file }) => file.startsWith("202608020001"))?.sql ?? "";
const resourceUrlMigration = migrations.find(({ file }) => file.startsWith("202608020002"))?.sql ?? "";
const forumIdentityMigration = migrations.find(({ file }) => file.startsWith("202608020003"))?.sql ?? "";
const forumAccessMigration = migrations.find(({ file }) => file.startsWith("202608020004"))?.sql ?? "";
const releaseV14Migration = migrations.find(({ file }) => file.startsWith("202608030001"))?.sql ?? "";
const qqRegistrationMigration = migrations.find(({ file }) => file.startsWith("202608040001"))?.sql ?? "";
const qqAbuseHardeningMigration = migrations.find(({ file }) => file.startsWith("202608040002"))?.sql ?? "";
const releaseV15Migration = migrations.find(({ file }) => file.startsWith("202608040003"))?.sql ?? "";
const accountQqVisibilityMigration = migrations.find(({ file }) => file.startsWith("202608050001"))?.sql ?? "";
const securityConsistencyMigration = migrations.find(({ file }) => file.startsWith("202608060001"))?.sql ?? "";
const releaseV16Migration = migrations.find(({ file }) => file.startsWith("202608060002"))?.sql ?? "";
const publicMapMigration = migrations.find(({ file }) => file.startsWith("20260812074939"))?.sql ?? "";
const releaseV19Migration = migrations.find(({ file }) => file.endsWith("release_v1_9_0.sql"))?.sql ?? "";
const visitorAnalyticsMigration = migrations.find(({ file }) => file.endsWith("visitor_analytics_v1_9.sql"))?.sql ?? "";

const conflictScanExtensions = new Set([
  ".css", ".html", ".json", ".md", ".sql", ".toml", ".ts", ".tsx", ".yaml", ".yml"
]);
const conflictScanExcludedDirectories = new Set([
  ".git", ".pnpm-store", "dist", "dist-server", "images", "node_modules", "test-results"
]);

function listConflictScannableFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return conflictScanExcludedDirectories.has(entry.name) ? [] : listConflictScannableFiles(path);
    }
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    return conflictScanExtensions.has(extension) ? [path] : [];
  });
}

describe("critical deployment contracts", () => {
  it("keeps an optimized JPG for every bundled PNG media identifier", () => {
    const contentFiles = [resolve(root, "src/domain/defaults.ts")];
    const bundledPngPattern = /["'](images\/[A-Za-z0-9_./-]+\.png)["']/g;
    const contentIdentifiers = contentFiles.flatMap(file =>
      [...readFileSync(file, "utf8").matchAll(bundledPngPattern)].map(match => match[1])
    );
    const migrationIdentifiers = migrations.flatMap(({ sql }) =>
      [...sql.matchAll(bundledPngPattern)].map(match => match[1])
    );
    const identifiers = [...contentIdentifiers, ...migrationIdentifiers];
    const missingAssets = [...new Set(identifiers)].flatMap(identifier => {
      const optimized = identifier
        .replace(/^images\//, "images/optimized/")
        .replace(/\.png$/i, ".jpg");
      return existsSync(resolve(root, optimized)) ? [] : [optimized];
    });

    expect(identifiers.length).toBeGreaterThan(0);
    expect(missingAssets).toEqual([]);
  });

  it("contains no unresolved Git merge conflict markers", () => {
    const marker = new RegExp("^(?:<" + "{7}|=" + "{7}|>" + "{7})(?: |$)", "m");
    const pollutedFiles = listConflictScannableFiles(root)
      .filter(file => marker.test(readFileSync(file, "utf8")))
      .map(file => file.slice(root.length + 1));
    expect(pollutedFiles).toEqual([]);
  });

  it("keeps the application release on v1.9.0 while preserving migration history", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      version?: string;
    };
    expect(packageJson.version).toBe("1.9.0");
    expect(releaseV19Migration).toMatch(/^-- v1\.9\.0\b/);
    expect(releaseV16Migration).toMatch(/^-- v1\.6\.0\b/);
    expect(releaseV15Migration).toMatch(/^-- v1\.5\.0\b/);
    expect(releaseV14Migration).toMatch(/^-- v1\.4\.0\b/);
    expect(releaseV14Migration).toContain("'forumHero'");
  });

  it("forces Vite to rebuild optimized dependencies on each development start", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["dev:web"]).toMatch(/\bvite\b.*\s--force(?:\s|$)/);
    expect(packageJson.scripts?.["api:dev"]).toBe("tsx watch --env-file=.env server/index.ts");
    expect(packageJson.scripts?.dev).toContain("pnpm dev:web");
    expect(packageJson.scripts?.dev).toContain("pnpm api:dev");
  });

  it("copies only optimized runtime media into the production artifact", () => {
    const viteConfig = readFileSync(resolve(root, "vite.config.ts"), "utf8");

    expect(viteConfig).toContain('["optimized"]');
    expect(viteConfig).not.toContain('"cloud"');
    expect(viteConfig).not.toMatch(/cpSync\(\s*resolve\(["']images["']\)/);
  });

  it("contains only one non-idempotent platform baseline", () => {
    const appRoleDefinitions = migrations.flatMap(({ file, sql }) =>
      [...sql.matchAll(/create\s+type\s+public\.app_role\b/gi)].map(() => file)
    );

    expect(appRoleDefinitions).toEqual(["202607230001_initial_schema.sql"]);
  });

  it("keeps compatibility migrations idempotent on a fresh database", () => {
    const compatibilityMigration = migrations.find(({ file }) =>
      file === "20260723074849_optimize_rls_and_foreign_keys.sql"
    )?.sql ?? "";
    const createdPolicies = [...compatibilityMigration.matchAll(
      /create\s+policy\s+"([^"]+)"\s+on\s+([a-z_.]+)/gi
    )];

    expect(createdPolicies.length).toBeGreaterThan(0);
    for (const policy of createdPolicies) {
      const createPosition = policy.index ?? 0;
      const prefix = compatibilityMigration.slice(0, createPosition);
      expect(prefix).toMatch(new RegExp(
        `drop\\s+policy\\s+if\\s+exists\\s+"${policy[1]}"\\s+on\\s+${policy[2].replace(".", "\\.")}`,
        "i"
      ));
    }
  });

  it("keeps public Auth signup disabled and provisions accounts fail-closed", () => {
    const supabaseConfig = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
    expect(supabaseConfig).toMatch(/\[auth\][\s\S]*?enable_signup\s*=\s*false/);
    expect(supabaseConfig).toMatch(/\[auth\.email\][\s\S]*?enable_signup\s*=\s*false/);
    expect(supabaseConfig).toMatch(/minimum_password_length\s*=\s*10/);
    expect(supabaseConfig).toMatch(/secure_password_change\s*=\s*true/);
    expect(securityConsistencyMigration).toContain("yingwu_trusted_provisioning");
    expect(securityConsistencyMigration).toMatch(/raw_app_meta_data[\s\S]*qq_registration_pending/);
  });

  it("does not expose archived image metadata or Storage listings", () => {
    expect(securityConsistencyMigration).toContain('drop policy if exists "public reads town images"');
    expect(securityConsistencyMigration).toMatch(
      /create policy "public reads visible images"[\s\S]*area <> 'other'/
    );
    expect(securityConsistencyMigration).toContain('drop policy if exists "public reads site images"');
    expect(securityConsistencyMigration).toContain('create policy "owners read site images"');
  });

  it("keeps reverse-proxy and bot administration bindings loopback-only", () => {
    const deployGuide = readFileSync(resolve(root, "docs/DEPLOY_UBUNTU_24.md"), "utf8");
    const handoff = readFileSync(resolve(root, "docs/handoff.md"), "utf8");
    expect(deployGuide).not.toContain("$proxy_add_x_forwarded_for");
    expect(handoff).not.toContain("$proxy_add_x_forwarded_for");
    expect(handoff).not.toMatch(/-\s*"(?:6099|6185):(?:6099|6185)"/);
    expect(handoff).toContain('"127.0.0.1:6099:6099"');
    expect(handoff).toContain('"127.0.0.1:6185:6185"');
  });

  it("enables RLS for every application table", () => {
    const tableNames = [...combinedSql.matchAll(
      /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z_]+)/gi
    )].map(match => match[1]);
    expect(tableNames.length).toBeGreaterThan(0);
    for (const tableName of new Set(tableNames)) {
      expect(combinedSql).toMatch(new RegExp(
        `alter\\s+table\\s+public\\.${tableName}\\s+enable\\s+row\\s+level\\s+security`,
        "i"
      ));
    }
  });

  it("pins the search path of every security-definer function", () => {
    const positions = [...combinedSql.matchAll(/\bsecurity\s+definer\b/gi)]
      .map(match => match.index);
    expect(positions.length).toBeGreaterThan(0);
    for (const position of positions) {
      const declarationStart = combinedSql.lastIndexOf("create", position);
      const bodyStart = combinedSql.indexOf("as $$", position);
      const header = combinedSql.slice(declarationStart, bodyStart);
      expect(header).toMatch(/set\s+search_path\s*=\s*''/i);
    }
  });

  it("does not retain the litematic-only file-name constraint", () => {
    expect(combinedSql).not.toMatch(/file_name\s+text\s+not\s+null\s+check\s*\([^)]*litematic/i);
  });

  it("gates every map child row through map visibility", () => {
    const mapMigration = migrations.find(({ file }) => file.includes("town_maps"))?.sql ?? "";
    expect(mapMigration).toContain("private.can_read_map(map_id)");
    expect(mapMigration.match(/private\.can_read_map\(map_id\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("keeps Sharp's decompression pixel guard enabled", () => {
    const source = readFileSync(resolve(root, "server/maps/mapTilePipeline.ts"), "utf8");
    expect(source).not.toContain("limitInputPixels: false");
    expect(source).toContain("MAX_MAP_PIXELS");
  });

  it("serializes last-Owner checks with account deletion", () => {
    expect(hardeningMigration).toContain("lock table public.profiles in share row exclusive mode");
    expect(hardeningMigration).toContain("Cannot delete the last Owner");
    expect(hardeningMigration).toContain("insert into public.account_deletion_queue");
    expect(hardeningMigration).toMatch(/delete from public\.profiles where id = p_target_id/i);
  });

  it("queues Storage cleanup in the same database transaction as metadata deletion", () => {
    expect(hardeningMigration).toContain("create table if not exists public.storage_cleanup_queue");
    expect(hardeningMigration).toContain("function public.queue_shared_file_deletion");
    expect(hardeningMigration).toContain("function public.queue_town_image_deletion");
    expect(hardeningMigration).toContain("function public.queue_own_storage_cleanup");
  });

  it("keeps the full resource catalogue behind Member permissions", () => {
    expect(hardeningMigration).toContain('create policy "members read resources"');
    expect(hardeningMigration).toContain("revoke select on public.resources from anon");
    expect(hardeningMigration).toContain("function public.list_public_resource_previews");
    expect(hardeningMigration).toContain("function public.get_resource_stats");
  });

  it("binds created resource and file rows to the authenticated user", () => {
    expect(hardeningMigration.match(/created_by = \(select auth\.uid\(\)\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(hardeningMigration).toContain("resources_creator_immutable");
    expect(hardeningMigration).toContain("schematics_creator_immutable");
    expect(hardeningMigration.match(/storage\.foldername\(name\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("keeps shared update checks narrow and resource administration Owner-only", () => {
    expect(releaseMigration).toContain('create policy "creators update own resources"');
    expect(releaseMigration).toContain("function public.update_resource_check");
    expect(releaseMigration).toContain("if not private.can_use_resources()");
    expect(releaseMigration).toContain("function public.admin_update_resource_details");
    expect(releaseMigration).toContain("function public.admin_delete_resource");
    expect(releaseMigration.match(/if not private\.is_owner\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("stores Bilibili media with a unique validated BV id", () => {
    const mediaMigration = migrations.find(({ file }) => file.startsWith("202607290001"))?.sql ?? "";
    expect(mediaMigration).toContain("add column if not exists media_type");
    expect(mediaMigration).toContain("town_images_bilibili_shape_check");
    expect(mediaMigration).toMatch(/external_id\s*~\s*'\^BV\[0-9A-Za-z\]\{10\}\$'/);
    expect(mediaMigration).toContain("town_images_bilibili_external_id_key");
  });

  it("keeps material viewing and editing behind separate role boundaries", () => {
    expect(materialMigration).toMatch(/current_role\(\) in \('viewer', 'member', 'admin', 'owner'\)/);
    expect(materialMigration).toMatch(/current_role\(\) in \('member', 'admin', 'owner'\)/);
    expect(materialMigration).toContain("revoke insert, update, delete on public.material_projects");
    expect(materialMigration).toContain("if not private.can_edit_materials() then raise insufficient_privilege");
  });

  it("serializes material reservations and only ranks completed collections", () => {
    expect(materialMigration).toMatch(/from public\.material_items where id = p_item_id for update/i);
    expect(materialMigration).toContain("error.materialClaimExceeded");
    expect(materialMigration).toMatch(/where assignment\.completed\s+group by assignment\.claimant_id/i);
  });

  it("keeps the Material Page hero independently manageable", () => {
    expect(materialHeroMigration).toContain("'materialHero'");
    expect(materialHeroMigration).toContain("town_images_area_check");
  });

  it("gates temporary-password accounts in both Fastify and database authorization", () => {
    expect(workflowMigration).toMatch(/where profile\.id = auth\.uid\(\) and not profile\.must_change_password/);
    expect(workflowMigration).toContain(
      "revoke all on function public.mark_password_changed() from public, anon, authenticated, service_role"
    );
    expect(workflowMigration).toMatch(/actor_role is null or actor_role not in \('member', 'admin', 'owner'\)/);
  });

  it("keeps trusted material creation service-role-only", () => {
    expect(workflowMigration).toContain("function public.create_material_project_server");
    expect(workflowMigration).toContain("from public, anon, authenticated");
    expect(workflowMigration).toMatch(
      /grant execute on function public\.create_material_project_server[\s\S]*to service_role/
    );
    expect(workflowMigration).toContain("for update");
  });

  it("preserves completed contribution snapshots while releasing pending claims", () => {
    expect(workflowMigration).toContain("on delete set null");
    expect(workflowMigration).toMatch(
      /delete from public\.material_assignments where claimant_id = p_target_id and not completed/
    );
    expect(workflowMigration).toContain("'releasedMaterialClaims'");
  });

  it("keeps per-item batch material claims atomic and derives full capacities in the database", () => {
    expect(materialBatchMigration).toContain("p_amounts integer[]");
    expect(materialBatchMigration).toContain("if p_amounts is null then");
    expect(materialBatchMigration).toContain("for update");
    expect(materialBatchMigration).toContain("private.save_material_claim");
    expect(materialBatchMigration).not.toContain("commit;");
  });

  it("keeps destructive material project administration Owner-only", () => {
    expect(resourceAdminMigration).toContain("function public.admin_update_material_project");
    expect(resourceAdminMigration).toContain("function public.admin_delete_material_project");
    expect(resourceAdminMigration.match(/if not private\.is_owner\(\) then raise insufficient_privilege/g)?.length).toBe(2);
    expect(resourceAdminMigration).toMatch(/delete from public\.material_projects where id = p_project_id/i);
  });

  it("keeps homepage notices editable only by Owner while exposing visible rows", () => {
    expect(webDataMigration).toContain("create table if not exists public.town_announcements");
    expect(webDataMigration).toMatch(/public reads visible announcements[\s\S]*using \(is_visible\)/);
    expect(webDataMigration).toMatch(/owners read all announcements[\s\S]*using \(private\.is_owner\(\)\)/);
    expect(webDataMigration).not.toContain("is_visible or private.is_owner()");
    expect(webDataMigration).toContain("if not private.is_owner() then raise insufficient_privilege");
    expect(webDataMigration).toContain("show_on_home boolean not null default false");
  });

  it("stores only aggregate page views without visitor fingerprints", () => {
    const executableSql = webDataMigration.replace(/--.*$/gm, "");
    expect(webDataMigration).toContain("create table if not exists public.daily_page_views");
    expect(webDataMigration).toContain("function public.record_page_view");
    expect(executableSql).not.toMatch(/\b(ip_address|user_agent|fingerprint|session_id)\b/i);
    expect(webDataMigration).toContain("if not private.is_owner() then raise insufficient_privilege");
    expect(webDataMigration).toContain("generate_series");
    expect(webDataMigration).toContain("grant execute on function public.record_page_view(boolean) to service_role");
    expect(webDataMigration).not.toMatch(/grant execute on function public\.record_page_view[^;]*to anon/);
  });

  it("keeps operation snapshots immutable and prunes them after seven days", () => {
    expect(webDataMigration).toContain("function private.audit_managed_change");
    expect(webDataMigration).toContain("'before'");
    expect(webDataMigration).toContain("'after'");
    expect(webDataMigration).toMatch(/created_at < now\(\) - interval '7 days'/);
    expect(webDataMigration.match(/target_type in \('map_claim', 'map_marker', 'material', 'resource'\)/g)?.length).toBe(2);
    expect(webDataMigration).not.toMatch(/update\s+public\.audit_logs/i);
  });

  it("keeps forum identity database-owned and forum access authenticated", () => {
    expect(forumMigration).toContain("create table if not exists public.forum_posts");
    expect(forumMigration).toMatch(
      /current_role\(\) in \('viewer', 'member', 'admin', 'owner'\)/
    );
    expect(forumMigration).toMatch(
      /current_role\(\) in \('member', 'admin', 'owner'\)/
    );
    expect(forumMigration).toContain("new.author_id := actor_id");
    expect(forumMigration).toContain("new.author_username := actor_username");
    expect(forumMigration).toContain("new.author_id := old.author_id");
    expect(forumIdentityMigration).toContain("new.id := old.id");
    expect(forumAccessMigration).toContain("create or replace function public.list_forum_posts");
    expect(forumAccessMigration).toContain("safe_limit := least(safe_limit, 5)");
    expect(forumAccessMigration).toContain("safe_offset := 0");
    expect(forumAccessMigration).toContain("pg_advisory_xact_lock");
    expect(forumAccessMigration).toContain("error.forumRateLimit");
    expect(forumMigration).toContain("revoke all on public.forum_posts from public, anon");
    expect(forumMigration).toMatch(
      /author_id = \(select auth\.uid\(\)\) or private\.is_owner\(\)/
    );
  });

  it("rejects non-web protocols in Member-created resource links", () => {
    expect(resourceUrlMigration).toContain("resources_url_http_protocol");
    expect(resourceUrlMigration).toMatch(/check \(url ~\* '\^https\?:\/\//);
    expect(resourceUrlMigration).toContain("resources_icon_url_https_protocol");
  });

  it("keeps QQ identities private and locks a code after three failed attempts", () => {
    expect(qqRegistrationMigration).toContain("create table if not exists private.qq_identities");
    expect(qqRegistrationMigration).toContain("create table if not exists private.qq_verification_challenges");
    expect(qqRegistrationMigration).toContain("code_digest text not null");
    expect(qqRegistrationMigration).not.toMatch(/\bcode text\b/i);
    expect(qqRegistrationMigration).toContain("attempts between 0 and 3");
    expect(qqRegistrationMigration).toMatch(/when v_attempts >= 3 then clock_timestamp\(\)/);
    expect(qqRegistrationMigration).toContain("for update");
    expect(qqRegistrationMigration).toContain("to service_role");
    expect(qqRegistrationMigration).not.toMatch(/grant execute[^;]*to authenticated/i);
    expect(qqRegistrationMigration).toContain("qq_registration_pending boolean not null default false");
    expect(qqRegistrationMigration).toMatch(/current_role[\s\S]*not profile\.qq_registration_pending/);
  });

  it("counts failed QQ deliveries toward the daily abuse limit", () => {
    expect(qqAbuseHardeningMigration).toContain("create or replace function public.issue_qq_verification_challenge");
    expect(qqAbuseHardeningMigration).toMatch(
      /challenge\.qq_number = p_qq_number[\s\S]*challenge\.created_at > v_now - interval '1 day'\) >= 5/
    );
    expect(qqAbuseHardeningMigration).not.toMatch(
      /created_at > v_now - interval '1 day'[\s\S]{0,80}invalidated_at is null/
    );
  });

  it("exposes full QQ bindings only to the trusted service role", () => {
    expect(accountQqVisibilityMigration).toContain("function public.list_account_qq_bindings");
    expect(accountQqVisibilityMigration).toContain("from private.qq_identities");
    expect(accountQqVisibilityMigration).toMatch(
      /revoke all on function public\.list_account_qq_bindings\(\)[\s\S]*from public, anon, authenticated/
    );
    expect(accountQqVisibilityMigration).toMatch(
      /grant execute on function public\.list_account_qq_bindings\(\)[\s\S]*to service_role/
    );
    expect(accountQqVisibilityMigration).not.toMatch(/grant execute[^;]*to authenticated/i);
  });

  it("stores only masked and digested visitor identities behind the owner RPC", () => {
    expect(visitorAnalyticsMigration).toContain("private.daily_visitor_views");
    expect(visitorAnalyticsMigration).toContain("visitor_digest text not null");
    expect(visitorAnalyticsMigration).toContain("masked_ip text not null");
    expect(visitorAnalyticsMigration).not.toMatch(/\braw_ip\b|\bip_address\b/i);
    expect(visitorAnalyticsMigration).toContain("if not private.is_owner()");
    expect(visitorAnalyticsMigration).toContain("revoke all on private.daily_visitor_views from public, anon, authenticated");
    expect(visitorAnalyticsMigration).toContain("grant execute on function public.record_page_view(boolean, text, text) to service_role");
  });

  it("keeps public maps read-only and original uploads private", () => {
    expect(publicMapMigration).toContain('for select to anon, authenticated');
    expect(publicMapMigration).toContain('grant select on public.town_maps, public.map_claims, public.map_claim_cells');
    expect(publicMapMigration).toContain("(storage.foldername(storage.objects.name))[3] = 'tiles'");
    expect(publicMapMigration).not.toMatch(/grant (insert|update|delete)[^;]*to anon/i);
  });
});
