-- Remove overlapping SELECT checks from editor write policies ----------------
drop policy if exists "editors manage content" on public.site_content;
drop policy if exists "editors manage members" on public.town_members;
drop policy if exists "editors manage history" on public.town_history;
drop policy if exists "editors manage resources" on public.resources;
drop policy if exists "editors manage schematics" on public.schematics;

-- The baseline already creates the split write policies. Dropping them keeps
-- this compatibility migration safe for both legacy and fresh databases.
drop policy if exists "editors insert content" on public.site_content;
drop policy if exists "editors update content" on public.site_content;
drop policy if exists "editors delete content" on public.site_content;
drop policy if exists "editors insert members" on public.town_members;
drop policy if exists "editors update members" on public.town_members;
drop policy if exists "editors delete members" on public.town_members;
drop policy if exists "editors insert history" on public.town_history;
drop policy if exists "editors update history" on public.town_history;
drop policy if exists "editors delete history" on public.town_history;
drop policy if exists "editors insert resources" on public.resources;
drop policy if exists "editors update resources" on public.resources;
drop policy if exists "editors delete resources" on public.resources;
drop policy if exists "editors insert schematics" on public.schematics;
drop policy if exists "editors update schematics" on public.schematics;
drop policy if exists "editors delete schematics" on public.schematics;

create policy "editors insert content" on public.site_content for insert to authenticated
  with check (private.can_edit());
create policy "editors update content" on public.site_content for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete content" on public.site_content for delete to authenticated
  using (private.can_edit());

create policy "editors insert members" on public.town_members for insert to authenticated
  with check (private.can_edit());
create policy "editors update members" on public.town_members for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete members" on public.town_members for delete to authenticated
  using (private.can_edit());

create policy "editors insert history" on public.town_history for insert to authenticated
  with check (private.can_edit());
create policy "editors update history" on public.town_history for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete history" on public.town_history for delete to authenticated
  using (private.can_edit());

create policy "editors insert resources" on public.resources for insert to authenticated
  with check (private.can_edit());
create policy "editors update resources" on public.resources for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete resources" on public.resources for delete to authenticated
  using (private.can_edit());

create policy "editors insert schematics" on public.schematics for insert to authenticated
  with check (private.can_edit());
create policy "editors update schematics" on public.schematics for update to authenticated
  using (private.can_edit()) with check (private.can_edit());
create policy "editors delete schematics" on public.schematics for delete to authenticated
  using (private.can_edit());

-- Cover foreign keys used by cleanup and ownership queries -------------------
create index if not exists resources_created_by_idx on public.resources (created_by);
create index if not exists schematics_created_by_idx on public.schematics (created_by);
create index if not exists server_commands_requested_by_idx on public.server_commands (requested_by);
create index if not exists site_content_updated_by_idx on public.site_content (updated_by);

;
