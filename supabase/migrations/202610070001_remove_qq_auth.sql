begin;

-- 账号统一由可信后台创建；现有账号、密码和角色保持不变。
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'yingwu_trusted_provisioning', 'false') <> 'true' then
    raise exception 'Accounts must be provisioned by an administrator' using errcode = '42501';
  end if;
  insert into public.profiles (id, username, must_change_password)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)), true);
  return new;
end;
$$;

create or replace function private.current_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and not must_change_password;
$$;

-- 删除 QQ 专属函数、挑战、绑定数据及字段，不扩大依赖删除范围。
drop function public.issue_qq_verification_challenge(uuid, text, text, uuid, text, text);
drop function public.set_qq_challenge_delivery(uuid, boolean);
drop function public.claim_qq_verification_challenge(uuid, text, text, uuid, text, text);
drop function public.release_qq_verification_claim(uuid, text);
drop function public.complete_qq_verification(uuid, text, uuid);
drop function public.get_qq_binding_status(uuid);
drop function public.list_account_qq_bindings();
drop table private.qq_verification_challenges;
drop table private.qq_identities;
update public.profiles set must_change_password = true where qq_registration_pending;
alter table public.profiles drop column qq_registration_pending;
update auth.users set raw_user_meta_data = raw_user_meta_data - 'qq_registration_pending'
where raw_user_meta_data ? 'qq_registration_pending';

commit;
