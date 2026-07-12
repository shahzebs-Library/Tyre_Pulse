-- ============================================================================
-- MIGRATIONS_V130 — TPMS: Tyre Pressure Monitoring Readings
-- ============================================================================
-- Backs the TPMS module (/tpms). Stores live tyre pressure/temperature sensor
-- readings so the fleet can be monitored for under/over-inflation in real time.
-- Each row is one reading for one tyre position on one asset at a point in time.
--
-- The TPMS page also surfaces existing tyre_records.pressure_reading as a
-- baseline dataset, so it is useful immediately — this table captures the
-- richer, timestamped sensor stream once telematics/sensors are integrated.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tpms_readings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text,
  tyre_position    text,
  tyre_serial      text,
  pressure         numeric,
  temperature      numeric,
  target_pressure  numeric,
  status           text
                     CHECK (status IN ('optimal','under','over','critical')),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tpms_readings_org      ON public.tpms_readings (organisation_id);
CREATE INDEX IF NOT EXISTS idx_tpms_readings_asset    ON public.tpms_readings (asset_no);
CREATE INDEX IF NOT EXISTS idx_tpms_readings_recorded ON public.tpms_readings (recorded_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_tpms_readings ON public.tpms_readings;
CREATE TRIGGER set_updated_at_tpms_readings BEFORE UPDATE ON public.tpms_readings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read readings; authenticated members may ingest (insert) and
-- correct (update) readings for their own org.
ALTER TABLE public.tpms_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tpms_readings_org_isolation ON public.tpms_readings;
CREATE POLICY tpms_readings_org_isolation ON public.tpms_readings
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS tpms_readings_read ON public.tpms_readings;
CREATE POLICY tpms_readings_read ON public.tpms_readings FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tpms_readings_insert ON public.tpms_readings;
CREATE POLICY tpms_readings_insert ON public.tpms_readings FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tpms_readings_update ON public.tpms_readings;
CREATE POLICY tpms_readings_update ON public.tpms_readings FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON public.tpms_readings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tpms_readings TO authenticated;

-- Reversible:
--   DROP TABLE public.tpms_readings;
