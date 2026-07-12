-- ============================================================================
-- MIGRATIONS_V159 — Fleet Renewal Planning
-- ============================================================================
-- Backs the Fleet Renewal Planning module (/fleet-renewal). Fleet managers plan
-- vehicle replacements/renewals: for each asset they record its current age &
-- mileage, a recommended action, a target replacement date, an estimated cost,
-- and a priority + status through a lightweight lifecycle
-- (planned → approved → deferred → completed). Org-isolated and country-scoped.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fleet_renewal_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid DEFAULT public.app_current_org(),
  country             text,
  asset_no            text NOT NULL,
  current_km          numeric,
  age_years           numeric,
  recommendation      text,
  target_replace_date date,
  est_cost            numeric,
  priority            text NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low','medium','high')),
  status              text NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','approved','deferred','completed')),
  site                text,
  notes               text,
  created_by          uuid DEFAULT auth.uid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fleet_renewal_plans_org      ON public.fleet_renewal_plans (organisation_id);
CREATE INDEX IF NOT EXISTS idx_fleet_renewal_plans_status   ON public.fleet_renewal_plans (status);
CREATE INDEX IF NOT EXISTS idx_fleet_renewal_plans_priority ON public.fleet_renewal_plans (priority);
CREATE INDEX IF NOT EXISTS idx_fleet_renewal_plans_asset    ON public.fleet_renewal_plans (asset_no);

DROP TRIGGER IF EXISTS set_updated_at_fleet_renewal_plans ON public.fleet_renewal_plans;
CREATE TRIGGER set_updated_at_fleet_renewal_plans BEFORE UPDATE ON public.fleet_renewal_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read renewal plans; only Admin/Manager/
-- Director may create, update or delete them.
ALTER TABLE public.fleet_renewal_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fleet_renewal_plans_org_isolation ON public.fleet_renewal_plans;
CREATE POLICY fleet_renewal_plans_org_isolation ON public.fleet_renewal_plans
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS fleet_renewal_plans_read ON public.fleet_renewal_plans;
CREATE POLICY fleet_renewal_plans_read ON public.fleet_renewal_plans FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fleet_renewal_plans_insert ON public.fleet_renewal_plans;
CREATE POLICY fleet_renewal_plans_insert ON public.fleet_renewal_plans FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS fleet_renewal_plans_update ON public.fleet_renewal_plans;
CREATE POLICY fleet_renewal_plans_update ON public.fleet_renewal_plans FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS fleet_renewal_plans_delete ON public.fleet_renewal_plans;
CREATE POLICY fleet_renewal_plans_delete ON public.fleet_renewal_plans FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.fleet_renewal_plans FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_renewal_plans TO authenticated;

-- Reversible:
--   DROP TABLE public.fleet_renewal_plans;
