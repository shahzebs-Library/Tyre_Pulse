-- V456 - Enterprise-scale indexes for Cost per M3 + CPK RPCs
-- STATUS: APPLIED LIVE (project jhssdmeruxtrlqnwfksc) + verified with EXPLAIN ANALYZE.
--
-- WHY: at millions of rows the Cost/M3 + CPK aggregates must range-scan the exact
-- (org, country, period) slice, not scan a wider slice and filter. Profiling found:
--   * fleet_tyre_km_by_asset filtered the whole (org,country) issue_date slice
--     because its date predicate is coalesce(removal_date, issue_date) - the existing
--     tyre_records_org_country_date_idx (on issue_date) could not bound it. On KSA
--     current month it read 8046 rows and threw away 8017 (Rows Removed by Filter).
--   * get_cost_per_m3 / _trend / get_production_rejections filtered production_logs by
--     the period-only index then filtered org+country in the heap.
--   * fleet_hours_by_asset scans engine_hours_logs by org only.
--
-- MEASURED (KSA current month, tyre CPK-km query):
--   BEFORE: Index Scan tyre_records_org_country_date_idx, 8017 rows removed,
--           shared hit 6548, Execution 11.7 ms
--   AFTER : Index Scan tyre_records_km_effective_date_idx, date is an index cond,
--           shared hit 21 read 2, Execution 0.99 ms  (~12x time, ~285x buffers)
--
-- REVERSIBLE: drop the three indexes.

create index if not exists production_logs_org_country_period_idx
  on public.production_logs (organisation_id, country, period_date);

-- Partial index: only lifecycle rows carrying km (5,511 of 11,095 today) and the
-- EFFECTIVE date the RPC filters on (removal_date, else issue_date).
create index if not exists tyre_records_km_effective_date_idx
  on public.tyre_records (organisation_id, country, (coalesce(removal_date, issue_date)))
  where total_km is not null and total_km > 0;

create index if not exists engine_hours_org_country_date_idx
  on public.engine_hours_logs (organisation_id, country, reading_date)
  where engine_hours > 0;

analyze public.production_logs;
analyze public.tyre_records;
analyze public.engine_hours_logs;

-- ROLLBACK:
-- drop index if exists public.production_logs_org_country_period_idx;
-- drop index if exists public.tyre_records_km_effective_date_idx;
-- drop index if exists public.engine_hours_org_country_date_idx;
