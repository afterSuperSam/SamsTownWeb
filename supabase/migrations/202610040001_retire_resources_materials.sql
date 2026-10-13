-- 资源与材料退役：核对目标、暂停写入、通过 Storage API 清理专属文件，再删除业务元数据。
-- 部署时暂停上传与清理 worker；共享图片按实际引用保留，不直接删除 storage.objects。
begin;
do $$
begin
  perform 1 from storage.buckets where id = 'schematics' for update;
  if exists (select 1 from storage.objects where bucket_id = 'schematics') then
    raise exception 'Retirement blocked: clear schematics through Storage API first';
  end if;
end;
$$;

create or replace function public.prepare_account_deletion(p_actor_id uuid, p_target_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_role public.app_role;
  target_role public.app_role;
  owner_count integer;
  transferred_maps integer := 0;
  transferred_claims integer := 0;
  transferred_markers integer := 0;
  transferred_commands integer := 0;
begin
  if p_actor_id = p_target_id then raise exception 'Cannot delete the current account'; end if;
  lock table public.profiles in share row exclusive mode;
  select role into actor_role from public.profiles where id = p_actor_id;
  if actor_role is distinct from 'owner'::public.app_role then raise insufficient_privilege; end if;
  select role into target_role from public.profiles where id = p_target_id;
  if target_role is null then
    if exists (select 1 from public.account_deletion_queue where user_id = p_target_id) then
      return jsonb_build_object('pending', true);
    end if;
    raise no_data_found;
  end if;
  if target_role = 'owner'::public.app_role then
    select count(*) into owner_count from public.profiles where role = 'owner';
    if owner_count <= 1 then raise exception 'Cannot delete the last Owner'; end if;
  end if;
  update public.town_maps set created_by = p_actor_id where created_by = p_target_id;
  get diagnostics transferred_maps = row_count;
  update public.map_claims set owner_id = p_actor_id where owner_id = p_target_id;
  get diagnostics transferred_claims = row_count;
  update public.map_markers set created_by = p_actor_id where created_by = p_target_id;
  get diagnostics transferred_markers = row_count;
  update public.server_commands set requested_by = p_actor_id where requested_by = p_target_id;
  get diagnostics transferred_commands = row_count;
  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (p_actor_id, 'account.delete.prepare', 'account', p_target_id::text, jsonb_build_object(
    'previousRole', target_role, 'transferredMaps', transferred_maps,
    'transferredClaims', transferred_claims, 'transferredMarkers', transferred_markers,
    'transferredCommands', transferred_commands
  ));
  insert into public.account_deletion_queue (user_id, requested_by)
  values (p_target_id, p_actor_id) on conflict (user_id) do nothing;
  delete from public.profiles where id = p_target_id;
  return jsonb_build_object('pending', true, 'transferredMaps', transferred_maps,
    'transferredClaims', transferred_claims, 'transferredMarkers', transferred_markers,
    'transferredCommands', transferred_commands);
end;
$$;
revoke all on function public.prepare_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid, uuid) to service_role;

create or replace function private.audit_managed_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  actor uuid;
  actor_name text;
  category text;
  action_name text;
  root_target_id text;
  target_name text;
begin
  actor := coalesce(
    auth.uid(),
    nullif(source_row ->> 'owner_id', '')::uuid,
    nullif(source_row ->> 'created_by', '')::uuid
  );
  select username into actor_name from public.profiles where id = actor;

  category := case
    when tg_table_name in ('map_claims', 'map_claim_cells') then 'map_claim'
    when tg_table_name = 'map_markers' then 'map_marker'
    else tg_table_name
  end;
  action_name := case tg_op
    when 'INSERT' then 'add'
    when 'UPDATE' then 'update'
    else 'delete'
  end;

  root_target_id := coalesce(source_row ->> 'id', source_row ->> 'claim_id');
  target_name := coalesce(source_row ->> 'name', source_row ->> 'title');

  delete from public.audit_logs
  where created_at < now() - interval '7 days'
    and target_type in ('map_claim', 'map_marker');

  insert into public.audit_logs (
    actor_id, action, target_type, target_id, details
  ) values (
    actor,
    action_name,
    category,
    coalesce(source_row ->> 'id', source_row ->> 'claim_id'),
    jsonb_build_object(
      'category', category,
      'table', tg_table_name,
      'rootTargetId', root_target_id,
      'targetName', target_name,
      'actorUsername', coalesce(actor_name, 'System'),
      'before', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'after', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.audit_managed_change() from public, anon, authenticated;

create or replace function public.prune_operation_logs()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare removed integer;
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  delete from public.audit_logs where created_at < now() - interval '7 days'
    and target_type in ('map_claim', 'map_marker');
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.prune_operation_logs() from public, anon;
grant execute on function public.prune_operation_logs() to authenticated;

create or replace function public.queue_own_storage_cleanup(p_bucket text, p_path text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_path is null or char_length(p_path) not between 1 and 512 or p_path like '%..%' then
    raise invalid_parameter_value;
  end if;
  if p_bucket is distinct from 'site-images' or not private.is_owner() then
    raise insufficient_privilege;
  end if;
  if not exists (select 1 from storage.objects where bucket_id = p_bucket and name = p_path) then
    return;
  end if;
  if (select count(*) from public.storage_cleanup_queue
      where requested_by = auth.uid() and status <> 'dead') >= 20 then
    raise exception 'error.storageCleanupRateLimit';
  end if;
  insert into public.storage_cleanup_queue
    (bucket_id, object_path, requested_by, status, next_attempt_at, locked_at, last_error)
  values (p_bucket, p_path, auth.uid(), 'pending', clock_timestamp(), null, null)
  on conflict (bucket_id, object_path, recursive) do update
  set requested_by = excluded.requested_by, status = 'pending',
    next_attempt_at = clock_timestamp(), locked_at = null, last_error = null;
end;
$$;
revoke all on function public.queue_own_storage_cleanup(text, text) from public, anon;
grant execute on function public.queue_own_storage_cleanup(text, text) to authenticated, service_role;

-- 清除退役栏目内容与审计快照，保留账户、地图等共享业务记录。
update public.site_content site
set content = (site.content - array['resources', 'materials', 'schematics', 'resourceHero', 'materialHero'])
  || case when jsonb_typeof(site.content -> 'translations') = 'object' then
    jsonb_build_object('translations', coalesce((
      select jsonb_object_agg(entry.key, entry.value)
      from jsonb_each(site.content -> 'translations') entry
      where entry.key !~ '^(resources|materials|schematics|admin\.resources)\.'
        and entry.key not in ('app.nav.resources', 'app.nav.materials', 'admin.nav.resources',
          'admin.images.area.resources', 'admin.images.area.materialHero',
          'admin.analytics.category.material', 'admin.analytics.category.resource',
          'admin.analytics.table.material_projects', 'admin.analytics.table.material_items',
          'admin.analytics.table.material_assignments', 'admin.analytics.table.resources',
          'admin.analytics.table.schematics', 'error.duplicateResource', 'error.invalidResourceDetails',
          'error.invalidProjectUrl', 'error.invalidModrinthUrl', 'error.invalidGithubUrl',
          'error.projectMetadata', 'error.requiredFile', 'error.fileTooLarge')
        and entry.key !~ '^error\.(resource|material|schematic|invalidMaterial)'
    ), '{}'::jsonb)) else '{}'::jsonb end;
delete from public.audit_logs
where target_type in ('material', 'resource', 'schematic', 'resources', 'schematics',
    'material_projects', 'material_items', 'material_assignments')
  or details ->> 'category' in ('material', 'resource', 'schematic')
  or details ->> 'table' in ('resources', 'schematics', 'material_projects', 'material_items', 'material_assignments');
update public.audit_logs set details = details - 'releasedMaterialClaims'
where details ? 'releasedMaterialClaims';

create temporary table retirement_storage_candidates (
  bucket_id text not null, object_path text not null, primary key (bucket_id, object_path)
) on commit drop;
insert into retirement_storage_candidates
select 'schematics', name from storage.objects where bucket_id = 'schematics'
union select 'schematics', storage_path from public.schematics
union select 'schematics', projection_storage_path from public.material_projects
  where projection_storage_path is not null;
insert into retirement_storage_candidates
select 'site-images', storage_path from public.town_images
where area in ('resources', 'materialHero') and storage_path is not null
on conflict do nothing;
-- SQL 不推测项目域名：URL 只能产生保守阻断候选；物理删除由严格同项目的脚本负责。
create function pg_temp.retirement_decode_storage_path(encoded_path text, strict_encoding boolean default false)
returns text language plpgsql set search_path = ''
as $$
declare
  encoded_run text;
  character_index integer := 1;
  decoded_path text := '';
  decoded_run text;
begin
  while character_index <= char_length(encoded_path) loop
    encoded_run := (regexp_match(substr(encoded_path, character_index), '^(?:%[0-9a-fA-F]{2})+'))[1];
    if encoded_run is null then
      decoded_path := decoded_path || substr(encoded_path, character_index, 1);
      character_index := character_index + 1;
    else
      begin
        decoded_run := convert_from(decode(replace(encoded_run, '%', ''), 'hex'), 'UTF8');
      exception when data_exception then
        if strict_encoding then return null; end if;
        decoded_run := encoded_run;
      end;
      decoded_path := decoded_path || decoded_run;
      character_index := character_index + char_length(encoded_run);
    end if;
  end loop;
  return decoded_path;
end;
$$;
create function pg_temp.retirement_url_path(url text)
returns text language plpgsql set search_path = ''
as $$
declare encoded_path text; decoded_path text;
begin
  encoded_path := (regexp_match(url,
    '^https?://[^/@?#[:space:]]+/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/site-images/([^?#]+)(?:[?#].*)?$', 'i'))[1];
  if encoded_path is null or strpos(regexp_replace(encoded_path, '%[0-9a-fA-F]{2}', '', 'g'), '%') > 0 then return null; end if;
  decoded_path := pg_temp.retirement_decode_storage_path(encoded_path, true);
  -- 解码失败时只忽略阻断候选，不据此删除任何文件。
  if decoded_path is null or decoded_path ~ '[[:cntrl:]\\]'
    or decoded_path ~ '(^|/)(\.|\.\.|)(/|$)' then return null; end if;
  return decoded_path;
end;
$$;
insert into retirement_storage_candidates
select 'site-images', pg_temp.retirement_url_path(url)
from (
  select icon_url as url from public.resources union select url from public.resources
  union select image_url from public.material_items
  union select source_url from public.town_images where area in ('resources', 'materialHero')
) urls
where pg_temp.retirement_url_path(url) is not null
on conflict do nothing;
create temporary table retirement_cleanup_paths on commit drop as select * from retirement_storage_candidates;
-- 只扫描真实字符串值，不扫描 JSON 键；编码正文与序列化 JSON 同样属于共享引用。
create temporary table retirement_surviving_references (document text not null) on commit drop;
create function pg_temp.retirement_reference_strings(value jsonb, depth integer default 0)
returns setof text language plpgsql set search_path = ''
as $$
declare item jsonb; variant text; decoded text; parsed jsonb; level integer;
begin
  if depth > 64 then raise exception 'Retirement blocked: reference nesting limit'; end if;
  if jsonb_typeof(value) = 'object' then
    for item in select entry.value from jsonb_each(value) entry loop
      return query select pg_temp.retirement_reference_strings(item, depth + 1);
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for item in select * from jsonb_array_elements(value) loop
      return query select pg_temp.retirement_reference_strings(item, depth + 1);
    end loop;
  elsif jsonb_typeof(value) = 'string' then
    variant := value #>> '{}';
    for level in 1..4 loop
      return next variant;
      if variant ~ '^\s*[\[{]' then
        parsed := null;
        begin parsed := variant::jsonb; exception when data_exception then null; end;
        if jsonb_typeof(parsed) in ('object', 'array') then
          return query select pg_temp.retirement_reference_strings(parsed, depth + 1);
        end if;
      end if;
      decoded := pg_temp.retirement_decode_storage_path(variant);
      exit when decoded = variant;
      variant := decoded;
    end loop;
  end if;
end;
$$;
create function pg_temp.retirement_encode_uri(value text, component boolean)
returns text language plpgsql immutable strict set search_path = ''
as $$
declare
  bytes bytea := convert_to(value, 'UTF8');
  encoded text := '';
  allowed text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*''()';
  byte_index integer; byte_value integer;
begin
  if not component then allowed := allowed || ';/?:@&=+$,#'; end if;
  for byte_index in 0..length(bytes)-1 loop
    byte_value := get_byte(bytes, byte_index);
    if byte_value > 0 and byte_value < 128 and strpos(allowed, chr(byte_value)) > 0 then
      encoded := encoded || chr(byte_value);
    else encoded := encoded || '%' || upper(lpad(to_hex(byte_value), 2, '0'));
    end if;
  end loop;
  return encoded;
end;
$$;
create function pg_temp.retirement_has_reference(value text)
returns boolean language sql stable set search_path = ''
as $$
  select value is not null and value <> '' and exists (
    select 1 from pg_temp.retirement_surviving_references where strpos(document, value) > 0
      or strpos(document, pg_temp.retirement_encode_uri(value, false)) > 0
      or strpos(document, pg_temp.retirement_encode_uri(value, true)) > 0
  );
$$;
do $$
declare relation record;
begin
  for relation in select tablename from pg_tables where schemaname = 'public'
    and tablename not in ('resources', 'schematics', 'material_projects', 'material_items',
      'material_assignments', 'town_images', 'storage_cleanup_queue')
  loop
    execute format('insert into pg_temp.retirement_surviving_references select pg_temp.retirement_reference_strings(to_jsonb(source_row)) from public.%I source_row on conflict do nothing', relation.tablename);
  end loop;
end;
$$;
insert into retirement_surviving_references
select pg_temp.retirement_reference_strings(to_jsonb(image))
from public.town_images image where area not in ('resources', 'materialHero') on conflict do nothing;
-- 清理队列是删除任务，不是共享使用；仅真实存活内容能保护候选文件。
-- 共享旧图片逐轮闭包：保留 ID 的同时保留其路径、URL 及其他图片引用。
create temporary table retirement_shared_images (id uuid primary key, processed boolean default false) on commit drop;
do $$
declare added integer;
begin
  loop
    insert into retirement_shared_images (id)
    select image.id from public.town_images image where image.area in ('resources', 'materialHero')
      and (pg_temp.retirement_has_reference(image.id::text)
        or pg_temp.retirement_has_reference(image.storage_path)
        or pg_temp.retirement_has_reference(image.source_url)) on conflict do nothing;
    get diagnostics added = row_count;
    exit when added = 0;
    insert into retirement_surviving_references
    select pg_temp.retirement_reference_strings(to_jsonb(image)) from public.town_images image
    join retirement_shared_images shared on shared.id = image.id where not shared.processed on conflict do nothing;
    update retirement_shared_images set processed = true;
  end loop;
  if exists (select 1 from retirement_surviving_references where strpos(document, 'schematics/') > 0)
    or exists (select 1 from retirement_storage_candidates where bucket_id = 'schematics'
      and pg_temp.retirement_has_reference(object_path)) then
    raise exception 'Retirement blocked: surviving schematics reference';
  end if;
end;
$$;
update public.town_images image set area = case
  when exists (select 1 from public.town_history where image_id = image.id) then 'history'
  else 'gallery' end
where image.id in (select id from retirement_shared_images);
delete from retirement_storage_candidates candidate
where candidate.bucket_id = 'site-images' and pg_temp.retirement_has_reference(candidate.object_path);

-- 仅核查元数据，文件必须由 Storage API 先清理；外站 URL 同名对象会保守阻断。
do $$
begin
  if exists (
    select 1 from storage.objects object join pg_temp.retirement_storage_candidates candidate
      on candidate.bucket_id = object.bucket_id and candidate.object_path = object.name
  ) then
    raise exception 'Retirement blocked: clear exclusive site-images through Storage API first';
  end if;
end;
$$;
-- 共享候选也取消旧待删映射，防止重分类后被后台队列误删。
delete from public.storage_cleanup_queue queue
where queue.bucket_id = 'schematics'
  or exists (select 1 from retirement_cleanup_paths candidate
    where candidate.bucket_id = queue.bucket_id and candidate.object_path = queue.object_path);
delete from public.town_images where area in ('resources', 'materialHero');
alter table public.town_images drop constraint if exists town_images_area_check;
alter table public.town_images add constraint town_images_area_check
  check (area in ('hero', 'story', 'gallery', 'join', 'history', 'mapHero', 'forumHero', 'other'));
drop function pg_temp.retirement_has_reference(text);
drop function pg_temp.retirement_encode_uri(text, boolean);
drop function pg_temp.retirement_reference_strings(jsonb, integer);
drop function pg_temp.retirement_url_path(text);
drop function pg_temp.retirement_decode_storage_path(text, boolean);

-- 专属 bucket 策略精确移除，共享 Storage 与地图策略不受影响。
drop policy if exists "public downloads schematics" on storage.objects;
drop policy if exists "editors upload schematics" on storage.objects;
drop policy if exists "editors update schematics" on storage.objects;
drop policy if exists "editors delete schematics" on storage.objects;
drop policy if exists "members download shared files" on storage.objects;
drop policy if exists "members upload shared files" on storage.objects;
drop policy if exists "members update shared files" on storage.objects;
drop policy if exists "owners delete shared files" on storage.objects;

-- 按精确名称枚举全部签名，涵盖历史重载；RESTRICT 遇到未识别依赖即回滚。
do $$
declare routine record;
begin
  for routine in
    select namespace.nspname, procedure.proname, pg_get_function_identity_arguments(procedure.oid) arguments
    from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname in (
      'list_resource_loaders', 'list_public_resource_previews', 'get_resource_stats',
      'update_resource_check', 'admin_update_resource_details', 'admin_delete_resource',
      'queue_shared_file_deletion', 'create_material_project', 'create_material_project_server',
      'update_material_project', 'admin_update_material_project', 'admin_delete_material_project',
      'update_material_projection', 'set_material_claim', 'set_material_claims',
      'set_material_claim_completed', 'set_material_claims_completed', 'get_material_workspace'
    )
  loop
    execute format('drop function %I.%I(%s) restrict', routine.nspname, routine.proname, routine.arguments);
  end loop;
end;
$$;
drop table if exists public.material_assignments restrict;
drop table if exists public.material_items restrict;
drop table if exists public.material_projects restrict;
drop table if exists public.schematics restrict;
drop table if exists public.resources restrict;
drop function if exists private.save_material_claim(uuid, uuid, integer, text) restrict;
drop function if exists private.can_view_materials() restrict;
drop function if exists private.can_edit_materials() restrict;
drop function if exists private.can_use_resources() restrict;
drop type if exists public.resource_source restrict;

-- PL/pgSQL 的文本依赖不一定登记在 pg_depend，额外核对存活函数体。
do $$
declare remaining_functions text;
begin
  select string_agg(namespace.nspname || '.' || routine.proname, ', ')
  into remaining_functions
  from pg_proc routine join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname in ('public', 'private') and routine.prokind in ('f', 'p')
    and pg_get_functiondef(routine.oid) ~ '\m(material_projects|material_items|material_assignments|schematics|resources|can_use_resources|can_view_materials|can_edit_materials|save_material_claim)\M';
  if remaining_functions is not null then
    raise exception 'Retirement blocked: remaining function references: %', remaining_functions;
  end if;
end;
$$;

-- Storage 元数据由 Supabase Storage 触发器保护，不能在 SQL 迁移内直接删除。
-- 这里仅验证 bucket 为空；部署方随后通过 Storage API 删除退役 bucket。
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'schematics') then
    raise exception 'Retirement blocked: schematics bucket must remain empty';
  end if;
end;
$$;
commit;
