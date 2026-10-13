-- 只在 database-bootstrap.sql 创建的隔离数据库中运行；所有夹具最终回滚。
begin;
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-4000-8000-000000000001', 'fixture@example.test',
  '{"username":"SqlFixture"}', '{"yingwu_trusted_provisioning":true}');
update public.profiles set role = 'member', must_change_password = false
where id = '00000000-0000-4000-8000-000000000001';
insert into public.town_maps (id, name, image_width, image_height, max_level,
  original_path, storage_prefix, created_by, is_visible)
values
  ('00000000-0000-4000-8000-000000000010', 'Fixture Visible', 4096, 4096, 12,
    'fixture/visible/original.png', 'fixture/visible', '00000000-0000-4000-8000-000000000001', true),
  ('00000000-0000-4000-8000-000000000020', 'Fixture Other', 4096, 4096, 12,
    'fixture/other/original.png', 'fixture/other', '00000000-0000-4000-8000-000000000001', true),
  ('00000000-0000-4000-8000-000000000030', 'Fixture Hidden', 4096, 4096, 12,
    'fixture/hidden/original.png', 'fixture/hidden', '00000000-0000-4000-8000-000000000001', false);
insert into public.map_claims (id, map_id, owner_id, project_name, minecraft_username, color)
select md5('fixture-claim-' || item)::uuid, '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001', 'Project ' || item, 'SqlFixture', '#d38d42'
from generate_series(0, 1030) item;
insert into public.map_claim_cells (claim_id, map_id, chunk_column, chunk_row)
select md5('fixture-claim-' || item)::uuid, '00000000-0000-4000-8000-000000000010',
  item % 64, item / 64 from generate_series(0, 1030) item;
-- 单条跨视口领地验证完整详情，独立地图保持原有列表总数不变。
insert into public.map_claims (id, map_id, owner_id, project_name, minecraft_username, color)
values
  (md5('fixture-large-claim')::uuid, '00000000-0000-4000-8000-000000000020',
    '00000000-0000-4000-8000-000000000001', 'Large project', 'SqlFixture', '#d38d42'),
  (md5('fixture-hidden-claim')::uuid, '00000000-0000-4000-8000-000000000030',
    '00000000-0000-4000-8000-000000000001', 'Hidden project', 'SqlFixture', '#d38d42');
insert into public.map_claim_cells (claim_id, map_id, chunk_column, chunk_row)
select md5('fixture-large-claim')::uuid, '00000000-0000-4000-8000-000000000020',
  item % 64, item / 64 from generate_series(0, 1030) item;
insert into public.map_claim_cells (claim_id, map_id, chunk_column, chunk_row)
values (md5('fixture-hidden-claim')::uuid, '00000000-0000-4000-8000-000000000030', 0, 0);
insert into public.map_markers (id, map_id, name, icon_type, color, pixel_x, pixel_y, created_by)
select md5('fixture-marker-' || item)::uuid, '00000000-0000-4000-8000-000000000010',
  'Marker ' || item, 'other', '#d38d42', (item % 64) * 16 + 8, (item / 64) * 16 + 8,
  '00000000-0000-4000-8000-000000000001' from generate_series(0, 1030) item;
insert into public.map_markers (map_id, name, icon_type, color, pixel_x, pixel_y, created_by)
values ('00000000-0000-4000-8000-000000000030', 'Hidden marker', 'other', '#d38d42', 8, 8,
  '00000000-0000-4000-8000-000000000001');

set local role anon;
do $$
declare result jsonb; page jsonb; count_cells integer; unique_markers integer; hidden_query text; unique_cells integer;
begin
  if has_schema_privilege(current_user, 'private', 'usage') then
    raise exception 'Anonymous fixture must not have private schema usage';
  end if;
  result := public.list_map_claim_summaries('00000000-0000-4000-8000-000000000010');
  if (result ->> 'total')::integer <> 1031 or jsonb_array_length(result -> 'items') <> 30 then
    raise exception 'Full-map summaries were truncated';
  end if;
  result := public.list_map_claim_summaries('00000000-0000-4000-8000-000000000010', p_query => 'Project 1030');
  if (result ->> 'total')::integer <> 1 then raise exception 'Global search failed'; end if;
  result := public.list_map_claim_summaries('00000000-0000-4000-8000-000000000010', p_offset => 1020);
  if (result ->> 'total')::integer <> 1031 or jsonb_array_length(result -> 'items') <> 11 then
    raise exception 'Full-map summary final page failed';
  end if;
  -- 有界区域内的格子按 row/column 稳定分页，跨页总数和版本保持一致。
  result := public.get_map_viewport('00000000-0000-4000-8000-000000000010', 0, 0, 63, 32, 0, 1000, 'claims');
  page := public.get_map_viewport('00000000-0000-4000-8000-000000000010', 0, 0, 63, 32, 1000, 1000, 'claims');
  select count(*) into count_cells from jsonb_array_elements(result -> 'claims') claim,
    jsonb_array_elements(claim -> 'cells');
  if count_cells <> 1000 or not (result ->> 'hasMore')::boolean then raise exception 'Viewport first cell page failed'; end if;
  select count(*) into count_cells from jsonb_array_elements(page -> 'claims') claim,
    jsonb_array_elements(claim -> 'cells');
  if count_cells <> 31 or (page ->> 'hasMore')::boolean
    or (result ->> 'cellTotal')::integer <> 1031 or (page ->> 'cellTotal')::integer <> 1031
    or result ->> 'cellRevision' is distinct from page ->> 'cellRevision' then
    raise exception 'Viewport final cell page or revision failed';
  end if;
  select count(distinct (cell ->> 'row') || ':' || (cell ->> 'column')) into unique_cells
    from jsonb_array_elements((result -> 'claims') || (page -> 'claims')) claim,
      jsonb_array_elements(claim -> 'cells') cell;
  if unique_cells <> 1031 then raise exception 'Viewport cell pages overlapped or omitted records'; end if;
  result := public.get_map_viewport('00000000-0000-4000-8000-000000000010', 0, 0, 63, 32, 0, 1000, 'all');
  page := public.get_map_viewport('00000000-0000-4000-8000-000000000010', 0, 0, 63, 32, 1000, 1000, 'all');
  if not (result ->> 'hasMore')::boolean or (page ->> 'hasMore')::boolean
    or jsonb_array_length(result -> 'markers') <> 1000 or jsonb_array_length(page -> 'markers') <> 31 then
    raise exception 'Combined viewport pagination failed';
  end if;
  result := public.get_map_viewport('00000000-0000-4000-8000-000000000010', 0, 0, 63, 32, 0, 1000, 'markers');
  page := public.get_map_viewport('00000000-0000-4000-8000-000000000010', 0, 0, 63, 32, 1000, 1000, 'markers');
  if jsonb_array_length(result -> 'markers') <> 1000 or not (result ->> 'hasMore')::boolean
    or jsonb_array_length(page -> 'markers') <> 31 or (page ->> 'hasMore')::boolean
    or (result ->> 'markerTotal')::integer <> 1031 or (page ->> 'markerTotal')::integer <> 1031
    or result ->> 'markerRevision' is distinct from page ->> 'markerRevision' then
    raise exception 'Viewport marker pagination failed';
  end if;
  select count(distinct marker ->> 'id') into unique_markers
    from jsonb_array_elements((result -> 'markers') || (page -> 'markers')) marker;
  if unique_markers <> 1031 then raise exception 'Viewport marker pages overlapped or omitted records'; end if;
  result := public.list_map_claim_summaries('00000000-0000-4000-8000-000000000010',
    p_offset => 1000, p_limit => 100, p_kind => 'markers');
  if (result ->> 'total')::integer <> 1031 or jsonb_array_length(result -> 'items') <> 31 then
    raise exception 'Full-map marker pagination failed';
  end if;
  result := public.get_map_viewport('00000000-0000-4000-8000-000000000020', 0, 0, 0, 0, p_area => 'claims');
  if jsonb_array_length(result -> 'claims' -> 0 -> 'cells') <> 1
    or not (result -> 'claims' -> 0 ->> 'partial')::boolean then
    raise exception 'Clipped claim was not marked partial';
  end if;
  result := public.get_map_claim_detail('00000000-0000-4000-8000-000000000020', md5('fixture-large-claim')::uuid);
  if result is null or jsonb_array_length(result -> 'cells') <> 1031
    or result ->> 'map_id' <> '00000000-0000-4000-8000-000000000020' then
    raise exception 'Full claim detail lost cells outside viewport or beyond 1000';
  end if;
  result := public.get_map_claim_detail('00000000-0000-4000-8000-000000000010', md5('fixture-large-claim')::uuid);
  if result is not null then raise exception 'Claim detail crossed map boundary'; end if;
  -- 128×128 恰好允许；129×128 超出 16384 格必须拒绝。
  perform public.get_map_viewport('00000000-0000-4000-8000-000000000010', 0, 0, 127, 127, p_area => 'claims');
  begin
    perform public.get_map_viewport('00000000-0000-4000-8000-000000000010', 0, 0, 128, 127, p_area => 'claims');
    raise exception 'Viewport exceeded the 16384-cell capacity';
  exception when invalid_parameter_value then null;
  end;
  result := public.get_map_occupancy('00000000-0000-4000-8000-000000000010', 8);
  select sum((block ->> 'count')::integer) into count_cells from jsonb_array_elements(result -> 'blocks') block;
  if count_cells <> 1031 then raise exception 'Occupancy aggregation lost cells'; end if;
  foreach hidden_query in array array[
    $query$select public.get_map_occupancy('00000000-0000-4000-8000-000000000030', 8)$query$,
    $query$select public.get_map_viewport('00000000-0000-4000-8000-000000000030', 0, 0, 63, 32)$query$,
    $query$select public.list_map_claim_summaries('00000000-0000-4000-8000-000000000030')$query$,
    $query$select public.get_map_claim_detail('00000000-0000-4000-8000-000000000030', md5('fixture-hidden-claim')::uuid)$query$
  ] loop
    begin
      execute hidden_query;
      raise exception 'Hidden map RPC leaked to anonymous visitor: %', hidden_query;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare hidden_query text;
begin
  if private.current_role() is distinct from 'member'::public.app_role or not private.can_claim_maps() then
    raise exception 'Member fixture did not reach ready permissions';
  end if;
  foreach hidden_query in array array[
    $query$select public.get_map_occupancy('00000000-0000-4000-8000-000000000030', 8)$query$,
    $query$select public.get_map_viewport('00000000-0000-4000-8000-000000000030', 0, 0, 63, 32)$query$,
    $query$select public.list_map_claim_summaries('00000000-0000-4000-8000-000000000030')$query$,
    $query$select public.get_map_claim_detail('00000000-0000-4000-8000-000000000030', md5('fixture-hidden-claim')::uuid)$query$
  ] loop
    begin
      execute hidden_query;
      raise exception 'Hidden map RPC leaked to non-manager member: %', hidden_query;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    insert into public.map_claim_cells (claim_id, map_id, chunk_column, chunk_row)
    values (md5('fixture-claim-0')::uuid, '00000000-0000-4000-8000-000000000020', 200, 200);
    raise exception 'Cross-map cell escaped RLS';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
begin
  begin
    insert into public.map_claim_cells (claim_id, map_id, chunk_column, chunk_row)
    values (md5('fixture-claim-0')::uuid, '00000000-0000-4000-8000-000000000020', 200, 200);
    raise exception 'Cross-map cell escaped composite foreign key';
  exception when foreign_key_violation then null;
  end;
end;
$$;

-- 管理员门禁前可读隐藏地图；密码门禁后仅保留与匿名一致的公开读取。
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  perform public.get_map_occupancy('00000000-0000-4000-8000-000000000030', 8);
  perform public.get_map_viewport('00000000-0000-4000-8000-000000000030', 0, 0, 63, 32);
  perform public.list_map_claim_summaries('00000000-0000-4000-8000-000000000030');
  if public.get_map_claim_detail('00000000-0000-4000-8000-000000000030', md5('fixture-hidden-claim')::uuid) is null then
    raise exception 'Ready administrator could not read hidden claim';
  end if;
end;
$$;
reset role;
update public.profiles set must_change_password = true where id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
declare hidden_query text;
begin
  if private.current_role() is not null or private.can_manage_maps() or private.can_claim_maps() then
    raise exception 'Password gate retained map capabilities';
  end if;
  perform public.get_map_occupancy('00000000-0000-4000-8000-000000000010', 8);
  perform public.get_map_viewport('00000000-0000-4000-8000-000000000010', 0, 0, 63, 32);
  perform public.list_map_claim_summaries('00000000-0000-4000-8000-000000000010');
  if public.get_map_claim_detail('00000000-0000-4000-8000-000000000020', md5('fixture-large-claim')::uuid) is null then
    raise exception 'Password gate incorrectly blocked public map reading';
  end if;
  foreach hidden_query in array array[
    $query$select public.get_map_occupancy('00000000-0000-4000-8000-000000000030', 8)$query$,
    $query$select public.get_map_viewport('00000000-0000-4000-8000-000000000030', 0, 0, 63, 32)$query$,
    $query$select public.list_map_claim_summaries('00000000-0000-4000-8000-000000000030')$query$,
    $query$select public.get_map_claim_detail('00000000-0000-4000-8000-000000000030', md5('fixture-hidden-claim')::uuid)$query$
  ] loop
    begin
      execute hidden_query;
      raise exception 'Password-gated administrator retained hidden map access: %', hidden_query;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;
reset role;
update public.profiles set role = 'member' where id = '00000000-0000-4000-8000-000000000001';
do $$
begin
  if to_regclass('private.qq_identities') is not null or to_regclass('private.qq_verification_challenges') is not null then
    raise exception 'QQ database objects remain';
  end if;
end;
$$;
rollback;
