-- Preserve row-level audit detail while attaching a stable root entity key.
-- The admin UI can then present one project operation with its row changes
-- nested underneath instead of flattening every trigger event.

create or replace function private.audit_managed_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  actor uuid;
  actor_name text;
  category text;
  action_name text;
  root_target_id text;
  target_name text;
begin
  actor := coalesce(
    auth.uid(),
    nullif(source_row ->> 'owner_id', '')::uuid,
    nullif(source_row ->> 'creator_id', '')::uuid,
    nullif(source_row ->> 'created_by', '')::uuid,
    nullif(source_row ->> 'claimant_id', '')::uuid
  );
  select username into actor_name from public.profiles where id = actor;

  category := case
    when tg_table_name in ('map_claims', 'map_claim_cells') then 'map_claim'
    when tg_table_name = 'map_markers' then 'map_marker'
    when tg_table_name in ('material_projects', 'material_assignments') then 'material'
    when tg_table_name = 'resources' then 'resource'
    else tg_table_name
  end;
  action_name := case tg_op
    when 'INSERT' then 'add'
    when 'UPDATE' then 'update'
    else 'delete'
  end;

  root_target_id := coalesce(source_row ->> 'id', source_row ->> 'claim_id', source_row ->> 'item_id');
  target_name := coalesce(source_row ->> 'name', source_row ->> 'title');

  if tg_table_name = 'material_assignments' then
    select item.project_id::text, project.name
      into root_target_id, target_name
    from public.material_items item
    left join public.material_projects project on project.id = item.project_id
    where item.id = nullif(source_row ->> 'item_id', '')::uuid;
  end if;
  root_target_id := coalesce(root_target_id, source_row ->> 'id', source_row ->> 'claim_id', source_row ->> 'item_id');

  delete from public.audit_logs
  where created_at < now() - interval '7 days'
    and target_type in ('map_claim', 'map_marker', 'material', 'resource');

  insert into public.audit_logs (
    actor_id, action, target_type, target_id, details
  ) values (
    actor,
    action_name,
    category,
    coalesce(source_row ->> 'id', source_row ->> 'claim_id', source_row ->> 'item_id'),
    jsonb_build_object(
      'category', category,
      'table', tg_table_name,
      'rootTargetId', root_target_id,
      'targetName', target_name,
      'actorUsername', coalesce(actor_name, 'System'),
      'before', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'after', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.audit_managed_change() from public, anon, authenticated;

-- Backfill stable roots for the retained legacy material audit window.
update public.audit_logs log
set details = log.details || jsonb_build_object(
  'rootTargetId', item.project_id::text,
  'targetName', project.name
)
from public.material_items item
left join public.material_projects project on project.id = item.project_id
where log.target_type = 'material'
  and log.details ->> 'table' = 'material_assignments'
  and item.id = nullif(coalesce(
    log.details #>> '{after,item_id}',
    log.details #>> '{before,item_id}'
  ), '')::uuid;

update public.audit_logs log
set details = log.details || jsonb_build_object(
  'rootTargetId', log.target_id,
  'targetName', coalesce(
    log.details #>> '{after,name}',
    log.details #>> '{before,name}'
  )
)
where log.target_type = 'material'
  and log.details ->> 'table' = 'material_projects';
