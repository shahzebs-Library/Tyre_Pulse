-- ============================================================================
-- MIGRATIONS_V612 — report_schedules.period: widen the CHECK to allow 'yesterday'
-- ----------------------------------------------------------------------------
-- STATUS: APPLIED LIVE 2026-09-13 via `supabase db query --linked --project-ref
-- jhssdmeruxtrlqnwfksc` (verified afterward against pg_get_constraintdef, not
-- assumed from this file). This file exists so the fix is committed alongside
-- the client code that needed it and can be replayed if the project is ever
-- rebuilt from migrations.
--
-- WHY: MIGRATIONS_V218 created `report_schedules_period_chk` scoped to the six
-- periods that existed at the time (last_7/30/90, mtd, ytd, custom). A later web
-- change added a "Yesterday" coverage option to the client's PERIODS list
-- (src/lib/api/scheduledReports.js) WITHOUT widening this constraint — every
-- create/update of a schedule with period='yesterday' then failed with Postgres
-- 23514, surfaced to the user as the generic "Some values are not valid."
-- (src/lib/safeError.js). Reproduced live in a rolled-back transaction before
-- being applied for real: an INSERT with period='yesterday' was refused before
-- this migration and accepted after it.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS, then ADD. Safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_period_chk;

ALTER TABLE public.report_schedules
  ADD CONSTRAINT report_schedules_period_chk
  CHECK (period IN ('yesterday','last_7','last_30','last_90','mtd','ytd','custom'));

COMMENT ON COLUMN public.report_schedules.period IS
  'Coverage window the report spans: yesterday | last_7 | last_30 | last_90 | mtd | ytd | custom.';

COMMIT;

-- ============================================================================
-- ROLLBACK (run manually to revert this migration - restores the V218 shape)
-- ----------------------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE public.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_period_chk;
-- ALTER TABLE public.report_schedules
--   ADD CONSTRAINT report_schedules_period_chk
--   CHECK (period IN ('last_7','last_30','last_90','mtd','ytd','custom'));
-- COMMIT;
-- ============================================================================
