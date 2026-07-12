-- ============================================================================
-- MIGRATIONS_V187 — Driver Coaching & Leaderboard
-- ============================================================================
-- Backs the Driver Coaching module (/driver-coaching). Stores per-driver
-- performance scorecards (safety + fuel behaviour, harsh events, idling,
-- distance) together with the coaching workflow (recommended → scheduled →
-- completed) so fleet managers can rank drivers, target the worst performers,
-- and track improvement over time.
--
-- Driver behaviour is a leading indicator of tyre wear, fuel burn, and accident
-- risk, so each row is org-isolated and country-scoped, exactly like the rest
-- of the operational tables.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.driver_coaching (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  driver_name      text NOT NULL,
  period           text,
  safety_score     numeric,
  fuel_score       numeric,
  harsh_events     integer,
  idling_min       numeric,
  distance_km      numeric,
  coaching_status  text
                     CHECK (coaching_status IN ('none','recommended','scheduled','completed')),
  coach            text,
  coaching_notes   text,
  improvement_pct  numeric,
  rank             integer,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_coaching_org        ON public.driver_coaching (organisation_id);
CREATE INDEX IF NOT EXISTS idx_driver_coaching_driver     ON public.driver_coaching (driver_name);
CREATE INDEX IF NOT EXISTS idx_driver_coaching_period     ON public.driver_coaching (period);
CREATE INDEX IF NOT EXISTS idx_driver_coaching_created_at ON public.driver_coaching (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_driver_coaching ON public.driver_coaching;
CREATE TRIGGER set_updated_at_driver_coaching BEFORE UPDATE ON public.driver_coaching
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read scorecards; authenticated members may create, update, and
-- delete coaching records for their own org.
ALTER TABLE public.driver_coaching ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_coaching_org_isolation ON public.driver_coaching;
CREATE POLICY driver_coaching_org_isolation ON public.driver_coaching
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS driver_coaching_read ON public.driver_coaching;
CREATE POLICY driver_coaching_read ON public.driver_coaching FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_coaching_insert ON public.driver_coaching;
CREATE POLICY driver_coaching_insert ON public.driver_coaching FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_coaching_update ON public.driver_coaching;
CREATE POLICY driver_coaching_update ON public.driver_coaching FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_coaching_delete ON public.driver_coaching;
CREATE POLICY driver_coaching_delete ON public.driver_coaching FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.driver_coaching FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_coaching TO authenticated;

-- Reversible:
--   DROP TABLE public.driver_coaching;
