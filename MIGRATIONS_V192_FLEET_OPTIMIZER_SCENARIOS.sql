-- ============================================================================
-- MIGRATIONS_V192 — Fleet Optimizer Scenarios
-- ============================================================================
-- Backs the Fleet Optimizer module (/fleet-optimizer). Stores fleet
-- right-sizing / utilisation scenarios: for each asset a recorded utilisation,
-- annual km, annual cost, downtime, age and resale value together with a
-- keep / replace / redeploy / dispose / review recommendation, projected saving
-- and confidence. This turns raw utilisation-vs-cost data into an actionable
-- fleet composition decision (which assets to retain, replace, redeploy or
-- retire) with a financial impact attached.
--
-- Each row is one modelled scenario for one asset. The page derives a suggested
-- recommendation from the utilisation/cost/age inputs (pure logic in
-- src/lib/fleetOptimizer.js) and compares it against the recorded decision.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fleet_optimizer_scenarios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),
  country           text,
  scenario_name     text,
  asset_no          text NOT NULL,
  asset_type        text,
  utilization_pct   numeric,
  annual_km         numeric,
  annual_cost       numeric,
  downtime_days     numeric,
  age_years         numeric,
  resale_value      numeric,
  currency          text,
  recommendation    text
                      CHECK (recommendation IN ('keep','replace','redeploy','dispose','review')),
  projected_saving  numeric,
  confidence        text
                      CHECK (confidence IN ('low','medium','high')),
  rationale         text,
  notes             text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_optimizer_scenarios_org
  ON public.fleet_optimizer_scenarios (organisation_id);
CREATE INDEX IF NOT EXISTS idx_fleet_optimizer_scenarios_asset
  ON public.fleet_optimizer_scenarios (asset_no);
CREATE INDEX IF NOT EXISTS idx_fleet_optimizer_scenarios_created
  ON public.fleet_optimizer_scenarios (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_optimizer_scenarios_recommendation
  ON public.fleet_optimizer_scenarios (recommendation);

DROP TRIGGER IF EXISTS set_updated_at_fleet_optimizer_scenarios ON public.fleet_optimizer_scenarios;
CREATE TRIGGER set_updated_at_fleet_optimizer_scenarios BEFORE UPDATE ON public.fleet_optimizer_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read scenarios; authenticated members may create and update
-- scenarios for their own org.
ALTER TABLE public.fleet_optimizer_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fleet_optimizer_scenarios_org_isolation ON public.fleet_optimizer_scenarios;
CREATE POLICY fleet_optimizer_scenarios_org_isolation ON public.fleet_optimizer_scenarios
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS fleet_optimizer_scenarios_read ON public.fleet_optimizer_scenarios;
CREATE POLICY fleet_optimizer_scenarios_read ON public.fleet_optimizer_scenarios FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fleet_optimizer_scenarios_insert ON public.fleet_optimizer_scenarios;
CREATE POLICY fleet_optimizer_scenarios_insert ON public.fleet_optimizer_scenarios FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fleet_optimizer_scenarios_update ON public.fleet_optimizer_scenarios;
CREATE POLICY fleet_optimizer_scenarios_update ON public.fleet_optimizer_scenarios FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON public.fleet_optimizer_scenarios FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_optimizer_scenarios TO authenticated;

-- Reversible:
--   DROP TABLE public.fleet_optimizer_scenarios;
