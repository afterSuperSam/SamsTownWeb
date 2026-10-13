-- v1.6.0 security and consistency hardening -------------------------------

-- Auth users created outside the trusted Fastify provisioning path must not
-- receive an immediately usable Viewer profile, even if public signup is
-- accidentally enabled in a future environment.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_provisioning boolean :=
    coalesce(new.raw_app_meta_data ->> 'yingwu_trusted_provisioning', 'false') = 'true';
  requested_pending boolean :=
    coalesce(new.raw_user_meta_data ->> 'qq_registration_pending', 'true') <> 'false';
begin
  insert into public.profiles (id, username, qq_registration_pending)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)),
    (not trusted_provisioning) or requested_pending
  );
  return new;
end;
$$;

-- Only visible page media is public metadata. The archival `other` area is
-- intentionally Owner-only and is not exposed by the public catalogue.
drop policy if exists "public reads town images" on public.town_images;
drop policy if exists "public reads image metadata" on public.town_images;
drop policy if exists "public reads visible images" on public.town_images;
drop policy if exists "owners read all images" on public.town_images;
create policy "public reads visible images" on public.town_images for select
  to anon, authenticated
  using (is_visible and area <> 'other');
create policy "owners read all images" on public.town_images for select
  to authenticated
  using (private.is_owner());

-- A public bucket can serve a known object URL without a broad SELECT policy.
-- Removing anonymous SELECT prevents directory listing while retaining public
-- page images. Owners still need SELECT for update/delete operations.
drop policy if exists "public downloads site images" on storage.objects;
drop policy if exists "public reads site images" on storage.objects;
drop policy if exists "owners read site images" on storage.objects;
create policy "owners read site images" on storage.objects for select
  to authenticated
  using (bucket_id = 'site-images' and private.is_owner());

-- Serialize the database commit of map replacements and return the prefix
-- that was actually replaced. This prevents concurrent conversions from
-- leaving the first newly uploaded revision orphaned.
create or replace function public.commit_town_map_image_v2(
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_map public.town_maps;
  updated_map public.town_maps;
  dimensions_changed boolean;
begin
  select * into previous_map
  from public.town_maps
  where id = p_map_id
  for update;
  if not found then raise no_data_found; end if;

  dimensions_changed := previous_map.image_width <> p_image_width
    or previous_map.image_height <> p_image_height;
  if dimensions_changed and not p_clear_existing then
    raise exception 'error.mapDimensionsChanged';
  end if;
  if dimensions_changed then
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

  return jsonb_build_object(
    'map', to_jsonb(updated_map),
    'replacedStoragePrefix', previous_map.storage_prefix
  );
end;
$$;

revoke all on function public.commit_town_map_image_v2(
  uuid, integer, integer, integer, integer, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.commit_town_map_image_v2(
  uuid, integer, integer, integer, integer, uuid, text, text, boolean
) to service_role;

-- Retry queues use leases, exponential backoff, and a terminal dead-letter
-- state so one permanent failure cannot starve newer cleanup work.
alter table public.storage_cleanup_queue
  add column if not exists status text not null default 'pending',
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists requested_by uuid references public.profiles(id) on delete set null;
alter table public.storage_cleanup_queue
  drop constraint if exists storage_cleanup_queue_status_check;
alter table public.storage_cleanup_queue
  add constraint storage_cleanup_queue_status_check
  check (status in ('pending', 'processing', 'dead'));
create index if not exists storage_cleanup_queue_ready_idx
  on public.storage_cleanup_queue (status, next_attempt_at, created_at);

alter table public.account_deletion_queue
  add column if not exists status text not null default 'pending',
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz;
alter table public.account_deletion_queue
  drop constraint if exists account_deletion_queue_status_check;
alter table public.account_deletion_queue
  add constraint account_deletion_queue_status_check
  check (status in ('pending', 'processing', 'dead'));
create index if not exists account_deletion_queue_ready_idx
  on public.account_deletion_queue (status, next_attempt_at, requested_at);

create or replace function public.claim_storage_cleanup_batch(p_limit integer default 50)
returns setof public.storage_cleanup_queue
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.storage_cleanup_queue
  set status = 'pending', locked_at = null, next_attempt_at = clock_timestamp()
  where status = 'processing'
    and locked_at < clock_timestamp() - interval '15 minutes';

  return query
  with claimed as (
    select queue.id
    from public.storage_cleanup_queue queue
    where queue.status = 'pending'
      and queue.next_attempt_at <= clock_timestamp()
    order by queue.next_attempt_at, queue.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
  )
  update public.storage_cleanup_queue queue
  set status = 'processing', locked_at = clock_timestamp()
  from claimed
  where queue.id = claimed.id
  returning queue.*;
end;
$$;

create or replace function public.claim_account_deletion_batch(p_limit integer default 20)
returns setof public.account_deletion_queue
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_deletion_queue
  set status = 'pending', locked_at = null, next_attempt_at = clock_timestamp()
  where status = 'processing'
    and locked_at < clock_timestamp() - interval '15 minutes';

  return query
  with claimed as (
    select queue.user_id
    from public.account_deletion_queue queue
    where queue.status = 'pending'
      and queue.next_attempt_at <= clock_timestamp()
    order by queue.next_attempt_at, queue.requested_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 20), 1), 20)
  )
  update public.account_deletion_queue queue
  set status = 'processing', locked_at = clock_timestamp()
  from claimed
  where queue.user_id = claimed.user_id
  returning queue.*;
end;
$$;

revoke all on function public.claim_storage_cleanup_batch(integer)
  from public, anon, authenticated;
revoke all on function public.claim_account_deletion_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup_batch(integer) to service_role;
grant execute on function public.claim_account_deletion_batch(integer) to service_role;

-- A browser may enqueue only a real object it owns. Limiting each user to 20
-- live requests prevents fabricated paths from filling the worker queue.
create or replace function public.queue_own_storage_cleanup(p_bucket text, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_path is null or char_length(p_path) not between 1 and 512 or p_path like '%..%' then
    raise invalid_parameter_value;
  end if;
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

  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = p_bucket and object.name = p_path
  ) then
    return;
  end if;
  if (
    select count(*) from public.storage_cleanup_queue queue
    where queue.requested_by = auth.uid() and queue.status <> 'dead'
  ) >= 20 then
    raise exception 'error.storageCleanupRateLimit';
  end if;

  insert into public.storage_cleanup_queue (
    bucket_id, object_path, requested_by, status, next_attempt_at, locked_at, last_error
  ) values (
    p_bucket, p_path, auth.uid(), 'pending', clock_timestamp(), null, null
  )
  on conflict (bucket_id, object_path, recursive) do update
  set requested_by = excluded.requested_by,
      status = 'pending', next_attempt_at = clock_timestamp(),
      locked_at = null, last_error = null;
end;
$$;

-- Database-side input limits protect PostgREST writes that bypass the React
-- forms. Existing rows are left intact; every new or updated row is checked.
alter table public.resources
  add constraint resources_name_length check (char_length(trim(name)) between 1 and 120) not valid,
  add constraint resources_description_length check (char_length(description) <= 2000) not valid,
  add constraint resources_type_length check (char_length(resource_type) between 1 and 50) not valid,
  add constraint resources_project_type_length check (char_length(project_type) between 1 and 50) not valid,
  add constraint resources_url_length check (char_length(url) <= 2048) not valid,
  add constraint resources_icon_url_length check (icon_url is null or char_length(icon_url) <= 2048) not valid,
  add constraint resources_tags_bounds check (
    cardinality(tags) <= 20 and char_length(array_to_string(tags, '')) <= 1600
  ) not valid,
  add constraint resources_loaders_bounds check (
    cardinality(loaders) <= 40 and char_length(array_to_string(loaders, '')) <= 1600
  ) not valid,
  add constraint resources_game_versions_bounds check (
    cardinality(game_versions) <= 100 and char_length(array_to_string(game_versions, '')) <= 4000
  ) not valid;

alter table public.schematics
  add constraint schematics_name_length check (char_length(trim(name)) between 1 and 120) not valid,
  add constraint schematics_description_length check (char_length(description) <= 2000) not valid,
  add constraint schematics_author_length check (char_length(author) <= 120) not valid,
  add constraint schematics_file_name_length check (char_length(file_name) between 1 and 255) not valid,
  add constraint schematics_storage_path_length check (char_length(storage_path) between 1 and 512) not valid;

drop policy if exists "members update shared files" on public.schematics;
drop policy if exists "creators update own shared files" on public.schematics;
drop policy if exists "owners update shared files" on public.schematics;
create policy "creators update own shared files" on public.schematics for update
  to authenticated
  using (private.can_use_resources() and created_by = auth.uid())
  with check (private.can_use_resources() and created_by = auth.uid());
create policy "owners update shared files" on public.schematics for update
  to authenticated
  using (private.is_owner()) with check (private.is_owner());

-- Admin map managers need a narrow account directory without receiving access
-- to the full profiles table through RLS.
create or replace function public.list_map_owners()
returns table(id uuid, username text, role public.app_role, must_change_password boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_maps() then raise insufficient_privilege; end if;
  return query
  select profile.id, profile.username, profile.role, profile.must_change_password
  from public.profiles profile
  order by profile.username;
end;
$$;
revoke all on function public.list_map_owners() from public, anon;
grant execute on function public.list_map_owners() to authenticated, service_role;

-- Bound legacy OFFSET pagination so a hostile client cannot force the forum
-- RPC to scan an arbitrarily deep result set. The UI stays below this ceiling.
create or replace function public.list_forum_posts(
  p_kind text default null,
  p_limit integer default 5,
  p_offset integer default 0,
  p_author_id uuid default null
)
returns table (
  id uuid,
  title text,
  kind text,
  body text,
  author_id uuid,
  author_username text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_owner boolean := private.is_owner();
  safe_limit integer;
  safe_offset integer;
begin
  if not private.can_view_forum() then raise insufficient_privilege; end if;
  if p_kind is not null and p_kind not in ('task', 'anecdote', 'event') then raise check_violation; end if;
  if p_author_id is not null and not (
    actor_is_owner or (private.can_write_forum() and p_author_id = actor_id)
  ) then raise insufficient_privilege; end if;

  safe_limit := least(greatest(coalesce(p_limit, 5), 1), 100);
  safe_offset := least(greatest(coalesce(p_offset, 0), 0), 5000);
  if not actor_is_owner and p_author_id is null then
    safe_limit := least(safe_limit, 5);
    safe_offset := 0;
  end if;

  return query
  select post.id, post.title, post.kind, post.body, post.author_id,
    post.author_username, post.created_at, post.updated_at
  from public.forum_posts post
  where (p_kind is null or post.kind = p_kind)
    and (p_author_id is null or post.author_id = p_author_id)
  order by post.created_at desc, post.id desc
  limit safe_limit offset safe_offset;
end;
$$;

revoke all on function public.list_forum_posts(text, integer, integer, uuid) from public, anon;
grant execute on function public.list_forum_posts(text, integer, integer, uuid) to authenticated;
