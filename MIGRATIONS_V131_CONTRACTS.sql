-- ============================================================================
-- MIGRATIONS_V131 — Contract Manager: Supplier & Service Contracts
-- ============================================================================
-- Backs the Contract Manager module (route /contracts). Tracks supplier and
-- service contracts with lifecycle status and expiry, so procurement/management
-- can see what is active, expiring soon, or lapsed and what it costs. Org-
-- isolated and country-scoped; writes restricted to Admin/Manager/Director.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  title            text NOT NULL,
  vendor           text,
  contract_type    text,
  start_date       date,
  end_date         date,
  value            numeric,
  currency         text,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','expired','pending','cancelled')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_org      ON public.contracts (organisation_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status   ON public.contracts (status);
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON public.contracts (end_date);

DROP TRIGGER IF EXISTS set_updated_at_contracts ON public.contracts;
CREATE TRIGGER set_updated_at_contracts BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read contracts; only Admin/Manager/
-- Director may create, update, or delete them.
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contracts_org_isolation ON public.contracts;
CREATE POLICY contracts_org_isolation ON public.contracts
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS contracts_read ON public.contracts;
CREATE POLICY contracts_read ON public.contracts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS contracts_insert ON public.contracts;
CREATE POLICY contracts_insert ON public.contracts FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS contracts_update ON public.contracts;
CREATE POLICY contracts_update ON public.contracts FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS contracts_delete ON public.contracts;
CREATE POLICY contracts_delete ON public.contracts FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.contracts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated;

-- Reversible:
--   DROP TABLE public.contracts;
