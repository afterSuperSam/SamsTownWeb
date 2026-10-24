begin;

-- 原图上限与 Fastify 默认值一致；展示图仍由 Sharp 缩小。
update storage.buckets set file_size_limit = 52428800 where id = 'site-images';

-- ICU 字符分类对应 Unicode 字母和十进制数字，不依赖服务器的系统区域设置。
create or replace function public.update_own_username(next_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare normalized text := trim(next_username);
begin
  if private.current_role() is null then raise insufficient_privilege; end if;
  if normalized is null or normalized collate pg_catalog."und-x-icu" !~ '^[[:alnum:]_-]{2,32}$' then
    raise exception 'Invalid username';
  end if;
  update public.profiles set username = normalized where id = auth.uid() and not must_change_password;
  if not found then raise insufficient_privilege; end if;
exception when unique_violation then
  raise exception 'Username already exists' using errcode = '23505';
end;
$$;

-- 游戏数据 API 已退役，只移除遗留的无条件读取策略，保留表和数据。
drop policy "public reads server status" on public.game_servers;
drop policy "public reads player profiles" on public.player_profiles;
drop policy "public reads recent metrics" on public.server_metrics;

commit;
