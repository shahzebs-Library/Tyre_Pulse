-- ============================================================================
-- MIGRATIONS_V145 — Retread Claims (warranty / quality claims vs retread vendors)
-- ============================================================================
-- Tracks retread warranty & quality claims raised against retread vendors: the
-- affected casing/tyre serial, the vendor, the claim reason, cost exposure and
-- amount recovered, through a lightweight status lifecycle
-- (open → submitted → approved/rejected → settled). Feeds vendor reliability
-- and recovery-rate reporting. Org-isolated and country-scoped.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.retread_claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  claim_no         text,
  tyre_serial      text,
  asset_no         text,
  vendor           text,
  reason           text,
  claim_date       date,
  cost             numeric,
  amount_recovered numeric,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','submitted','approved','rejected','settled')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retread_claims_org    ON public.retread_claims (organisation_id);
CREATE INDEX IF NOT EXISTS idx_retread_claims_status ON public.retread_claims (status);
CREATE INDEX IF NOT EXISTS idx_retread_claims_vendor ON public.retread_claims (vendor);

DROP TRIGGER IF EXISTS set_updated_at_retread_claims ON public.retread_claims;
CREATE TRIGGER set_updated_at_retread_claims BEFORE UPDATE ON public.retread_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and manage claims.
ALTER TABLE public.retread_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS retread_claims_org_isolation ON public.retread_claims;
CREATE POLICY retread_claims_org_isolation ON public.retread_claims
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS retread_claims_read ON public.retread_claims;
CREATE POLICY retread_claims_read ON public.retread_claims FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS retread_claims_insert ON public.retread_claims;
CREATE POLICY retread_claims_insert ON public.retread_claims FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS retread_claims_update ON public.retread_claims;
CREATE POLICY retread_claims_update ON public.retread_claims FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS retread_claims_delete ON public.retread_claims;
CREATE POLICY retread_claims_delete ON public.retread_claims FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.retread_claims FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retread_claims TO authenticated;

-- Reversible:
--   DROP TABLE public.retread_claims;
