begin;

-- 密码重置使旧会话失效；数据库写入和服务端改密使用同一判据。
alter table public.profiles add column sessions_valid_after timestamptz not null default '-infinity';
create function public.is_current_auth_session(p_user_id uuid, p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.sessions session join public.profiles profile on profile.id = session.user_id
    where session.id = p_session_id and session.user_id = p_user_id
      and session.created_at >= profile.sessions_valid_after
      and (session.not_after is null or session.not_after > now()));
$$;
revoke all on function public.is_current_auth_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_current_auth_session(uuid, uuid) to service_role;
create or replace function private.current_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select profile.role from public.profiles profile where profile.id = auth.uid() and not profile.must_change_password
    and public.is_current_auth_session(profile.id, nullif(auth.jwt() ->> 'session_id', '')::uuid);
$$;

-- 本人改名同样拒绝已失效会话，避免绕过服务端的改密门禁。
create or replace function public.update_own_username(next_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare normalized text := trim(next_username);
begin
  if private.current_role() is null then raise insufficient_privilege; end if;
  if char_length(normalized) not between 2 and 32 or normalized !~ '^[[:alnum:]_-]+$' then
    raise exception 'Invalid username';
  end if;
  update public.profiles set username = normalized where id = auth.uid() and not must_change_password;
  if not found then raise insufficient_privilege; end if;
exception when unique_violation then
  raise exception 'Username already exists' using errcode = '23505';
end;
$$;
revoke all on function public.update_own_username(text) from public, anon;
grant execute on function public.update_own_username(text) to authenticated;

-- 限制新写入的长文本；已有内容不截断，修改时须满足相同上限。
alter table public.map_claims add constraint map_claim_description_length check (char_length(description) <= 4000) not valid;
alter table public.town_maps add constraint town_map_description_length check (char_length(description) <= 4000) not valid;

-- 同一语句读取项目与区块，避免分页期间的并发变更产生不完整边界。
create function public.get_map_snapshot(p_map_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('projects', coalesce(jsonb_agg(to_jsonb(project) || jsonb_build_object('cells', coalesce((
    select jsonb_agg(jsonb_build_object('column', cell.chunk_column, 'row', cell.chunk_row)
      order by cell.chunk_row, cell.chunk_column)
    from public.map_claim_cells cell where cell.map_id = p_map_id and cell.claim_id = project.id
  ), '[]'::jsonb)) order by project.id), '[]'::jsonb))
  from public.map_claims project where project.map_id = p_map_id;
$$;
revoke all on function public.get_map_snapshot(uuid) from public;
grant execute on function public.get_map_snapshot(uuid) to anon, authenticated;

-- 内容集合只开放白名单；完整快照不受 PostgREST 行数上限截断。
create function public.get_site_collection(p_collection text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare items jsonb;
begin
  if p_collection is null or p_collection not in ('town_members', 'town_history', 'faq_items') then raise invalid_parameter_value; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(item) order by sort_order, id), ''[]''::jsonb) from public.%I item', p_collection) into items;
  return jsonb_build_object('items', items, 'revision', md5(items::text));
end;
$$;
revoke all on function public.get_site_collection(text) from public;
grant execute on function public.get_site_collection(text) to anon, authenticated;
create function public.save_site_collection(p_collection text, p_revision text, p_items jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  if p_collection is null or p_collection not in ('town_members', 'town_history', 'faq_items')
    or p_items is null or jsonb_typeof(p_items) <> 'array' then raise invalid_parameter_value; end if;
  execute format('lock table public.%I in share row exclusive mode', p_collection);
  if p_revision is distinct from (public.get_site_collection(p_collection) ->> 'revision') then
    raise exception 'error.contentChanged';
  end if;
  case p_collection
    when 'town_members' then perform public.replace_town_members(p_items);
    when 'town_history' then perform public.replace_town_history(p_items);
    when 'faq_items' then perform public.replace_faq_items(p_items);
  end case;
  return public.get_site_collection(p_collection) ->> 'revision';
end;
$$;
revoke all on function public.save_site_collection(text, text, jsonb) from public, anon;
grant execute on function public.save_site_collection(text, text, jsonb) to authenticated;

-- 账号清理保留媒体，由仍在任的管理员接收对象所有权；同时兼容已入队的旧任务。
create function public.transfer_account_storage(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare recipient uuid;
begin
  select profile.id into recipient from public.account_deletion_queue queue join public.profiles profile
    on profile.role = 'owner' and profile.id <> p_user_id
  where queue.user_id = p_user_id
  order by (profile.id = queue.requested_by) desc, profile.created_at, profile.id limit 1;
  if recipient is null then raise exception 'Account cleanup has no remaining owner'; end if;
  update storage.objects set owner = recipient, owner_id = recipient::text
    where owner = p_user_id or owner_id = p_user_id::text;
end;
$$;
revoke all on function public.transfer_account_storage(uuid) from public, anon, authenticated;
grant execute on function public.transfer_account_storage(uuid) to service_role;

-- 地图切片回收与地图变更同事务入队，进程中断也不会丢失回收任务。
create function private.queue_replaced_map_storage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.storage_prefix is distinct from new.storage_prefix then
    insert into public.storage_cleanup_queue (bucket_id, object_path, recursive)
    values ('town-maps', old.storage_prefix, true) on conflict (bucket_id, object_path, recursive) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.queue_replaced_map_storage() from public, anon, authenticated;
create trigger queue_replaced_map_storage after update of storage_prefix or delete on public.town_maps
  for each row execute function private.queue_replaced_map_storage();

create function public.commit_town_map_image_v2(
  p_map_id uuid, p_image_width integer, p_image_height integer, p_tile_size integer,
  p_max_level integer, p_tile_revision uuid, p_original_path text, p_storage_prefix text,
  p_clear_existing boolean, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous_map public.town_maps; updated_map public.town_maps; dimensions_changed boolean;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'owner' and not must_change_password) then
    raise insufficient_privilege;
  end if;
  perform set_config('yingwu.actor_id', p_actor_id::text, true);
  select * into previous_map from public.town_maps where id = p_map_id for update;
  if not found then raise no_data_found; end if;
  dimensions_changed := previous_map.image_width <> p_image_width or previous_map.image_height <> p_image_height;
  if dimensions_changed and not p_clear_existing then raise exception 'error.mapDimensionsChanged'; end if;
  if dimensions_changed then delete from public.map_claims where map_id = p_map_id; end if;
  update public.town_maps set image_width = p_image_width, image_height = p_image_height,
    tile_size = p_tile_size, max_level = p_max_level, tile_revision = p_tile_revision,
    original_path = p_original_path, storage_prefix = p_storage_prefix
  where id = p_map_id returning * into updated_map;
  return jsonb_build_object('map', to_jsonb(updated_map));
end;
$$;
revoke all on function public.commit_town_map_image_v2(uuid, integer, integer, integer, integer, uuid, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.commit_town_map_image_v2(uuid, integer, integer, integer, integer, uuid, text, text, boolean, uuid) to service_role;

create function public.delete_town_map(p_map_id uuid, p_confirm_name text, p_storage_prefix text, p_actor_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'owner' and not must_change_password) then
    raise insufficient_privilege;
  end if;
  perform set_config('yingwu.actor_id', p_actor_id::text, true);
  delete from public.town_maps where id = p_map_id and name = p_confirm_name and storage_prefix = p_storage_prefix;
  if not found then raise exception 'error.mapDataChanged'; end if;
end;
$$;
revoke all on function public.delete_town_map(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.delete_town_map(uuid, text, text, uuid) to service_role;

-- 可信服务端事务传递操作人，普通客户端仍以自己的 JWT 身份记录。
create or replace function private.audit_managed_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  actor uuid; actor_name text; category text;
begin
  actor := coalesce(auth.uid(), case when auth.role() = 'service_role'
    then nullif(current_setting('yingwu.actor_id', true), '')::uuid end,
    nullif(source_row ->> 'owner_id', '')::uuid, nullif(source_row ->> 'created_by', '')::uuid);
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

commit;
