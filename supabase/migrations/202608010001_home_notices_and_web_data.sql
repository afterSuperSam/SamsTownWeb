-- Homepage editorial controls, aggregate-only page views, and immutable
-- seven-day operation history. No IP address, device fingerprint, or route
-- payload is stored.

alter table public.town_history
  add column if not exists show_on_home boolean not null default false;

update public.town_history
set show_on_home = true
where id in (
  select id from public.town_history order by sort_order, event_date limit 4
)
  and not exists (
    select 1 from public.town_history where show_on_home
  );

create or replace function public.replace_town_history(items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then raise insufficient_privilege; end if;

  delete from public.town_history where true;
  insert into public.town_history (
    event_date, title_zh, title_en, body_zh, body_en, image_id,
    show_on_home, sort_order
  )
  select
    item ->> 'event_date',
    item ->> 'title_zh',
    coalesce(item ->> 'title_en', ''),
    item ->> 'body_zh',
    coalesce(item ->> 'body_en', ''),
    nullif(item ->> 'image_id', '')::uuid,
    coalesce((item ->> 'show_on_home')::boolean, false),
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;

create table if not exists public.town_announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'announcement'
    check (kind in ('announcement', 'affair')),
  title_zh text not null check (char_length(trim(title_zh)) between 1 and 120),
  title_en text not null default '',
  subtitle_zh text not null default '',
  subtitle_en text not null default '',
  body_zh text not null default '',
  body_en text not null default '',
  image_id uuid references public.town_images(id) on delete set null,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists town_announcements_visible_sort_idx
  on public.town_announcements (is_visible, sort_order);

drop trigger if exists town_announcements_updated_at on public.town_announcements;
create trigger town_announcements_updated_at
before update on public.town_announcements
for each row execute procedure private.set_updated_at();

alter table public.town_announcements enable row level security;

drop policy if exists "public reads visible announcements" on public.town_announcements;
drop policy if exists "owners read all announcements" on public.town_announcements;
drop policy if exists "owners insert announcements" on public.town_announcements;
drop policy if exists "owners update announcements" on public.town_announcements;
drop policy if exists "owners delete announcements" on public.town_announcements;
create policy "public reads visible announcements"
  on public.town_announcements for select to anon, authenticated
  using (is_visible);
create policy "owners read all announcements"
  on public.town_announcements for select to authenticated
  using (private.is_owner());
create policy "owners insert announcements"
  on public.town_announcements for insert to authenticated
  with check (private.is_owner());
create policy "owners update announcements"
  on public.town_announcements for update to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "owners delete announcements"
  on public.town_announcements for delete to authenticated
  using (private.is_owner());

create or replace function public.replace_town_announcements(items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then raise insufficient_privilege; end if;

  delete from public.town_announcements where true;
  insert into public.town_announcements (
    kind, title_zh, title_en, subtitle_zh, subtitle_en, body_zh, body_en,
    image_id, is_visible, sort_order
  )
  select
    coalesce(item ->> 'kind', 'announcement'),
    trim(item ->> 'title_zh'),
    coalesce(item ->> 'title_en', ''),
    coalesce(item ->> 'subtitle_zh', ''),
    coalesce(item ->> 'subtitle_en', ''),
    coalesce(item ->> 'body_zh', ''),
    coalesce(item ->> 'body_en', ''),
    nullif(item ->> 'image_id', '')::uuid,
    coalesce((item ->> 'is_visible')::boolean, true),
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;

grant select on public.town_announcements to anon, authenticated;
grant insert, update, delete on public.town_announcements to authenticated;
revoke all on function public.replace_town_announcements(jsonb) from public, anon;
grant execute on function public.replace_town_announcements(jsonb) to authenticated;
revoke all on function public.replace_town_history(jsonb) from public, anon;
grant execute on function public.replace_town_history(jsonb) to authenticated;

-- Aggregate page views ------------------------------------------------------
create table if not exists public.daily_page_views (
  view_date date primary key,
  total_views bigint not null default 0 check (total_views >= 0),
  authenticated_views bigint not null default 0
    check (authenticated_views between 0 and total_views),
  updated_at timestamptz not null default now()
);

alter table public.daily_page_views enable row level security;
revoke all on public.daily_page_views from public, anon, authenticated;

drop function if exists public.record_page_view();
create or replace function public.record_page_view(p_authenticated boolean default false)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.daily_page_views (
    view_date, total_views, authenticated_views, updated_at
  )
  values (
    (now() at time zone 'Asia/Shanghai')::date,
    1,
    case when p_authenticated then 1 else 0 end,
    now()
  )
  on conflict (view_date) do update
  set total_views = public.daily_page_views.total_views + 1,
      authenticated_views = public.daily_page_views.authenticated_views
        + case when p_authenticated then 1 else 0 end,
      updated_at = now();
$$;

create or replace function public.get_page_view_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.is_owner() then raise insufficient_privilege; end if;

  select jsonb_build_object(
    'totalViews', coalesce((select sum(total_views) from public.daily_page_views), 0),
    'authenticatedViews', coalesce((select sum(authenticated_views) from public.daily_page_views), 0),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', day.view_date,
          'totalViews', day.total_views,
          'authenticatedViews', day.authenticated_views
        )
        order by day.view_date
      )
      from (
        select
          series::date as view_date,
          coalesce(views.total_views, 0) as total_views,
          coalesce(views.authenticated_views, 0) as authenticated_views
        from generate_series(
          (now() at time zone 'Asia/Shanghai')::date
            - (greatest(1, least(coalesce(p_days, 30), 365)) - 1),
          (now() at time zone 'Asia/Shanghai')::date,
          interval '1 day'
        ) as series
        left join public.daily_page_views views
          on views.view_date = series::date
      ) as day
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.record_page_view(boolean) from public, anon, authenticated;
grant execute on function public.record_page_view(boolean) to service_role;
revoke all on function public.get_page_view_analytics(integer) from public, anon;
grant execute on function public.get_page_view_analytics(integer) to authenticated;

-- Immutable operation history ---------------------------------------------
create or replace function private.audit_managed_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  actor uuid;
  actor_name text;
  category text;
  action_name text;
begin
  actor := coalesce(
    auth.uid(),
    nullif(source_row ->> 'owner_id', '')::uuid,
    nullif(source_row ->> 'creator_id', '')::uuid,
    nullif(source_row ->> 'created_by', '')::uuid,
    nullif(source_row ->> 'claimant_id', '')::uuid
  );
  select username into actor_name from public.profiles where id = actor;

  category := case
    when tg_table_name in ('map_claims', 'map_claim_cells') then 'map_claim'
    when tg_table_name = 'map_markers' then 'map_marker'
    when tg_table_name in ('material_projects', 'material_assignments') then 'material'
    when tg_table_name = 'resources' then 'resource'
    else tg_table_name
  end;
  action_name := case tg_op
    when 'INSERT' then 'add'
    when 'UPDATE' then 'update'
    else 'delete'
  end;

  delete from public.audit_logs
  where created_at < now() - interval '7 days'
    and target_type in ('map_claim', 'map_marker', 'material', 'resource');

  insert into public.audit_logs (
    actor_id, action, target_type, target_id, details
  ) values (
    actor,
    action_name,
    category,
    coalesce(source_row ->> 'id', source_row ->> 'claim_id', source_row ->> 'item_id'),
    jsonb_build_object(
      'category', category,
      'table', tg_table_name,
      'actorUsername', coalesce(actor_name, 'System'),
      'before', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'after', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'map_claims', 'map_markers', 'material_projects',
    'material_assignments', 'resources'
  ] loop
    execute format('drop trigger if exists managed_operation_audit on public.%I', table_name);
    execute format(
      'create trigger managed_operation_audit after insert or update or delete on public.%I for each row execute procedure private.audit_managed_change()',
      table_name
    );
  end loop;
end
$$;

create or replace function public.prune_operation_logs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  delete from public.audit_logs
  where created_at < now() - interval '7 days'
    and target_type in ('map_claim', 'map_marker', 'material', 'resource');
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function private.audit_managed_change() from public;
revoke all on function public.prune_operation_logs() from public, anon;
grant execute on function public.prune_operation_logs() to authenticated;
