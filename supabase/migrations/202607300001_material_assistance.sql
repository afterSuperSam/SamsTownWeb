-- Material assistance ------------------------------------------------------
-- Litematica counts remain immutable source data. Community collection is
-- recorded separately so attribution and the leaderboard stay auditable.

create or replace function private.can_view_materials()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_role() in ('viewer', 'member', 'admin', 'owner'), false);
$$;

create or replace function private.can_edit_materials()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_role() in ('member', 'admin', 'owner'), false);
$$;

create table if not exists public.material_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  priority smallint not null default 1 check (priority between 1 and 3),
  storage_location text not null default '' check (char_length(storage_location) <= 500),
  source_title text not null default '' check (char_length(source_title) <= 240),
  source_date text not null default '' check (char_length(source_date) <= 120),
  creator_id uuid references public.profiles(id) on delete set null,
  creator_username text not null check (char_length(creator_username) between 1 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.material_projects(id) on delete cascade,
  item_id text not null check (item_id ~ '^[a-z0-9_.-]+:[a-z0-9_./-]+$'),
  name_zh text not null check (char_length(name_zh) between 1 and 160),
  name_en text not null check (char_length(name_en) between 1 and 160),
  image_url text check (image_url is null or image_url ~ '^https://'),
  total_count integer not null check (total_count >= 0),
  source_missing_count integer not null check (source_missing_count >= 0),
  initial_available_count integer not null check (initial_available_count >= 0),
  mismatched_count integer not null default 0 check (mismatched_count >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  unique (project_id, item_id)
);

create table if not exists public.material_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.material_items(id) on delete cascade,
  claimant_id uuid not null references public.profiles(id) on delete cascade,
  claimant_username text not null check (char_length(claimant_username) between 1 and 32),
  amount integer not null check (amount > 0),
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, claimant_id),
  check ((completed and completed_at is not null) or (not completed and completed_at is null))
);

create index if not exists material_projects_priority_idx
  on public.material_projects (priority desc, updated_at desc);
create index if not exists material_items_project_sort_idx
  on public.material_items (project_id, sort_order);
create index if not exists material_assignments_item_idx
  on public.material_assignments (item_id, completed);
create index if not exists material_assignments_leaderboard_idx
  on public.material_assignments (completed, claimant_id) where completed;

drop trigger if exists material_projects_updated_at on public.material_projects;
create trigger material_projects_updated_at before update on public.material_projects
  for each row execute procedure private.set_updated_at();
drop trigger if exists material_assignments_updated_at on public.material_assignments;
create trigger material_assignments_updated_at before update on public.material_assignments
  for each row execute procedure private.set_updated_at();

alter table public.material_projects enable row level security;
alter table public.material_items enable row level security;
alter table public.material_assignments enable row level security;

create policy "viewers read material projects" on public.material_projects for select to authenticated
  using (private.can_view_materials());
create policy "viewers read material items" on public.material_items for select to authenticated
  using (private.can_view_materials());
create policy "viewers read material assignments" on public.material_assignments for select to authenticated
  using (private.can_view_materials());

grant select on public.material_projects, public.material_items, public.material_assignments to authenticated;
revoke insert, update, delete on public.material_projects, public.material_items, public.material_assignments from anon, authenticated;
grant all privileges on public.material_projects, public.material_items, public.material_assignments to service_role;

-- One transaction creates the project and every imported material. Metadata
-- enrichment has already happened in Fastify; this function validates the
-- final payload again before persisting it.
create or replace function public.create_material_project(
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
begin
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  if jsonb_typeof(p_materials) <> 'array' then
    raise exception 'Invalid material list';
  end if;
  if jsonb_array_length(p_materials) not between 1 and 5000 then
    raise exception 'Invalid material list';
  end if;
  select profile.username into actor_username
  from public.profiles profile where profile.id = auth.uid();
  if actor_username is null then raise insufficient_privilege; end if;

  insert into public.material_projects (
    name, priority, storage_location, source_title, source_date, creator_id, creator_username
  ) values (
    trim(p_name), p_priority, coalesce(trim(p_storage_location), ''),
    coalesce(trim(p_source_title), ''), coalesce(trim(p_source_date), ''),
    auth.uid(), actor_username
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

create or replace function public.update_material_project(
  p_project_id uuid,
  p_priority integer,
  p_storage_location text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  update public.material_projects
  set priority = p_priority, storage_location = coalesce(trim(p_storage_location), '')
  where id = p_project_id;
  if not found then raise no_data_found; end if;
end;
$$;

-- Claim amounts are reserved under a row lock, preventing concurrent members
-- from assigning more blocks than the still-needed imported amount.
create or replace function public.set_material_claim(p_item_id uuid, p_amount integer)
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
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  select * into item_record from public.material_items where id = p_item_id for update;
  if not found then raise no_data_found; end if;

  select assignment.completed into existing_completed
  from public.material_assignments assignment
  where assignment.item_id = p_item_id and assignment.claimant_id = auth.uid();
  if coalesce(existing_completed, false) then raise exception 'error.materialClaimCompleted'; end if;

  if p_amount <= 0 then
    delete from public.material_assignments
    where item_id = p_item_id and claimant_id = auth.uid() and not completed;
    return null;
  end if;

  select coalesce(sum(assignment.amount), 0) into other_reserved
  from public.material_assignments assignment
  where assignment.item_id = p_item_id and assignment.claimant_id <> auth.uid();
  if other_reserved + p_amount > greatest(
    item_record.source_missing_count - item_record.initial_available_count,
    0
  ) then
    raise exception 'error.materialClaimExceeded' using errcode = '22003';
  end if;

  select profile.username into actor_username
  from public.profiles profile where profile.id = auth.uid();
  if actor_username is null then raise insufficient_privilege; end if;

  insert into public.material_assignments (item_id, claimant_id, claimant_username, amount)
  values (p_item_id, auth.uid(), actor_username, p_amount)
  on conflict (item_id, claimant_id) do update set amount = excluded.amount
  returning id into assignment_id;
  return assignment_id;
end;
$$;

create or replace function public.set_material_claim_completed(p_assignment_id uuid, p_completed boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can_edit_materials() then raise insufficient_privilege; end if;
  update public.material_assignments
  set completed = p_completed,
      completed_at = case when p_completed then now() else null end
  where id = p_assignment_id and claimant_id = auth.uid();
  if not found then raise no_data_found; end if;
end;
$$;

-- Viewer-safe read model. Only the public username needed for Minecraft
-- avatars is exposed; profile email and authentication data never leave Auth.
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
        'id', project.id,
        'name', project.name,
        'priority', project.priority,
        'storageLocation', project.storage_location,
        'sourceTitle', project.source_title,
        'sourceDate', project.source_date,
        'creatorId', project.creator_id,
        'creatorUsername', coalesce(profile.username, project.creator_username),
        'createdAt', project.created_at,
        'updatedAt', project.updated_at,
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
        'id', item.id,
        'projectId', item.project_id,
        'itemId', item.item_id,
        'nameZh', item.name_zh,
        'nameEn', item.name_en,
        'imageUrl', item.image_url,
        'totalCount', item.total_count,
        'sourceMissingCount', item.source_missing_count,
        'initialAvailableCount', item.initial_available_count,
        'mismatchedCount', item.mismatched_count,
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
        ), 0),
        'sortOrder', item.sort_order
      ) order by item.project_id, item.sort_order)
      from public.material_items item
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id,
        'itemId', assignment.item_id,
        'claimantId', assignment.claimant_id,
        'claimantUsername', coalesce(profile.username, assignment.claimant_username),
        'amount', assignment.amount,
        'completed', assignment.completed,
        'completedAt', assignment.completed_at,
        'createdAt', assignment.created_at
      ) order by assignment.created_at)
      from public.material_assignments assignment
      left join public.profiles profile on profile.id = assignment.claimant_id
    ), '[]'::jsonb),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claimantId', ranked.claimant_id,
        'username', ranked.username,
        'collectedCount', ranked.collected_count
      ) order by ranked.collected_count desc, ranked.username)
      from (
        select assignment.claimant_id,
          coalesce(profile.username, max(assignment.claimant_username)) as username,
          sum(assignment.amount)::bigint as collected_count
        from public.material_assignments assignment
        left join public.profiles profile on profile.id = assignment.claimant_id
        where assignment.completed
        group by assignment.claimant_id, profile.username
      ) ranked
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.create_material_project(text, integer, text, text, text, jsonb) from public, anon;
revoke all on function public.update_material_project(uuid, integer, text) from public, anon;
revoke all on function public.set_material_claim(uuid, integer) from public, anon;
revoke all on function public.set_material_claim_completed(uuid, boolean) from public, anon;
revoke all on function public.get_material_workspace() from public, anon;
grant execute on function public.create_material_project(text, integer, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.update_material_project(uuid, integer, text) to authenticated, service_role;
grant execute on function public.set_material_claim(uuid, integer) to authenticated, service_role;
grant execute on function public.set_material_claim_completed(uuid, boolean) to authenticated, service_role;
grant execute on function public.get_material_workspace() to authenticated, service_role;

do $$
begin
  alter publication supabase_realtime add table public.material_projects;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.material_items;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.material_assignments;
exception when duplicate_object then null;
end $$;
