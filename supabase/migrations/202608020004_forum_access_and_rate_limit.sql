-- Forum reads are served through a bounded RPC. Direct table reads are kept
-- only for an author's own rows and Owner maintenance.

drop policy if exists "authenticated roles read forum posts" on public.forum_posts;
create policy "authors and owners read forum rows"
  on public.forum_posts for select to authenticated
  using (
    private.is_owner()
    or (
      private.can_write_forum()
      and author_id = (select auth.uid())
    )
  );

create or replace function public.list_forum_posts(
  p_kind text default null,
  p_limit integer default 5,
  p_offset integer default 0,
  p_author_id uuid default null
)
returns table (
  id uuid,
  title text,
  kind text,
  body text,
  author_id uuid,
  author_username text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_owner boolean := private.is_owner();
  safe_limit integer;
  safe_offset integer;
begin
  if not private.can_view_forum() then raise insufficient_privilege; end if;
  if p_kind is not null and p_kind not in ('task', 'anecdote', 'event') then
    raise check_violation;
  end if;
  if p_author_id is not null and not (
    actor_is_owner
    or (private.can_write_forum() and p_author_id = actor_id)
  ) then
    raise insufficient_privilege;
  end if;

  safe_limit := least(greatest(coalesce(p_limit, 5), 1), 100);
  safe_offset := greatest(coalesce(p_offset, 0), 0);
  if not actor_is_owner and p_author_id is null then
    safe_limit := least(safe_limit, 5);
    safe_offset := 0;
  end if;

  return query
  select
    post.id,
    post.title,
    post.kind,
    post.body,
    post.author_id,
    post.author_username,
    post.created_at,
    post.updated_at
  from public.forum_posts post
  where (p_kind is null or post.kind = p_kind)
    and (p_author_id is null or post.author_id = p_author_id)
  order by post.created_at desc, post.id desc
  limit safe_limit
  offset safe_offset;
end;
$$;

revoke all on function public.list_forum_posts(text, integer, integer, uuid) from public, anon;
grant execute on function public.list_forum_posts(text, integer, integer, uuid) to authenticated;

-- Serialize inserts per actor before checking the short abuse window so
-- concurrent REST calls cannot bypass the quota.
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
  if not private.can_write_forum() then raise insufficient_privilege; end if;

  new.title := trim(new.title);
  new.body := trim(new.body);

  if tg_op = 'INSERT' then
    if not private.is_owner() then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(actor_id::text, 0)
      );
      if (
        select count(*)
        from public.forum_posts post
        where post.author_id = actor_id
          and post.created_at >= now() - interval '5 minutes'
      ) >= 5 then
        raise exception 'error.forumRateLimit' using errcode = 'P0001';
      end if;
    end if;

    select profile.username
    into actor_username
    from public.profiles profile
    where profile.id = actor_id;
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
