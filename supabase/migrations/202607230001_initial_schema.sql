-- Extensions -----------------------------------------------------------------
create extension if not exists pgcrypto;
create schema if not exists private;

-- Shared helpers --------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Auth profiles and role checks ----------------------------------------------
create type public.app_role as enum ('owner', 'admin', 'editor', 'viewer');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 2 and 32),
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure private.handle_new_user();

create or replace function private.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function private.can_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role() in ('owner', 'admin', 'editor'), false);
$$;

create or replace function private.can_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role() in ('owner', 'admin'), false);
$$;

-- Public website content ------------------------------------------------------
create table public.site_content (
  id smallint primary key default 1 check (id = 1),
  content jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.town_members (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  role_zh text not null default '',
  role_en text not null default '',
  variant text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index town_members_sort_idx on public.town_members (sort_order, username);

create table public.town_history (
  id uuid primary key default gen_random_uuid(),
  event_date text not null,
  title_zh text not null,
  title_en text not null default '',
  body_zh text not null,
  body_en text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index town_history_sort_idx on public.town_history (sort_order, created_at);

-- Atomic ordered-content replacement ----------------------------------------
create or replace function public.replace_town_members(items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.town_members;
  insert into public.town_members (username, role_zh, role_en, variant, sort_order)
  select
    item ->> 'username',
    coalesce(item ->> 'role_zh', ''),
    coalesce(item ->> 'role_en', ''),
    coalesce(item ->> 'variant', ''),
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;

create or replace function public.replace_town_history(items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.town_history;
  insert into public.town_history (event_date, title_zh, title_en, body_zh, body_en, sort_order)
  select
    item ->> 'event_date',
    item ->> 'title_zh',
    coalesce(item ->> 'title_en', ''),
    item ->> 'body_zh',
    coalesce(item ->> 'body_en', ''),
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;

-- Resources and Litematic metadata -------------------------------------------
create type public.resource_source as enum ('modrinth', 'github', 'minecraft');

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  source public.resource_source not null,
  resource_type text not null default 'resource',
  url text not null check (url ~ '^https?://'),
  icon_url text check (icon_url is null or icon_url ~ '^https?://'),
  tags text[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resources_source_created_idx on public.resources (source, created_at desc);
create index resources_tags_idx on public.resources using gin (tags);

create table public.schematics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  author text not null,
  file_name text not null,
  storage_path text not null unique,
  file_size bigint not null check (file_size between 1 and 26214400),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index schematics_created_idx on public.schematics (created_at desc);

-- Future Minecraft server integration ----------------------------------------
create table public.game_servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'offline' check (status in ('online', 'offline', 'degraded')),
  version text,
  online_players integer not null default 0 check (online_players >= 0),
  max_players integer not null default 0 check (max_players >= 0),
  map_url text check (map_url is null or map_url ~ '^https?://'),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_profiles (
  id uuid primary key default gen_random_uuid(),
  minecraft_uuid uuid not null unique,
  username text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  playtime_seconds bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index player_profiles_username_idx on public.player_profiles (lower(username));

create table public.server_metrics (
  id bigint generated always as identity primary key,
  server_id uuid not null references public.game_servers(id) on delete cascade,
  sampled_at timestamptz not null default now(),
  tps numeric(5,2),
  mspt numeric(8,2),
  memory_used_bytes bigint,
  online_players integer not null default 0
);
create index server_metrics_server_time_idx on public.server_metrics (server_id, sampled_at desc);

create type public.command_status as enum ('pending', 'sent', 'succeeded', 'failed', 'expired');

create table public.server_commands (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.game_servers(id) on delete cascade,
  command_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.command_status not null default 'pending',
  requested_by uuid not null references public.profiles(id),
  result jsonb,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
create index server_commands_pending_idx on public.server_commands (server_id, requested_at)
  where status = 'pending';

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

-- Updated-at triggers ---------------------------------------------------------
create trigger profiles_updated_at before update on public.profiles
  for each row execute procedure private.set_updated_at();
create trigger members_updated_at before update on public.town_members
  for each row execute procedure private.set_updated_at();
create trigger history_updated_at before update on public.town_history
  for each row execute procedure private.set_updated_at();
create trigger resources_updated_at before update on public.resources
  for each row execute procedure private.set_updated_at();
create trigger schematics_updated_at before update on public.schematics
  for each row execute procedure private.set_updated_at();
create trigger servers_updated_at before update on public.game_servers
  for each row execute procedure private.set_updated_at();
create trigger player_profiles_updated_at before update on public.player_profiles
  for each row execute procedure private.set_updated_at();

-- Row-level security ----------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.site_content enable row level security;
alter table public.town_members enable row level security;
alter table public.town_history enable row level security;
alter table public.resources enable row level security;
alter table public.schematics enable row level security;
alter table public.game_servers enable row level security;
alter table public.player_profiles enable row level security;
alter table public.server_metrics enable row level security;
alter table public.server_commands enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles read authenticated" on public.profiles
  for select to authenticated using (true);
create policy "owners update profiles" on public.profiles
  for update to authenticated using (private.current_role() = 'owner')
  with check (private.current_role() = 'owner');

create policy "public reads content" on public.site_content for select using (true);
create policy "editors insert content" on public.site_content for insert to authenticated
  with check (private.can_edit());
create policy "editors update content" on public.site_content for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete content" on public.site_content for delete to authenticated
  using (private.can_edit());

create policy "public reads members" on public.town_members for select using (true);
create policy "editors insert members" on public.town_members for insert to authenticated
  with check (private.can_edit());
create policy "editors update members" on public.town_members for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete members" on public.town_members for delete to authenticated
  using (private.can_edit());

create policy "public reads history" on public.town_history for select using (true);
create policy "editors insert history" on public.town_history for insert to authenticated
  with check (private.can_edit());
create policy "editors update history" on public.town_history for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete history" on public.town_history for delete to authenticated
  using (private.can_edit());

create policy "public reads resources" on public.resources for select using (true);
create policy "editors insert resources" on public.resources for insert to authenticated
  with check (private.can_edit());
create policy "editors update resources" on public.resources for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete resources" on public.resources for delete to authenticated
  using (private.can_edit());

create policy "public reads schematic metadata" on public.schematics for select using (true);
create policy "editors insert schematics" on public.schematics for insert to authenticated
  with check (private.can_edit());
create policy "editors update schematics" on public.schematics for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete schematics" on public.schematics for delete to authenticated
  using (private.can_edit());

create policy "public reads server status" on public.game_servers for select using (true);
create policy "public reads player profiles" on public.player_profiles for select using (true);
create policy "public reads recent metrics" on public.server_metrics for select using (true);
create policy "admins read commands" on public.server_commands for select to authenticated
  using (private.can_admin());
create policy "admins create commands" on public.server_commands for insert to authenticated
  with check (private.can_admin() and requested_by = (select auth.uid()));
create policy "admins read audit logs" on public.audit_logs for select to authenticated
  using (private.can_admin());

-- Storage bucket and policies -------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('schematics', 'schematics', true, 26214400, array['application/octet-stream'])
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "public downloads schematics" on storage.objects for select
  using (bucket_id = 'schematics');
create policy "editors upload schematics" on storage.objects for insert to authenticated
  with check (bucket_id = 'schematics' and private.can_edit());
create policy "editors update schematics" on storage.objects for update to authenticated
  using (bucket_id = 'schematics' and private.can_edit())
  with check (bucket_id = 'schematics' and private.can_edit());
create policy "editors delete schematics" on storage.objects for delete to authenticated
  using (bucket_id = 'schematics' and private.can_edit());

-- Explicit Data API grants ---------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;

grant select on public.site_content, public.town_members, public.town_history,
  public.resources, public.schematics, public.game_servers,
  public.player_profiles, public.server_metrics to anon;

grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.site_content, public.town_members,
  public.town_history, public.resources, public.schematics to authenticated;
grant insert on public.server_commands to authenticated;

grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function private.current_role() from public;
revoke all on function private.can_edit() from public;
revoke all on function private.can_admin() from public;
grant execute on function private.current_role() to authenticated, service_role;
grant execute on function private.can_edit() to authenticated, service_role;
grant execute on function private.can_admin() to authenticated, service_role;
revoke all on function public.replace_town_members(jsonb) from public, anon;
revoke all on function public.replace_town_history(jsonb) from public, anon;
grant execute on function public.replace_town_members(jsonb) to authenticated, service_role;
grant execute on function public.replace_town_history(jsonb) to authenticated, service_role;

-- Initial singleton row -------------------------------------------------------
insert into public.site_content (id, content) values (1, '{}'::jsonb)
on conflict (id) do nothing;
