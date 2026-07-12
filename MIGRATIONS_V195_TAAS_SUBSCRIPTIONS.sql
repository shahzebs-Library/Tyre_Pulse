-- ============================================================================
-- MIGRATIONS_V195 — TaaS: Tyre-as-a-Service Subscriptions
-- ============================================================================
-- Backs the TaaS module (/taas). Stores subscription / usage-billing contracts
-- for tyres-as-a-service: per-km, per-month, per-tyre, or hybrid plans. Each row
-- is one active (or historical) contract for one customer / asset, carrying the
-- commercial terms (rate, committed vs actual km, monthly fee) needed to track
-- cost-per-km, monthly recurring revenue (MRR), utilisation, and renewals.
--
-- This is the commercial counterpart to the operational tyre data: it turns tyre
-- servicing into a recurring-revenue product with usage tracking and renewal
-- forecasting.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run. Reversible (see bottom).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.taas_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  subscription_no  text,
  customer_name    text,
  asset_no         text,
  plan_type        text
                     CHECK (plan_type IN ('per_km','per_month','per_tyre','hybrid')),
  tyres_covered    integer,
  rate             numeric,
  rate_unit        text,
  committed_km     numeric,
  actual_km        numeric,
  monthly_fee      numeric,
  currency         text,
  start_date       date,
  renewal_date     date,
  billed_to_date   numeric,
  status           text
                     CHECK (status IN ('active','trial','paused','cancelled','expired')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_taas_subscriptions_org     ON public.taas_subscriptions (organisation_id);
CREATE INDEX IF NOT EXISTS idx_taas_subscriptions_asset   ON public.taas_subscriptions (asset_no);
CREATE INDEX IF NOT EXISTS idx_taas_subscriptions_status  ON public.taas_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_taas_subscriptions_renewal ON public.taas_subscriptions (renewal_date);

DROP TRIGGER IF EXISTS set_updated_at_taas_subscriptions ON public.taas_subscriptions;
CREATE TRIGGER set_updated_at_taas_subscriptions BEFORE UPDATE ON public.taas_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read subscriptions; authenticated members may create, amend, and
-- delete subscriptions for their own org.
ALTER TABLE public.taas_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS taas_subscriptions_org_isolation ON public.taas_subscriptions;
CREATE POLICY taas_subscriptions_org_isolation ON public.taas_subscriptions
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS taas_subscriptions_read ON public.taas_subscriptions;
CREATE POLICY taas_subscriptions_read ON public.taas_subscriptions FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS taas_subscriptions_insert ON public.taas_subscriptions;
CREATE POLICY taas_subscriptions_insert ON public.taas_subscriptions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS taas_subscriptions_update ON public.taas_subscriptions;
CREATE POLICY taas_subscriptions_update ON public.taas_subscriptions FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS taas_subscriptions_delete ON public.taas_subscriptions;
CREATE POLICY taas_subscriptions_delete ON public.taas_subscriptions FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.taas_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.taas_subscriptions TO authenticated;

-- Reversible:
--   DROP TABLE public.taas_subscriptions;
