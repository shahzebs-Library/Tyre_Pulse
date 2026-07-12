-- ============================================================================
-- MIGRATIONS_V165 — Route Optimization: Route Plans
-- ============================================================================
-- Backs the Route Optimization module (/route-optimization). Stores planned
-- delivery/collection routes per asset so dispatchers can compare a naive
-- total distance against an optimised distance and track the kilometres saved.
-- Each row is one route plan for one asset (with an ordered set of waypoints).
--
-- Fewer kilometres driven directly lowers fuel burn, tyre wear, and CPK, so the
-- savings captured here feed the same fleet-cost intelligence as odometer and
-- utilisation data.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.route_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid DEFAULT public.app_current_org(),
  country               text,
  plan_name             text,
  asset_no              text,
  driver_name           text,
  plan_date             date,
  stops_count           integer,
  total_distance_km     numeric,
  optimized_distance_km numeric,
  estimated_duration_min numeric,
  savings_km            numeric,
  status                text
                          CHECK (status IN ('draft','optimized','dispatched','completed')),
  waypoints             jsonb,
  notes                 text,
  created_by            uuid DEFAULT auth.uid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_route_plans_org   ON public.route_plans (organisation_id);
CREATE INDEX IF NOT EXISTS idx_route_plans_asset ON public.route_plans (asset_no);
CREATE INDEX IF NOT EXISTS idx_route_plans_date  ON public.route_plans (plan_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_route_plans ON public.route_plans;
CREATE TRIGGER set_updated_at_route_plans BEFORE UPDATE ON public.route_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read plans; authenticated members may create (insert) and revise
-- (update) plans for their own org.
ALTER TABLE public.route_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS route_plans_org_isolation ON public.route_plans;
CREATE POLICY route_plans_org_isolation ON public.route_plans
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS route_plans_read ON public.route_plans;
CREATE POLICY route_plans_read ON public.route_plans FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS route_plans_insert ON public.route_plans;
CREATE POLICY route_plans_insert ON public.route_plans FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS route_plans_update ON public.route_plans;
CREATE POLICY route_plans_update ON public.route_plans FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON public.route_plans FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_plans TO authenticated;

-- Reversible:
--   DROP TABLE public.route_plans;
