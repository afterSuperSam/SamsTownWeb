-- Archive-only images remain manageable in Admin but are not consumed by any
-- public page section.
alter table public.town_images drop constraint if exists town_images_area_check;
alter table public.town_images add constraint town_images_area_check
  check (area in ('hero', 'story', 'gallery', 'join', 'history', 'resources', 'mapHero', 'other'));
