-- Keep every server-owned forum identity field immutable on update.
-- This migration is separate because the forum baseline may already be
-- recorded in a deployed project's migration history.

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
