-- ============================================================================
-- MIGRATIONS_V62_LOCALSTORAGE_TO_DB.sql  (applied live 2026-07-02)
-- Business data out of localStorage (audit H4): records that previously lived
-- in one browser now persist in shared, RLS-protected tables.
--
--  * tyre_disposals    — scrap-disposal status per tyre record
--                        (was localStorage tp_scrap_disposals).
--  * tyre_status_marks — tyre-exchange return / write-off marks per serial
--                        (was localStorage tp_tyre_returns / tp_tyre_writeoffs).
--
-- Also rewired (no schema change needed):
--  * Settings → Scheduled Reports now reads/writes report_schedules (the table
--    the pg_cron delivery function processes) instead of tp_scheduled_reports.
--  * Alert thresholds were ALREADY DB-backed (app_settings key) — audit note
--    was stale.
--
-- Rollback:
--   DROP TABLE public.tyre_status_marks;
--   DROP TABLE public.tyre_disposals;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tyre_disposals (
  tyre_record_id uuid PRIMARY KEY REFERENCES public.tyre_records(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('Pending','Disposed','Retreaded')),
  organisation_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tyre_disposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tyre_disposals_org_isolation ON public.tyre_disposals AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organisation_id IS NULL) OR (organisation_id = app_current_org()))
  WITH CHECK ((organisation_id IS NULL) OR (organisation_id = app_current_org()));
CREATE POLICY tyre_disposals_read ON public.tyre_disposals FOR SELECT TO authenticated USING (true);
CREATE POLICY tyre_disposals_write ON public.tyre_disposals FOR ALL TO authenticated
  USING (is_approved_and_unlocked()) WITH CHECK (is_approved_and_unlocked());

CREATE TABLE IF NOT EXISTS public.tyre_status_marks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial      text NOT NULL,
  mark_type   text NOT NULL CHECK (mark_type IN ('returned','written_off')),
  organisation_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  country     text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (serial, mark_type)
);
CREATE INDEX IF NOT EXISTS idx_tyre_status_marks_serial ON public.tyre_status_marks (serial);
ALTER TABLE public.tyre_status_marks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tyre_status_marks_org_isolation ON public.tyre_status_marks AS RESTRICTIVE FOR ALL TO authenticated
  USING ((organisation_id IS NULL) OR (organisation_id = app_current_org()))
  WITH CHECK ((organisation_id IS NULL) OR (organisation_id = app_current_org()));
CREATE POLICY tyre_status_marks_read ON public.tyre_status_marks FOR SELECT TO authenticated USING (true);
CREATE POLICY tyre_status_marks_write ON public.tyre_status_marks FOR ALL TO authenticated
  USING (is_approved_and_unlocked()) WITH CHECK (is_approved_and_unlocked());
