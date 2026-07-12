-- ============================================================================
-- MIGRATIONS_V193 — Customer Portal: External Customer Accounts
-- ============================================================================
-- Backs the Customer Portal module (/customer-portal). This is the internal
-- admin surface for a customer-facing portal: each row is one external customer
-- account (a fleet operator, distributor, or B2B client) whose staff can be
-- granted read-only visibility of their linked assets and service history.
--
-- Stores the account's commercial profile (tier, contract reference, SLA),
-- portal-access state, and light roll-up counters (linked assets, open service
-- requests) so the admin can gauge adoption and support load at a glance.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customer_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  account_code     text,
  company_name     text NOT NULL,
  contact_name     text,
  email            text,
  phone            text,
  portal_enabled   boolean DEFAULT false,
  tier             text
                     CHECK (tier IN ('standard','premium','enterprise')),
  assets_linked    integer,
  open_requests    integer,
  contract_ref     text,
  sla_hours        numeric,
  account_manager  text,
  status           text
                     CHECK (status IN ('active','suspended','onboarding','churned')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_org     ON public.customer_accounts (organisation_id);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_code    ON public.customer_accounts (account_code);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_status  ON public.customer_accounts (status);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_created ON public.customer_accounts (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_customer_accounts ON public.customer_accounts;
CREATE TRIGGER set_updated_at_customer_accounts BEFORE UPDATE ON public.customer_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read accounts; authenticated members may create, update, and
-- delete accounts for their own org.
ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_accounts_org_isolation ON public.customer_accounts;
CREATE POLICY customer_accounts_org_isolation ON public.customer_accounts
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS customer_accounts_read ON public.customer_accounts;
CREATE POLICY customer_accounts_read ON public.customer_accounts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS customer_accounts_insert ON public.customer_accounts;
CREATE POLICY customer_accounts_insert ON public.customer_accounts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS customer_accounts_update ON public.customer_accounts;
CREATE POLICY customer_accounts_update ON public.customer_accounts FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS customer_accounts_delete ON public.customer_accounts;
CREATE POLICY customer_accounts_delete ON public.customer_accounts FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.customer_accounts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_accounts TO authenticated;

-- Reversible:
--   DROP TABLE public.customer_accounts;
