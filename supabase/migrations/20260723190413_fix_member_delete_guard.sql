create or replace function public.replace_town_members(items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_edit() then
    raise exception using errcode = '42501', message = '仅 editor、admin 或 owner 可以修改成员';
  end if;
  if jsonb_typeof(items) is distinct from 'array' then
    raise exception using errcode = '22023', message = '成员数据格式无效';
  end if;

  delete from public.town_members where id is not null;
  insert into public.town_members
    (username, role_zh, role_en, variant, member_group, sort_order)
  select
    nullif(trim(item ->> 'username'), ''),
    coalesce(trim(item ->> 'role_zh'), ''),
    coalesce(trim(item ->> 'role_en'), ''),
    coalesce(item ->> 'variant', ''),
    case
      when item ->> 'member_group' in ('primary', 'town', 'friend') then item ->> 'member_group'
      else 'town'
    end,
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;
revoke all on function public.replace_town_members(jsonb) from public, anon;
grant execute on function public.replace_town_members(jsonb) to authenticated, service_role;;
