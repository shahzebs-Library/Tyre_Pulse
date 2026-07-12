-- ============================================================================
-- MIGRATIONS_V172 — Hours of Service (ELD) / Driver Duty Status Logs
-- ============================================================================
-- Backs the Hours of Service module (/hours-of-service): time-series driver
-- duty-status records (off duty, sleeper berth, driving, on duty) used for
-- Electronic Logging Device (ELD) / Hours-of-Service compliance. Each row is one
-- duty-status segment for one driver on one log date, with driving/on-duty
-- durations, distance covered, and any HOS violation flagged.
--
-- Driver-hours compliance is the backbone of fatigue-risk, safety, and
-- regulatory reporting, so every log is org-isolated, country-scoped, and
-- auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hos_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  driver_name      text NOT NULL,
  asset_no         text,
  log_date         date,
  duty_status      text
                     CHECK (duty_status IN ('off_duty','sleeper','driving','on_duty')),
  start_time       timestamptz,
  end_time         timestamptz,
  duration_min     numeric,
  distance_km      numeric,
  location         text,
  remarks          text,
  violation        boolean DEFAULT false,
  violation_type   text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hos_logs_org     ON public.hos_logs (organisation_id);
CREATE INDEX IF NOT EXISTS idx_hos_logs_driver  ON public.hos_logs (driver_name);
CREATE INDEX IF NOT EXISTS idx_hos_logs_date    ON public.hos_logs (log_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_hos_logs ON public.hos_logs;
CREATE TRIGGER set_updated_at_hos_logs BEFORE UPDATE ON public.hos_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and log duty statuses — HOS capture
-- is a routine field/ops activity, not a privileged one.
ALTER TABLE public.hos_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hos_logs_org_isolation ON public.hos_logs;
CREATE POLICY hos_logs_org_isolation ON public.hos_logs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS hos_logs_read ON public.hos_logs;
CREATE POLICY hos_logs_read ON public.hos_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS hos_logs_insert ON public.hos_logs;
CREATE POLICY hos_logs_insert ON public.hos_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS hos_logs_update ON public.hos_logs;
CREATE POLICY hos_logs_update ON public.hos_logs FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS hos_logs_delete ON public.hos_logs;
CREATE POLICY hos_logs_delete ON public.hos_logs FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.hos_logs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hos_logs TO authenticated;

-- Reversible:
--   DROP TABLE public.hos_logs;
