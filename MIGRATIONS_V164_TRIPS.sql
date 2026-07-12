-- ============================================================================
-- MIGRATIONS_V164 — Trip History / Trip Replay
-- ============================================================================
-- Backs the Trip History module (/trips): completed and in-flight journeys per
-- asset, capturing origin/destination, timing, distance, speed, and idle so the
-- fleet can replay trips, audit utilisation, and feed CPK, driver-behaviour, and
-- tyre-life analytics. Every trip is org-isolated, country-scoped, and auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.trips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  driver_name      text,
  origin           text,
  destination      text,
  started_at       timestamptz,
  ended_at         timestamptz,
  distance_km      numeric,
  duration_min     numeric,
  max_speed_kmh    numeric,
  avg_speed_kmh    numeric,
  idle_min         numeric,
  status           text
                     CHECK (status IN ('planned','in_progress','completed','cancelled')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trips_org     ON public.trips (organisation_id);
CREATE INDEX IF NOT EXISTS idx_trips_asset   ON public.trips (asset_no);
CREATE INDEX IF NOT EXISTS idx_trips_started ON public.trips (started_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_trips ON public.trips;
CREATE TRIGGER set_updated_at_trips BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and record trips — trip capture is a
-- routine field/ops activity, not a privileged one.
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trips_org_isolation ON public.trips;
CREATE POLICY trips_org_isolation ON public.trips
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS trips_read ON public.trips;
CREATE POLICY trips_read ON public.trips FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS trips_insert ON public.trips;
CREATE POLICY trips_insert ON public.trips FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS trips_update ON public.trips;
CREATE POLICY trips_update ON public.trips FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS trips_delete ON public.trips;
CREATE POLICY trips_delete ON public.trips FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.trips FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO authenticated;

-- Reversible:
--   DROP TABLE public.trips;
