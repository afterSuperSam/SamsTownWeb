-- v1.8 public map access ---------------------------------------------------
-- The map is public read-only. Mutation policies and RPC checks remain
-- authenticated and capability-gated, so exposing reads does not widen edits.

create or replace function private.can_read_map(p_map_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.town_maps map
    where map.id = p_map_id
      and (map.is_visible or private.can_manage_maps())
  );
$$;

drop policy if exists "members read visible maps" on public.town_maps;
drop policy if exists "public read visible maps" on public.town_maps;
create policy "public read visible maps" on public.town_maps for select to anon, authenticated
  using (is_visible);
drop policy if exists "map managers read hidden maps" on public.town_maps;
create policy "map managers read hidden maps" on public.town_maps for select to authenticated
  using (private.can_manage_maps());

drop policy if exists "members read claims" on public.map_claims;
drop policy if exists "public read map claims" on public.map_claims;
create policy "public read map claims" on public.map_claims for select to anon, authenticated
  using (private.can_read_map(map_id));

drop policy if exists "members read claim cells" on public.map_claim_cells;
drop policy if exists "public read map claim cells" on public.map_claim_cells;
create policy "public read map claim cells" on public.map_claim_cells for select to anon, authenticated
  using (private.can_read_map(map_id));

drop policy if exists "members read markers" on public.map_markers;
drop policy if exists "public read map markers" on public.map_markers;
create policy "public read map markers" on public.map_markers for select to anon, authenticated
  using (private.can_read_map(map_id));

-- Only generated Deep Zoom tiles are public. Original uploads remain private.
drop policy if exists "members read map tiles" on storage.objects;
drop policy if exists "public read map tiles" on storage.objects;
create policy "public read map tiles" on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'town-maps'
    and (storage.foldername(storage.objects.name))[3] = 'tiles'
    and (storage.foldername(storage.objects.name))[1]
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.can_read_map(((storage.foldername(storage.objects.name))[1])::uuid)
  );

grant select on public.town_maps, public.map_claims, public.map_claim_cells,
  public.map_markers to anon;
revoke all on function private.can_read_map(uuid) from public;
grant execute on function private.can_read_map(uuid) to anon, authenticated, service_role;
