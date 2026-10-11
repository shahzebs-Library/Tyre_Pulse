-- 20261011110000_most_used_read_paths
--
-- Speed pass on the areas used most, chosen from pg_stat_statements (total time
-- since 2026-09-30) and measured as a real KSA Manager under RLS. Every change
-- returns byte-identical results (md5 of each payload compared before/after in
-- a rolled-back transaction); only the plan or the per-row cost changes.
--
-- 1. plan_cache_mode = force_custom_plan on the read RPCs that filter big tables
--    with nullable arguments ("p_from is null or event_date >= p_from"). PostgREST
--    reuses pooled connections, so after a few calls Postgres switches these to a
--    GENERIC plan that cannot use the date/country index and scans everything.
--    Measured: get_expense_by_country 3,134 -> 205 ms, get_maintenance_snapshot
--    5,097 -> 596 ms, get_fleet_renewal_signals 1,650 -> 445 ms, get_parts_expense
--    _snapshot 1,368 -> 308 ms, get_maint_tyre_split 873 -> 158 ms. _cost_* and
--    get_cost_cpk_overview already carried this setting (V093/V100).
--
-- 2. wo_status_canonical rewritten as a single inlinable expression (no CTE, no
--    SET search_path). It runs once per work order on the Work Orders page; as a
--    non-inlined call it cost ~32 us/row = 1.9 s over the KSA register.
--    Count over KSA work orders 1,939 -> 273 ms. Work Orders page 3,951 -> 489 ms,
--    stats 1,607 -> 428 ms, all-country stats 5,737 -> 1,075 ms, insights
--    1,553 -> 510 ms. Equivalence: every distinct live status plus 29 edge strings,
--    0 mismatches. It is IMMUTABLE pure string logic, so no search_path is needed
--    (same reasoning as tyre_size_key in 20261011100000); expect one
--    function_search_path_mutable lint for it ON PURPOSE.
--    MIRROR: normalizeWoStatus() in src/lib/workOrderStatus.js - change both.
--
-- 3. parts_consumption (country, event_date desc). Every org-leading composite
--    index is unusable for a normal user because the RLS org predicate is
--    "organisation_id = app_current_org() OR is_super_admin()" - an OR the planner
--    cannot turn into an index condition. The Expenses page's "newest record"
--    probe (country = X order by event_date desc limit 1) scanned 57k rows:
--    2,738 -> 3 ms.
--
-- 4. cron_health_watch (every 5 minutes) called _cron_health(1), which reads all
--    of cron.job_run_details (103 MB, 166k rows; owned by supabase_admin, so it
--    cannot be indexed). 2.5-3.5 s per run and a 103 MB read through a 256 MB
--    cache every five minutes. _cron_watch_state() finds the last day's rows by a
--    binary search on runid (the primary key, assigned in start order) and
--    computes only the fields the watcher reads: 2,528 -> 57 ms, identical
--    last_status / fail_streak / stuck / overdue / active on all 23 jobs.
--    _cron_health() itself is unchanged (the console still uses it on demand).
--
-- Rollback:
--   alter function public.<fn>(...) reset plan_cache_mode;  -- per function below
--   drop index public.parts_consumption_country_event_idx;
--   restore wo_status_canonical / cron_health_watch from _bak.fn_backup_20261011b
--   drop function public._cron_watch_state(); drop function public._cron_runid_since(timestamptz);

create table if not exists _bak.fn_backup_20261011b as
  select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, now() as saved_at
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('wo_status_canonical', 'cron_health_watch');

-- 1 ---------------------------------------------------------------------------
alter function public.driver_fine_register(p_filters jsonb, p_offset integer) set plan_cache_mode = force_custom_plan;
alter function public.driver_workspace_options(p_kind text, p_search text, p_offset integer) set plan_cache_mode = force_custom_plan;
alter function public.get_accident_audit(p_accident_id uuid) set plan_cache_mode = force_custom_plan;
alter function public.get_accident_case_kpis(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_accident_case_status_breakdown(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_asset_disposal_fleet_baseline(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_asset_disposal_register(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_asset_disposal_reliability(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_asset_master(p_search text, p_limit integer) set plan_cache_mode = force_custom_plan;
alter function public.get_asset_ownership(p_search text, p_limit integer, p_cross_only boolean, p_asset text) set plan_cache_mode = force_custom_plan;
alter function public.get_brand_size_cpk(p_country text, p_from date, p_to date, p_site text) set plan_cache_mode = force_custom_plan;
alter function public.get_classification_decisions(p_country text, p_from date, p_to date, p_view text, p_search text, p_limit integer) set plan_cache_mode = force_custom_plan;
alter function public.get_control_center_summary(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_cost_cpk_overview_multi(p_countries text[], p_site text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_cost_per_m3(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_cost_per_m3_trend(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_cost_variance(p_country text, p_site text, p_from date, p_to date, p_limit integer) set plan_cache_mode = force_custom_plan;
alter function public.get_cost_variance_multi(p_countries text[], p_site text, p_from date, p_to date, p_limit integer) set plan_cache_mode = force_custom_plan;
alter function public.get_country_kpi(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_cpk_drivers(p_country text, p_from date, p_to date, p_prev_from date, p_prev_to date, p_site text) set plan_cache_mode = force_custom_plan;
alter function public.get_cpk_hours_source(p_country text, p_from date, p_to date, p_asset text, p_site text) set plan_cache_mode = force_custom_plan;
alter function public.get_cpk_km_intelligence(p_country text, p_from date, p_to date, p_site text) set plan_cache_mode = force_custom_plan;
alter function public.get_cpk_km_source(p_country text, p_from date, p_to date, p_asset text, p_site text) set plan_cache_mode = force_custom_plan;
alter function public.get_cpk_unit_audit(p_country text, p_from date, p_to date, p_site text) set plan_cache_mode = force_custom_plan;
alter function public.get_daily_job_cards(p_country text, p_on date) set plan_cache_mode = force_custom_plan;
alter function public.get_data_trust_overview(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_expense_by_country(p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_expense_by_site(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_expense_period_trend(p_country text, p_grain text) set plan_cache_mode = force_custom_plan;
alter function public.get_expense_yearly_trend(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_extra_field_stats(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_figure_lineage(p_domain text, p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_fleet_area_map(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_fleet_cpk(p_country text, p_from date, p_to date, p_site text) set plan_cache_mode = force_custom_plan;
alter function public.get_fleet_renewal_signals(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_maint_tyre_split(p_country text, p_site text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_maintenance_snapshot(p_site text, p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_mobile_analytics(p_country text, p_from date, p_to date, p_site text) set plan_cache_mode = force_custom_plan;
alter function public.get_parts_expense_snapshot(p_site text, p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_plan_coverage(p_country text, p_horizon_days integer) set plan_cache_mode = force_custom_plan;
alter function public.get_production_monthly(p_country text, p_from date, p_to date, p_reason text) set plan_cache_mode = force_custom_plan;
alter function public.get_production_reasons(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_production_rejections(p_country text, p_from date, p_to date, p_reason text) set plan_cache_mode = force_custom_plan;
alter function public.get_production_stations(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_record_provenance(p_table text, p_id uuid) set plan_cache_mode = force_custom_plan;
alter function public.get_report_snapshot_authed(p_from text, p_to text, p_site text, p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_report_tyre_maintenance(p_token text, p_password text, p_site text, p_country text, p_from text, p_to text) set plan_cache_mode = force_custom_plan;
alter function public.get_sany_delay_candidates(p_country text, p_from date, p_to date, p_min_days numeric) set plan_cache_mode = force_custom_plan;
alter function public.get_schedule_adherence(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_site_operating_cost(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_site_operating_cost_multi(p_countries text[], p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_tyre_brand_size_mix(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_tyre_consumption(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_tyre_cost_by_asset(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.get_tyre_filter_options(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_tyre_gap_overview(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.get_tyre_running_life(p_country text, p_limit integer, p_offset integer, p_asset text, p_due_only boolean) set plan_cache_mode = force_custom_plan;
alter function public.get_unplanned_assets(p_country text, p_horizon_days integer, p_site text, p_limit integer) set plan_cache_mode = force_custom_plan;
alter function public.get_work_order_insights(p_country text, p_from text, p_to text) set plan_cache_mode = force_custom_plan;
alter function public.get_work_order_stats(p_country text, p_from text, p_to text) set plan_cache_mode = force_custom_plan;
alter function public.get_work_orders_page(p_country text, p_from text, p_to text, p_search text, p_status text, p_priority text, p_type text, p_sort text, p_dir text, p_limit integer, p_offset integer) set plan_cache_mode = force_custom_plan;
alter function public.list_scrapped_tyres(p_search text, p_country text, p_limit integer) set plan_cache_mode = force_custom_plan;
alter function public.reference_asset_options(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.reference_site_options(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.report_asset_metrics(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.report_asset_overview(p_country text) set plan_cache_mode = force_custom_plan;
alter function public.report_country_metrics(p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.report_country_trends(p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.report_tyre_summary(p_country text, p_from date, p_to date) set plan_cache_mode = force_custom_plan;
alter function public.search_fleet_assets(p_query text, p_country text, p_site text, p_limit integer, p_offset integer) set plan_cache_mode = force_custom_plan;

-- 2 ---------------------------------------------------------------------------
create or replace function public.wo_status_canonical(p_raw text)
 returns text language sql immutable parallel safe
as $f$
  select case
    when btrim(coalesce(p_raw, '')) = '' then ''
    else coalesce(
      case regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(p_raw, ''))), '[\s\-/]+', '_', 'g'), '_+', '_', 'g'), '^_|_$', '', 'g')
        when 'new' then 'New' when 'open' then 'New'
        when 'created' then 'New' when 'raised' then 'New'
        when 'awaiting_assignment' then 'Awaiting Assignment'
        when 'unassigned' then 'Awaiting Assignment'
        when 'pending_assignment' then 'Awaiting Assignment'
        when 'assigned' then 'Assigned' when 'allocated' then 'Assigned'
        when 'in_progress' then 'In Progress' when 'inprogress' then 'In Progress'
        when 'started' then 'In Progress' when 'working' then 'In Progress'
        when 'wip' then 'In Progress'
        when 'waiting_for_parts' then 'Waiting for Parts'
        when 'waiting_parts' then 'Waiting for Parts'
        when 'awaiting_parts' then 'Waiting for Parts'
        when 'parts' then 'Waiting for Parts'
        when 'waiting_for_approval' then 'Waiting for Approval'
        when 'waiting_approval' then 'Waiting for Approval'
        when 'awaiting_approval' then 'Waiting for Approval'
        when 'pending_approval' then 'Waiting for Approval'
        when 'approval' then 'Waiting for Approval'
        when 'quality_inspection' then 'Quality Inspection'
        when 'qc' then 'Quality Inspection'
        when 'qc_inspection' then 'Quality Inspection'
        when 'quality_check' then 'Quality Inspection'
        when 'inspection' then 'Quality Inspection'
        when 'awaiting_inspection' then 'Quality Inspection'
        when 'completed' then 'Completed' when 'complete' then 'Completed'
        when 'done' then 'Completed' when 'closed' then 'Completed'
        when 'finished' then 'Completed'
        when 'overdue' then 'Overdue'
        when 'cancelled' then 'Cancelled' when 'canceled' then 'Cancelled'
        when 'void' then 'Cancelled' when 'voided' then 'Cancelled'
        when 'on_hold' then 'On Hold' when 'hold' then 'On Hold'
        when 'paused' then 'On Hold' when 'suspended' then 'On Hold'
        else null
      end,
      btrim(coalesce(p_raw, '')))
  end
$f$;
comment on function public.wo_status_canonical(text) is
  'No SET search_path on purpose: IMMUTABLE pure string logic, kept inlinable (a SET blocks inlining; it runs once per work order). Mirror of normalizeWoStatus() in src/lib/workOrderStatus.js.';

-- 3 ---------------------------------------------------------------------------
create index if not exists parts_consumption_country_event_idx
  on public.parts_consumption (country, event_date desc);
analyze public.parts_consumption;

-- 4 ---------------------------------------------------------------------------
create or replace function public._cron_runid_since(p_ts timestamptz)
 returns bigint language plpgsql stable security definer set search_path to 'public', 'cron'
as $f$
declare lo bigint; hi bigint; mid bigint; st timestamptz;
begin
  select min(runid), max(runid) into lo, hi from cron.job_run_details;
  if lo is null then return 0; end if;
  while lo < hi loop
    mid := lo + (hi - lo) / 2;
    select d.start_time into st from cron.job_run_details d where d.runid >= mid order by d.runid limit 1;
    if st is not null and st < p_ts then lo := mid + 1; else hi := mid; end if;
  end loop;
  return lo;
end $f$;

create or replace function public._cron_watch_state()
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'cron'
as $f$
declare
  v_pol jsonb := public._cron_policy();
  v_grace int := (v_pol ->> 'grace_min')::int;
  v_stuck int := (v_pol ->> 'stuck_min')::int;
  v_ws timestamptz := now() - interval '1 day';
  -- 30 minutes of slack so a row whose runid and start_time disagree at the
  -- boundary is still read; the start_time filter below keeps the window exact
  v_min bigint := public._cron_runid_since(now() - interval '1 day' - interval '30 minutes');
  v_jobs jsonb;
begin
  with jobs as (
    select j.jobid, j.jobname::text as jobname, j.active, public._cron_period_minutes(j.schedule) as period
      from cron.job j where coalesce(j.jobname, '') not like 'console-run-now-%'
  ),
  recent as materialized (
    select d.jobid, d.runid, d.start_time, d.end_time, d.status::text as status
      from cron.job_run_details d
     where d.runid >= v_min and d.start_time >= v_ws and d.jobid in (select jobid from jobs)
  ),
  latest as (
    select distinct on (r.jobid) r.jobid, r.start_time, r.status from recent r
     order by r.jobid, r.start_time desc, r.runid desc
  ),
  streak as (
    select x.jobid, count(*) fails from (
      select r.jobid, r.status,
             sum(case when r.status <> 'failed' then 1 else 0 end)
               over (partition by r.jobid order by r.start_time desc, r.runid desc) seen_ok
        from recent r) x
     where x.seen_ok = 0 and x.status = 'failed' group by x.jobid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'jobid', j.jobid, 'jobname', j.jobname, 'active', j.active,
      'last_status', l.status,
      'fail_streak', coalesce(s.fails, 0),
      'stuck', (l.status in ('running', 'starting') and l.start_time < now() - make_interval(mins => v_stuck)),
      'overdue', (j.active and j.period is not null and l.start_time is not null
                  and now() - l.start_time > make_interval(mins => j.period + v_grace))
    ) order by j.jobname), '[]'::jsonb)
    into v_jobs
    from jobs j left join latest l using (jobid) left join streak s using (jobid);
  return jsonb_build_object('ok', true, 'jobs', v_jobs);
end $f$;

revoke all on function public._cron_runid_since(timestamptz) from public, anon, authenticated;
revoke all on function public._cron_watch_state() from public, anon, authenticated;

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.cron_health_watch()'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'public._cron_health(1)', ''))) / length('public._cron_health(1)') <> 1 then
    raise exception 'cron_health_watch: expected exactly one _cron_health(1) call';
  end if;
  v_new := replace(v_def, 'public._cron_health(1)', 'public._cron_watch_state()');
  execute v_new;
end $$;
