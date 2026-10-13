-- Material project placement and private projection files.
alter table public.material_projects
  add column projection_origin_x integer not null default 0,
  add column projection_origin_y integer not null default 0,
  add column projection_origin_z integer not null default 0,
  add column projection_mirror text not null default 'none',
  add column projection_rotation smallint not null default 0,
  add column projection_file_name text,
  add column projection_storage_path text,
  add column projection_file_size bigint,
  add column projection_content_type text;

alter table public.material_projects
  add constraint material_projects_projection_mirror_check
    check (projection_mirror in ('none', 'left_right', 'front_back')),
  add constraint material_projects_projection_rotation_check
    check (projection_rotation in (0, 90, 180, 270)),
  add constraint material_projects_projection_file_name_check
    check (projection_file_name is null or char_length(projection_file_name) between 1 and 255),
  add constraint material_projects_projection_storage_path_check
    check (projection_storage_path is null or projection_storage_path ~ '^[0-9a-f-]{36}/material-projects/[0-9a-f-]{36}/[0-9a-f-]{36}\.(litematic|schem|schematic|nbt)$'),
  add constraint material_projects_projection_file_size_check
    check (projection_file_size is null or projection_file_size between 1 and 6291456),
  add constraint material_projects_projection_file_metadata_check
    check ((projection_storage_path is null) = (projection_file_name is null)
      and (projection_storage_path is null) = (projection_file_size is null)
      and (projection_storage_path is null) = (projection_content_type is null));

create unique index material_projects_projection_storage_path_idx
  on public.material_projects (projection_storage_path)
  where projection_storage_path is not null;

-- Project deletion and Storage cleanup are recorded atomically. The existing
-- cleanup worker removes the private object with retries after the row commit.
create or replace function public.admin_delete_material_project(p_project_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target_path text;
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  delete from public.material_projects
  where id = p_project_id
  returning projection_storage_path into target_path;
  if not found then raise no_data_found; end if;
  if target_path is not null then
    insert into public.storage_cleanup_queue (
      bucket_id, object_path, requested_by, status, next_attempt_at, locked_at, last_error
    ) values (
      'schematics', target_path, auth.uid(), 'pending', clock_timestamp(), null, null
    )
    on conflict (bucket_id, object_path, recursive) do update
    set requested_by = excluded.requested_by,
        status = 'pending', next_attempt_at = clock_timestamp(),
        locked_at = null, last_error = null;
  end if;
end;
$$;

-- Project creation remains one transaction; the browser never writes project
-- rows or Storage metadata directly.
drop function if exists public.create_material_project_server(uuid, text, integer, text, text, text, jsonb);
create or replace function public.create_material_project_server(
  p_actor_id uuid,
  p_name text,
  p_priority integer,
  p_storage_location text,
  p_source_title text,
  p_source_date text,
  p_materials jsonb,
  p_projection_origin_x integer,
  p_projection_origin_y integer,
  p_projection_origin_z integer,
  p_projection_mirror text,
  p_projection_rotation integer
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  project_id uuid;
  actor_username text;
  actor_role public.app_role;
begin
  select profile.username, profile.role into actor_username, actor_role
  from public.profiles profile
  where profile.id = p_actor_id and not profile.must_change_password;
  if actor_role is null or actor_role not in ('member', 'admin', 'owner') then
    raise insufficient_privilege;
  end if;
  if p_materials is null or jsonb_typeof(p_materials) <> 'array'
    or jsonb_array_length(p_materials) not between 1 and 5000 then
    raise exception 'Invalid material list';
  end if;
  if p_priority not between 1 and 3
    or p_projection_mirror not in ('none', 'left_right', 'front_back')
    or p_projection_rotation not in (0, 90, 180, 270) then
    raise exception 'error.invalidMaterialProject';
  end if;

  insert into public.material_projects (
    name, priority, storage_location, source_title, source_date,
    creator_id, creator_username, projection_origin_x, projection_origin_y,
    projection_origin_z, projection_mirror, projection_rotation
  ) values (
    trim(p_name), p_priority, coalesce(trim(p_storage_location), ''),
    coalesce(trim(p_source_title), ''), coalesce(trim(p_source_date), ''),
    p_actor_id, actor_username, p_projection_origin_x, p_projection_origin_y,
    p_projection_origin_z, p_projection_mirror, p_projection_rotation
  ) returning id into project_id;

  insert into public.material_items (
    project_id, item_id, name_zh, name_en, image_url, total_count,
    source_missing_count, initial_available_count, mismatched_count, sort_order
  )
  select
    project_id, item ->> 'itemId', item ->> 'nameZh', item ->> 'nameEn',
    nullif(item ->> 'imageUrl', ''), (item ->> 'totalCount')::integer,
    (item ->> 'missingCount')::integer, (item ->> 'availableCount')::integer,
    (item ->> 'mismatchedCount')::integer, (item ->> 'sortOrder')::integer
  from jsonb_array_elements(p_materials) item;

  return project_id;
end;
$$;

revoke all on function public.create_material_project_server(
  uuid, text, integer, text, text, text, jsonb, integer, integer, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.create_material_project_server(
  uuid, text, integer, text, text, text, jsonb, integer, integer, integer, text, integer
) to service_role;

create or replace function public.update_material_projection(
  p_project_id uuid,
  p_origin_x integer,
  p_origin_y integer,
  p_origin_z integer,
  p_mirror text,
  p_rotation integer,
  p_file_name text default null,
  p_storage_path text default null,
  p_file_size bigint default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  previous_path text;
begin
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  if p_origin_x is null or p_origin_x not between -30000000 and 30000000
    or p_origin_y is null
    or p_origin_y not between -2048 and 2048
    or p_origin_z is null
    or p_origin_z not between -30000000 and 30000000
    or p_mirror not in ('none', 'left_right', 'front_back')
    or p_rotation not in (0, 90, 180, 270) then
    raise exception 'error.invalidMaterialProjection';
  end if;
  if p_storage_path is not null and (
    p_file_name is null or char_length(p_file_name) not between 1 and 255
    or p_file_size is null or p_file_size not between 1 and 6291456
    or (storage.foldername(p_storage_path))[1] is distinct from auth.uid()::text
    or (storage.foldername(p_storage_path))[2] is distinct from 'material-projects'
    or (storage.foldername(p_storage_path))[3] is distinct from p_project_id::text
    or not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'schematics' and object.name = p_storage_path
    )
  ) then
    raise exception 'error.invalidMaterialProjection';
  end if;

  select projection_storage_path into previous_path
  from public.material_projects where id = p_project_id for update;
  if not found then raise no_data_found; end if;
  update public.material_projects set
    projection_origin_x = p_origin_x,
    projection_origin_y = p_origin_y,
    projection_origin_z = p_origin_z,
    projection_mirror = p_mirror,
    projection_rotation = p_rotation,
    projection_file_name = case when p_storage_path is null then projection_file_name else p_file_name end,
    projection_storage_path = case when p_storage_path is null then projection_storage_path else p_storage_path end,
    projection_file_size = case when p_storage_path is null then projection_file_size else p_file_size end,
    projection_content_type = case when p_storage_path is null then projection_content_type else 'application/octet-stream' end
  where id = p_project_id;
  if p_storage_path is not null and previous_path is not null and previous_path <> p_storage_path then
    insert into public.storage_cleanup_queue (
      bucket_id, object_path, requested_by, status, next_attempt_at, locked_at, last_error
    ) values (
      'schematics', previous_path, auth.uid(), 'pending', clock_timestamp(), null, null
    )
    on conflict (bucket_id, object_path, recursive) do update
    set requested_by = excluded.requested_by,
        status = 'pending', next_attempt_at = clock_timestamp(),
        locked_at = null, last_error = null;
  end if;
  return previous_path;
end;
$$;

revoke all on function public.update_material_projection(
  uuid, integer, integer, integer, text, integer, text, text, bigint
) from public, anon;
grant execute on function public.update_material_projection(
  uuid, integer, integer, integer, text, integer, text, text, bigint
) to authenticated, service_role;

create or replace function public.get_material_workspace()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.can_view_materials() then raise insufficient_privilege; end if;
  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', project.id, 'name', project.name, 'priority', project.priority,
        'storageLocation', project.storage_location, 'sourceTitle', project.source_title,
        'sourceDate', project.source_date, 'creatorId', project.creator_id,
        'creatorUsername', coalesce(profile.username, project.creator_username),
        'originX', project.projection_origin_x, 'originY', project.projection_origin_y,
        'originZ', project.projection_origin_z, 'mirror', project.projection_mirror,
        'rotation', project.projection_rotation, 'projectionFileName', project.projection_file_name,
        'projectionFileSize', project.projection_file_size,
        'projectionStoragePath', project.projection_storage_path,
        'hasProjectionFile', project.projection_storage_path is not null,
        'createdAt', project.created_at, 'updatedAt', project.updated_at,
        'itemCount', (select count(*) from public.material_items item where item.project_id = project.id),
        'totalCount', (select coalesce(sum(item.total_count), 0) from public.material_items item where item.project_id = project.id),
        'missingCount', (select coalesce(sum(greatest(
          item.source_missing_count - item.initial_available_count - coalesce((
            select sum(assignment.amount) from public.material_assignments assignment
            where assignment.item_id = item.id and assignment.completed
          ), 0), 0
        )), 0) from public.material_items item where item.project_id = project.id)
      ) order by project.priority desc, project.updated_at desc)
      from public.material_projects project
      left join public.profiles profile on profile.id = project.creator_id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id, 'projectId', item.project_id, 'itemId', item.item_id,
        'nameZh', item.name_zh, 'nameEn', item.name_en, 'imageUrl', item.image_url,
        'totalCount', item.total_count, 'sourceMissingCount', item.source_missing_count,
        'initialAvailableCount', item.initial_available_count, 'mismatchedCount', item.mismatched_count,
        'existingCount', item.initial_available_count + coalesce((
          select sum(assignment.amount) from public.material_assignments assignment
          where assignment.item_id = item.id and assignment.completed
        ), 0),
        'missingCount', greatest(item.source_missing_count - item.initial_available_count - coalesce((
          select sum(assignment.amount) from public.material_assignments assignment
          where assignment.item_id = item.id and assignment.completed
        ), 0), 0),
        'reservedCount', coalesce((
          select sum(assignment.amount) from public.material_assignments assignment
          where assignment.item_id = item.id
        ), 0), 'sortOrder', item.sort_order
      ) order by item.project_id, item.sort_order)
      from public.material_items item
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id, 'itemId', assignment.item_id,
        'claimantId', assignment.claimant_id,
        'claimantUsername', coalesce(profile.username, assignment.claimant_username),
        'amount', assignment.amount, 'completed', assignment.completed,
        'completedAt', assignment.completed_at, 'note', assignment.note,
        'updatedById', assignment.updated_by,
        'updatedByUsername', coalesce(editor.username, assignment.updated_by_username),
        'createdAt', assignment.created_at, 'updatedAt', assignment.updated_at
      ) order by assignment.created_at)
      from public.material_assignments assignment
      left join public.profiles profile on profile.id = assignment.claimant_id
      left join public.profiles editor on editor.id = assignment.updated_by
    ), '[]'::jsonb),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claimantId', ranked.claimant_id, 'username', ranked.username,
        'collectedCount', ranked.collected_count
      ) order by ranked.collected_count desc, ranked.username)
      from (
        select assignment.claimant_id,
          coalesce(profile.username, assignment.claimant_username) as username,
          sum(assignment.amount)::bigint as collected_count
        from public.material_assignments assignment
        left join public.profiles profile on profile.id = assignment.claimant_id
        where assignment.completed
        group by assignment.claimant_id, coalesce(profile.username, assignment.claimant_username)
      ) ranked
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
