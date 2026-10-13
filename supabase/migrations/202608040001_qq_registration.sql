-- QQ-backed self registration and account binding ---------------------------
-- Sensitive QQ identities and short-lived challenges remain outside the
-- exposed public schema. Trusted Fastify routes are the only callers.

alter table public.profiles
  add column if not exists qq_registration_pending boolean not null default false;

-- A failed Auth rollback must never leave a usable unverified account. The
-- profile trigger records the pending gate before any session can be issued.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, qq_registration_pending)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'qq_registration_pending', 'false') = 'true'
  );
  return new;
end;
$$;

create or replace function private.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles profile
  where profile.id = auth.uid()
    and not profile.must_change_password
    and not profile.qq_registration_pending;
$$;

create table if not exists private.qq_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  qq_number text not null unique check (qq_number ~ '^[1-9][0-9]{4,10}$'),
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.qq_verification_challenges (
  id uuid primary key,
  purpose text not null check (purpose in ('register', 'bind')),
  qq_number text not null check (qq_number ~ '^[1-9][0-9]{4,10}$'),
  requested_by uuid references auth.users(id) on delete cascade,
  code_digest text not null check (code_digest ~ '^[a-f0-9]{64}$'),
  ip_digest text not null check (ip_digest ~ '^[a-f0-9]{64}$'),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  delivered_at timestamptz,
  claimed_at timestamptz,
  claim_digest text check (claim_digest is null or claim_digest ~ '^[a-f0-9]{64}$'),
  consumed_at timestamptz,
  invalidated_at timestamptz,
  locked_at timestamptz,
  constraint qq_challenge_actor_check check (
    (purpose = 'register' and requested_by is null)
    or (purpose = 'bind' and requested_by is not null)
  )
);

create index if not exists qq_challenges_qq_created_idx
  on private.qq_verification_challenges (qq_number, created_at desc);
create index if not exists qq_challenges_ip_created_idx
  on private.qq_verification_challenges (ip_digest, created_at desc);
create index if not exists qq_challenges_expiry_idx
  on private.qq_verification_challenges (expires_at);

alter table private.qq_identities enable row level security;
alter table private.qq_verification_challenges enable row level security;
revoke all on table private.qq_identities from public, anon, authenticated;
revoke all on table private.qq_verification_challenges from public, anon, authenticated;

-- Enforce per-QQ and per-IP cooldowns inside the database so parallel requests
-- cannot bypass the limits. Failed deliveries are invalidated and may retry.
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
        and challenge.created_at > v_now - interval '1 day'
        and challenge.invalidated_at is null) >= 5
    or (select count(*) from private.qq_verification_challenges challenge
        where challenge.ip_digest = p_ip_digest
          and challenge.created_at > v_now - interval '1 day'
          and challenge.invalidated_at is null) >= 20
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

create or replace function public.set_qq_challenge_delivery(p_id uuid, p_delivered boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.qq_verification_challenges
  set delivered_at = case when p_delivered then clock_timestamp() else null end,
      invalidated_at = case when p_delivered then null else clock_timestamp() end
  where id = p_id and consumed_at is null;
  return found;
end;
$$;

-- A correct code is claimed before Auth creation. Wrong attempts are counted
-- under a row lock and the third failure permanently locks the challenge.
create or replace function public.claim_qq_verification_challenge(
  p_id uuid,
  p_purpose text,
  p_qq_number text,
  p_requested_by uuid,
  p_code_digest text,
  p_claim_digest text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge private.qq_verification_challenges%rowtype;
  v_attempts smallint;
begin
  select * into v_challenge
  from private.qq_verification_challenges
  where id = p_id
  for update;

  if not found
    or v_challenge.purpose <> p_purpose
    or v_challenge.qq_number <> p_qq_number
    or v_challenge.requested_by is distinct from p_requested_by
    or v_challenge.delivered_at is null
    or v_challenge.invalidated_at is not null
    or v_challenge.consumed_at is not null
    or v_challenge.expires_at <= clock_timestamp()
    or v_challenge.claimed_at is not null
  then
    return 'invalid';
  end if;

  if v_challenge.locked_at is not null or v_challenge.attempts >= 3 then
    return 'locked';
  end if;

  if v_challenge.code_digest <> p_code_digest then
    v_attempts := v_challenge.attempts + 1;
    update private.qq_verification_challenges
    set attempts = v_attempts,
        locked_at = case when v_attempts >= 3 then clock_timestamp() else null end
    where id = p_id;
    return case when v_attempts >= 3 then 'locked' else 'invalid' end;
  end if;

  update private.qq_verification_challenges
  set claimed_at = clock_timestamp(), claim_digest = p_claim_digest
  where id = p_id;
  return 'ok';
end;
$$;

create or replace function public.release_qq_verification_claim(p_id uuid, p_claim_digest text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.qq_verification_challenges
  set claimed_at = null, claim_digest = null
  where id = p_id
    and claim_digest = p_claim_digest
    and consumed_at is null
    and locked_at is null
    and expires_at > clock_timestamp();
  return found;
end;
$$;

-- Final identity binding and challenge consumption happen in one transaction.
create or replace function public.complete_qq_verification(
  p_id uuid,
  p_claim_digest text,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge private.qq_verification_challenges%rowtype;
begin
  select * into v_challenge
  from private.qq_verification_challenges
  where id = p_id
  for update;

  if not found
    or v_challenge.claim_digest is distinct from p_claim_digest
    or v_challenge.claimed_at is null
    or v_challenge.consumed_at is not null
    or v_challenge.invalidated_at is not null
    or v_challenge.locked_at is not null
    or v_challenge.expires_at <= clock_timestamp()
    or (v_challenge.purpose = 'register' and v_challenge.requested_by is not null)
    or (v_challenge.purpose = 'bind' and v_challenge.requested_by is distinct from p_user_id)
  then
    return 'invalid';
  end if;

  begin
    insert into private.qq_identities (user_id, qq_number, verified_at, updated_at)
    values (p_user_id, v_challenge.qq_number, clock_timestamp(), clock_timestamp())
    on conflict (user_id) do update
      set qq_number = excluded.qq_number,
          verified_at = excluded.verified_at,
          updated_at = excluded.updated_at;
  exception when unique_violation then
    return 'unavailable';
  end;

  update public.profiles
  set must_change_password = false,
      qq_registration_pending = false
  where id = p_user_id;
  if not found then return 'invalid'; end if;

  update private.qq_verification_challenges
  set consumed_at = clock_timestamp()
  where id = p_id;
  return 'ok';
end;
$$;

create or replace function public.get_qq_binding_status(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when identity.user_id is null
    then jsonb_build_object('bound', false, 'maskedNumber', null)
    else jsonb_build_object(
      'bound', true,
      'maskedNumber', left(identity.qq_number, 2)
        || repeat('*', greatest(length(identity.qq_number) - 4, 1))
        || right(identity.qq_number, 2)
    )
  end
  from (select p_user_id as user_id) requested
  left join private.qq_identities identity on identity.user_id = requested.user_id;
$$;

revoke all on function public.issue_qq_verification_challenge(uuid, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_qq_challenge_delivery(uuid, boolean) from public, anon, authenticated;
revoke all on function public.claim_qq_verification_challenge(uuid, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_qq_verification_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_qq_verification(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.get_qq_binding_status(uuid) from public, anon, authenticated;
grant execute on function public.issue_qq_verification_challenge(uuid, text, text, uuid, text, text) to service_role;
grant execute on function public.set_qq_challenge_delivery(uuid, boolean) to service_role;
grant execute on function public.claim_qq_verification_challenge(uuid, text, text, uuid, text, text) to service_role;
grant execute on function public.release_qq_verification_claim(uuid, text) to service_role;
grant execute on function public.complete_qq_verification(uuid, text, uuid) to service_role;
grant execute on function public.get_qq_binding_status(uuid) to service_role;
