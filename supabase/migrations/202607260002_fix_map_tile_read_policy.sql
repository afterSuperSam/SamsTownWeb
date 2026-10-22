-- Qualify the outer Storage object path inside the nested map lookup. Without
-- this qualifier, PostgreSQL resolves `name` to `town_maps.name`, so every
-- authenticated tile request is hidden as "Object not found" by RLS.
drop policy if exists "members read map tiles" on storage.objects;
create policy "members read map tiles" on storage.objects for select to authenticated
  using (
    bucket_id = 'town-maps'
    and private.can_view_maps()
    and exists (
      select 1
      from public.town_maps map
      where map.id::text = (storage.foldername(storage.objects.name))[1]
        and (map.is_visible or private.can_manage_maps())
    )
  );
