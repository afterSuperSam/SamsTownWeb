-- 退役论坛和手动公告；生产执行前备份这两张表，图片文件保留。
begin;

drop function public.list_forum_posts(text, integer, integer, uuid);
drop table public.forum_posts;
drop function private.prepare_forum_post();
drop function private.can_view_forum();
drop function private.can_write_forum();
drop function public.replace_town_announcements(jsonb);
drop table public.town_announcements;

update public.town_images set area = 'other' where area = 'forumHero';
alter table public.town_images drop constraint town_images_area_check;
alter table public.town_images add constraint town_images_area_check
  check (area in ('hero', 'story', 'gallery', 'join', 'history', 'mapHero', 'other'));

-- 清理废弃文案覆盖，保留其他自定义内容。
update public.site_content set content = jsonb_set(content, '{translations}', coalesce((
  select jsonb_object_agg(entry.key, entry.value)
  from jsonb_each(content -> 'translations') entry
  where entry.key not like 'forum.%' and entry.key not like 'error.forum%'
    and entry.key not like 'admin.announcements.%'
    and entry.key not in ('app.nav.forum', 'admin.nav.announcements', 'admin.images.area.forumHero',
      'home.announcements.announcement', 'home.announcements.affair', 'home.announcements.body')
), '{}'::jsonb))
where jsonb_typeof(content -> 'translations') = 'object';

commit;
