-- ============================================================================
-- MIGRATIONS_V134 — Accident & Insurance: Insurance Claims
-- ============================================================================
-- Backs the Insurance Claims tracker. Records insurance claims raised against a
-- fleet asset following an accident/incident, and follows each claim through its
-- lifecycle (open → submitted → under_review → approved/rejected → settled →
-- closed) with claimed vs. settled amounts for recovery-rate reporting.
-- Org-isolated and country-scoped.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.insurance_claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  claim_no         text,
  asset_no         text,
  insurer          text,
  policy_no        text,
  incident_date    date,
  claim_date       date,
  amount_claimed   numeric,
  amount_settled   numeric,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','submitted','under_review','approved','rejected','settled','closed')),
  description      text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_org    ON public.insurance_claims (organisation_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_status ON public.insurance_claims (status);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_asset  ON public.insurance_claims (asset_no);

DROP TRIGGER IF EXISTS set_updated_at_insurance_claims ON public.insurance_claims;
CREATE TRIGGER set_updated_at_insurance_claims BEFORE UPDATE ON public.insurance_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and write claims.
ALTER TABLE public.insurance_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insurance_claims_org_isolation ON public.insurance_claims;
CREATE POLICY insurance_claims_org_isolation ON public.insurance_claims
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS insurance_claims_read ON public.insurance_claims;
CREATE POLICY insurance_claims_read ON public.insurance_claims FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS insurance_claims_insert ON public.insurance_claims;
CREATE POLICY insurance_claims_insert ON public.insurance_claims FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS insurance_claims_update ON public.insurance_claims;
CREATE POLICY insurance_claims_update ON public.insurance_claims FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS insurance_claims_delete ON public.insurance_claims;
CREATE POLICY insurance_claims_delete ON public.insurance_claims FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.insurance_claims FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_claims TO authenticated;

-- Reversible:
--   DROP TABLE public.insurance_claims;
