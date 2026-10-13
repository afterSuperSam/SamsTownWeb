-- Security and integrity hardening for existing v1.1 installations ----------

-- Shared files are no longer litematic-only.
alter table public.schematics
  drop constraint if exists schematics_file_name_check;

-- Login and profile updates use case-insensitive usernames. Stop with a clear
-- message instead of silently choosing one account if legacy conflicts exist.
do $$
begin
  if exists (
    select 1 from public.profiles
    group by lower(username)
    having count(*) > 1
  ) then
    raise exception 'Resolve case-insensitive duplicate profile usernames before applying this migration';
  end if;
end
$$;

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username));

create or replace function public.resolve_profile_id(login_username text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select profile.id
  from public.profiles profile
  where lower(profile.username) = lower(trim(login_username))
  limit 1;
$$;

revoke all on function public.resolve_profile_id(text) from public, anon, authenticated;
grant execute on function public.resolve_profile_id(text) to service_role;

create or replace function public.update_own_username(next_username text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  normalized text := trim(next_username);
begin
  if char_length(normalized) not between 2 and 32
    or normalized !~ '^[[:alnum:]_-]+$' then
    raise exception 'Invalid username';
  end if;
  update public.profiles set username = normalized where id = auth.uid();
  if not found then raise exception 'Profile not found'; end if;
exception
  when unique_violation then
    raise exception 'Username already exists' using errcode = '23505';
end;
$$;

-- Preserve authored data and audit history when a deletable account is
-- removed. Maps and claims remain RESTRICTed and must be reassigned explicitly.
alter table public.site_content drop constraint if exists site_content_updated_by_fkey;
alter table public.site_content add constraint site_content_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;
alter table public.resources drop constraint if exists resources_created_by_fkey;
alter table public.resources add constraint resources_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.schematics drop constraint if exists schematics_created_by_fkey;
alter table public.schematics add constraint schematics_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.audit_logs drop constraint if exists audit_logs_actor_id_fkey;
alter table public.audit_logs add constraint audit_logs_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;
alter table public.town_images drop constraint if exists town_images_created_by_fkey;
alter table public.town_images add constraint town_images_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- Child-table reads must follow the parent map's visibility.
create or replace function private.can_read_map(p_map_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_view_maps() and exists (
    select 1 from public.town_maps map
    where map.id = p_map_id
      and (map.is_visible or private.can_manage_maps())
  );
$$;

drop policy if exists "members read claims" on public.map_claims;
create policy "members read claims" on public.map_claims for select to authenticated
  using (private.can_read_map(map_id));
drop policy if exists "members read claim cells" on public.map_claim_cells;
create policy "members read claim cells" on public.map_claim_cells for select to authenticated
  using (private.can_read_map(map_id));
drop policy if exists "members read markers" on public.map_markers;
create policy "members read markers" on public.map_markers for select to authenticated
  using (private.can_read_map(map_id));

drop policy if exists "members update own claims" on public.map_claims;
create policy "members update own claims" on public.map_claims for update to authenticated
  using (private.can_claim_maps() and private.can_read_map(map_id)
    and (owner_id = (select auth.uid()) or private.can_manage_maps()))
  with check (private.can_claim_maps() and private.can_read_map(map_id)
    and (owner_id = (select auth.uid()) or private.can_manage_maps()));
drop policy if exists "members delete own claims" on public.map_claims;
create policy "members delete own claims" on public.map_claims for delete to authenticated
  using (private.can_claim_maps() and private.can_read_map(map_id)
    and (owner_id = (select auth.uid()) or private.can_manage_maps()));

drop policy if exists "members insert own claim cells" on public.map_claim_cells;
create policy "members insert own claim cells" on public.map_claim_cells for insert to authenticated
  with check (private.can_claim_maps() and private.can_read_map(map_id) and exists (
    select 1 from public.map_claims claim
    join public.town_maps map on map.id = claim.map_id
    where claim.id = claim_id and claim.map_id = map_id
      and (claim.owner_id = (select auth.uid()) or private.can_manage_maps())
      and chunk_column < ceil(map.image_width / 16.0)
      and chunk_row < ceil(map.image_height / 16.0)
  ));
drop policy if exists "members delete own claim cells" on public.map_claim_cells;
create policy "members delete own claim cells" on public.map_claim_cells for delete to authenticated
  using (private.can_claim_maps() and private.can_read_map(map_id) and exists (
    select 1 from public.map_claims claim
    where claim.id = claim_id
      and (claim.owner_id = (select auth.uid()) or private.can_manage_maps())
  ));

revoke all on function private.can_read_map(uuid) from public;
grant execute on function private.can_read_map(uuid) to authenticated, service_role;

-- Account deletion is prepared atomically in Postgres before the external
-- Supabase Auth identity is removed. A queue row makes Auth cleanup retryable.
create table if not exists public.account_deletion_queue (
  user_id uuid primary key,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);

alter table public.account_deletion_queue enable row level security;

create or replace function public.prepare_account_deletion(
  p_actor_id uuid,
  p_target_id uuid
)
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
  if p_actor_id = p_target_id then
    raise exception 'Cannot delete the current account';
  end if;

  lock table public.profiles in share row exclusive mode;
  select role into actor_role from public.profiles where id = p_actor_id;
  if actor_role is distinct from 'owner'::public.app_role then
    raise insufficient_privilege;
  end if;

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
  values (
    p_actor_id,
    'account.delete.prepare',
    'account',
    p_target_id::text,
    jsonb_build_object(
      'previousRole', target_role,
      'transferredMaps', transferred_maps,
      'transferredClaims', transferred_claims,
      'transferredMarkers', transferred_markers,
      'transferredCommands', transferred_commands
    )
  );

  insert into public.account_deletion_queue (user_id, requested_by)
  values (p_target_id, p_actor_id)
  on conflict (user_id) do nothing;

  delete from public.profiles where id = p_target_id;

  return jsonb_build_object(
    'pending', true,
    'transferredMaps', transferred_maps,
    'transferredClaims', transferred_claims,
    'transferredMarkers', transferred_markers,
    'transferredCommands', transferred_commands
  );
end;
$$;

revoke all on public.account_deletion_queue from public, anon, authenticated;
grant select, insert, update, delete on public.account_deletion_queue to service_role;
revoke all on function public.prepare_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid, uuid) to service_role;

-- Durable cross-system cleanup queue. Metadata deletion and queue insertion are
-- atomic; the Fastify worker removes Storage objects with retries.
create table if not exists public.storage_cleanup_queue (
  id bigint generated always as identity primary key,
  bucket_id text not null,
  object_path text not null,
  recursive boolean not null default false,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path, recursive)
);

alter table public.storage_cleanup_queue enable row level security;
revoke all on public.storage_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on public.storage_cleanup_queue to service_role;
grant usage, select on sequence public.storage_cleanup_queue_id_seq to service_role;

create or replace function public.queue_shared_file_deletion(p_file_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target_path text;
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  delete from public.schematics where id = p_file_id returning storage_path into target_path;
  if target_path is null then raise no_data_found; end if;
  insert into public.storage_cleanup_queue (bucket_id, object_path)
  values ('schematics', target_path)
  on conflict (bucket_id, object_path, recursive) do nothing;
end;
$$;

create or replace function public.queue_town_image_deletion(p_image_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target_path text;
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  delete from public.town_images where id = p_image_id returning storage_path into target_path;
  if not found then raise no_data_found; end if;
  if target_path is not null then
    insert into public.storage_cleanup_queue (bucket_id, object_path)
    values ('site-images', target_path)
    on conflict (bucket_id, object_path, recursive) do nothing;
  end if;
end;
$$;

create or replace function public.queue_own_storage_cleanup(p_bucket text, p_path text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_bucket = 'schematics' then
    if not private.can_use_resources()
      or (storage.foldername(p_path))[1] is distinct from auth.uid()::text then
      raise insufficient_privilege;
    end if;
  elsif p_bucket = 'site-images' then
    if not private.is_owner() then raise insufficient_privilege; end if;
  else
    raise insufficient_privilege;
  end if;
  insert into public.storage_cleanup_queue (bucket_id, object_path)
  values (p_bucket, p_path)
  on conflict (bucket_id, object_path, recursive) do nothing;
end;
$$;

revoke all on function public.queue_shared_file_deletion(uuid) from public, anon;
revoke all on function public.queue_town_image_deletion(uuid) from public, anon;
revoke all on function public.queue_own_storage_cleanup(text, text) from public, anon;
grant execute on function public.queue_shared_file_deletion(uuid) to authenticated, service_role;
grant execute on function public.queue_town_image_deletion(uuid) to authenticated, service_role;
grant execute on function public.queue_own_storage_cleanup(text, text) to authenticated, service_role;

-- Expose only the three public homepage previews; the complete resource table
-- remains a Member capability.
drop policy if exists "public reads resources" on public.resources;
drop policy if exists "members read resources" on public.resources;
create policy "members read resources" on public.resources for select to authenticated
  using (private.can_use_resources());
revoke select on public.resources from anon;

create or replace function public.list_public_resource_previews()
returns setof public.resources
language sql stable security definer set search_path = ''
as $$
  select resource.*
  from public.resources resource
  order by resource.created_at desc
  limit 3;
$$;

revoke all on function public.list_public_resource_previews() from public;
grant execute on function public.list_public_resource_previews() to anon, authenticated, service_role;

create or replace function public.get_resource_stats()
returns table(total bigint, plugin bigint, datapack bigint, github bigint, updates bigint)
language sql stable security invoker set search_path = ''
as $$
  select
    count(*),
    count(*) filter (where resource_type = 'plugin'),
    count(*) filter (where resource_type = 'datapack'),
    count(*) filter (where source = 'github'),
    count(*) filter (where update_available)
  from public.resources;
$$;

revoke all on function public.get_resource_stats() from public, anon;
grant execute on function public.get_resource_stats() to authenticated, service_role;

-- Authorship is assigned by the caller and cannot be rewritten later, while
-- Member/Admin collaborative metadata editing remains available.
create or replace function private.keep_creator_immutable()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists resources_creator_immutable on public.resources;
create trigger resources_creator_immutable before update of created_by on public.resources
  for each row execute procedure private.keep_creator_immutable();
drop trigger if exists schematics_creator_immutable on public.schematics;
create trigger schematics_creator_immutable before update of created_by on public.schematics
  for each row execute procedure private.keep_creator_immutable();

drop policy if exists "members insert resources" on public.resources;
create policy "members insert resources" on public.resources for insert to authenticated
  with check (private.can_use_resources() and created_by = (select auth.uid()));
drop policy if exists "members insert shared files" on public.schematics;
create policy "members insert shared files" on public.schematics for insert to authenticated
  with check (private.can_use_resources() and created_by = (select auth.uid()));

drop policy if exists "members upload shared files" on storage.objects;
create policy "members upload shared files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'schematics'
    and private.can_use_resources()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "members update shared files" on storage.objects;
create policy "members update shared files" on storage.objects for update to authenticated
  using (
    bucket_id = 'schematics'
    and private.can_use_resources()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'schematics'
    and private.can_use_resources()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
