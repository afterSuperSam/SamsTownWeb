-- Give Material Page an independently managed hero image without coupling it
-- to the resource or map page image categories.
alter table public.town_images drop constraint if exists town_images_area_check;
alter table public.town_images add constraint town_images_area_check
  check (area in (
    'hero', 'story', 'gallery', 'join', 'history', 'resources',
    'mapHero', 'materialHero', 'other'
  ));
