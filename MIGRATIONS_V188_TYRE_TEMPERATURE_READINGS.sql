-- ============================================================================
-- MIGRATIONS_V188 — Heat Intelligence: Tyre Temperature Readings
-- ============================================================================
-- Backs the Heat Intelligence module (/heat-intelligence). Stores timestamped
-- tyre thermal readings so the fleet can be monitored for overheating —
-- bearing failure, dragging brakes, chronic under-inflation, and overload all
-- surface first as abnormal tyre/hub temperature. Each row is one thermal
-- reading for one tyre position on one asset at a point in time.
--
-- A reading's `status` classifies severity (normal → elevated → high →
-- critical) so hotspots can be triaged without recomputing thresholds on read.
-- The `threshold_c` column carries the per-reading alarm point (sensor- or
-- policy-defined) used by the domain logic to escalate a reading to critical.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run. Reversible (see footer).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tyre_temperature_readings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  tyre_position    text,
  tyre_serial      text,
  temperature_c    numeric,
  ambient_c        numeric,
  pressure_bar     numeric,
  speed_kmh        numeric,
  threshold_c      numeric,
  status           text
                     CHECK (status IN ('normal','elevated','high','critical')),
  location         text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tyre_temperature_readings_org
  ON public.tyre_temperature_readings (organisation_id);
CREATE INDEX IF NOT EXISTS idx_tyre_temperature_readings_asset
  ON public.tyre_temperature_readings (asset_no);
CREATE INDEX IF NOT EXISTS idx_tyre_temperature_readings_recorded
  ON public.tyre_temperature_readings (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_tyre_temperature_readings_status
  ON public.tyre_temperature_readings (status);

DROP TRIGGER IF EXISTS set_updated_at_tyre_temperature_readings ON public.tyre_temperature_readings;
CREATE TRIGGER set_updated_at_tyre_temperature_readings BEFORE UPDATE ON public.tyre_temperature_readings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read readings; authenticated members may ingest (insert) and
-- correct (update) readings for their own org.
ALTER TABLE public.tyre_temperature_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tyre_temperature_readings_org_isolation ON public.tyre_temperature_readings;
CREATE POLICY tyre_temperature_readings_org_isolation ON public.tyre_temperature_readings
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS tyre_temperature_readings_read ON public.tyre_temperature_readings;
CREATE POLICY tyre_temperature_readings_read ON public.tyre_temperature_readings FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tyre_temperature_readings_insert ON public.tyre_temperature_readings;
CREATE POLICY tyre_temperature_readings_insert ON public.tyre_temperature_readings FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tyre_temperature_readings_update ON public.tyre_temperature_readings;
CREATE POLICY tyre_temperature_readings_update ON public.tyre_temperature_readings FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON public.tyre_temperature_readings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tyre_temperature_readings TO authenticated;

-- Reversible:
--   DROP TABLE public.tyre_temperature_readings;
