-- v1.3.0 resource mutation boundaries -------------------------------------
-- Members may maintain resources they created. Shared update checks use a
-- narrow RPC, while Owner administration remains independently authorized.

drop policy if exists "members update resources" on public.resources;
drop policy if exists "creators update own resources" on public.resources;
drop policy if exists "owners update resources" on public.resources;
create policy "creators update own resources"
  on public.resources for update to authenticated
  using (
    private.can_use_resources()
    and created_by = (select auth.uid())
  )
  with check (
    private.can_use_resources()
    and created_by = (select auth.uid())
  );
create policy "owners update resources"
  on public.resources for update to authenticated
  using (private.is_owner())
  with check (private.is_owner());

create or replace function public.update_resource_check(
  p_resource_id uuid,
  p_latest_version text,
  p_update_available boolean,
  p_checked_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_use_resources() then raise insufficient_privilege; end if;
  if char_length(coalesce(p_latest_version, '')) > 200
    or p_update_available is null
    or p_checked_at is null then
    raise exception 'error.invalidResourceDetails';
  end if;

  update public.resources
  set latest_version = coalesce(p_latest_version, ''),
      update_available = p_update_available,
      update_checked_at = p_checked_at
  where id = p_resource_id;
  if not found then raise no_data_found; end if;
end;
$$;

create or replace function public.admin_update_resource_details(
  p_resource_id uuid,
  p_name text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120
    or char_length(coalesce(p_description, '')) > 2000 then
    raise exception 'error.invalidResourceDetails';
  end if;

  update public.resources
  set name = trim(p_name),
      description = trim(coalesce(p_description, ''))
  where id = p_resource_id;
  if not found then raise no_data_found; end if;
end;
$$;

create or replace function public.admin_delete_resource(p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  delete from public.resources where id = p_resource_id;
  if not found then raise no_data_found; end if;
end;
$$;

revoke all on function public.update_resource_check(uuid, text, boolean, timestamptz)
  from public, anon;
revoke all on function public.admin_update_resource_details(uuid, text, text)
  from public, anon;
revoke all on function public.admin_delete_resource(uuid)
  from public, anon;
grant execute on function public.update_resource_check(uuid, text, boolean, timestamptz)
  to authenticated, service_role;
grant execute on function public.admin_update_resource_details(uuid, text, text)
  to authenticated, service_role;
grant execute on function public.admin_delete_resource(uuid)
  to authenticated, service_role;
