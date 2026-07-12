-- ============================================================================
-- MIGRATIONS_V171 — GPS Tracking / Position History
-- ============================================================================
-- Backs the GPS Tracking module (/gps-tracking). Stores time-series GPS
-- position pings per asset so the fleet's movement, location, speed, idle time
-- and route history can be reconstructed and analysed. Each row is one position
-- fix for one asset at a point in time.
--
-- Position history underpins utilisation, idle-cost, geofence and route
-- analytics, so every ping is org-isolated and country-scoped exactly like the
-- rest of the operational data.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gps_positions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  driver_name      text,
  latitude         numeric,
  longitude        numeric,
  speed_kmh        numeric,
  heading          numeric,
  altitude_m       numeric,
  ignition         boolean,
  odometer_km      numeric,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  address          text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gps_positions_org      ON public.gps_positions (organisation_id);
CREATE INDEX IF NOT EXISTS idx_gps_positions_asset    ON public.gps_positions (asset_no);
CREATE INDEX IF NOT EXISTS idx_gps_positions_recorded ON public.gps_positions (recorded_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_gps_positions ON public.gps_positions;
CREATE TRIGGER set_updated_at_gps_positions BEFORE UPDATE ON public.gps_positions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read positions; authenticated members may ingest (insert) and
-- correct (update/delete) positions for their own org.
ALTER TABLE public.gps_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gps_positions_org_isolation ON public.gps_positions;
CREATE POLICY gps_positions_org_isolation ON public.gps_positions
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS gps_positions_read ON public.gps_positions;
CREATE POLICY gps_positions_read ON public.gps_positions FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS gps_positions_insert ON public.gps_positions;
CREATE POLICY gps_positions_insert ON public.gps_positions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS gps_positions_update ON public.gps_positions;
CREATE POLICY gps_positions_update ON public.gps_positions FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS gps_positions_delete ON public.gps_positions;
CREATE POLICY gps_positions_delete ON public.gps_positions FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.gps_positions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gps_positions TO authenticated;

-- Reversible:
--   DROP TABLE public.gps_positions;
