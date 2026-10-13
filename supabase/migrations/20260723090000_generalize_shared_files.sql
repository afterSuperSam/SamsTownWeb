-- Generalize the original litematic-only metadata table into a shared file
-- library while preserving existing rows and public URLs.
alter table public.schematics
  add column if not exists mime_type text not null default 'application/octet-stream',
  add column if not exists category text not null default '建筑投影';

-- The original schema accepted only .litematic files. The resource library now
-- intentionally supports jars, images, text and other shared artifacts.
alter table public.schematics
  drop constraint if exists schematics_file_name_check;

update storage.buckets
set allowed_mime_types = null
where id = 'schematics';

-- Change only the caller's username without exposing the role column.
create or replace function public.update_own_username(next_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(trim(next_username)) not between 2 and 32 then
    raise exception '用户名长度必须为 2 至 32 个字符';
  end if;
  update public.profiles set username = trim(next_username) where id = auth.uid();
  if not found then raise exception '未找到当前用户资料'; end if;
end;
$$;

revoke all on function public.update_own_username(text) from public;
grant execute on function public.update_own_username(text) to authenticated;

-- Project metadata used by the Modrinth/GitHub resource manager.
alter table public.resources
  add column if not exists external_id text,
  add column if not exists project_type text not null default 'other',
  add column if not exists author text not null default '',
  add column if not exists current_version text not null default '—',
  add column if not exists latest_version text not null default '—',
  add column if not exists game_versions text[] not null default '{}',
  add column if not exists loaders text[] not null default '{}',
  add column if not exists update_available boolean not null default false,
  add column if not exists project_updated_at timestamptz,
  add column if not exists update_checked_at timestamptz;

-- Keep the newest copy of legacy duplicate URLs before adding uniqueness.
delete from public.resources older
using public.resources newer
where older.source = newer.source
  and (
    lower(trim(older.url)) = lower(trim(newer.url))
    or (
      older.source = 'modrinth'
      and regexp_replace(lower(trim(older.url)), '^.*/([^/?#]+).*$', '\1')
        = regexp_replace(lower(trim(newer.url)), '^.*/([^/?#]+).*$', '\1')
    )
  )
  and older.created_at < newer.created_at;

update public.resources
set external_id = lower(trim(url))
where external_id is null;

create unique index if not exists resources_source_external_id_unique
  on public.resources (source, external_id);

create index if not exists resources_update_available_idx
  on public.resources (update_available)
  where update_available = true;

update public.town_members
set username = 'jangyi_gniklaw'
where username = 'jiangyi_gniklaw';
