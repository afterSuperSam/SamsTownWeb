-- Count failed deliveries toward daily abuse limits without extending the
-- short resend cooldown. This replaces the issuing function additively after
-- v1.4.0 QQ registration has already reached production.
create or replace function public.issue_qq_verification_challenge(
  p_id uuid,
  p_purpose text,
  p_qq_number text,
  p_requested_by uuid,
  p_code_digest text,
  p_ip_digest text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_id is null
    or p_purpose not in ('register', 'bind')
    or p_qq_number !~ '^[1-9][0-9]{4,10}$'
    or p_code_digest !~ '^[a-f0-9]{64}$'
    or p_ip_digest !~ '^[a-f0-9]{64}$'
    or (p_purpose = 'register' and p_requested_by is not null)
    or (p_purpose = 'bind' and p_requested_by is null)
  then
    return 'invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('qq:' || p_qq_number, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ip:' || p_ip_digest, 0));

  delete from private.qq_verification_challenges
  where created_at < v_now - interval '1 day';

  if exists (
    select 1 from private.qq_identities identity
    where identity.qq_number = p_qq_number
      and (p_purpose = 'register' or identity.user_id <> p_requested_by)
  ) then
    return 'unavailable';
  end if;

  if exists (
    select 1 from private.qq_verification_challenges challenge
    where challenge.qq_number = p_qq_number
      and challenge.created_at > v_now - interval '5 minutes'
      and challenge.invalidated_at is null
  ) or exists (
    select 1 from private.qq_verification_challenges challenge
    where challenge.ip_digest = p_ip_digest
      and challenge.created_at > v_now - interval '1 minute'
      and challenge.invalidated_at is null
  ) then
    return 'cooldown';
  end if;

  if (select count(*) from private.qq_verification_challenges challenge
      where challenge.qq_number = p_qq_number
        and challenge.created_at > v_now - interval '1 day') >= 5
    or (select count(*) from private.qq_verification_challenges challenge
        where challenge.ip_digest = p_ip_digest
          and challenge.created_at > v_now - interval '1 day') >= 20
  then
    return 'daily_limit';
  end if;

  insert into private.qq_verification_challenges (
    id, purpose, qq_number, requested_by, code_digest, ip_digest, created_at, expires_at
  ) values (
    p_id, p_purpose, p_qq_number, p_requested_by, p_code_digest, p_ip_digest,
    v_now, v_now + interval '5 minutes'
  );
  return 'ok';
end;
$$;

revoke all on function public.issue_qq_verification_challenge(uuid, text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_qq_verification_challenge(uuid, text, text, uuid, text, text)
  to service_role;
