-- Extend the existing public member directory instead of introducing a
-- second homepage-only roster. Existing RLS and grants remain unchanged.
alter table public.town_members
  add column show_on_home boolean not null default false,
  add column intro_zh text not null default '',
  add column intro_en text not null default '';

alter table public.town_members
  add constraint town_members_intro_zh_length check (char_length(intro_zh) <= 800),
  add constraint town_members_intro_en_length check (char_length(intro_en) <= 800);

update public.town_members
set show_on_home = lower(username) in (
  'aresgao', 'dogsam', 'tabularis', 'nani0416', 'nanio416'
);

create index town_members_home_sort_idx
  on public.town_members (sort_order, username)
  where show_on_home;

create or replace function public.replace_town_members(items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if items is null or jsonb_typeof(items) <> 'array'
    or jsonb_array_length(items) > 500 then
    raise exception 'error.invalidMembers';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(items) item
    where coalesce((item ->> 'show_on_home')::boolean, false)
  ) > 4 then
    raise exception 'error.tooManyHomeMembers';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(items) item
    where char_length(trim(coalesce(item ->> 'username', ''))) not between 1 and 64
      or char_length(coalesce(item ->> 'role_zh', '')) > 160
      or char_length(coalesce(item ->> 'role_en', '')) > 160
      or char_length(coalesce(item ->> 'intro_zh', '')) > 800
      or char_length(coalesce(item ->> 'intro_en', '')) > 800
      or coalesce(item ->> 'member_group', 'town') not in ('primary', 'town', 'friend')
  ) then
    raise exception 'error.invalidMembers';
  end if;

  delete from public.town_members where true;
  insert into public.town_members (
    username, role_zh, role_en, variant, member_group,
    show_on_home, intro_zh, intro_en, sort_order
  )
  select
    trim(item ->> 'username'),
    coalesce(item ->> 'role_zh', ''),
    coalesce(item ->> 'role_en', ''),
    coalesce(item ->> 'variant', ''),
    coalesce(item ->> 'member_group', 'town'),
    coalesce((item ->> 'show_on_home')::boolean, false),
    coalesce(item ->> 'intro_zh', ''),
    coalesce(item ->> 'intro_en', ''),
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;

revoke all on function public.replace_town_members(jsonb) from public, anon;
grant execute on function public.replace_town_members(jsonb) to authenticated, service_role;
