-- MIGRATIONS_V32.sql
-- Performance: index hygiene on the 131k-row tyre_records hot table + RLS cleanup.
--
-- Problem
--   Uploads were slow and the table carried ~39 MB of indexes. Every INSERT must
--   update every index on the table, so unused/duplicate indexes are pure write
--   overhead with zero read benefit. pg_stat_user_indexes showed 10 indexes with
--   idx_scan = 0 plus 5 duplicate indexes across work_orders / vehicle_fleet /
--   console_sessions. A per-row SELECT policy that re-evaluated auth.role() for
--   every scanned row was also slowing reads.
--
-- Effect (verified)
--   tyre_records indexes 28 -> 18, index size 39 MB -> 20 MB; faster bulk uploads.
--   Applied on Supabase as migration `perf_drop_unused_indexes_and_fix_rls`.
--
-- Idempotent: every statement uses IF EXISTS.

-- ── Unused indexes on tyre_records (idx_scan = 0) ──────────────────────────────
DROP INDEX IF EXISTS public.idx_tyre_records_extra_fields;
DROP INDEX IF EXISTS public.idx_tyre_active;
DROP INDEX IF EXISTS public.idx_tyre_records_jobcard;
DROP INDEX IF EXISTS public.idx_tyre_records_mis;
DROP INDEX IF EXISTS public.idx_tyre_records_category;
DROP INDEX IF EXISTS public.idx_tyre_records_position;
DROP INDEX IF EXISTS public.idx_tyre_records_removal_reason;
DROP INDEX IF EXISTS public.idx_tyre_records_removal_date;
DROP INDEX IF EXISTS public.idx_tyre_records_region;
DROP INDEX IF EXISTS public.idx_tyre_serial;

-- ── Duplicate indexes (same columns already covered by another index) ──────────
DROP INDEX IF EXISTS public.idx_wo_asset;
DROP INDEX IF EXISTS public.idx_wo_site;
DROP INDEX IF EXISTS public.idx_wo_status;
DROP INDEX IF EXISTS public.idx_vehicle_fleet_asset;
DROP INDEX IF EXISTS public.idx_console_sessions_created;

-- ── RLS: drop the per-row auth.role() SELECT policy on tyre_records ────────────
-- Reads are governed by the fast `auth_read_tyre_records` policy (USING true for
-- authenticated). The redundant `tyre_records_select` re-evaluated auth.role()
-- per scanned row, adding measurable overhead on large scans.
DROP POLICY IF EXISTS tyre_records_select ON public.tyre_records;
