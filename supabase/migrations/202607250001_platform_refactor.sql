-- Yingwu platform refactor --------------------------------------------------
-- This migration is additive except for the approved editor -> member enum
-- label rename. Existing content, users, resources, and files are preserved.

-- Roles and profiles --------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role' and e.enumlabel = 'editor'
  ) and not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role' and e.enumlabel = 'member'
  ) then
    alter type public.app_role rename value 'editor' to 'member';
  end if;
end
$$;

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create or replace function private.can_use_resources()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role() in ('owner', 'admin', 'member'), false);
$$;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role() = 'owner', false);
$$;

-- Compatibility helpers are deliberately narrow: Admin and Member share
-- resource access, while content and account administration remain Owner-only.
create or replace function private.can_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner();
$$;

create or replace function private.can_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner();
$$;

-- Public content ------------------------------------------------------------
alter table public.town_members
  add column if not exists member_group text not null default 'town';

update public.town_members
set member_group = case
  when variant = 'friend' then 'friend'
  when lower(username) in ('aresgao', 'nanio416', 'kilmaus', 'fsjhxm', 'dogsam', 'tabularis') then 'primary'
  else 'town'
end
where member_group = 'town';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'town_members_member_group_check'
      and conrelid = 'public.town_members'::regclass
  ) then
    alter table public.town_members
      add constraint town_members_member_group_check
      check (member_group in ('primary', 'town', 'friend'));
  end if;
end
$$;

create table if not exists public.town_images (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  source_url text not null,
  storage_path text unique,
  caption_zh text not null default '',
  caption_en text not null default '',
  alt_zh text not null default '',
  alt_en text not null default '',
  layout text not null default 'standard',
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.town_images
  add column if not exists is_visible boolean not null default true;

do $$
begin
  alter table public.town_images drop constraint if exists town_images_area_check;
  alter table public.town_images
    add constraint town_images_area_check
    check (area in ('hero', 'story', 'gallery', 'join', 'history', 'resources'));
  if not exists (
    select 1 from pg_constraint
    where conname = 'town_images_layout_check'
      and conrelid = 'public.town_images'::regclass
  ) then
    alter table public.town_images
      add constraint town_images_layout_check
      check (layout in ('standard', 'wide', 'tall'));
  end if;
end
$$;

create index if not exists town_images_area_sort_idx
  on public.town_images (area, sort_order);

drop trigger if exists town_images_updated_at on public.town_images;
create trigger town_images_updated_at before update on public.town_images
  for each row execute procedure private.set_updated_at();

alter table public.town_history
  add column if not exists image_id uuid references public.town_images(id) on delete set null;

create table if not exists public.faq_items (
  id uuid primary key default gen_random_uuid(),
  question_zh text not null,
  question_en text not null default '',
  answer_zh text not null,
  answer_en text not null default '',
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faq_items_sort_idx on public.faq_items (sort_order);
drop trigger if exists faq_items_updated_at on public.faq_items;
create trigger faq_items_updated_at before update on public.faq_items
  for each row execute procedure private.set_updated_at();

-- Ordered replacement functions -------------------------------------------
-- Explicit WHERE predicates satisfy PostgREST/Supabase safe-update rules.
create or replace function public.replace_town_members(items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.town_members where true;
  insert into public.town_members (
    username, role_zh, role_en, variant, member_group, sort_order
  )
  select
    trim(item ->> 'username'),
    coalesce(item ->> 'role_zh', ''),
    coalesce(item ->> 'role_en', ''),
    coalesce(item ->> 'variant', ''),
    coalesce(item ->> 'member_group', 'town'),
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;

create or replace function public.replace_town_history(items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.town_history where true;
  insert into public.town_history (
    event_date, title_zh, title_en, body_zh, body_en, image_id, sort_order
  )
  select
    item ->> 'event_date',
    item ->> 'title_zh',
    coalesce(item ->> 'title_en', ''),
    item ->> 'body_zh',
    coalesce(item ->> 'body_en', ''),
    nullif(item ->> 'image_id', '')::uuid,
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;

create or replace function public.replace_faq_items(items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.faq_items where true;
  insert into public.faq_items (
    question_zh, question_en, answer_zh, answer_en, is_visible, sort_order
  )
  select
    item ->> 'question_zh',
    coalesce(item ->> 'question_en', ''),
    item ->> 'answer_zh',
    coalesce(item ->> 'answer_en', ''),
    coalesce((item ->> 'is_visible')::boolean, true),
    (ordinality - 1)::integer
  from jsonb_array_elements(items) with ordinality as source(item, ordinality);
end;
$$;

create or replace function public.list_resource_loaders()
returns table(loader text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct value
  from public.resources, unnest(loaders) as value
  where value <> ''
  order by value;
$$;

create or replace function public.mark_password_changed()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set must_change_password = false
  where id = auth.uid();
$$;

-- Row-level security --------------------------------------------------------
alter table public.town_images enable row level security;
alter table public.faq_items enable row level security;

drop policy if exists "profiles read authenticated" on public.profiles;
drop policy if exists "owners read profiles" on public.profiles;
drop policy if exists "users read own profile" on public.profiles;
drop policy if exists "owners update profiles" on public.profiles;
create policy "users read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_owner());
create policy "owners update profiles" on public.profiles for update to authenticated
  using (private.is_owner()) with check (private.is_owner());

drop policy if exists "editors insert content" on public.site_content;
drop policy if exists "editors update content" on public.site_content;
drop policy if exists "editors delete content" on public.site_content;
drop policy if exists "owners insert content" on public.site_content;
drop policy if exists "owners update content" on public.site_content;
drop policy if exists "owners delete content" on public.site_content;
create policy "owners insert content" on public.site_content for insert to authenticated
  with check (private.is_owner());
create policy "owners update content" on public.site_content for update to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "owners delete content" on public.site_content for delete to authenticated
  using (private.is_owner());

drop policy if exists "editors insert members" on public.town_members;
drop policy if exists "editors update members" on public.town_members;
drop policy if exists "editors delete members" on public.town_members;
drop policy if exists "owners insert members" on public.town_members;
drop policy if exists "owners update members" on public.town_members;
drop policy if exists "owners delete members" on public.town_members;
create policy "owners insert members" on public.town_members for insert to authenticated
  with check (private.is_owner());
create policy "owners update members" on public.town_members for update to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "owners delete members" on public.town_members for delete to authenticated
  using (private.is_owner());

drop policy if exists "editors insert history" on public.town_history;
drop policy if exists "editors update history" on public.town_history;
drop policy if exists "editors delete history" on public.town_history;
drop policy if exists "owners insert history" on public.town_history;
drop policy if exists "owners update history" on public.town_history;
drop policy if exists "owners delete history" on public.town_history;
create policy "owners insert history" on public.town_history for insert to authenticated
  with check (private.is_owner());
create policy "owners update history" on public.town_history for update to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "owners delete history" on public.town_history for delete to authenticated
  using (private.is_owner());

drop policy if exists "public reads image metadata" on public.town_images;
drop policy if exists "public reads visible images" on public.town_images;
create policy "public reads image metadata" on public.town_images for select
  using (true);
drop policy if exists "owners insert images" on public.town_images;
drop policy if exists "owners update images" on public.town_images;
drop policy if exists "owners delete images" on public.town_images;
create policy "owners insert images" on public.town_images for insert to authenticated
  with check (private.is_owner());
create policy "owners update images" on public.town_images for update to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "owners delete images" on public.town_images for delete to authenticated
  using (private.is_owner());

drop policy if exists "public reads visible faqs" on public.faq_items;
drop policy if exists "public reads faq metadata" on public.faq_items;
drop policy if exists "owners insert faqs" on public.faq_items;
drop policy if exists "owners update faqs" on public.faq_items;
drop policy if exists "owners delete faqs" on public.faq_items;
create policy "public reads faq metadata" on public.faq_items for select
  using (true);
create policy "owners insert faqs" on public.faq_items for insert to authenticated
  with check (private.is_owner());
create policy "owners update faqs" on public.faq_items for update to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "owners delete faqs" on public.faq_items for delete to authenticated
  using (private.is_owner());

drop policy if exists "editors insert resources" on public.resources;
drop policy if exists "editors update resources" on public.resources;
drop policy if exists "editors delete resources" on public.resources;
drop policy if exists "members insert resources" on public.resources;
drop policy if exists "members update resources" on public.resources;
drop policy if exists "owners delete resources" on public.resources;
create policy "members insert resources" on public.resources for insert to authenticated
  with check (private.can_use_resources());
create policy "members update resources" on public.resources for update to authenticated
  using (private.can_use_resources()) with check (private.can_use_resources());
create policy "owners delete resources" on public.resources for delete to authenticated
  using (private.is_owner());

drop policy if exists "public reads schematic metadata" on public.schematics;
drop policy if exists "editors insert schematics" on public.schematics;
drop policy if exists "editors update schematics" on public.schematics;
drop policy if exists "editors delete schematics" on public.schematics;
drop policy if exists "members read shared file metadata" on public.schematics;
drop policy if exists "members insert shared files" on public.schematics;
drop policy if exists "members update shared files" on public.schematics;
drop policy if exists "owners delete shared files" on public.schematics;
create policy "members read shared file metadata" on public.schematics for select to authenticated
  using (private.can_use_resources());
create policy "members insert shared files" on public.schematics for insert to authenticated
  with check (private.can_use_resources());
create policy "members update shared files" on public.schematics for update to authenticated
  using (private.can_use_resources()) with check (private.can_use_resources());
create policy "owners delete shared files" on public.schematics for delete to authenticated
  using (private.is_owner());

drop policy if exists "admins read audit logs" on public.audit_logs;
drop policy if exists "owners read audit logs" on public.audit_logs;
create policy "owners read audit logs" on public.audit_logs for select to authenticated
  using (private.is_owner());

-- Storage ------------------------------------------------------------------
update storage.buckets set public = false, allowed_mime_types = null
where id = 'schematics';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-images',
  'site-images',
  true,
  15728640,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public downloads schematics" on storage.objects;
drop policy if exists "editors upload schematics" on storage.objects;
drop policy if exists "editors update schematics" on storage.objects;
drop policy if exists "editors delete schematics" on storage.objects;
drop policy if exists "members download shared files" on storage.objects;
drop policy if exists "members upload shared files" on storage.objects;
drop policy if exists "members update shared files" on storage.objects;
drop policy if exists "owners delete shared files" on storage.objects;
create policy "members download shared files" on storage.objects for select to authenticated
  using (bucket_id = 'schematics' and private.can_use_resources());
create policy "members upload shared files" on storage.objects for insert to authenticated
  with check (bucket_id = 'schematics' and private.can_use_resources());
create policy "members update shared files" on storage.objects for update to authenticated
  using (bucket_id = 'schematics' and private.can_use_resources())
  with check (bucket_id = 'schematics' and private.can_use_resources());
create policy "owners delete shared files" on storage.objects for delete to authenticated
  using (bucket_id = 'schematics' and private.is_owner());

drop policy if exists "public reads site images" on storage.objects;
drop policy if exists "owners upload site images" on storage.objects;
drop policy if exists "owners update site images" on storage.objects;
drop policy if exists "owners delete site images" on storage.objects;
create policy "public reads site images" on storage.objects for select
  using (bucket_id = 'site-images');
create policy "owners upload site images" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-images' and private.is_owner());
create policy "owners update site images" on storage.objects for update to authenticated
  using (bucket_id = 'site-images' and private.is_owner())
  with check (bucket_id = 'site-images' and private.is_owner());
create policy "owners delete site images" on storage.objects for delete to authenticated
  using (bucket_id = 'site-images' and private.is_owner());

-- Grants -------------------------------------------------------------------
grant select on public.town_images, public.faq_items to anon;
grant select, insert, update, delete on public.town_images, public.faq_items to authenticated;
revoke select on public.schematics from anon;

revoke all on function private.can_use_resources() from public;
revoke all on function private.is_owner() from public;
grant execute on function private.can_use_resources()
  to authenticated, service_role;
grant execute on function private.is_owner()
  to authenticated, service_role;

revoke all on function public.replace_faq_items(jsonb) from public, anon;
grant execute on function public.replace_faq_items(jsonb) to authenticated, service_role;
revoke all on function public.list_resource_loaders() from public, anon;
grant execute on function public.list_resource_loaders() to authenticated, service_role;
revoke all on function public.mark_password_changed() from public, anon;
grant execute on function public.mark_password_changed() to authenticated, service_role;

-- Seed FAQ only for installations that have no FAQ content yet. -------------
insert into public.faq_items (
  question_zh, question_en, answer_zh, answer_en, sort_order
)
select seed.*
from (values
  ('如何抵达小镇？', 'How do I reach the town?', '加入后使用 /guild home 前往主城；建筑前先查看群相册中的规划图。', 'After joining, use /guild home to reach the town center. Check the planning map before building.', 0),
  ('物资可以使用吗？', 'May I use the shared supplies?', '未特殊标明的镇内箱子与盒子可自由取用，不清楚时随时询问群友。', 'You may use unmarked town chests and shulker boxes. Ask the community whenever you are unsure.', 1),
  ('如何参与建设？', 'How can I help with construction?', '主城以樱花为主题。大型工程欢迎共同收集材料，也欢迎新的建筑创意。', 'The town center follows a cherry-blossom theme. Help gather materials for major projects or bring a new building idea.', 2),
  ('机器损坏怎么办？', 'What should I do if a machine breaks?', '机器坐标与负责人见《楹雾工程表》，损坏后请及时联系维护者。', 'Check the Yingwu Project Sheet for coordinates and owners, then contact the maintainer as soon as possible.', 3)
) as seed(question_zh, question_en, answer_zh, answer_en, sort_order)
where not exists (select 1 from public.faq_items);
