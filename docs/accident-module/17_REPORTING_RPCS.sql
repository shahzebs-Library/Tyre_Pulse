-- =============================================================================
-- ACCIDENT CASE MODEL - SERVER-SIDE ANALYTICS RPCs (Phase 3, reporting)
-- =============================================================================
-- STATUS: AUTHORED, NOT YET APPLIED. This file is a REVIEW ARTIFACT only. It has
-- NOT been run against any database and carries no `supabase_migrations` row. It
-- takes the next free migration number at apply time (RE-CONFIRM then: the
-- accident batch reserves V417 = 02_DATA_MODEL.sql, V418 = 08_ENGINE_SQL_MIRROR,
-- and 10/11/12/13/14/15 are the later workstream / notification / SLA / evidence /
-- insurance / finance RPC scripts; if the standing V419-V422 batch or any other
-- migration lands first, renumber. Nothing here depends on its own number).
--
-- WHY IT EXISTS
--   The client analytics engine src/lib/accidentCaseAnalytics.js is pure and
--   correct, but a browser can only compute over the rows it actually paged in.
--   The case-status breakdown, the workstream bottleneck, average time-to-close,
--   the SLA breach rate and the reopen rate are all FLEET-WIDE questions: reading
--   them from a paged client slice understates every count. These RPCs compute the
--   SAME figures server-side over the FULL, RLS-scoped dataset, mirroring the repo
--   pattern of the get_*_snapshot aggregates (get_report_snapshot, get_maintenance
--   _snapshot, get_expense_period_trend). A future frontend wiring is 1:1 with the
--   JS engine functions (caseStatusBreakdown / byWorkstreamBottleneck /
--   avgTimeToClose / slaBreachRate / reopenRate), so the on-screen numbers and the
--   server numbers agree.
--
--   JS <-> SQL MIRROR: the JS SPEC is src/lib/accidentCaseAnalytics.js. The
--   vocabularies these functions inline are copied from the committed engine
--   src/lib/accidentCase.js (WORKSTREAM_SATISFIED = completed|not_required|
--   cancelled, TERMINAL_STATUSES = closed|cancelled_duplicate) and the closed /
--   open / reopened predicates copy accidentCaseAnalytics.isGenuinelyClosed /
--   isOpenCase / wasReopened VERBATIM. "Change both" if the shapes ever diverge.
--
-- SECURITY
--   Every function is SECURITY INVOKER - a plain read is all that is needed and the
--   caller's own RLS (the V417 org / country / site isolation on `accidents`,
--   `accident_case_workstreams`, `accident_sla_instances`, `accident_closure_reviews`)
--   is inherited unchanged, so there is NO cross-tenant risk and NO org argument is
--   taken or trusted. search_path is pinned to 'public'. Volatility is STABLE (they
--   read tables and, for the SLA breach test, now()). anon EXECUTE is revoked;
--   authenticated is granted.
--
-- HONEST NULLS (repo rule, mirrored from the JS engine)
--   An aggregate over zero qualifying rows returns NULL, never a flattering 0 or
--   100. "we did not measure this" and "the value is zero" are opposite statements:
--     * avg_time_to_close / median / longest are NULL when nothing timeable closed.
--     * sla_breach_rate is NULL when no case in scope carries a tracked SLA.
--     * reopen_rate is NULL when there are no cases in scope at all.
--   Counts (total / open / closed / distinct) are genuine zeros and stay 0.
--
-- COUNTRY FILTER
--   p_country is optional and applied NULL-safe as (p_country is null or country =
--   p_country) against each table's own denormalized `country` column - it NARROWS
--   within the caller's already-RLS-scoped visibility, it never widens it.
--
-- ROLLBACK (paste and run to reverse this file)
--   drop function if exists
--     public.get_accident_case_status_breakdown(text),
--     public.get_accident_workstream_bottleneck(text),
--     public.get_accident_case_kpis(text,date,date);
-- =============================================================================

begin;

-- =============================================================================
-- 1. get_accident_case_status_breakdown(p_country)
--    Mirrors accidentCaseAnalytics.caseStatusBreakdown: cases grouped by their
--    headline case_status (most common first), with a case that has NO recorded
--    status counted separately as `unrecorded` rather than invented into a bucket.
--    Also returns a by_stage breakdown over the V300 workflow_stage, so the one
--    call answers "counts per status" and "counts per stage" together.
--    Returns:
--      { rows:[{token,value}], by_stage:[{stage,value}],
--        total, distinct, unrecorded, top:{token,value}|null }
-- =============================================================================
create or replace function public.get_accident_case_status_breakdown(
  p_country text default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with scoped as (
    select a.case_status, a.workflow_stage
      from public.accidents a
     where (p_country is null or a.country = p_country)
  ),
  status_rows as (
    select lower(btrim(case_status)) as token, count(*)::int as value
      from scoped
     where case_status is not null and btrim(case_status) <> ''
     group by lower(btrim(case_status))
  ),
  status_ordered as (
    select token, value
      from status_rows
     order by value desc, token asc
  ),
  stage_rows as (
    select coalesce(nullif(btrim(workflow_stage), ''), 'unrecorded') as stage,
           count(*)::int as value
      from scoped
     group by coalesce(nullif(btrim(workflow_stage), ''), 'unrecorded')
     order by count(*) desc, 1 asc
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('token', token, 'value', value))
                        from status_ordered), '[]'::jsonb),
    'by_stage', coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'value', value))
                            from stage_rows), '[]'::jsonb),
    'total', (select count(*)::int from scoped),
    'distinct', (select count(*)::int from status_rows),
    'unrecorded', (select count(*)::int from scoped
                    where case_status is null or btrim(case_status) = ''),
    'top', (select jsonb_build_object('token', token, 'value', value)
              from status_ordered limit 1)
  );
$$;

-- =============================================================================
-- 2. get_accident_workstream_bottleneck(p_country)
--    Mirrors accidentCaseAnalytics.byWorkstreamBottleneck: per workstream, the
--    number of CASES it is currently holding up. A workstream STALLS a case when
--    its row is NOT satisfied (anything other than completed / not_required /
--    cancelled - WORKSTREAM_SATISFIED). Counted per CASE (distinct accident_id),
--    so one case with two blocking rows on the same workstream is one stall.
--    measured is false only when there are NO workstream rows at all in scope
--    (with nothing recorded there is genuinely no bottleneck to attribute).
--    Returns:
--      { rows:[{key,cases}], measured:bool, stalled_cases, top:{key,cases}|null }
-- =============================================================================
create or replace function public.get_accident_workstream_bottleneck(
  p_country text default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with scoped as (
    select w.accident_id, w.workstream_key, lower(btrim(w.status)) as status
      from public.accident_case_workstreams w
     where (p_country is null or w.country = p_country)
  ),
  stalled as (
    -- Not satisfied: a real, non-empty status that is not in the satisfied set,
    -- carrying a known workstream key (WORKSTREAM_SATISFIED = completed |
    -- not_required | cancelled; blank status is not counted - it is "no row set").
    select accident_id, workstream_key
      from scoped
     where status is not null and status <> ''
       and status <> all (array['completed','not_required','cancelled'])
       and workstream_key is not null and btrim(workstream_key) <> ''
  ),
  by_key as (
    select workstream_key as key, count(distinct accident_id)::int as cases
      from stalled
     group by workstream_key
     order by count(distinct accident_id) desc, workstream_key asc
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'cases', cases))
                        from by_key), '[]'::jsonb),
    -- measured = at least one workstream row exists in scope (matches the JS
    -- rows.length === 0 -> measured:false short-circuit).
    'measured', (select count(*) > 0 from scoped),
    'stalled_cases', (select count(distinct accident_id)::int from stalled),
    'top', (select jsonb_build_object('key', key, 'cases', cases)
              from by_key limit 1)
  );
$$;

-- =============================================================================
-- 3. get_accident_case_kpis(p_country, p_from, p_to)
--    The headline case KPIs over the FULL scoped dataset. Mirrors
--    accidentCaseAnalytics.avgTimeToClose + slaBreachRate + reopenRate + the
--    open / closed counts, with the same honest-null discipline.
--
--    Date window: p_from / p_to (inclusive, NULL = all time) apply to each case's
--    business date coalesce(incident_date, created_at::date). The SLA breach rate
--    is measured over the SLA instances of the cases IN that window, so the whole
--    result describes one coherent slice.
--
--    time-to-close is measured ONLY over genuinely closed cases that carry a valid
--    start (created_at, else incident_date) AND a valid, not-earlier close stamp
--    (an approved fully_closed closure review's reviewed_at, else release_date) -
--    `measured` vs `closed` is the honest gap. An unmeasurable set is NULL, not 0.
--
--    Returns:
--      { total, open, closed, reopened,
--        avg_time_to_close, median_time_to_close, longest_time_to_close,
--        time_to_close_measured,
--        sla_tracked, sla_breached, sla_breach_rate,
--        reopen_rate }
-- =============================================================================
create or replace function public.get_accident_case_kpis(
  p_country text default null,
  p_from    date default null,
  p_to      date default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with scoped as (
    select a.id, a.case_status, a.status, a.closure_level,
           a.reopened_flag, a.is_reopened, a.reopen_count,
           a.created_at, a.incident_date, a.release_date
      from public.accidents a
     where (p_country is null or a.country = p_country)
       and (p_from is null
            or coalesce(a.incident_date, a.created_at::date) >= p_from)
       and (p_to is null
            or coalesce(a.incident_date, a.created_at::date) <= p_to)
  ),
  flagged as (
    select s.*,
      -- isGenuinelyClosed(record)
      (lower(coalesce(s.case_status, '')) = 'closed'
       or lower(coalesce(s.status, '')) = 'closed'
       or lower(coalesce(s.closure_level, '')) = 'fully_closed') as genuinely_closed,
      -- wasReopened(record): reopened_flag OR is_reopened (the permanent audit
      -- twin of the JS `reopened` field) OR case_status='reopened' OR reopen_count>0
      (coalesce(s.reopened_flag, false)
       or coalesce(s.is_reopened, false)
       or lower(coalesce(s.case_status, '')) = 'reopened'
       or coalesce(s.reopen_count, 0) > 0) as reopened
    from scoped s
  ),
  classified as (
    select f.*,
      -- isOpenCase(record): not genuinely closed AND not a terminal status
      -- (TERMINAL_STATUSES = closed | cancelled_duplicate); blank status = open.
      (not f.genuinely_closed
       and lower(coalesce(f.case_status, ''))
             <> all (array['closed','cancelled_duplicate'])) as open_case
    from flagged f
  ),
  -- Time-to-close over genuinely closed cases with a timeable span. The close
  -- stamp is an approved fully_closed closure review's reviewed_at, else the
  -- release_date (only real columns are referenced).
  closable as (
    select c.id,
      coalesce(c.created_at, c.incident_date::timestamptz) as start_ts,
      coalesce(
        (select max(r.reviewed_at)
           from public.accident_closure_reviews r
          where r.accident_id = c.id
            and r.level = 'fully_closed'
            and r.decision = 'approved'),
        c.release_date::timestamptz
      ) as end_ts
    from classified c
    where c.genuinely_closed
  ),
  timed as (
    select extract(epoch from (end_ts - start_ts)) / 86400.0 as days
      from closable
     where start_ts is not null and end_ts is not null and end_ts >= start_ts
  ),
  -- SLA breach over the SLA instances of the in-scope cases. An instance is
  -- TRACKED only if it carries a due date; SATISFIED (cannot breach) when its
  -- state is met/cancelled or it carries a completion stamp; BREACHED when the
  -- engine already marked it, its state is breached, or its due date has passed
  -- while unsatisfied. Un-tracked instances are excluded entirely (not "0% - fine").
  sla as (
    select i.due_at, i.state, i.completed_at, coalesce(i.breached, false) as breached
      from public.accident_sla_instances i
     where i.accident_id in (select id from classified)
       and i.due_at is not null
  ),
  sla_calc as (
    select
      count(*)::int as tracked,
      count(*) filter (
        where breached
           or lower(coalesce(state, '')) = 'breached'
           or (lower(coalesce(state, '')) <> all (array['met','cancelled'])
               and completed_at is null
               and due_at < now())
      )::int as breached
    from sla
  )
  select jsonb_build_object(
    'total',    (select count(*)::int from classified),
    'open',     (select count(*) filter (where open_case)::int from classified),
    'closed',   (select count(*) filter (where genuinely_closed)::int from classified),
    'reopened', (select count(*) filter (where reopened)::int from classified),

    'avg_time_to_close',
      (select case when count(*) = 0 then null
                   else round(avg(days)::numeric, 1) end from timed),
    'median_time_to_close',
      (select case when count(*) = 0 then null
                   else round(percentile_cont(0.5) within group (order by days)::numeric, 1)
              end from timed),
    'longest_time_to_close',
      (select case when count(*) = 0 then null
                   else round(max(days)::numeric, 1) end from timed),
    'time_to_close_measured', (select count(*)::int from timed),

    'sla_tracked',  (select tracked  from sla_calc),
    'sla_breached', (select breached from sla_calc),
    'sla_breach_rate',
      (select case when tracked = 0 then null
                   else round(breached::numeric / tracked, 4) end from sla_calc),

    'reopen_rate',
      (select case when count(*) = 0 then null
                   else round(count(*) filter (where reopened)::numeric / count(*), 4)
              end from classified)
  );
$$;

-- -----------------------------------------------------------------------------
-- GRANTS - anon revoked, authenticated granted; RLS on the underlying tables is
-- the real boundary (SECURITY INVOKER, so the caller's isolation is inherited).
-- -----------------------------------------------------------------------------
revoke all on function public.get_accident_case_status_breakdown(text) from anon;
revoke all on function public.get_accident_workstream_bottleneck(text) from anon;
revoke all on function public.get_accident_case_kpis(text,date,date) from anon;

grant execute on function public.get_accident_case_status_breakdown(text) to authenticated;
grant execute on function public.get_accident_workstream_bottleneck(text) to authenticated;
grant execute on function public.get_accident_case_kpis(text,date,date) to authenticated;

commit;

-- =============================================================================
-- VERIFY (run after apply, as a real authenticated user - NOT the service role,
-- so RLS actually scopes the read; app_current_org() is NULL for the service role
-- / an MCP session, which would return an empty org and mask a scoping bug):
--
--   select public.get_accident_case_status_breakdown(null);      -- all countries
--   select public.get_accident_case_status_breakdown('KSA');     -- one country
--   select public.get_accident_workstream_bottleneck(null);
--   select public.get_accident_case_kpis(null, null, null);      -- all time
--   select public.get_accident_case_kpis('KSA', '2026-01-01', '2026-12-31');
--
-- Expect: honest NULLs where nothing is measurable (avg/median/longest time to
-- close on a set with no timeable closed case; sla_breach_rate when no tracked
-- SLA; reopen_rate when total = 0), genuine 0 counts otherwise, and a country
-- filter that only ever NARROWS the RLS-scoped result. Cross-check a sample org's
-- numbers against the JS engine (src/lib/accidentCaseAnalytics.js) over the same
-- rows - they must agree 1:1.
--
-- ROLLBACK
--   begin;
--   drop function if exists public.get_accident_case_status_breakdown(text);
--   drop function if exists public.get_accident_workstream_bottleneck(text);
--   drop function if exists public.get_accident_case_kpis(text,date,date);
--   commit;
-- =============================================================================
