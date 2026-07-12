-- ============================================================================
-- MIGRATIONS_V162 — Odometer Logs
-- ============================================================================
-- Backs the Odometer Logs module (/odometer-logs): time-series odometer (km)
-- readings captured per asset, whether entered manually, imported from an ERP,
-- or read off a telematics feed. Distance history is the backbone of CPK, tyre
-- life, and utilisation analytics, so every reading is org-isolated, country
-- scoped, and auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.odometer_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  odometer_km      numeric,
  reading_date     date,
  source           text,
  site             text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odometer_logs_org      ON public.odometer_logs (organisation_id);
CREATE INDEX IF NOT EXISTS idx_odometer_logs_asset    ON public.odometer_logs (asset_no);
CREATE INDEX IF NOT EXISTS idx_odometer_logs_reading  ON public.odometer_logs (reading_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_odometer_logs ON public.odometer_logs;
CREATE TRIGGER set_updated_at_odometer_logs BEFORE UPDATE ON public.odometer_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and log readings — odometer capture
-- is a routine field/ops activity, not a privileged one.
ALTER TABLE public.odometer_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS odometer_logs_org_isolation ON public.odometer_logs;
CREATE POLICY odometer_logs_org_isolation ON public.odometer_logs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS odometer_logs_read ON public.odometer_logs;
CREATE POLICY odometer_logs_read ON public.odometer_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS odometer_logs_insert ON public.odometer_logs;
CREATE POLICY odometer_logs_insert ON public.odometer_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS odometer_logs_update ON public.odometer_logs;
CREATE POLICY odometer_logs_update ON public.odometer_logs FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS odometer_logs_delete ON public.odometer_logs;
CREATE POLICY odometer_logs_delete ON public.odometer_logs FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.odometer_logs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odometer_logs TO authenticated;

-- Reversible:
--   DROP TABLE public.odometer_logs;
