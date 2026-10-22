-- Interactive town maps ---------------------------------------------------
-- Stores only claimed 16x16 image-pixel chunks. Empty chunks are implicit.

alter table public.town_images drop constraint if exists town_images_area_check;
alter table public.town_images add constraint town_images_area_check
  check (area in ('hero', 'story', 'gallery', 'join', 'history', 'resources', 'mapHero'));

create or replace function private.can_view_maps()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_role() in ('viewer', 'member', 'admin', 'owner'), false);
$$;

create or replace function private.can_claim_maps()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_role() in ('member', 'admin', 'owner'), false);
$$;

create or replace function private.can_manage_maps()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_role() in ('admin', 'owner'), false);
$$;

create table if not exists public.town_maps (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 80),
  description text not null default '',
  short_label text not null default '' check (char_length(short_label) <= 24),
  image_width integer not null check (image_width > 0),
  image_height integer not null check (image_height > 0),
  tile_size integer not null default 256 check (tile_size between 128 and 1024),
  max_level integer not null check (max_level >= 0),
  tile_revision uuid not null default gen_random_uuid(),
  original_path text not null unique,
  storage_prefix text not null unique,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.map_claims (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.town_maps(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  project_name text not null check (char_length(trim(project_name)) between 1 and 100),
  minecraft_username text not null check (minecraft_username ~ '^[A-Za-z0-9_]{1,16}$'),
  description text not null default '',
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'paused', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.map_claim_cells (
  claim_id uuid not null references public.map_claims(id) on delete cascade,
  map_id uuid not null references public.town_maps(id) on delete cascade,
  chunk_column integer not null check (chunk_column >= 0),
  chunk_row integer not null check (chunk_row >= 0),
  created_at timestamptz not null default now(),
  primary key (map_id, chunk_column, chunk_row),
  unique (claim_id, chunk_column, chunk_row)
);

create table if not exists public.map_markers (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.town_maps(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  icon_type text not null check (icon_type in ('building', 'machine', 'other')),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  description text not null default '',
  pixel_x integer not null check (pixel_x >= 0),
  pixel_y integer not null check (pixel_y >= 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Central visibility predicate used by every child-table policy. Security
-- definer is intentional: callers may not be able to select the hidden map row
-- directly, but managers must still be able to inspect it.
create or replace function private.can_read_map(p_map_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_view_maps() and exists (
    select 1
    from public.town_maps map
    where map.id = p_map_id
      and (map.is_visible or private.can_manage_maps())
  );
$$;

create index if not exists town_maps_visible_sort_idx on public.town_maps (is_visible, sort_order);
create index if not exists map_claims_map_idx on public.map_claims (map_id, updated_at desc);
create index if not exists map_claims_owner_idx on public.map_claims (owner_id, updated_at desc);
create index if not exists map_claim_cells_claim_idx on public.map_claim_cells (claim_id);
create index if not exists map_markers_map_idx on public.map_markers (map_id, updated_at desc);

drop trigger if exists town_maps_updated_at on public.town_maps;
create trigger town_maps_updated_at before update on public.town_maps
  for each row execute procedure private.set_updated_at();
drop trigger if exists map_claims_updated_at on public.map_claims;
create trigger map_claims_updated_at before update on public.map_claims
  for each row execute procedure private.set_updated_at();
drop trigger if exists map_markers_updated_at on public.map_markers;
create trigger map_markers_updated_at before update on public.map_markers
  for each row execute procedure private.set_updated_at();

create or replace function private.keep_claim_map_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.map_id <> old.map_id then
    raise exception 'A claim cannot move between maps';
  end if;
  return new;
end;
$$;
drop trigger if exists map_claim_map_immutable on public.map_claims;
create trigger map_claim_map_immutable before update of map_id on public.map_claims
  for each row execute procedure private.keep_claim_map_immutable();

-- RLS ---------------------------------------------------------------------
alter table public.town_maps enable row level security;
alter table public.map_claims enable row level security;
alter table public.map_claim_cells enable row level security;
alter table public.map_markers enable row level security;

create policy "members read visible maps" on public.town_maps for select to authenticated
  using (private.can_view_maps() and (is_visible or private.can_manage_maps()));
create policy "map managers read profiles" on public.profiles for select to authenticated
  using (private.can_manage_maps());
-- Map image metadata is written only through the authenticated Fastify tile
-- pipeline. Authenticated clients receive no direct town_maps write policy.

create policy "members read claims" on public.map_claims for select to authenticated
  using (private.can_read_map(map_id));
create policy "members insert own claims" on public.map_claims for insert to authenticated
  with check (
    private.can_claim_maps()
    and (owner_id = (select auth.uid()) or private.can_manage_maps())
    and exists (
      select 1 from public.town_maps map
      where map.id = map_id and (map.is_visible or private.can_manage_maps())
    )
  );
create policy "members update own claims" on public.map_claims for update to authenticated
  using (private.can_claim_maps() and private.can_read_map(map_id)
    and (owner_id = (select auth.uid()) or private.can_manage_maps()))
  with check (private.can_claim_maps() and private.can_read_map(map_id)
    and (owner_id = (select auth.uid()) or private.can_manage_maps()));
create policy "members delete own claims" on public.map_claims for delete to authenticated
  using (private.can_claim_maps() and private.can_read_map(map_id)
    and (owner_id = (select auth.uid()) or private.can_manage_maps()));

create policy "members read claim cells" on public.map_claim_cells for select to authenticated
  using (private.can_read_map(map_id));
create policy "members insert own claim cells" on public.map_claim_cells for insert to authenticated
  with check (private.can_claim_maps() and private.can_read_map(map_id) and exists (
    select 1 from public.map_claims claim
    join public.town_maps map on map.id = claim.map_id
    where claim.id = claim_id and claim.map_id = map_id
      and (claim.owner_id = (select auth.uid()) or private.can_manage_maps())
      and chunk_column < ceil(map.image_width / 16.0)
      and chunk_row < ceil(map.image_height / 16.0)
  ));
create policy "members delete own claim cells" on public.map_claim_cells for delete to authenticated
  using (private.can_claim_maps() and private.can_read_map(map_id) and exists (
    select 1 from public.map_claims claim
    where claim.id = claim_id
      and (claim.owner_id = (select auth.uid()) or private.can_manage_maps())
  ));

create policy "members read markers" on public.map_markers for select to authenticated
  using (private.can_read_map(map_id));
create policy "map managers insert markers" on public.map_markers for insert to authenticated
  with check (private.can_manage_maps() and exists (
    select 1 from public.town_maps map
    where map.id = map_id and pixel_x < map.image_width and pixel_y < map.image_height
  ));
create policy "map managers update markers" on public.map_markers for update to authenticated
  using (private.can_manage_maps()) with check (private.can_manage_maps() and exists (
    select 1 from public.town_maps map
    where map.id = map_id and pixel_x < map.image_width and pixel_y < map.image_height
  ));
create policy "map managers delete markers" on public.map_markers for delete to authenticated
  using (private.can_manage_maps());

-- One transaction saves metadata and the complete desired Chunk set. Cells
-- won by another concurrent claim are returned instead of rolling back the
-- non-conflicting work.
create or replace function public.save_map_claim(
  p_claim_id uuid,
  p_map_id uuid,
  p_project_name text,
  p_minecraft_username text,
  p_description text,
  p_color text,
  p_status text,
  p_cells jsonb,
  p_owner_id uuid default null
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  resolved_id uuid;
  resolved_owner uuid;
  conflict_cells jsonb;
begin
  if not private.can_claim_maps() then raise insufficient_privilege; end if;
  resolved_owner := case
    when private.can_manage_maps() and p_owner_id is not null then p_owner_id
    else auth.uid()
  end;

  if p_claim_id is null then
    insert into public.map_claims (
      map_id, owner_id, project_name, minecraft_username, description, color, status
    ) values (
      p_map_id, resolved_owner, trim(p_project_name), trim(p_minecraft_username),
      coalesce(p_description, ''), p_color, p_status
    ) returning id into resolved_id;
  else
    update public.map_claims set
      owner_id = resolved_owner,
      project_name = trim(p_project_name),
      minecraft_username = trim(p_minecraft_username),
      description = coalesce(p_description, ''),
      color = p_color,
      status = p_status
    where id = p_claim_id and map_id = p_map_id
    returning id into resolved_id;
    if resolved_id is null then raise no_data_found; end if;
  end if;

  delete from public.map_claim_cells cell
  where cell.claim_id = resolved_id
    and not exists (
      select 1 from jsonb_array_elements(p_cells) item
      where (item ->> 'column')::integer = cell.chunk_column
        and (item ->> 'row')::integer = cell.chunk_row
    );

  insert into public.map_claim_cells (claim_id, map_id, chunk_column, chunk_row)
  select resolved_id, p_map_id, (item ->> 'column')::integer, (item ->> 'row')::integer
  from jsonb_array_elements(p_cells) item
  on conflict (map_id, chunk_column, chunk_row) do nothing;

  select coalesce(jsonb_agg(jsonb_build_object(
    'column', (item ->> 'column')::integer,
    'row', (item ->> 'row')::integer
  )), '[]'::jsonb)
  into conflict_cells
  from jsonb_array_elements(p_cells) item
  join public.map_claim_cells occupied
    on occupied.map_id = p_map_id
   and occupied.chunk_column = (item ->> 'column')::integer
   and occupied.chunk_row = (item ->> 'row')::integer
   and occupied.claim_id <> resolved_id;

  if not exists (select 1 from public.map_claim_cells where claim_id = resolved_id) then
    delete from public.map_claims where id = resolved_id;
    resolved_id := null;
  end if;
  return jsonb_build_object('claimId', resolved_id, 'conflicts', conflict_cells);
end;
$$;

-- Commits the database side of an image replacement atomically. The function
-- is service-role-only because authorization is performed by Fastify before
-- the trusted server client reaches this boundary.
create or replace function public.commit_town_map_image(
  p_map_id uuid,
  p_image_width integer,
  p_image_height integer,
  p_tile_size integer,
  p_max_level integer,
  p_tile_revision uuid,
  p_original_path text,
  p_storage_prefix text,
  p_clear_existing boolean
)
returns public.town_maps
language plpgsql security definer set search_path = ''
as $$
declare
  updated_map public.town_maps;
begin
  if p_clear_existing then
    delete from public.map_claims where map_id = p_map_id;
    delete from public.map_markers where map_id = p_map_id;
  end if;
  update public.town_maps set
    image_width = p_image_width,
    image_height = p_image_height,
    tile_size = p_tile_size,
    max_level = p_max_level,
    tile_revision = p_tile_revision,
    original_path = p_original_path,
    storage_prefix = p_storage_prefix
  where id = p_map_id
  returning * into updated_map;
  if updated_map.id is null then raise no_data_found; end if;
  return updated_map;
end;
$$;

-- Private map storage ------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'town-maps', 'town-maps', false, 52428800,
  array['image/png', 'image/jpeg', 'image/webp', 'image/tiff']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "members read map tiles" on storage.objects for select to authenticated
  using (
    bucket_id = 'town-maps' and private.can_view_maps() and exists (
      select 1 from public.town_maps map
      where map.id::text = (storage.foldername(name))[1]
        and (map.is_visible or private.can_manage_maps())
    )
  );

grant select, insert, update, delete on public.town_maps, public.map_claims,
  public.map_claim_cells, public.map_markers to authenticated;

revoke all on function private.can_view_maps() from public;
revoke all on function private.can_claim_maps() from public;
revoke all on function private.can_manage_maps() from public;
revoke all on function private.can_read_map(uuid) from public;
grant execute on function private.can_view_maps(), private.can_claim_maps(),
  private.can_manage_maps() to authenticated, service_role;
grant execute on function private.can_read_map(uuid) to authenticated, service_role;
revoke all on function public.save_map_claim(uuid, uuid, text, text, text, text, text, jsonb, uuid)
  from public, anon;
grant execute on function public.save_map_claim(uuid, uuid, text, text, text, text, text, jsonb, uuid)
  to authenticated, service_role;
revoke all on function public.commit_town_map_image(uuid, integer, integer, integer, integer, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.commit_town_map_image(uuid, integer, integer, integer, integer, uuid, text, text, boolean)
  to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'town_maps'
  ) then alter publication supabase_realtime add table public.town_maps; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'map_claims'
  ) then alter publication supabase_realtime add table public.map_claims; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'map_claim_cells'
  ) then alter publication supabase_realtime add table public.map_claim_cells; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'map_markers'
  ) then alter publication supabase_realtime add table public.map_markers; end if;
end
$$;
