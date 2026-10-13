alter table public.town_members
  add column if not exists member_group text not null default 'town'
  check (member_group in ('primary', 'town', 'friend'));

update public.town_members
set member_group = case
  when username in ('Aresgao', 'NaniO416', 'Kilmaus', 'FSJhxm', 'DogSam', 'Tabularis') then 'primary'
  when variant = 'friend' then 'friend'
  else 'town'
end;

create index if not exists town_members_group_sort_idx
  on public.town_members (member_group, sort_order);

create or replace function public.replace_town_members(items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.town_members;
  insert into public.town_members
    (username, role_zh, role_en, variant, member_group, sort_order)
  select
    item ->> 'username',
    coalesce(item ->> 'role_zh', ''),
    coalesce(item ->> 'role_en', ''),
    coalesce(item ->> 'variant', ''),
    case
      when item ->> 'member_group' in ('primary', 'town', 'friend')
        then item ->> 'member_group'
      else 'town'
    end,
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;

revoke all on function public.replace_town_members(jsonb) from public, anon;
grant execute on function public.replace_town_members(jsonb) to authenticated, service_role;;
