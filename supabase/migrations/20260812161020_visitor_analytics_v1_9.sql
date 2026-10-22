-- Privacy-preserving visitor analytics -------------------------------------

create table if not exists private.daily_visitor_views (
  view_date date not null,
  visitor_digest text not null check (visitor_digest ~ '^[a-f0-9]{64}$'),
  masked_ip text not null check (char_length(masked_ip) between 3 and 80),
  view_count bigint not null default 1 check (view_count > 0),
  last_seen_at timestamptz not null default now(),
  primary key (view_date, visitor_digest)
);

revoke all on private.daily_visitor_views from public, anon, authenticated;

drop function if exists public.record_page_view(boolean);
create or replace function public.record_page_view(
  p_authenticated boolean default false,
  p_visitor_digest text default null,
  p_masked_ip text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_date_cn date := (now() at time zone 'Asia/Shanghai')::date;
begin
  insert into public.daily_page_views (
    view_date, total_views, authenticated_views, updated_at
  ) values (
    current_date_cn,
    1,
    case when p_authenticated then 1 else 0 end,
    now()
  )
  on conflict (view_date) do update
  set total_views = public.daily_page_views.total_views + 1,
      authenticated_views = public.daily_page_views.authenticated_views
        + case when p_authenticated then 1 else 0 end,
      updated_at = now();

  if p_visitor_digest is not null and p_masked_ip is not null then
    if p_visitor_digest !~ '^[a-f0-9]{64}$'
      or char_length(p_masked_ip) not between 3 and 80 then
      raise invalid_parameter_value;
    end if;
    insert into private.daily_visitor_views (
      view_date, visitor_digest, masked_ip, view_count, last_seen_at
    ) values (
      current_date_cn, p_visitor_digest, p_masked_ip, 1, now()
    )
    on conflict (view_date, visitor_digest) do update
    set view_count = private.daily_visitor_views.view_count + 1,
        masked_ip = excluded.masked_ip,
        last_seen_at = now();
  end if;

  -- Keep detailed visitor aggregates bounded; long-term totals remain in
  -- public.daily_page_views without retaining a visitor fingerprint.
  delete from private.daily_visitor_views
  where view_date < current_date_cn - 365;
end;
$$;

create or replace function public.get_page_view_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  start_date date := (now() at time zone 'Asia/Shanghai')::date
    - (greatest(1, least(coalesce(p_days, 30), 365)) - 1);
begin
  if not private.is_owner() then raise insufficient_privilege; end if;

  select jsonb_build_object(
    'totalViews', coalesce((select sum(total_views) from public.daily_page_views), 0),
    'authenticatedViews', coalesce((select sum(authenticated_views) from public.daily_page_views), 0),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', day.view_date,
        'totalViews', day.total_views,
        'authenticatedViews', day.authenticated_views
      ) order by day.view_date)
      from (
        select series::date as view_date,
          coalesce(views.total_views, 0) as total_views,
          coalesce(views.authenticated_views, 0) as authenticated_views
        from generate_series(start_date, (now() at time zone 'Asia/Shanghai')::date, interval '1 day') series
        left join public.daily_page_views views on views.view_date = series::date
      ) day
    ), '[]'::jsonb),
    'frequentVisitors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'maskedIp', visitors.masked_ip,
        'views', visitors.views,
        'activeDays', visitors.active_days,
        'lastSeenAt', visitors.last_seen_at
      ) order by visitors.views desc, visitors.last_seen_at desc)
      from (
        select max(masked_ip) as masked_ip,
          sum(view_count) as views,
          count(distinct view_date) as active_days,
          max(last_seen_at) as last_seen_at
        from private.daily_visitor_views
        where view_date >= start_date
        group by visitor_digest
        order by views desc, last_seen_at desc
        limit 20
      ) visitors
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.record_page_view(boolean, text, text) from public, anon, authenticated;
grant execute on function public.record_page_view(boolean, text, text) to service_role;
revoke all on function public.get_page_view_analytics(integer) from public, anon;
grant execute on function public.get_page_view_analytics(integer) to authenticated;
