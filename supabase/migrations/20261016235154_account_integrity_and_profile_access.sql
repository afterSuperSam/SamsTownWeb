begin;

-- 账号写入统一经过服务端，改名仍由 update_own_username 定向执行。
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
drop policy if exists "owners update profiles" on public.profiles;

-- 删号时仅允许外键清空作者引用，正文和作者名称快照保持不变。
create or replace function private.prepare_forum_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_username text;
begin
  if tg_op = 'UPDATE' then
    if old.author_id is not null and new.author_id is null
      and not exists (select 1 from public.profiles where id = old.author_id)
      and (to_jsonb(new) - 'author_id') = (to_jsonb(old) - 'author_id') then
      return new;
    end if;
  end if;
  if not private.can_write_forum() then raise insufficient_privilege; end if;

  new.title := trim(new.title);
  new.body := trim(new.body);

  if tg_op = 'INSERT' then
    if not private.is_owner() then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(actor_id::text, 0)
      );
      if (
        select count(*) from public.forum_posts post
        where post.author_id = actor_id
          and post.created_at >= now() - interval '5 minutes'
      ) >= 5 then
        raise exception 'error.forumRateLimit' using errcode = 'P0001';
      end if;
    end if;
    select profile.username into actor_username
    from public.profiles profile where profile.id = actor_id;
    if actor_username is null then raise insufficient_privilege; end if;
    new.author_id := actor_id;
    new.author_username := actor_username;
    new.created_at := now();
  else
    new.id := old.id;
    new.author_id := old.author_id;
    new.author_username := old.author_username;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.prepare_forum_post() from public;

commit;
