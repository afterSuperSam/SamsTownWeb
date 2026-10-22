-- 本人改名与数据库其他写入保持一致：临时密码账号不可修改资料。
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
  update public.profiles set username = normalized
  where id = auth.uid() and not must_change_password;
  if not found then raise insufficient_privilege; end if;
exception
  when unique_violation then
    raise exception 'Username already exists' using errcode = '23505';
end;
$$;
revoke all on function public.update_own_username(text) from public, anon;
grant execute on function public.update_own_username(text) to authenticated;
