-- ============================================================================
-- MIGRATIONS_V218 — Scheduled Reports: professional, configurable scheduling
-- ----------------------------------------------------------------------------
-- Additive columns on the EXISTING public.report_schedules table (do NOT create
-- a parallel table — single source of truth). RLS (RESTRICTIVE org isolation +
-- Admin/Manager/Director write gate) and the set_updated_at trigger already
-- exist on this table and automatically cover the new columns.
--
-- New capabilities:
--   * run_at        — exact date+time for one-off ("once") schedules
--   * start_date    — first eligible run date for a recurring schedule
--   * period        — coverage window the report spans (last_7/30/90, mtd, ytd, custom)
--   * period_from / period_to — bounds for a custom coverage window
--   * output_formats— which artefacts to produce (pdf / excel)
--   * last_status / last_error — outcome of the most recent run (surfaced in UI)
--
-- Idempotent (IF NOT EXISTS). Safe to run once; a rollback block is provided.
-- Apply via Supabase MCP (project jhssdmeruxtrlqnwfksc) or the SQL editor.
-- ============================================================================

BEGIN;

ALTER TABLE public.report_schedules
  ADD COLUMN IF NOT EXISTS run_at         timestamptz,
  ADD COLUMN IF NOT EXISTS start_date     date,
  ADD COLUMN IF NOT EXISTS period         text        NOT NULL DEFAULT 'last_30',
  ADD COLUMN IF NOT EXISTS period_from    date,
  ADD COLUMN IF NOT EXISTS period_to      date,
  ADD COLUMN IF NOT EXISTS output_formats text[]      NOT NULL DEFAULT ARRAY['pdf']::text[],
  ADD COLUMN IF NOT EXISTS last_status    text,
  ADD COLUMN IF NOT EXISTS last_error     text;

-- Coverage-window whitelist (keeps the column self-describing + query-safe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'report_schedules_period_chk'
      AND conrelid = 'public.report_schedules'::regclass
  ) THEN
    ALTER TABLE public.report_schedules
      ADD CONSTRAINT report_schedules_period_chk
      CHECK (period IN ('last_7','last_30','last_90','mtd','ytd','custom'));
  END IF;
END$$;

-- Frequency whitelist now includes the one-off cadence ('once').
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'report_schedules_frequency_chk'
      AND conrelid = 'public.report_schedules'::regclass
  ) THEN
    ALTER TABLE public.report_schedules
      ADD CONSTRAINT report_schedules_frequency_chk
      CHECK (frequency IN ('once','daily','weekly','monthly'));
  END IF;
END$$;

-- The cron sweep scans active schedules by next_run_at; index it for scale.
CREATE INDEX IF NOT EXISTS idx_report_schedules_active_next_run
  ON public.report_schedules (next_run_at)
  WHERE active = true;

COMMENT ON COLUMN public.report_schedules.run_at         IS 'Exact datetime for a one-off (frequency = once) schedule.';
COMMENT ON COLUMN public.report_schedules.start_date     IS 'First eligible run date for a recurring schedule.';
COMMENT ON COLUMN public.report_schedules.period         IS 'Coverage window the report spans: last_7 | last_30 | last_90 | mtd | ytd | custom.';
COMMENT ON COLUMN public.report_schedules.period_from    IS 'Custom coverage window start (period = custom).';
COMMENT ON COLUMN public.report_schedules.period_to      IS 'Custom coverage window end (period = custom).';
COMMENT ON COLUMN public.report_schedules.output_formats IS 'Artefacts to produce, e.g. {pdf,excel}.';
COMMENT ON COLUMN public.report_schedules.last_status    IS 'Outcome of the most recent run (sent | failed | generated).';
COMMENT ON COLUMN public.report_schedules.last_error     IS 'Provider/generation error from the most recent failed run.';

COMMIT;

-- ============================================================================
-- ROLLBACK (run manually to revert this migration)
-- ----------------------------------------------------------------------------
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_report_schedules_active_next_run;
-- ALTER TABLE public.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_period_chk;
-- ALTER TABLE public.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_frequency_chk;
-- ALTER TABLE public.report_schedules
--   DROP COLUMN IF EXISTS run_at,
--   DROP COLUMN IF EXISTS start_date,
--   DROP COLUMN IF EXISTS period,
--   DROP COLUMN IF EXISTS period_from,
--   DROP COLUMN IF EXISTS period_to,
--   DROP COLUMN IF EXISTS output_formats,
--   DROP COLUMN IF EXISTS last_status,
--   DROP COLUMN IF EXISTS last_error;
-- COMMIT;
-- ============================================================================
