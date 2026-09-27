-- 20260927110000_production_logs_cost_m3_covering_index
--
-- WHAT: replace production_logs_org_country_period_idx (organisation_id, country, period_date)
--       with the same key plus INCLUDE (site, station, approved_m3, m3).
--
-- WHY: get_cost_per_m3 (Cost per M3 page) measured 1.6-4.5 s for a KSA-only Manager
--      (YTD). EXPLAIN (ANALYZE, BUFFERS): ~1.0-1.2 s of that is the prod CTE doing an
--      Index Scan over 70,107 KSA 2026 rows with ~5,600 heap buffers (mostly disk reads)
--      because the rows are scattered by upload order, not by date. The table is 100%
--      all-visible, so carrying the four columns the aggregate reads in the index turns it
--      into an index-only scan. Same key prefix, so every existing reader of the dropped
--      index is still served (get_cost_per_m3_trend, get_production_monthly, rejections).
--
-- VERIFY (done live, KSA-only Manager 34793423 and super admin, hashes of the full jsonb
--      output identical before/after for 7 parameter sets; see handback report):
--   select get_cost_per_m3('KSA','2026-01-01','2026-09-27');
--
-- ROLLBACK:
--   create index production_logs_org_country_period_idx on public.production_logs
--     (organisation_id, country, period_date);
--   drop index public.production_logs_org_country_period_cov_idx;

create index if not exists production_logs_org_country_period_cov_idx
  on public.production_logs (organisation_id, country, period_date)
  include (site, station, approved_m3, m3);

drop index if exists public.production_logs_org_country_period_idx;

analyze public.production_logs;
