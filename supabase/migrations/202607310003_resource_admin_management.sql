-- Owner-only material project administration. Resource catalogue edits already
-- use owner-gated RLS; material project rows remain RPC-only to preserve their
-- stricter table grants.
create or replace function public.admin_update_material_project(
  p_project_id uuid,
  p_name text,
  p_priority integer,
  p_storage_location text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 100
    or p_priority not between 1 and 3
    or char_length(coalesce(p_storage_location, '')) > 500 then
    raise exception 'error.invalidMaterialProject';
  end if;

  update public.material_projects
  set name = trim(p_name),
      priority = p_priority,
      storage_location = trim(coalesce(p_storage_location, ''))
  where id = p_project_id;
  if not found then raise no_data_found; end if;
end;
$$;

create or replace function public.admin_delete_material_project(p_project_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_owner() then raise insufficient_privilege; end if;
  delete from public.material_projects where id = p_project_id;
  if not found then raise no_data_found; end if;
end;
$$;

revoke all on function public.admin_update_material_project(uuid, text, integer, text)
  from public, anon;
revoke all on function public.admin_delete_material_project(uuid)
  from public, anon;
grant execute on function public.admin_update_material_project(uuid, text, integer, text)
  to authenticated, service_role;
grant execute on function public.admin_delete_material_project(uuid)
  to authenticated, service_role;
