-- =============================================================================
-- Daily coverage: make get_upload_coverage_detail fast (15.2 s cold / 3.6 s warm)
-- =============================================================================
-- PURPOSE
--   The console Daily coverage panel timed out. Causes, measured with EXPLAIN
--   ANALYZE on the generated SQL (org Company A, 35 active feeds):
--   1. Feed scans on timestamptz date columns filtered with (col)::date, which
--      no btree can serve; work_orders alone was 1.0-1.5 s of heap reads.
--   2. cs_weekday_rate ran a correlated EXISTS over the base_days CTE in the
--      SELECT list: pairs x 180 days subplans, each a CTE scan.
--   3. site_gaps' NOT EXISTS over the scoped CTE was planned as a Nested Loop
--      Anti Join (bad row estimate): 1.85 s.
--   4. Every per-source JSON field was a correlated subquery over a CTE.
--
-- FIX (output unchanged; see VERIFY)
--   * _upload_feed_window_sql(): per feed, replaces the (col)::date tests with
--     the EXACTLY equivalent sargable range col >= (current_date-$N+1)::<type>
--     and col < (current_date+1)::<type> (same session TimeZone on both sides;
--     falls back to the original test for any other column type).
--   * Detail: country filter pushed into each feed branch (it was applied just
--     after the UNION, so the rows are identical); EXISTS/correlated subqueries
--     replaced by pre-aggregated CTEs joined once; NOT EXISTS -> hashed NOT IN
--     (all four key columns are non-null by construction); materialized CTEs.
--   * Cron twin _upload_coverage_for_org gets the same window helper so the
--     05:30 alert and the panel read the registry the same way.
--   * Four covering indexes (org, date) INCLUDE (country, site): 36 MB total.
--     The planner picks each one (Index Only Scan) - EXPLAIN evidence:
--       work_orders 1514 ms -> 29 ms, parts_consumption 555 -> 40 ms,
--       work_order_line_items 196-350 -> 93 ms, production_logs 180 -> 26 ms.
--   * A STABLE function cannot create a temp table, hence CTEs, not temp tables.
--
-- ONE DELIBERATE OUTPUT DIFFERENCE: the per-source "sites" array now has a
--   final tiebreak on site name. Before, sites tied on (missing_count, rows)
--   came out in whatever order the hash aggregate produced (plan dependent).
--   Every other byte is identical: hashed old vs new for 10 (days,country)
--   inputs with generated_at stripped and sites re-sorted by the full key -
--   all 10 equal; 4 of them were byte-identical even without re-sorting.
--   The cron twin was byte-identical on all 6 inputs tested.
--
-- MEASURED (same session, warm; old -> new)
--   detail  30/All: 1296-1868 ms -> 348-744 ms   30/KSA: 1263-1365 -> 269-433
--           14/UAE: 1194-1265 -> 69-92           365/Egypt: 2490-2544 -> 233-380
--           365/All: 1868-2312 -> ~790 (plan)    60/other: 1105-1657 -> 28-33
--   cron    30/All: 167 -> 33 ms   30/KSA: 405 -> 30   180/Egypt: 279 -> 157
--   End to end, get_upload_coverage_detail as a super admin (role
--   authenticated): 30/All 299-359 ms, 30/KSA 239, 90/All 351, 365/All 693.
--   Old first call of the session was 3883 ms. Cold is dominated by heap
--   reads, which the index-only scans remove (not directly measurable here:
--   shared buffers cannot be flushed from SQL).
--
-- VERIFY
--   select md5((public.get_upload_coverage_detail(30, null) - 'generated_at')::text);
--   explain of the generated SQL shows "Index Only Scan using *_cov_idx".
--
-- ROLLBACK
--   Re-apply the previous bodies of _upload_coverage_detail_for_org
--   (MIGRATIONS_V485_UPLOAD_COVERAGE_READS_REGISTRY.sql) and
--   _upload_coverage_for_org (MIGRATIONS_V486_UPLOAD_GAP_PUSH.sql), then:
--   drop index if exists public.work_orders_org_opened_cov_idx,
--     public.parts_consumption_org_event_cov_idx,
--     public.work_order_line_items_org_created_cov_idx,
--     public.production_logs_org_period_cov_idx;
--   drop function if exists public._upload_feed_window_sql(text, text, text);
-- =============================================================================

-- Sargable window bounds for one feed's date column. Returns extra predicates
-- ('' when the column type is not a date/timestamp) that are EXACTLY implied
-- by the existing "(col)::date > current_date - $N and (col)::date <= current_date"
-- test (same session TimeZone on both sides), so adding them cannot change the
-- result - it only lets the planner use a (…, <date col>) index range.
create or replace function public._upload_feed_window_sql(p_table text, p_col text, p_param text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select case
           when t.typ in ('date', 'timestamp with time zone', 'timestamp without time zone')
           then format(' and t.%I >= ((current_date - %s + 1))::%s and t.%I < ((current_date + 1))::%s',
                       p_col, p_param, t.typ, p_col, t.typ)
           else ''
         end
    from (select format_type(a.atttypid, a.atttypmod) as typ
            from pg_attribute a
           where a.attrelid = ('public.' || quote_ident(p_table))::regclass
             and a.attname = p_col and not a.attisdropped) t
$$;
revoke all on function public._upload_feed_window_sql(text, text, text) from public;
revoke all on function public._upload_feed_window_sql(text, text, text) from anon, authenticated;

-- Feed branches: $1 = org, $2 = baseline window, $4 = country. The country
-- filter and a sargable date range are pushed INTO each branch (both are
-- implied by what "base" filters afterwards, so the rows are the same).
-- No registered feed is an honest empty answer, not an error.
create or replace function public._upload_coverage_detail_for_org(p_org uuid, p_days integer DEFAULT 30, p_country text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n    int := least(greatest(coalesce(p_days, 30), 7), 365);
  v_base int := greatest(180, v_n);
  v_raw  text;
  v_sql  text;
  v_out  jsonb;
begin
  if p_org is null then return jsonb_build_object('ok', false, 'reason', 'no_org'); end if;
  select string_agg(
           format(
             'select %L::text as src, t.country, %s as site, (t.%I)::date as d, count(*)::bigint as rows'
             || ' from public.%I t'
             || ' where t.organisation_id = $1'
             || '   and t.country is not null and ($4::text is null or t.country = $4::text)'
             || coalesce(nullif(public._upload_feed_window_sql(f.table_name, f.date_column, '$2'), ''),
                  format(' and t.%I is not null and (t.%I)::date > current_date - $2 and (t.%I)::date <= current_date',
                         f.date_column, f.date_column, f.date_column))
             || ' group by 1,2,3,4',
             f.src,
             case when f.site_column is null
                  then '''Not stated''::text'
                  else format('coalesce(nullif(btrim(t.%I), ''''), ''Not stated'')', f.site_column)
             end,
             f.date_column, f.table_name
           ),
           ' union all '
           order by f.sort_order, f.src)
    into v_raw
    from public.upload_feeds f
   where f.active;
  if v_raw is null then
    return jsonb_build_object(
      'ok', true, 'generated_at', now(), 'today', current_date,
      'days', v_n, 'baseline_days', v_base, 'country', p_country,
      'countries', '[]'::jsonb, 'files', '[]'::jsonb, 'no_feeds', true);
  end if;
  v_sql :=
  'with days as (
     select generate_series(current_date - $3 + 1, current_date, interval ''1 day'')::date as d
   ),
   base as materialized (
     select * from (' || v_raw || ') raw where country is not null and ($4::text is null or country = $4::text)
   ),
   scoped as materialized (
     select * from base where d > current_date - $3
   ),
   srcs as (
     select f.src, f.label, f.table_name as tbl, f.sort_order as ord,
            f.date_basis, f.site_day_policed
       from public.upload_feeds f where f.active
   ),
   pairs as materialized (select distinct country, src from base),
   base_days as materialized (
     select distinct country, src, d from base where d < current_date
   ),
   base_gaps as (
     select country, src, d, d - lag(d) over (partition by country, src order by d) as gap
       from base_days
   ),
   gap_p90 as (
     select country, src, percentile_disc(0.9) within group (order by gap) as p90
       from base_gaps where gap is not null group by 1,2
   ),
   cadence as (
     select bd.country, bd.src,
            count(*) as base_data_days,
            (current_date - 1) - min(bd.d) + 1 as base_elapsed,
            max(bd.d) as last_data_date
       from base_days bd group by 1,2
   ),
   cadence2 as (
     select c.*,
            coalesce(g.p90, 1) as typical_gap,
            (c.base_elapsed > 0 and c.base_data_days::numeric / c.base_elapsed >= 0.5) as expect_daily,
            current_date - c.last_data_date as days_since_last
       from cadence c
       left join gap_p90 g on g.country = c.country and g.src = c.src
   ),
   cadence3 as materialized (
     select c.country, c.src, c.base_data_days, c.base_elapsed, c.last_data_date, c.typical_gap,
            c.expect_daily, c.days_since_last,
            public._coverage_quiet(c.expect_daily, c.days_since_last, c.typical_gap) as quiet
       from cadence2 c
   ),
   scoped_day as (
     select country, src, d, sum(rows) as rows,
            count(distinct site) filter (where rows > 0) as sites
       from scoped group by 1,2,3
   ),
   cs_day as materialized (
     select p.country, p.src, d.d, coalesce(s.rows, 0) as rows, coalesce(s.sites, 0) as sites
       from pairs p cross join days d
       left join scoped_day s on s.country = p.country and s.src = p.src and s.d = d.d
   ),
   cs_weekday_rate as materialized (
     select p.country, p.src, extract(isodow from g.d)::int as dow,
            count(*) filter (where b.d is not null)::numeric / nullif(count(*), 0) as hit_rate
       from pairs p
       cross join (select generate_series(current_date - $2 + 1, current_date - 1, interval ''1 day'')::date d) g
       left join base_days b on b.country = p.country and b.src = p.src and b.d = g.d
      group by 1,2,3
   ),
   cs_stats as (
     select c.country, c.src,
            count(*) filter (where c.rows > 0 and c.d < current_date) as days_with_data,
            count(*) filter (where c.d < current_date)                as days_elapsed,
            sum(c.rows)                                               as total_rows
       from cs_day c group by 1,2
   ),
   cs_gaps as materialized (
     select c.country, c.src, c.d
       from cs_day c
       join cadence3 e on e.country = c.country and e.src = c.src
       join cs_weekday_rate w on w.country = c.country and w.src = c.src
                             and w.dow = extract(isodow from c.d)::int
      where e.expect_daily and c.rows = 0 and c.d < current_date
        and coalesce(w.hit_rate, 0) >= 0.3
   ),
   cs_gap_agg as (
     select country, src, count(*) as n, jsonb_agg(d order by d desc) as days
       from cs_gaps group by 1,2
   ),
   cs_day_agg as (
     select country, src,
            jsonb_agg(jsonb_build_object(''d'', d, ''rows'', rows, ''sites'', sites) order by d) as by_day
       from cs_day group by 1,2
   ),
   site_stats as (
     select s.country, s.src, s.site,
            sum(s.rows) as rows,
            count(distinct s.d) filter (where s.d < current_date) as days_with_data,
            min(s.d) as first_data_date,
            max(s.d) as last_data_date,
            max(s.d) filter (where s.d > current_date - greatest($3 / 2, 3)) is not null as active_recently
       from scoped s group by 1,2,3
   ),
   site_daily as materialized (
     select ss.*,
            (coalesce((select sd.site_day_policed from srcs sd where sd.src = ss.src), false)
             and ss.days_with_data >= 5
             and ss.days_with_data::numeric
                 / nullif(greatest(least(current_date - 1, ss.last_data_date) - ss.first_data_date + 1, 1), 0) >= 0.5
            ) as expect_daily_site
       from site_stats ss
   ),
   site_gaps as (
     select ss.country, ss.src, ss.site, c.d
       from site_daily ss
       join cs_day c on c.country = ss.country and c.src = ss.src
       join cadence3 e on e.country = ss.country and e.src = ss.src
      where e.expect_daily and ss.active_recently and ss.expect_daily_site
        and c.rows > 0 and c.d < current_date
        and c.d between ss.first_data_date and ss.last_data_date
        and (ss.country, ss.src, ss.site, c.d) not in (select x.country, x.src, x.site, x.d from scoped x)
   ),
   site_gap_agg as (
     select country, src, site, count(*) as n, jsonb_agg(d order by d desc) as days
       from site_gaps group by 1,2,3
   ),
   site_json as (
     select ss.country, ss.src,
            jsonb_agg(jsonb_build_object(
                ''site'', ss.site, ''rows'', ss.rows,
                ''days_with_data'', ss.days_with_data,
                ''last_data_date'', ss.last_data_date,
                ''days_since_last'', current_date - ss.last_data_date,
                ''dormant'', not ss.active_recently,
                ''occasional'', not ss.expect_daily_site,
                ''missing_count'', coalesce(sg.n, 0),
                ''missing_days'', coalesce(sg.days, ''[]''::jsonb))
              order by coalesce(sg.n, 0) desc, ss.rows desc, ss.site) as sites
       from site_daily ss
       left join site_gap_agg sg on sg.country = ss.country and sg.src = ss.src and sg.site = ss.site
      group by 1,2
   ),
   country_gaps as (
     select country, count(*) as n from cs_gaps group by 1
   )
   select jsonb_build_object(
     ''ok'', true, ''generated_at'', now(), ''today'', current_date,
     ''days'', $3, ''baseline_days'', $2, ''country'', $4,
     ''watched_feeds'', (select count(*) from srcs),
     ''countries'', coalesce((
       select jsonb_agg(jsonb_build_object(
         ''country'', q.country,
         ''total_rows'', q.total_rows,
         ''missing_count'', q.missing_count,
         ''quiet_count'', q.quiet_count,
         ''watched_sources'', q.watched_sources,
         ''sources'', q.sources) order by q.missing_count + q.quiet_count desc, q.country)
       from (
         select e.country,
                sum(coalesce(st.total_rows, 0)) as total_rows,
                coalesce(max(cg.n), 0) as missing_count,
                count(*) filter (where e.quiet) as quiet_count,
                count(*) filter (where e.expect_daily) as watched_sources,
                jsonb_agg(jsonb_build_object(
                  ''src'', e.src,
                  ''label'', sr.label,
                  ''table'', sr.tbl,
                  ''date_basis'', sr.date_basis,
                  ''expect_daily'', e.expect_daily,
                  ''typical_gap_days'', e.typical_gap,
                  ''quiet'', e.quiet,
                  ''base_data_days'', e.base_data_days,
                  ''days_with_data'', coalesce(st.days_with_data, 0),
                  ''days_elapsed'', coalesce(st.days_elapsed, 0),
                  ''total_rows'', coalesce(st.total_rows, 0),
                  ''last_data_date'', e.last_data_date,
                  ''days_since_last'', e.days_since_last,
                  ''missing_count'', coalesce(ga.n, 0),
                  ''missing_days'', coalesce(ga.days, ''[]''::jsonb),
                  ''by_day'', coalesce(da.by_day, ''[]''::jsonb),
                  ''sites'', coalesce(sj.sites, ''[]''::jsonb)
                ) order by sr.ord) as sources
           from cadence3 e
           left join srcs sr on sr.src = e.src
           left join cs_stats st on st.country = e.country and st.src = e.src
           left join cs_gap_agg ga on ga.country = e.country and ga.src = e.src
           left join cs_day_agg da on da.country = e.country and da.src = e.src
           left join site_json sj on sj.country = e.country and sj.src = e.src
           left join country_gaps cg on cg.country = e.country
          group by e.country
       ) q), ''[]''::jsonb),
     ''files'', coalesce((
       select jsonb_agg(jsonb_build_object(
         ''filename'', f.original_filename, ''country'', f.country,
         ''uploaded_at'', f.created_at, ''size_bytes'', f.size_bytes,
         ''source_system'', f.source_system) order by f.created_at desc)
         from public.import_files f
        where f.organisation_id = $1
          and f.created_at >= current_date - $3
          and ($4::text is null or f.country = $4::text)), ''[]''::jsonb)
   )';
  execute v_sql into v_out using p_org, v_base, v_n, p_country;
  return v_out;
end $function$;

-- Cron twin (morning upload-gap check). Same registry, same sargable window,
-- so the alert and the panel keep reading one feed list the same way.
CREATE OR REPLACE FUNCTION public._upload_coverage_for_org(p_org uuid, p_days integer DEFAULT 30, p_country text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n   int := least(greatest(coalesce(p_days, 30), 7), 180);
  v_raw text;
  v_sql text;
  v_out jsonb;
begin
  if p_org is null then return jsonb_build_object('ok', false, 'reason', 'no_org'); end if;

  select string_agg(
           format(
             'select %L::text as src, (t.%I)::date as d, count(*)::bigint as rows'
             || ' from public.%I t'
             || ' where t.organisation_id = $1'
             || '   and ($3 is null or t.country = $3)'
             || coalesce(nullif(public._upload_feed_window_sql(f.table_name, f.date_column, '$2'), ''),
                  format(' and t.%I is not null and (t.%I)::date > current_date - $2 and (t.%I)::date <= current_date',
                         f.date_column, f.date_column, f.date_column))
             || ' group by 1,2',
             f.src, f.date_column, f.table_name
           ),
           ' union all ' order by f.sort_order, f.src)
    into v_raw
    from public.upload_feeds f
   where f.active;

  if v_raw is null then
    return jsonb_build_object('ok', true, 'generated_at', now(), 'today', current_date,
      'days', v_n, 'country', p_country,
      'sources', '[]'::jsonb, 'alerts', '[]'::jsonb, 'no_feeds', true);
  end if;

  v_sql :=
  'with days as (
     select generate_series(current_date - $2 + 1, current_date, interval ''1 day'')::date as d
   ), raw as (' || v_raw || '
   ), srcs as (
     select f.src, f.label, f.table_name as tbl, f.sort_order as ord
       from public.upload_feeds f where f.active
   ), grid as (
     select s.src, s.label, s.tbl, s.ord, d.d, coalesce(r.rows, 0) as rows
       from srcs s cross join days d
       left join raw r on r.src = s.src and r.d = d.d
   ), weekday_activity as (
     select src, extract(isodow from d)::int as dow,
            count(*) filter (where rows > 0)::numeric / nullif(count(*), 0) as hit_rate
       from grid where d < current_date group by 1, 2
   ), src_stats as (
     select g.src, g.label, g.tbl, g.ord,
            count(*) filter (where g.rows > 0 and g.d < current_date) as days_with_data,
            count(*) filter (where g.d < current_date)                as days_elapsed,
            max(g.d) filter (where g.rows > 0)                        as last_data_date,
            sum(g.rows)                                               as total_rows
       from grid g group by 1,2,3,4
   ), expectation as (
     select st.*, (st.days_elapsed > 0
              and st.days_with_data::numeric / st.days_elapsed >= 0.5) as expect_daily
       from src_stats st
   ), gaps as (
     select g.src, g.d
       from grid g
       join expectation e on e.src = g.src
       join weekday_activity wa on wa.src = g.src and wa.dow = extract(isodow from g.d)::int
      where e.expect_daily and g.rows = 0 and g.d < current_date
        and coalesce(wa.hit_rate, 0) >= 0.3
   )
   select jsonb_build_object(
     ''ok'', true, ''generated_at'', now(), ''today'', current_date,
     ''days'', $2, ''country'', $3,
     ''sources'', (
       select coalesce(jsonb_agg(x order by x.expect_daily desc, x.ord), ''[]''::jsonb) from (
         select e.src, e.label, e.tbl, e.ord, e.expect_daily,
                e.days_with_data, e.days_elapsed, e.total_rows, e.last_data_date,
                case when e.last_data_date is null then null
                     else (current_date - e.last_data_date) end as days_since_last,
                (select coalesce(jsonb_agg(jsonb_build_object(''d'', g.d, ''rows'', g.rows) order by g.d), ''[]''::jsonb)
                   from grid g where g.src = e.src) as by_day,
                (select coalesce(jsonb_agg(gp.d order by gp.d desc), ''[]''::jsonb)
                   from gaps gp where gp.src = e.src) as missing_days,
                (select count(*) from gaps gp where gp.src = e.src) as missing_count
           from expectation e) x),
     ''alerts'', (
       select coalesce(jsonb_agg(jsonb_build_object(
                ''src'', e.src, ''label'', e.label,
                ''last_data_date'', e.last_data_date,
                ''days_since_last'', current_date - e.last_data_date)
              order by (current_date - e.last_data_date) desc), ''[]''::jsonb)
         from expectation e
        where e.expect_daily and e.last_data_date is not null
          and e.last_data_date < current_date - 1)
   )';

  execute v_sql into v_out using p_org, v_n, p_country;
  return v_out;
end $function$;

-- Covering indexes: the four large feeds are read by (organisation_id, <date>)
-- with country + site as the only other columns, so an index-only scan
-- replaces ~400 MB of random heap reads. Applied live with CREATE INDEX
-- CONCURRENTLY; IF NOT EXISTS makes a replay a no-op.
create index if not exists work_orders_org_opened_cov_idx
  on public.work_orders (organisation_id, opened_at) include (country, site);
create index if not exists parts_consumption_org_event_cov_idx
  on public.parts_consumption (organisation_id, event_date) include (country, site);
create index if not exists work_order_line_items_org_created_cov_idx
  on public.work_order_line_items (organisation_id, created_at) include (country, site);
create index if not exists production_logs_org_period_cov_idx
  on public.production_logs (organisation_id, period_date) include (country, site);
