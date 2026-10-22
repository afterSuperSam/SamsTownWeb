-- Authenticated community forum --------------------------------------------
-- Post identity and timestamps are database-owned. Clients may only provide
-- the title, kind, and plain-text body.

create or replace function private.can_view_forum()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_role() in ('viewer', 'member', 'admin', 'owner'),
    false
  );
$$;

create or replace function private.can_write_forum()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_role() in ('member', 'admin', 'owner'),
    false
  );
$$;

create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null,
  body text not null,
  author_id uuid references public.profiles(id) on delete set null,
  author_username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forum_posts_title_length
    check (char_length(title) between 1 and 120),
  constraint forum_posts_kind_check
    check (kind in ('task', 'anecdote', 'event')),
  constraint forum_posts_body_length
    check (char_length(body) between 1 and 8000),
  constraint forum_posts_author_username_length
    check (char_length(author_username) between 1 and 32)
);

create index if not exists forum_posts_created_at_idx
  on public.forum_posts (created_at desc);
create index if not exists forum_posts_kind_created_at_idx
  on public.forum_posts (kind, created_at desc);
create index if not exists forum_posts_author_created_at_idx
  on public.forum_posts (author_id, created_at desc);

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
    select profile.username
    into actor_username
    from public.profiles profile
    where profile.id = actor_id;
    if actor_username is null then raise insufficient_privilege; end if;

    new.author_id := actor_id;
    new.author_username := actor_username;
    new.created_at := now();
  else
    new.author_id := old.author_id;
    new.author_username := old.author_username;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists forum_posts_prepare on public.forum_posts;
create trigger forum_posts_prepare
before insert or update on public.forum_posts
for each row execute procedure private.prepare_forum_post();

alter table public.forum_posts enable row level security;

create policy "authenticated roles read forum posts"
  on public.forum_posts for select to authenticated
  using (private.can_view_forum());
create policy "members create forum posts"
  on public.forum_posts for insert to authenticated
  with check (
    private.can_write_forum()
    and author_id = (select auth.uid())
  );
create policy "authors update forum posts"
  on public.forum_posts for update to authenticated
  using (
    private.can_write_forum()
    and (author_id = (select auth.uid()) or private.is_owner())
  )
  with check (
    private.can_write_forum()
    and (author_id = (select auth.uid()) or private.is_owner())
  );
create policy "authors delete forum posts"
  on public.forum_posts for delete to authenticated
  using (
    private.can_write_forum()
    and (author_id = (select auth.uid()) or private.is_owner())
  );

revoke all on public.forum_posts from public, anon;
grant select, insert, update, delete on public.forum_posts to authenticated;
revoke all on function private.can_view_forum() from public;
revoke all on function private.can_write_forum() from public;
revoke all on function private.prepare_forum_post() from public;
grant execute on function private.can_view_forum() to authenticated, service_role;
grant execute on function private.can_write_forum() to authenticated, service_role;

