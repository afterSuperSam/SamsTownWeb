-- Editable homepage image library --------------------------------------------
create table if not exists public.town_images (
  id uuid primary key default gen_random_uuid(),
  area text not null check (area in ('hero', 'story', 'gallery', 'join')),
  source_url text not null,
  storage_path text unique,
  caption_zh text not null default '',
  caption_en text not null default '',
  alt_zh text not null default '',
  alt_en text not null default '',
  layout text not null default 'standard' check (layout in ('standard', 'wide', 'tall')),
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists town_images_area_sort_idx
  on public.town_images (area, sort_order, created_at);

create trigger town_images_updated_at before update on public.town_images
  for each row execute procedure private.set_updated_at();

alter table public.town_images enable row level security;

create policy "public reads town images" on public.town_images
  for select using (true);
create policy "editors insert town images" on public.town_images
  for insert to authenticated with check (private.can_edit());
create policy "editors update town images" on public.town_images
  for update to authenticated using (private.can_edit()) with check (private.can_edit());
create policy "editors delete town images" on public.town_images
  for delete to authenticated using (private.can_edit());

grant select on public.town_images to anon, authenticated;
grant insert, update, delete on public.town_images to authenticated;
grant all privileges on public.town_images to service_role;

-- Public image bucket; all mutations still require editor-level RLS. --------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-images',
  'site-images',
  true,
  26214400,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "public downloads site images" on storage.objects
  for select using (bucket_id = 'site-images');
create policy "editors upload site images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-images' and private.can_edit());
create policy "editors update site images" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-images' and private.can_edit())
  with check (bucket_id = 'site-images' and private.can_edit());
create policy "editors delete site images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-images' and private.can_edit());

-- Migrate bundled images into editable metadata without copying the binaries.
insert into public.town_images
  (area, source_url, caption_zh, caption_en, alt_zh, alt_en, layout, sort_order)
values
  ('hero', 'images/ingame/1.png', '楹雾镇主城', 'Yingwu Town', '楹雾镇樱花山谷', 'Yingwu Town cherry valley', 'wide', 0),
  ('story', 'images/group/1.png', '一次相聚，许多段故事。', 'One gathering, many stories.', '楹雾镇成员合影', 'Yingwu Town group photo', 'wide', 0),
  ('join', 'images/ingame/18.png', '下一次相聚，期待与你同框。', 'See you in our next gathering.', '楹雾镇风景', 'Yingwu Town landscape', 'wide', 0)
on conflict do nothing;

insert into public.town_images
  (area, source_url, caption_zh, caption_en, alt_zh, alt_en, layout, sort_order)
select
  'gallery',
  'images/ingame/' || image_number || '.png',
  '楹雾风景 ' || lpad(image_number::text, 2, '0'),
  'Yingwu view ' || lpad(image_number::text, 2, '0'),
  '楹雾镇风景 ' || image_number,
  'Yingwu Town view ' || image_number,
  case when image_number % 7 = 1 then 'wide' when image_number % 5 = 1 then 'tall' else 'standard' end,
  image_number - 1
from generate_series(1, 22) as image_number
where not exists (
  select 1 from public.town_images
  where area = 'gallery' and source_url = 'images/ingame/' || image_number || '.png'
);;
