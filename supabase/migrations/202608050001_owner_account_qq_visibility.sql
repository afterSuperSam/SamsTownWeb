-- Owner account directory QQ visibility -----------------------------------
-- QQ identities remain in the private schema. Only the trusted Fastify
-- service-role client may list complete numbers for the Owner account panel.

create or replace function public.list_account_qq_bindings()
returns table (
  user_id uuid,
  qq_number text,
  verified_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select identity.user_id, identity.qq_number, identity.verified_at
  from private.qq_identities identity
  order by identity.user_id;
$$;

revoke all on function public.list_account_qq_bindings()
  from public, anon, authenticated;
grant execute on function public.list_account_qq_bindings()
  to service_role;

