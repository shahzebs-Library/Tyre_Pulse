-- Hot tables: keep the visibility map current (PERF-7)
-- STATUS: APPLIED LIVE 2026-11-12 (schema_migrations 20261112080820).
--
-- MEASURED BEFORE: all-visible pages parts_consumption 0 of 10,624 (0%), work_orders 4,938 of
--   15,376 (32.1%), tyre_records 120 of 960 (12.5%); none vacuumed since the 2026-11-09 restart.
--   The default threshold (20% of the table changed) is never reached by daily imports.
-- DONE BY HAND THE SAME DAY (cannot be part of a migration: VACUUM cannot run in a transaction):
--   vacuum (analyze) public.tyre_records;
--   vacuum (analyze) public.parts_consumption;
--   vacuum (analyze) public.work_orders;
--   Plain VACUUM only - no rewrite, no exclusive lock.
-- MEASURED AFTER: tyre_records 100%, work_orders 100%, parts_consumption 99.8%.
--   Effect on a real read: reference_site_options('KSA') 43,606 -> 911 shared buffers (index-only
--   scans became possible), get_cost_cpk_overview 83,323 -> 71,416.
--
-- This file makes it stay that way: autovacuum now triggers at 2% changed or 2% inserted rows.
--
-- ROLLBACK: alter table public.<t> reset (autovacuum_vacuum_scale_factor,
--   autovacuum_vacuum_insert_scale_factor, autovacuum_analyze_scale_factor); for each table.

alter table public.parts_consumption set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.work_orders set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.tyre_records set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
