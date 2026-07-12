-- ============================================================================
-- MIGRATIONS_V170 — Driver Safety Events
-- ============================================================================
-- Backs the Driver Safety Events module (/driver-safety). Stores telematics
-- driver-behaviour events (harsh braking / acceleration / cornering, speeding,
-- overspeed, idling, fatigue) so fleet managers can score drivers, spot risky
-- behaviour, and link driver conduct to tyre wear, fuel burn and accident risk.
-- Each row is one detected event for one driver on one asset at a point in time.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.driver_safety_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text,
  driver_name      text,
  event_type       text
                     CHECK (event_type IN ('harsh_brake','harsh_accel','harsh_corner','speeding','overspeed','idling','fatigue','other')),
  severity         text
                     CHECK (severity IN ('low','medium','high')),
  event_at         timestamptz,
  location         text,
  speed_kmh        numeric,
  speed_limit_kmh  numeric,
  g_force          numeric,
  penalty_points   numeric,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_safety_events_org      ON public.driver_safety_events (organisation_id);
CREATE INDEX IF NOT EXISTS idx_driver_safety_events_asset    ON public.driver_safety_events (asset_no);
CREATE INDEX IF NOT EXISTS idx_driver_safety_events_driver   ON public.driver_safety_events (driver_name);
CREATE INDEX IF NOT EXISTS idx_driver_safety_events_event_at ON public.driver_safety_events (event_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_driver_safety_events ON public.driver_safety_events;
CREATE TRIGGER set_updated_at_driver_safety_events BEFORE UPDATE ON public.driver_safety_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read events; authenticated members may ingest (insert) and
-- correct (update) events for their own org.
ALTER TABLE public.driver_safety_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_safety_events_org_isolation ON public.driver_safety_events;
CREATE POLICY driver_safety_events_org_isolation ON public.driver_safety_events
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS driver_safety_events_read ON public.driver_safety_events;
CREATE POLICY driver_safety_events_read ON public.driver_safety_events FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_safety_events_insert ON public.driver_safety_events;
CREATE POLICY driver_safety_events_insert ON public.driver_safety_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_safety_events_update ON public.driver_safety_events;
CREATE POLICY driver_safety_events_update ON public.driver_safety_events FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON public.driver_safety_events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_safety_events TO authenticated;

-- Reversible:
--   DROP TABLE public.driver_safety_events;
