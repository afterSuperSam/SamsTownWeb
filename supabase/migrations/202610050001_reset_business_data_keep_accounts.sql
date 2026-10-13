-- 仅在当次全量备份验证及 Storage API 清空完成后由 CLI 按序应用；本轮不应用生产。
-- 保留全部 Auth、profiles 和 QQ 身份；前置失败或后置不一致均回滚整个语句。
do $reset$
declare
  business_tables constant text[] := array[
    'public.account_deletion_queue', 'public.audit_logs', 'public.daily_page_views',
    'public.faq_items', 'public.forum_posts', 'public.game_servers',
    'public.map_claim_cells', 'public.map_claims', 'public.map_markers',
    'public.player_profiles', 'public.server_commands', 'public.server_metrics',
    'public.site_content', 'public.storage_cleanup_queue', 'public.town_announcements',
    'public.town_history', 'public.town_images', 'public.town_maps', 'public.town_members',
    'private.qq_verification_challenges', 'private.daily_visitor_views'
  ];
  identity_tables text[];
  expected_tables text[];
  inventory_before text[];
  inventory_after text[];
  identity_before text[] := array[]::text[];
  identity_after text[] := array[]::text[];
  table_name text;
  fingerprint text;
  has_rows boolean;
  phase integer;
begin
  perform set_config('search_path', 'pg_catalog', true);
  perform set_config('row_security', 'off', true);
  perform set_config('lock_timeout', '10s', true);
  expected_tables := business_tables || array['public.profiles', 'private.qq_identities'];

  -- 锁定发现的身份与业务基表，再复核清单；未知表、物化视图、外部表和继承结构一律阻断。
  for phase in 1..2 loop
    select array_agg(format('%I.%I', namespace.nspname, relation.relname) order by namespace.nspname, relation.relname)
      into inventory_after
    from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private') and relation.relkind in ('r', 'p', 'f', 'm');
    if inventory_after is null
      or not (inventory_after @> expected_tables and expected_tables @> inventory_after)
      or exists (
        select 1 from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname in ('public', 'private') and relation.relkind in ('p', 'f', 'm')
      ) then
      raise exception 'Reset blocked: unexpected public/private base table inventory';
    end if;
    select array_agg(format('%I.%I', namespace.nspname, relation.relname) order by namespace.nspname, relation.relname)
      into identity_tables
    from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
    where (namespace.nspname = 'auth' and relation.relkind in ('r', 'p', 'm'))
      or (namespace.nspname, relation.relname) in (('public', 'profiles'), ('private', 'qq_identities'));
    if to_regclass('auth.users') is null or exists (
      select 1 from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'auth' and relation.relkind in ('f', 'm')
    ) then
      raise exception 'Reset blocked: unsupported Auth inventory';
    end if;
    select array_agg(relation.oid::text || ':' || relation.relkind::text || ':' || namespace.nspname || '.' || relation.relname
      order by relation.oid) into inventory_after
    from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('auth', 'public', 'private') and relation.relkind in ('r', 'p', 'f', 'm');
    if phase = 1 then
      inventory_before := inventory_after;
      for table_name in select unnest(business_tables || identity_tables) order by 1 loop
        execute 'lock table ' || table_name || ' in access exclusive mode';
      end loop;
      lock table storage.buckets, storage.objects in share mode;
    elsif inventory_after is distinct from inventory_before then
      raise exception 'Reset blocked: table inventory changed while locking';
    end if;
  end loop;
  if exists (select 1 from pg_inherits where inhrelid = any (
    select source.table_identifier::regclass from unnest(expected_tables) source(table_identifier)
  ) or inhparent = any (select source.table_identifier::regclass from unnest(expected_tables) source(table_identifier))) then
    raise exception 'Reset blocked: unexpected business/identity inheritance';
  end if;
  if exists (select 1 from storage.buckets where id not in ('site-images', 'town-maps')) then
    raise exception 'Reset blocked: unexpected Storage bucket (schematics must be retired)';
  end if;
  if exists (select 1 from storage.objects) then
    raise exception 'Reset blocked: clear all Storage objects through Storage API first';
  end if;
  -- TRUNCATE 不调用行级删除/审计触发器；拒绝语句级 TRUNCATE 副作用，不禁用现有触发器。
  if exists (select 1 from pg_trigger where tgrelid = any (
    select source.table_identifier::regclass from unnest(business_tables) source(table_identifier)
  ) and (tgtype::integer & 32) <> 0 and tgenabled <> 'D') then
    raise exception 'Reset blocked: enabled business TRUNCATE trigger';
  end if;
  for table_name in select unnest(identity_tables) loop
    execute format('select encode(sha256(convert_to(coalesce(string_agg(row_hash, '''' order by row_hash), ''''), ''UTF8'')), ''hex'')
      from (select encode(sha256(convert_to(to_jsonb(identity_row)::text, ''UTF8'')), ''hex'') row_hash
        from %s identity_row) fingerprints', table_name) into fingerprint;
    identity_before := array_append(identity_before, fingerprint);
  end loop;

  -- 仅一次显式白名单 TRUNCATE，默认保留序列位置，RESTRICT 禁止扩展到身份或其他表。
  truncate table
    public.account_deletion_queue, public.audit_logs, public.daily_page_views,
    public.faq_items, public.forum_posts, public.game_servers,
    public.map_claim_cells, public.map_claims, public.map_markers,
    public.player_profiles, public.server_commands, public.server_metrics,
    public.site_content, public.storage_cleanup_queue, public.town_announcements,
    public.town_history, public.town_images, public.town_maps, public.town_members,
    private.qq_verification_challenges, private.daily_visitor_views
    restrict;

  -- 后置仅比较全集指纹，不输出身份值或哈希；任何残留使整次清空回滚。
  for table_name in select unnest(identity_tables) loop
    execute format('select encode(sha256(convert_to(coalesce(string_agg(row_hash, '''' order by row_hash), ''''), ''UTF8'')), ''hex'')
      from (select encode(sha256(convert_to(to_jsonb(identity_row)::text, ''UTF8'')), ''hex'') row_hash
        from %s identity_row) fingerprints', table_name) into fingerprint;
    identity_after := array_append(identity_after, fingerprint);
  end loop;
  if identity_after is distinct from identity_before then
    raise exception 'Reset failed: preserved identity rows changed';
  end if;
  for table_name in select unnest(business_tables) loop
    execute 'select exists (select 1 from ' || table_name || ')' into has_rows;
    if has_rows then raise exception 'Reset failed: business rows remain'; end if;
  end loop;
  select array_agg(relation.oid::text || ':' || relation.relkind::text || ':' || namespace.nspname || '.' || relation.relname
    order by relation.oid) into inventory_after
  from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in ('auth', 'public', 'private') and relation.relkind in ('r', 'p', 'f', 'm');
  if inventory_after is distinct from inventory_before then
    raise exception 'Reset failed: table inventory changed';
  end if;
  if exists (select 1 from storage.objects)
    or exists (select 1 from storage.buckets where id not in ('site-images', 'town-maps')) then
    raise exception 'Reset failed: Storage is not empty or has unexpected buckets';
  end if;
end;
$reset$;
