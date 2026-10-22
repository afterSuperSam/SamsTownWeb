-- 角色归并和地图项目简化；生产应用前备份标记与项目状态，历史迁移保持不变。
begin;

update public.profiles set role = 'member' where role in ('viewer', 'admin');
alter table public.profiles alter column role set default 'member';
alter table public.profiles add constraint profiles_active_role_check check (role in ('member', 'owner'));

create or replace function private.can_view_maps()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.current_role() in ('member', 'owner'), false); $$;
create or replace function private.can_claim_maps()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.current_role() in ('member', 'owner'), false); $$;
create or replace function private.can_manage_maps()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.current_role() = 'owner', false); $$;

-- 删除带旧状态／标记参数的入口，不留下可继续调用的重载。
drop function public.save_map_claim(uuid, uuid, text, text, text, text, text, jsonb, uuid);
drop function public.list_map_claim_summaries(uuid, text, text, text, text, boolean, integer, integer, text);
drop function public.get_map_viewport(uuid, integer, integer, integer, integer, integer, integer, text);
drop function public.get_map_occupancy(uuid, integer);
drop function public.commit_town_map_image(uuid, integer, integer, integer, integer, uuid, text, text, boolean);
drop table public.map_markers;
alter table public.map_claims drop column status;

create function public.save_map_claim(
  p_claim_id uuid, p_map_id uuid, p_project_name text, p_minecraft_username text,
  p_description text, p_color text, p_cells jsonb, p_owner_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  resolved_id uuid;
  resolved_owner uuid;
  conflict_cells jsonb;
begin
  if not private.can_claim_maps() then raise insufficient_privilege; end if;
  if p_cells is null or jsonb_typeof(p_cells) <> 'array' then
    raise invalid_parameter_value using message = 'Invalid project cells';
  end if;
  resolved_owner := auth.uid();
  if p_claim_id is not null then
    select owner_id into resolved_owner from public.map_claims
    where id = p_claim_id and map_id = p_map_id for update;
    if not found then raise no_data_found; end if;
    if resolved_owner <> auth.uid() and not private.can_manage_maps() then raise insufficient_privilege; end if;
  end if;
  if private.can_manage_maps() and p_owner_id is not null then resolved_owner := p_owner_id; end if;
  if p_claim_id is null then
    insert into public.map_claims (map_id, owner_id, project_name, minecraft_username, description, color)
    values (p_map_id, resolved_owner, trim(p_project_name), trim(p_minecraft_username), coalesce(p_description, ''), p_color)
    returning id into resolved_id;
  else
    update public.map_claims set owner_id = resolved_owner, project_name = trim(p_project_name),
      minecraft_username = trim(p_minecraft_username), description = coalesce(p_description, ''), color = p_color
    where id = p_claim_id and map_id = p_map_id returning id into resolved_id;
    if resolved_id is null then raise no_data_found; end if;
  end if;
  delete from public.map_claim_cells cell where cell.claim_id = resolved_id and not exists (
    select 1 from jsonb_array_elements(p_cells) item
    where (item ->> 'column')::integer = cell.chunk_column and (item ->> 'row')::integer = cell.chunk_row
  );
  insert into public.map_claim_cells (claim_id, map_id, chunk_column, chunk_row)
  select resolved_id, p_map_id, (item ->> 'column')::integer, (item ->> 'row')::integer
  from jsonb_array_elements(p_cells) item on conflict (map_id, chunk_column, chunk_row) do nothing;
  select coalesce(jsonb_agg(jsonb_build_object(
    'column', (item ->> 'column')::integer, 'row', (item ->> 'row')::integer)), '[]'::jsonb)
  into conflict_cells from jsonb_array_elements(p_cells) item join public.map_claim_cells occupied
    on occupied.map_id = p_map_id and occupied.chunk_column = (item ->> 'column')::integer
      and occupied.chunk_row = (item ->> 'row')::integer and occupied.claim_id <> resolved_id;
  if not exists (select 1 from public.map_claim_cells where claim_id = resolved_id) then
    delete from public.map_claims where id = resolved_id;
    resolved_id := null;
  end if;
  return jsonb_build_object('claimId', resolved_id, 'conflicts', conflict_cells);
end;
$$;
revoke all on function public.save_map_claim(uuid, uuid, text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.save_map_claim(uuid, uuid, text, text, text, text, jsonb, uuid) to authenticated, service_role;

create function public.list_map_claim_summaries(
  p_map_id uuid, p_query text default '', p_offset integer default 0, p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not private.can_read_map(p_map_id) then raise insufficient_privilege using message = 'Map access denied'; end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 100
    or p_query is null or char_length(p_query) > 200 then
    raise invalid_parameter_value using message = 'Invalid project list filters';
  end if;
  with filtered as (
    select project.* from public.map_claims project where project.map_id = p_map_id
      and (p_query = '' or strpos(lower(project.project_name), lower(p_query)) > 0)
  ), page as (
    select * from filtered order by updated_at desc, id limit p_limit offset p_offset
  ), summaries as (
    select to_jsonb(page) || jsonb_build_object('cellCount', geometry.count, 'bounds',
      case when geometry.count = 0 then null else jsonb_build_object('minColumn', geometry.min_column,
        'minRow', geometry.min_row, 'maxColumn', geometry.max_column, 'maxRow', geometry.max_row) end) as value,
      page.updated_at, page.id
    from page cross join lateral (
      select count(*) as count, min(cell.chunk_column) as min_column, min(cell.chunk_row) as min_row,
        max(cell.chunk_column) as max_column, max(cell.chunk_row) as max_row
      from public.map_claim_cells cell where cell.map_id = p_map_id and cell.claim_id = page.id
    ) geometry
  )
  select jsonb_build_object('items', coalesce((select jsonb_agg(value order by updated_at desc, id) from summaries), '[]'::jsonb),
    'total', (select count(*) from filtered)) into result;
  return result;
end;
$$;
revoke all on function public.list_map_claim_summaries(uuid, text, integer, integer) from public;
grant execute on function public.list_map_claim_summaries(uuid, text, integer, integer) to anon, authenticated, service_role;

-- 地图替换和账号删除仍为服务端专用，不再访问已退役标记。
create or replace function public.commit_town_map_image_v2(
  p_map_id uuid, p_image_width integer, p_image_height integer, p_tile_size integer,
  p_max_level integer, p_tile_revision uuid, p_original_path text, p_storage_prefix text, p_clear_existing boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  previous_map public.town_maps;
  updated_map public.town_maps;
  dimensions_changed boolean;
begin
  select * into previous_map from public.town_maps where id = p_map_id for update;
  if not found then raise no_data_found; end if;
  dimensions_changed := previous_map.image_width <> p_image_width or previous_map.image_height <> p_image_height;
  if dimensions_changed and not p_clear_existing then raise exception 'error.mapDimensionsChanged'; end if;
  if dimensions_changed then delete from public.map_claims where map_id = p_map_id; end if;
  update public.town_maps set image_width = p_image_width, image_height = p_image_height,
    tile_size = p_tile_size, max_level = p_max_level, tile_revision = p_tile_revision,
    original_path = p_original_path, storage_prefix = p_storage_prefix
  where id = p_map_id returning * into updated_map;
  return jsonb_build_object('map', to_jsonb(updated_map), 'replacedStoragePrefix', previous_map.storage_prefix);
end;
$$;

create or replace function public.prepare_account_deletion(p_actor_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor_role public.app_role;
  target_role public.app_role;
  owner_count integer;
  transferred_maps integer := 0;
  transferred_projects integer := 0;
  transferred_commands integer := 0;
begin
  if p_actor_id = p_target_id then raise exception 'Cannot delete the current account'; end if;
  lock table public.profiles in share row exclusive mode;
  select role into actor_role from public.profiles where id = p_actor_id and not must_change_password;
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
  get diagnostics transferred_projects = row_count;
  update public.server_commands set requested_by = p_actor_id where requested_by = p_target_id;
  get diagnostics transferred_commands = row_count;
  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (p_actor_id, 'account.delete.prepare', 'account', p_target_id::text, jsonb_build_object(
    'previousRole', target_role, 'transferredMaps', transferred_maps,
    'transferredProjects', transferred_projects, 'transferredCommands', transferred_commands));
  insert into public.account_deletion_queue (user_id, requested_by)
  values (p_target_id, p_actor_id) on conflict (user_id) do nothing;
  delete from public.profiles where id = p_target_id;
  return jsonb_build_object('pending', true, 'transferredMaps', transferred_maps,
    'transferredProjects', transferred_projects, 'transferredCommands', transferred_commands);
end;
$$;

-- 操作日志采用项目术语；历史日志保留，原文快照不重写。
update public.audit_logs set target_type = 'map_project' where target_type = 'map_claim';
create or replace function private.audit_managed_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  source_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  actor uuid;
  actor_name text;
  category text;
begin
  actor := coalesce(auth.uid(), nullif(source_row ->> 'owner_id', '')::uuid, nullif(source_row ->> 'created_by', '')::uuid);
  select username into actor_name from public.profiles where id = actor;
  category := case when tg_table_name in ('map_claims', 'map_claim_cells') then 'map_project' else tg_table_name end;
  delete from public.audit_logs where created_at < now() - interval '7 days' and target_type in ('map_project', 'map_marker');
  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (actor, case tg_op when 'INSERT' then 'add' when 'UPDATE' then 'update' else 'delete' end,
    category, coalesce(source_row ->> 'id', source_row ->> 'claim_id'),
    jsonb_build_object('category', category, 'table', tg_table_name,
      'rootTargetId', coalesce(source_row ->> 'id', source_row ->> 'claim_id'),
      'targetName', coalesce(source_row ->> 'project_name', source_row ->> 'name', source_row ->> 'title'),
      'actorUsername', coalesce(actor_name, 'System'),
      'before', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'after', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end));
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create or replace function public.prune_operation_logs()
returns integer language plpgsql security definer set search_path = ''
as $$
declare removed integer;
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  delete from public.audit_logs where created_at < now() - interval '7 days' and target_type in ('map_project', 'map_marker');
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- 清除废弃筛选和旧认领文案覆盖，继续使用客户端的项目术语。
update public.site_content set content = jsonb_set(content, '{translations}', coalesce((
  select jsonb_object_agg(entry.key, entry.value)
  from jsonb_each(content -> 'translations') entry
  where entry.key not like 'map.status.%' and entry.key not like 'map.marker.%'
    and entry.key not like 'map.claim.%'
    and entry.key not in ('map.body', 'map.sidebar.claims', 'map.sidebar.search',
      'map.sidebar.markers', 'map.sidebar.mine', 'map.sidebar.allStatuses', 'map.sidebar.allColors',
      'map.sidebar.allMembers', 'map.toolbar.addMarker', 'map.toolbar.addClaim',
      'map.workspaceDescription', 'map.loginHint', 'map.denied')
), '{}'::jsonb))
where jsonb_typeof(content -> 'translations') = 'object';

commit;
