-- 地图归属完整性：锁定写入后检测历史错配，禁止自动修正。
lock table public.map_claims, public.map_claim_cells in share row exclusive mode;
do $$
begin
  if exists (
    select 1 from public.map_claim_cells cell
    left join public.map_claims claim on claim.id = cell.claim_id
    where claim.id is null or cell.map_id <> claim.map_id
  ) then
    raise exception 'Map claim/cell mismatch detected; migration stopped. Repair historical data explicitly.';
  end if;
end;
$$;
alter table public.map_claims add constraint map_claims_id_map_unique unique (id, map_id);
alter table public.map_claim_cells
  add constraint map_claim_cells_claim_map_foreign_key
  foreign key (claim_id, map_id) references public.map_claims (id, map_id) on delete cascade;
alter table public.map_claim_cells drop constraint map_claim_cells_claim_id_fkey;

-- 所有相关子查询显式引用策略所在表的外层字段。
drop policy if exists "members insert own claims" on public.map_claims;
create policy "members insert own claims" on public.map_claims for insert to authenticated
with check (private.can_claim_maps() and private.can_read_map(map_claims.map_id)
  and (map_claims.owner_id = (select auth.uid()) or private.can_manage_maps()));
drop policy if exists "members insert own claim cells" on public.map_claim_cells;
create policy "members insert own claim cells" on public.map_claim_cells for insert to authenticated
with check (private.can_claim_maps() and private.can_read_map(map_claim_cells.map_id) and exists (
  select 1 from public.map_claims claim join public.town_maps map on map.id = claim.map_id
  where claim.id = map_claim_cells.claim_id and claim.map_id = map_claim_cells.map_id
    and (claim.owner_id = (select auth.uid()) or private.can_manage_maps())
    and map_claim_cells.chunk_column < ceil(map.image_width / 16.0)
    and map_claim_cells.chunk_row < ceil(map.image_height / 16.0)
));
drop policy if exists "members delete own claim cells" on public.map_claim_cells;
create policy "members delete own claim cells" on public.map_claim_cells for delete to authenticated
using (private.can_claim_maps() and private.can_read_map(map_claim_cells.map_id) and exists (
  select 1 from public.map_claims claim
  where claim.id = map_claim_cells.claim_id and claim.map_id = map_claim_cells.map_id
    and (claim.owner_id = (select auth.uid()) or private.can_manage_maps())
));
drop policy if exists "map managers insert markers" on public.map_markers;
create policy "map managers insert markers" on public.map_markers for insert to authenticated
with check (private.can_manage_maps() and private.can_read_map(map_markers.map_id) and exists (
  select 1 from public.town_maps map where map.id = map_markers.map_id
    and map_markers.pixel_x < map.image_width and map_markers.pixel_y < map.image_height
));
drop policy if exists "map managers update markers" on public.map_markers;
create policy "map managers update markers" on public.map_markers for update to authenticated
using (private.can_manage_maps() and private.can_read_map(map_markers.map_id))
with check (private.can_manage_maps() and private.can_read_map(map_markers.map_id) and exists (
  select 1 from public.town_maps map where map.id = map_markers.map_id
    and map_markers.pixel_x < map.image_width and map_markers.pixel_y < map.image_height
));
create index map_claim_cells_viewport_idx on public.map_claim_cells (map_id, chunk_row, chunk_column);
create index map_markers_viewport_idx on public.map_markers (map_id, pixel_y, pixel_x);

-- RPC 固定空搜索路径，入口显式检查地图权限；不授予 private schema 权限。
create function public.get_map_occupancy(p_map_id uuid, p_block_size integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.can_read_map(p_map_id) then raise insufficient_privilege using message = 'Map access denied'; end if;
  if p_block_size is null or p_block_size < 1 or exists (
    select 1 from public.town_maps map where map.id = p_map_id
      and ceil(map.image_width / (16.0 * p_block_size)) * ceil(map.image_height / (16.0 * p_block_size)) > 4096
  ) then raise invalid_parameter_value using message = 'Invalid map aggregation size'; end if;
  select jsonb_build_object('blockSize', p_block_size, 'totalCells', coalesce(sum(block.count), 0),
    'blocks', coalesce(jsonb_agg(to_jsonb(block) order by block.row, block.column), '[]'::jsonb)) into result
  from (select cell.chunk_column / p_block_size as column, cell.chunk_row / p_block_size as row, count(*) as count
    from public.map_claim_cells cell where cell.map_id = p_map_id group by 1, 2) block;
  return result;
end;
$$;

create function public.get_map_viewport(
  p_map_id uuid, p_min_column integer, p_min_row integer, p_max_column integer, p_max_row integer,
  p_offset integer default 0, p_limit integer default 1000, p_area text default 'all'
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.can_read_map(p_map_id) then raise insufficient_privilege using message = 'Map access denied'; end if;
  if p_min_column is null or p_min_row is null or p_max_column is null or p_max_row is null
    or p_min_column < 0 or p_min_row < 0 or p_max_column < p_min_column or p_max_row < p_min_row
    or (p_max_column::bigint - p_min_column + 1) * (p_max_row::bigint - p_min_row + 1) > 16384
    or p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 1000
    or p_area is null or p_area not in ('all', 'claims', 'markers')
    then raise invalid_parameter_value using message = 'Invalid map viewport'; end if;
  with filtered_cells as materialized (
    select cell.claim_id, cell.chunk_column, cell.chunk_row, claim.updated_at
    from public.map_claim_cells cell join public.map_claims claim on claim.id = cell.claim_id and claim.map_id = cell.map_id
    where cell.map_id = p_map_id and p_area <> 'markers'
      and cell.chunk_column between p_min_column and p_max_column and cell.chunk_row between p_min_row and p_max_row
  ), cells as (
    select * from filtered_cells order by chunk_row, chunk_column limit p_limit offset p_offset
  ), claims as (
    select to_jsonb(claim) || jsonb_build_object('partial', exists (
      select 1 from public.map_claim_cells outside_cell where outside_cell.claim_id = claim.id and outside_cell.map_id = p_map_id
        and (outside_cell.chunk_column < p_min_column or outside_cell.chunk_column > p_max_column
          or outside_cell.chunk_row < p_min_row or outside_cell.chunk_row > p_max_row)
    ), 'cells', jsonb_agg(jsonb_build_object(
      'column', cell.chunk_column, 'row', cell.chunk_row) order by cell.chunk_row, cell.chunk_column)) as value
    from cells cell join public.map_claims claim on claim.id = cell.claim_id and claim.map_id = p_map_id group by claim.id
  ), filtered_markers as materialized (
    select marker.* from public.map_markers marker where marker.map_id = p_map_id and p_area <> 'claims'
      and marker.pixel_x::bigint between p_min_column::bigint * 16 and (p_max_column::bigint + 1) * 16 - 1
      and marker.pixel_y::bigint between p_min_row::bigint * 16 and (p_max_row::bigint + 1) * 16 - 1
  ), markers as (
    select * from filtered_markers order by id limit p_limit offset p_offset
  ) select jsonb_build_object(
    'claims', coalesce((select jsonb_agg(value) from claims), '[]'::jsonb),
    'markers', coalesce((select jsonb_agg(to_jsonb(marker)) from markers marker), '[]'::jsonb),
    'cellTotal', (select count(*) from filtered_cells),
    'cellRevision', (select md5(coalesce(string_agg(cell.claim_id::text || ':' || cell.chunk_row::text || ':' || cell.chunk_column::text || ':' || cell.updated_at::text,
      ',' order by cell.chunk_row, cell.chunk_column), '')) from filtered_cells cell),
    'markerTotal', (select count(*) from filtered_markers),
    'markerRevision', (select md5(coalesce(string_agg(marker.id::text || marker.updated_at::text, ',' order by marker.id), '')) from filtered_markers marker),
    'hasMore', case p_area
      when 'claims' then (select count(*) = p_limit from cells)
      when 'markers' then (select count(*) = p_limit from markers)
      else (select count(*) = p_limit from cells) or (select count(*) = p_limit from markers) end
  ) into result;
  return result;
end;
$$;

create function public.list_map_claim_summaries(
  p_map_id uuid, p_query text default '', p_status text default 'all', p_member text default 'all',
  p_color text default 'all', p_mine boolean default false, p_offset integer default 0,
  p_limit integer default 30, p_kind text default 'claims'
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.can_read_map(p_map_id) then raise insufficient_privilege using message = 'Map access denied'; end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 100
    or p_kind is null or p_kind not in ('claims', 'markers') or p_query is null or char_length(p_query) > 200
    or p_status is null or p_status not in ('all','planned','in_progress','completed','paused','abandoned')
    or p_member is null or p_color is null or p_mine is null
    then raise invalid_parameter_value using message = 'Invalid map list filters'; end if;
  if p_kind = 'markers' then
    with filtered as (
      select marker.* from public.map_markers marker where marker.map_id = p_map_id
        and (p_query = '' or strpos(lower(marker.name || ' ' || marker.description), lower(p_query)) > 0)
    ), page as (select * from filtered order by updated_at desc, id limit p_limit offset p_offset)
    select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(page) order by page.updated_at desc, page.id) from page), '[]'::jsonb),
      'total', (select count(*) from filtered), 'members', '[]'::jsonb, 'colors', '[]'::jsonb) into result;
  else
    with filtered as (
      select claim.* from public.map_claims claim where claim.map_id = p_map_id
        and (p_query = '' or strpos(lower(claim.project_name || ' ' || claim.minecraft_username || ' ' || claim.description), lower(p_query)) > 0)
        and (p_status = 'all' or claim.status = p_status) and (p_member = 'all' or claim.minecraft_username = p_member)
        and (p_color = 'all' or claim.color = p_color) and (not p_mine or claim.owner_id = (select auth.uid()))
    ), page as (select * from filtered order by updated_at desc, id limit p_limit offset p_offset), summaries as (
      select to_jsonb(page) || jsonb_build_object('cellCount', geometry.count, 'bounds',
        case when geometry.count = 0 then null else jsonb_build_object('minColumn', geometry.min_column,
          'minRow', geometry.min_row, 'maxColumn', geometry.max_column, 'maxRow', geometry.max_row) end) as value,
        page.updated_at, page.id
      from page cross join lateral (select count(*) as count, min(cell.chunk_column) as min_column,
        min(cell.chunk_row) as min_row, max(cell.chunk_column) as max_column, max(cell.chunk_row) as max_row
        from public.map_claim_cells cell where cell.map_id = p_map_id and cell.claim_id = page.id) geometry
    ) select jsonb_build_object('items', coalesce((select jsonb_agg(value order by updated_at desc, id) from summaries), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'members', coalesce((select jsonb_agg(value order by value) from (select distinct claim.minecraft_username as value from public.map_claims claim where claim.map_id = p_map_id) members), '[]'::jsonb),
      'colors', coalesce((select jsonb_agg(value order by value) from (select distinct claim.color as value from public.map_claims claim where claim.map_id = p_map_id) colors), '[]'::jsonb)) into result;
  end if;
  return result;
end;
$$;
create function public.get_map_claim_detail(p_map_id uuid, p_claim_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.can_read_map(p_map_id) then raise insufficient_privilege using message = 'Map access denied'; end if;
  select to_jsonb(claim) || jsonb_build_object('cells', coalesce((
    select jsonb_agg(jsonb_build_object('column', cell.chunk_column, 'row', cell.chunk_row)
      order by cell.chunk_row, cell.chunk_column)
    from public.map_claim_cells cell where cell.map_id = claim.map_id and cell.claim_id = claim.id
  ), '[]'::jsonb)) into result
  from public.map_claims claim where claim.map_id = p_map_id and claim.id = p_claim_id
    and private.can_read_map(p_map_id);
  return result;
end;
$$;
revoke all on function public.get_map_claim_detail(uuid, uuid) from public;
grant execute on function public.get_map_claim_detail(uuid, uuid) to anon, authenticated, service_role;
revoke all on function public.get_map_occupancy(uuid, integer) from public;
revoke all on function public.get_map_viewport(uuid, integer, integer, integer, integer, integer, integer, text) from public;
revoke all on function public.list_map_claim_summaries(uuid, text, text, text, text, boolean, integer, integer, text) from public;
grant execute on function public.get_map_occupancy(uuid, integer) to anon, authenticated, service_role;
grant execute on function public.get_map_viewport(uuid, integer, integer, integer, integer, integer, integer, text) to anon, authenticated, service_role;
grant execute on function public.list_map_claim_summaries(uuid, text, text, text, text, boolean, integer, integer, text) to anon, authenticated, service_role;
