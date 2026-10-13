-- Preserve the existing material workspace contract while calculating item
-- and project totals once instead of repeating correlated subqueries.
create or replace function public.get_material_workspace()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.can_view_materials() then raise insufficient_privilege; end if;

  with assignment_totals as (
    select assignment.item_id,
      coalesce(sum(assignment.amount) filter (where assignment.completed), 0)::bigint as completed_count,
      coalesce(sum(assignment.amount), 0)::bigint as reserved_count
    from public.material_assignments assignment
    group by assignment.item_id
  ), item_rollup as (
    select item.*,
      coalesce(totals.completed_count, 0) as completed_count,
      coalesce(totals.reserved_count, 0) as reserved_count,
      greatest(item.source_missing_count - item.initial_available_count - coalesce(totals.completed_count, 0), 0) as remaining_count
    from public.material_items item
    left join assignment_totals totals on totals.item_id = item.id
  ), project_totals as (
    select item.project_id,
      count(*)::bigint as item_count,
      coalesce(sum(item.total_count), 0)::bigint as total_count,
      coalesce(sum(item.remaining_count), 0)::bigint as missing_count
    from item_rollup item
    group by item.project_id
  )
  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', project.id, 'name', project.name, 'priority', project.priority,
        'storageLocation', project.storage_location, 'sourceTitle', project.source_title,
        'sourceDate', project.source_date, 'creatorId', project.creator_id,
        'creatorUsername', coalesce(profile.username, project.creator_username),
        'originX', project.projection_origin_x, 'originY', project.projection_origin_y,
        'originZ', project.projection_origin_z, 'mirror', project.projection_mirror,
        'rotation', project.projection_rotation, 'projectionFileName', project.projection_file_name,
        'projectionFileSize', project.projection_file_size,
        'projectionStoragePath', project.projection_storage_path,
        'hasProjectionFile', project.projection_storage_path is not null,
        'createdAt', project.created_at, 'updatedAt', project.updated_at,
        'itemCount', coalesce(totals.item_count, 0),
        'totalCount', coalesce(totals.total_count, 0),
        'missingCount', coalesce(totals.missing_count, 0)
      ) order by project.priority desc, project.updated_at desc)
      from public.material_projects project
      left join public.profiles profile on profile.id = project.creator_id
      left join project_totals totals on totals.project_id = project.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id, 'projectId', item.project_id, 'itemId', item.item_id,
        'nameZh', item.name_zh, 'nameEn', item.name_en, 'imageUrl', item.image_url,
        'totalCount', item.total_count, 'sourceMissingCount', item.source_missing_count,
        'initialAvailableCount', item.initial_available_count, 'mismatchedCount', item.mismatched_count,
        'existingCount', item.initial_available_count + item.completed_count,
        'missingCount', item.remaining_count, 'reservedCount', item.reserved_count,
        'sortOrder', item.sort_order
      ) order by item.project_id, item.sort_order)
      from item_rollup item
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id, 'itemId', assignment.item_id,
        'claimantId', assignment.claimant_id,
        'claimantUsername', coalesce(profile.username, assignment.claimant_username),
        'amount', assignment.amount, 'completed', assignment.completed,
        'completedAt', assignment.completed_at, 'note', assignment.note,
        'updatedById', assignment.updated_by,
        'updatedByUsername', coalesce(editor.username, assignment.updated_by_username),
        'createdAt', assignment.created_at, 'updatedAt', assignment.updated_at
      ) order by assignment.created_at)
      from public.material_assignments assignment
      left join public.profiles profile on profile.id = assignment.claimant_id
      left join public.profiles editor on editor.id = assignment.updated_by
    ), '[]'::jsonb),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claimantId', ranked.claimant_id, 'username', ranked.username,
        'collectedCount', ranked.collected_count
      ) order by ranked.collected_count desc, ranked.username)
      from (
        select assignment.claimant_id,
          coalesce(profile.username, assignment.claimant_username) as username,
          sum(assignment.amount)::bigint as collected_count
        from public.material_assignments assignment
        left join public.profiles profile on profile.id = assignment.claimant_id
        where assignment.completed
        group by assignment.claimant_id, coalesce(profile.username, assignment.claimant_username)
      ) ranked
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_material_workspace() from public, anon;
grant execute on function public.get_material_workspace() to authenticated, service_role;
