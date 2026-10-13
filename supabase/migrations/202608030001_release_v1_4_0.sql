-- v1.4.0 managed forum hero and Story supporting media ---------------------

alter table public.town_images drop constraint if exists town_images_area_check;
alter table public.town_images add constraint town_images_area_check
  check (area in (
    'hero', 'story', 'gallery', 'join', 'history', 'resources',
    'mapHero', 'materialHero', 'forumHero', 'other'
  ));

insert into public.town_images (
  id, media_type, area, source_url, caption_zh, caption_en,
  alt_zh, alt_en, layout, is_visible, sort_order
)
select
  '00000000-0000-4000-8000-000000000045'::uuid,
  'image',
  'forumHero',
  'images/ingame/23.png',
  '楹雾留言论坛',
  'Yingwu Forum',
  '楹雾留言论坛',
  'Yingwu Forum',
  'wide',
  true,
  0
where not exists (
  select 1 from public.town_images
  where area = 'forumHero' and source_url = 'images/ingame/23.png'
)
on conflict (id) do nothing;

insert into public.town_images (
  id, media_type, area, source_url, caption_zh, caption_en,
  alt_zh, alt_en, layout, is_visible, sort_order
)
select
  seed.id::uuid,
  'image',
  'story',
  seed.source_url,
  seed.caption_zh,
  seed.caption_en,
  seed.caption_zh,
  seed.caption_en,
  'wide',
  true,
  seed.sort_order
from (values
  (
    '00000000-0000-4000-8000-000000000046',
    'images/group/2.png',
    '楹雾与友镇成员合影',
    'Yingwu and friends',
    2
  ),
  (
    '00000000-0000-4000-8000-000000000047',
    'images/group/3.png',
    '一路同行的小镇成员',
    'Our town community',
    3
  )
) as seed(id, source_url, caption_zh, caption_en, sort_order)
where not exists (
  select 1 from public.town_images image
  where image.area = 'story' and image.source_url = seed.source_url
)
on conflict (id) do nothing;
