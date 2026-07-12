-- ============================================================================
-- MIGRATIONS_V161 — Telematics: Engine Hours Logs
-- ============================================================================
-- Backs the Engine Hours Tracker (/engine-hours). Records point-in-time engine-
-- hour meter readings per asset over time, so the fleet can trend utilisation,
-- schedule hour-based servicing, and detect meter/data anomalies. Org-isolated,
-- country-scoped. Any authenticated member of the org may log/read/maintain
-- readings; RLS enforces the org boundary as the hard wall.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.engine_hours_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  engine_hours     numeric,
  reading_date     date,
  source           text,
  site             text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engine_hours_logs_org     ON public.engine_hours_logs (organisation_id);
CREATE INDEX IF NOT EXISTS idx_engine_hours_logs_asset   ON public.engine_hours_logs (asset_no);
CREATE INDEX IF NOT EXISTS idx_engine_hours_logs_reading ON public.engine_hours_logs (reading_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_engine_hours_logs ON public.engine_hours_logs;
CREATE TRIGGER set_updated_at_engine_hours_logs BEFORE UPDATE ON public.engine_hours_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member may read and maintain readings within their org.
ALTER TABLE public.engine_hours_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engine_hours_logs_org_isolation ON public.engine_hours_logs;
CREATE POLICY engine_hours_logs_org_isolation ON public.engine_hours_logs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS engine_hours_logs_read ON public.engine_hours_logs;
CREATE POLICY engine_hours_logs_read ON public.engine_hours_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS engine_hours_logs_insert ON public.engine_hours_logs;
CREATE POLICY engine_hours_logs_insert ON public.engine_hours_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS engine_hours_logs_update ON public.engine_hours_logs;
CREATE POLICY engine_hours_logs_update ON public.engine_hours_logs FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS engine_hours_logs_delete ON public.engine_hours_logs;
CREATE POLICY engine_hours_logs_delete ON public.engine_hours_logs FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.engine_hours_logs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engine_hours_logs TO authenticated;

-- Reversible:
--   DROP TABLE public.engine_hours_logs;
