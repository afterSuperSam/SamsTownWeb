-- v1.2.0 password gate and material workflow -------------------------------

-- A temporary-password account keeps its profile visible for the login UI but
-- receives no application role until Fastify has replaced the Auth password.
create or replace function private.current_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select profile.role
  from public.profiles profile
  where profile.id = auth.uid() and not profile.must_change_password;
$$;

revoke all on function public.mark_password_changed() from public, anon, authenticated, service_role;

-- Preserve completed contribution snapshots when an Auth profile is removed.
-- Pending reservations are released by prepare_account_deletion below.
alter table public.material_assignments
  drop constraint if exists material_assignments_claimant_id_fkey;
alter table public.material_assignments alter column claimant_id drop not null;
alter table public.material_assignments
  add constraint material_assignments_claimant_id_fkey
  foreign key (claimant_id) references public.profiles(id) on delete set null;

alter table public.material_assignments
  add column if not exists note text not null default '',
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by_username text not null default '';

update public.material_assignments
set updated_by = claimant_id,
    updated_by_username = claimant_username
where updated_by_username = '';

alter table public.material_assignments
  drop constraint if exists material_assignments_note_length;
alter table public.material_assignments
  add constraint material_assignments_note_length check (char_length(note) <= 2000);
alter table public.material_assignments
  drop constraint if exists material_assignments_updated_by_username_length;
alter table public.material_assignments
  add constraint material_assignments_updated_by_username_length
  check (char_length(updated_by_username) <= 32);

alter table public.material_items
  drop constraint if exists material_items_item_id_length;
alter table public.material_items
  add constraint material_items_item_id_length check (char_length(item_id) <= 200) not valid;
alter table public.material_items
  drop constraint if exists material_items_image_host;
alter table public.material_items
  add constraint material_items_image_host check (
    image_url is null or image_url ~ '^https://mcitemgallery\\.com/images/'
  ) not valid;

-- Project creation now has one trusted entrypoint. Fastify resolves metadata,
-- authenticates the Member, then invokes this service-role-only transaction.
drop function if exists public.create_material_project(text, integer, text, text, text, jsonb);
create or replace function public.create_material_project_server(
  p_actor_id uuid,
  p_name text,
  p_priority integer,
  p_storage_location text,
  p_source_title text,
  p_source_date text,
  p_materials jsonb
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
  if p_materials is null or jsonb_typeof(p_materials) <> 'array' then
    raise exception 'Invalid material list';
  end if;
  if jsonb_array_length(p_materials) not between 1 and 5000 then
    raise exception 'Invalid material list';
  end if;

  insert into public.material_projects (
    name, priority, storage_location, source_title, source_date, creator_id, creator_username
  ) values (
    trim(p_name), p_priority, coalesce(trim(p_storage_location), ''),
    coalesce(trim(p_source_title), ''), coalesce(trim(p_source_date), ''),
    p_actor_id, actor_username
  ) returning id into project_id;

  insert into public.material_items (
    project_id, item_id, name_zh, name_en, image_url, total_count,
    source_missing_count, initial_available_count, mismatched_count, sort_order
  )
  select
    project_id,
    item ->> 'itemId',
    item ->> 'nameZh',
    item ->> 'nameEn',
    nullif(item ->> 'imageUrl', ''),
    (item ->> 'totalCount')::integer,
    (item ->> 'missingCount')::integer,
    (item ->> 'availableCount')::integer,
    (item ->> 'mismatchedCount')::integer,
    (item ->> 'sortOrder')::integer
  from jsonb_array_elements(p_materials) item;

  return project_id;
end;
$$;

revoke all on function public.create_material_project_server(uuid, text, integer, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_material_project_server(uuid, text, integer, text, text, text, jsonb)
  to service_role;

-- One private primitive keeps single and batch claim rules identical.
create or replace function private.save_material_claim(
  p_actor_id uuid,
  p_item_id uuid,
  p_amount integer,
  p_note text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  item_record public.material_items%rowtype;
  assignment_id uuid;
  other_reserved bigint;
  actor_username text;
  existing_completed boolean;
begin
  if char_length(coalesce(p_note, '')) > 2000 then raise exception 'Invalid material note'; end if;
  select profile.username into actor_username from public.profiles profile where profile.id = p_actor_id;
  if actor_username is null then raise insufficient_privilege; end if;

  select * into item_record from public.material_items where id = p_item_id for update;
  if not found then raise no_data_found; end if;
  select assignment.completed into existing_completed
  from public.material_assignments assignment
  where assignment.item_id = p_item_id and assignment.claimant_id = p_actor_id;
  if coalesce(existing_completed, false) then raise exception 'error.materialClaimCompleted'; end if;

  if p_amount <= 0 then
    delete from public.material_assignments
    where item_id = p_item_id and claimant_id = p_actor_id and not completed;
    return null;
  end if;

  select coalesce(sum(assignment.amount), 0) into other_reserved
  from public.material_assignments assignment
  where assignment.item_id = p_item_id and assignment.claimant_id is distinct from p_actor_id;
  if other_reserved + p_amount > greatest(
    item_record.source_missing_count - item_record.initial_available_count, 0
  ) then
    raise exception 'error.materialClaimExceeded' using errcode = '22003';
  end if;

  insert into public.material_assignments (
    item_id, claimant_id, claimant_username, amount, note, updated_by, updated_by_username
  ) values (
    p_item_id, p_actor_id, actor_username, p_amount, coalesce(trim(p_note), ''), p_actor_id, actor_username
  )
  on conflict (item_id, claimant_id) do update set
    amount = excluded.amount,
    note = excluded.note,
    updated_by = excluded.updated_by,
    updated_by_username = excluded.updated_by_username
  returning id into assignment_id;
  return assignment_id;
end;
$$;

revoke all on function private.save_material_claim(uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;

drop function if exists public.set_material_claim(uuid, integer);
create or replace function public.set_material_claim(p_item_id uuid, p_amount integer, p_note text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  return private.save_material_claim(auth.uid(), p_item_id, p_amount, p_note);
end;
$$;

create or replace function public.set_material_claims(p_item_ids uuid[], p_amount integer, p_note text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  item_id uuid;
  changed integer := 0;
begin
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 5000 or p_amount <= 0 then
    raise exception 'Invalid batch claim';
  end if;
  for item_id in
    select distinct source.item_id
    from unnest(p_item_ids) as source(item_id)
    order by source.item_id
  loop
    perform private.save_material_claim(auth.uid(), item_id, p_amount, p_note);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

drop function if exists public.set_material_claim_completed(uuid, boolean);
create or replace function public.set_material_claim_completed(
  p_assignment_id uuid,
  p_completed boolean,
  p_note text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  actor_username text;
begin
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  if p_note is not null and char_length(p_note) > 2000 then raise exception 'Invalid material note'; end if;
  select profile.username into actor_username from public.profiles profile where profile.id = auth.uid();
  update public.material_assignments
  set completed = p_completed,
      completed_at = case when p_completed then now() else null end,
      note = case when p_note is null then note else trim(p_note) end,
      updated_by = auth.uid(),
      updated_by_username = actor_username
  where id = p_assignment_id and claimant_id = auth.uid();
  if not found then raise no_data_found; end if;
end;
$$;

create or replace function public.set_material_claims_completed(
  p_assignment_ids uuid[],
  p_completed boolean,
  p_note text default null
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  actor_username text;
  expected integer;
  changed integer;
begin
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  if p_assignment_ids is null or cardinality(p_assignment_ids) not between 1 and 5000 then
    raise exception 'Invalid batch completion';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then raise exception 'Invalid material note'; end if;
  select count(distinct source.assignment_id) into expected
  from unnest(p_assignment_ids) as source(assignment_id);
  select profile.username into actor_username from public.profiles profile where profile.id = auth.uid();
  update public.material_assignments
  set completed = p_completed,
      completed_at = case when p_completed then now() else null end,
      note = case when p_note is null then note else trim(p_note) end,
      updated_by = auth.uid(),
      updated_by_username = actor_username
  where id = any(p_assignment_ids) and claimant_id = auth.uid();
  get diagnostics changed = row_count;
  if changed <> expected then raise insufficient_privilege; end if;
  return changed;
end;
$$;

revoke all on function public.set_material_claim(uuid, integer, text) from public, anon;
revoke all on function public.set_material_claims(uuid[], integer, text) from public, anon;
revoke all on function public.set_material_claim_completed(uuid, boolean, text) from public, anon;
revoke all on function public.set_material_claims_completed(uuid[], boolean, text) from public, anon;
grant execute on function public.set_material_claim(uuid, integer, text) to authenticated, service_role;
grant execute on function public.set_material_claims(uuid[], integer, text) to authenticated, service_role;
grant execute on function public.set_material_claim_completed(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.set_material_claims_completed(uuid[], boolean, text) to authenticated, service_role;

-- Viewer-safe read model with immutable username snapshots for deleted users.
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

-- Account deletion releases unfinished reservations and preserves completed
-- rows through the SET NULL snapshot foreign key above.
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
  released_material_claims integer := 0;
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
  delete from public.material_assignments where claimant_id = p_target_id and not completed;
  get diagnostics released_material_claims = row_count;

  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values (p_actor_id, 'account.delete.prepare', 'account', p_target_id::text, jsonb_build_object(
    'previousRole', target_role,
    'transferredMaps', transferred_maps,
    'transferredClaims', transferred_claims,
    'transferredMarkers', transferred_markers,
    'transferredCommands', transferred_commands,
    'releasedMaterialClaims', released_material_claims
  ));
  insert into public.account_deletion_queue (user_id, requested_by)
  values (p_target_id, p_actor_id) on conflict (user_id) do nothing;
  delete from public.profiles where id = p_target_id;
  return jsonb_build_object(
    'pending', true,
    'transferredMaps', transferred_maps,
    'transferredClaims', transferred_claims,
    'transferredMarkers', transferred_markers,
    'transferredCommands', transferred_commands,
    'releasedMaterialClaims', released_material_claims
  );
end;
$$;

revoke all on function public.prepare_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid, uuid) to service_role;
