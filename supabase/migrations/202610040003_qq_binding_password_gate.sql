-- QQ 绑定保留临时密码门禁；只有经过注册挑战的新账号执行初始化。
create or replace function public.complete_qq_verification(p_id uuid, p_claim_digest text, p_user_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_challenge private.qq_verification_challenges%rowtype;
  registration_pending boolean;
begin
  select * into v_challenge from private.qq_verification_challenges where id = p_id for update;
  if not found
    or v_challenge.claim_digest is distinct from p_claim_digest
    or v_challenge.claimed_at is null
    or v_challenge.consumed_at is not null
    or v_challenge.invalidated_at is not null
    or v_challenge.locked_at is not null
    or v_challenge.expires_at <= clock_timestamp()
    or v_challenge.purpose not in ('register', 'bind')
    or (v_challenge.purpose = 'register' and v_challenge.requested_by is not null)
    or (v_challenge.purpose = 'bind' and v_challenge.requested_by is distinct from p_user_id)
  then return 'invalid'; end if;

  select qq_registration_pending into registration_pending
  from public.profiles where id = p_user_id for update;
  if not found or (v_challenge.purpose = 'register' and not registration_pending) then
    return 'invalid';
  end if;
  begin
    insert into private.qq_identities (user_id, qq_number, verified_at, updated_at)
    values (p_user_id, v_challenge.qq_number, clock_timestamp(), clock_timestamp())
    on conflict (user_id) do update set qq_number = excluded.qq_number,
      verified_at = excluded.verified_at, updated_at = excluded.updated_at;
  exception when unique_violation then return 'unavailable';
  end;
  if v_challenge.purpose = 'register' then
    update public.profiles set must_change_password = false, qq_registration_pending = false
    where id = p_user_id;
  end if;
  update private.qq_verification_challenges set consumed_at = clock_timestamp() where id = p_id;
  return 'ok';
end;
$$;
revoke all on function public.complete_qq_verification(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.complete_qq_verification(uuid, text, uuid) to service_role;
