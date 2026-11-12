-- vehicle_fleet: index the normalised asset number (PERF-4, get_site_operating_cost)
-- STATUS: APPLIED LIVE 2026-11-12 (schema_migrations 20261112080533).
--
-- MEASURED BEFORE (KSA-only Manager): get_site_operating_cost_multi(array['KSA'],'2026-01-01','2026-12-31')
--   221,853 shared buffers. 183,231 of them were one lateral: a sequential read of vehicle_fleet
--   (317 pages) for each of 578 distinct assets, because the join compares upper(btrim(asset_no))
--   and no index carried that expression.
-- MEASURED AFTER: 40,459 shared buffers, 660 ms. Output md5 identical before and after (KSA 2026
--   and all-countries all-time, `generated_at` removed).
--
-- vehicle_fleet has 1,622 rows, so the build holds its lock for well under a second.
-- ANALYZE is required: without statistics on the expression the planner keeps the seq scan.
-- Note: get_schedule_adherence does NOT benefit (it runs as the caller, and under RLS a
-- non-leakproof expression cannot be used as an index condition) - see 20261112193000.
--
-- ROLLBACK: remove the index vehicle_fleet_asset_norm_idx (no data is touched).

create index if not exists vehicle_fleet_asset_norm_idx on public.vehicle_fleet (upper(btrim(asset_no)));
analyze public.vehicle_fleet;
