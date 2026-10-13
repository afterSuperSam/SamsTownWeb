-- Extend the existing ordered image library into a compact page-media library.
-- Image rows keep their current defaults; Bilibili rows store only public
-- metadata and use the official external player at render time.
alter table public.town_images
  add column if not exists media_type text not null default 'image',
  add column if not exists external_id text,
  add column if not exists external_url text,
  add column if not exists creator_name text not null default '',
  add column if not exists duration_seconds integer;

alter table public.town_images
  drop constraint if exists town_images_media_type_check,
  drop constraint if exists town_images_external_url_check,
  drop constraint if exists town_images_duration_check,
  drop constraint if exists town_images_bilibili_shape_check;

alter table public.town_images
  add constraint town_images_media_type_check
    check (media_type in ('image', 'bilibili')),
  add constraint town_images_external_url_check
    check (external_url is null or external_url ~ '^https://'),
  add constraint town_images_duration_check
    check (duration_seconds is null or duration_seconds >= 0),
  add constraint town_images_bilibili_shape_check
    check (
      media_type <> 'bilibili'
      or (
        external_id ~ '^BV[0-9A-Za-z]{10}$'
        and external_url ~ '^https://www\.bilibili\.com/video/BV[0-9A-Za-z]{10}$'
        and storage_path is null
      )
    );

create unique index if not exists town_images_bilibili_external_id_key
  on public.town_images (external_id)
  where media_type = 'bilibili';

create index if not exists town_images_media_area_sort_idx
  on public.town_images (media_type, area, sort_order);
