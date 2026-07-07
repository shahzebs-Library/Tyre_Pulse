-- ============================================================================
-- MIGRATIONS_V105_SUBSCRIPTION_BILLING.sql
-- Roadmap #6 — Subscription & Billing (commercial SaaS foundation).
--
-- Adds the three tables + one aggregate RPC that back the Billing & Subscription
-- admin page (src/pages/Billing.jsx) and the entitlement layer
-- (src/lib/entitlements.js):
--
--   * subscription_plans   — platform plan catalogue (Trial / Starter /
--                            Professional / Enterprise). Global (no org),
--                            readable by every authenticated user, writable
--                            only by an Admin. Each plan carries numeric limits
--                            (vehicles / users / API keys / storage) and a
--                            feature-entitlement map.
--   * org_subscriptions    — the ONE active subscription per organisation
--                            (status, billing interval, seats, trial + period
--                            window, Stripe external ids). Org-scoped RLS;
--                            only an Admin in the org may change it.
--   * invoices             — billing history per organisation (status, amounts,
--                            period, line items, Stripe external id). Org-scoped
--                            read; Admin/service write.
--
--   * get_subscription_overview()  — SECURITY DEFINER aggregate returning the
--                            org's plan + subscription + LIVE usage counts
--                            (vehicles/users/API keys) in a single round trip.
--                            Lazily provisions a trialing subscription on the
--                            default plan so every org always has a billing
--                            context.
--   * org_can_add(resource) — boolean entitlement check (vehicles|users|
--                            api_keys) usable by future server-side enforcement.
--
-- Design notes
--   * organisation_id uses DEFAULT public.app_current_org() and carries NO FK
--     (mirrors V102 user_dashboards/report_definitions) so legacy/NULL-org rows
--     never block a write.
--   * NULL limit = unlimited (Enterprise). Enforcement treats NULL as ∞.
--   * Stripe is intentionally NOT called here — external_* columns are the seam.
--     Until STRIPE keys + a checkout edge function are wired, plan changes are
--     applied directly (admin-driven), which is correct for manual/enterprise
--     billing and safe for self-serve later.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF
-- EXISTS, ON CONFLICT seed. Safe to re-run.
--
-- Rollback
--   DROP FUNCTION IF EXISTS public.get_subscription_overview();
--   DROP FUNCTION IF EXISTS public.org_can_add(text);
--   DROP FUNCTION IF EXISTS public.ensure_org_subscription();
--   DROP TABLE IF EXISTS public.invoices, public.org_subscriptions,
--                        public.subscription_plans CASCADE;
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PLAN CATALOGUE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text UNIQUE NOT NULL,
  name           text NOT NULL,
  description    text,
  price_monthly  numeric(12,2) NOT NULL DEFAULT 0 CHECK (price_monthly >= 0),
  price_annual   numeric(12,2) NOT NULL DEFAULT 0 CHECK (price_annual >= 0),
  currency       text NOT NULL DEFAULT 'USD',
  -- NULL = unlimited
  max_vehicles   integer CHECK (max_vehicles IS NULL OR max_vehicles >= 0),
  max_users      integer CHECK (max_users   IS NULL OR max_users   >= 0),
  max_api_keys   integer CHECK (max_api_keys IS NULL OR max_api_keys >= 0),
  max_storage_gb integer CHECK (max_storage_gb IS NULL OR max_storage_gb >= 0),
  -- Entitlement map layered on top of the numeric limits, e.g.
  -- {"ai_tools":true,"automation_platform":false,"tv_display":true}
  features       jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(features) = 'object'),
  is_public      boolean NOT NULL DEFAULT true,   -- shown in the pricing grid
  sort_order     integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
-- Every authenticated user can see the catalogue (needed to render the pricing
-- grid + resolve their own plan). Only an Admin can curate it.
DROP POLICY IF EXISTS subscription_plans_read ON public.subscription_plans;
CREATE POLICY subscription_plans_read ON public.subscription_plans
  FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS subscription_plans_admin_write ON public.subscription_plans;
CREATE POLICY subscription_plans_admin_write ON public.subscription_plans
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = (SELECT auth.uid()) AND role = 'Admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = (SELECT auth.uid()) AND role = 'Admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PER-ORG SUBSCRIPTION (one active row per organisation)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid UNIQUE DEFAULT public.app_current_org(),
  plan_code             text NOT NULL REFERENCES public.subscription_plans(code),
  status                text NOT NULL DEFAULT 'trialing'
                        CHECK (status IN ('trialing','active','past_due','canceled','expired')),
  billing_interval      text NOT NULL DEFAULT 'monthly'
                        CHECK (billing_interval IN ('monthly','annual')),
  seats                 integer NOT NULL DEFAULT 1 CHECK (seats >= 0),
  trial_ends_at         timestamptz,
  current_period_start  timestamptz NOT NULL DEFAULT now(),
  current_period_end    timestamptz,
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  external_customer_id     text,   -- Stripe customer id (seam)
  external_subscription_id text,   -- Stripe subscription id (seam)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_status
  ON public.org_subscriptions (status);

ALTER TABLE public.org_subscriptions ENABLE ROW LEVEL SECURITY;
-- Members of the org can read their subscription; only an Admin in that org may
-- change it. NULL-org rows are readable (legacy/single-tenant installs).
DROP POLICY IF EXISTS org_subscriptions_read ON public.org_subscriptions;
CREATE POLICY org_subscriptions_read ON public.org_subscriptions
  FOR SELECT TO authenticated
  USING (organisation_id IS NULL
         OR organisation_id = (SELECT public.app_current_org()));
DROP POLICY IF EXISTS org_subscriptions_admin_write ON public.org_subscriptions;
CREATE POLICY org_subscriptions_admin_write ON public.org_subscriptions
  FOR ALL TO authenticated
  USING (
    (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org()))
    AND EXISTS (SELECT 1 FROM public.profiles
                WHERE id = (SELECT auth.uid()) AND role = 'Admin')
  )
  WITH CHECK (
    (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org()))
    AND EXISTS (SELECT 1 FROM public.profiles
                WHERE id = (SELECT auth.uid()) AND role = 'Admin')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. INVOICE HISTORY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  subscription_id  uuid REFERENCES public.org_subscriptions(id) ON DELETE SET NULL,
  number           text,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','open','paid','void','uncollectible')),
  amount_due       numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid      numeric(12,2) NOT NULL DEFAULT 0,
  currency         text NOT NULL DEFAULT 'USD',
  period_start     date,
  period_end       date,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  due_at           timestamptz,
  paid_at          timestamptz,
  line_items       jsonb NOT NULL DEFAULT '[]'::jsonb
                   CHECK (jsonb_typeof(line_items) = 'array'),
  external_invoice_id text,   -- Stripe invoice id (seam)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_org
  ON public.invoices (organisation_id, issued_at DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_read ON public.invoices;
CREATE POLICY invoices_read ON public.invoices
  FOR SELECT TO authenticated
  USING (organisation_id IS NULL
         OR organisation_id = (SELECT public.app_current_org()));
DROP POLICY IF EXISTS invoices_admin_write ON public.invoices;
CREATE POLICY invoices_admin_write ON public.invoices
  FOR ALL TO authenticated
  USING (
    (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org()))
    AND EXISTS (SELECT 1 FROM public.profiles
                WHERE id = (SELECT auth.uid()) AND role = 'Admin')
  )
  WITH CHECK (
    (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org()))
    AND EXISTS (SELECT 1 FROM public.profiles
                WHERE id = (SELECT auth.uid()) AND role = 'Admin')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. updated_at triggers (auto-detect the project's helper, per V44 pattern)
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS set_updated_at_subscription_plans ON public.subscription_plans;
    CREATE TRIGGER set_updated_at_subscription_plans
      BEFORE UPDATE ON public.subscription_plans
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    DROP TRIGGER IF EXISTS set_updated_at_org_subscriptions ON public.org_subscriptions;
    CREATE TRIGGER set_updated_at_org_subscriptions
      BEFORE UPDATE ON public.org_subscriptions
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SEED PLAN CATALOGUE
--    Prices are placeholder list prices (USD); an Admin can edit them. Limits
--    are per organisation. features maps 1:1 onto the app's feature-flag keys so
--    a plan can gate whole capabilities (Trial has no automation platform, etc.).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.subscription_plans
  (code, name, description, price_monthly, price_annual, currency,
   max_vehicles, max_users, max_api_keys, max_storage_gb, features, is_public, sort_order)
VALUES
  ('trial', 'Trial', '14-day evaluation with core fleet & tyre tracking.',
     0, 0, 'USD', 25, 3, 1, 1,
     '{"ai_tools":true,"automation_platform":false,"tv_display":false,"erp_sync":false,"report_scheduling":false}'::jsonb,
     true, 0),
  ('starter', 'Starter', 'For small fleets getting operations under control.',
     49, 490, 'USD', 100, 10, 2, 10,
     '{"ai_tools":true,"automation_platform":false,"tv_display":true,"erp_sync":false,"report_scheduling":true}'::jsonb,
     true, 1),
  ('professional', 'Professional', 'Full intelligence, automation and executive reporting.',
     199, 1990, 'USD', 750, 50, 10, 100,
     '{"ai_tools":true,"automation_platform":true,"tv_display":true,"erp_sync":true,"report_scheduling":true}'::jsonb,
     true, 2),
  ('enterprise', 'Enterprise', 'Unlimited scale, ERP integrations and SLA support.',
     0, 0, 'USD', NULL, NULL, NULL, NULL,
     '{"ai_tools":true,"automation_platform":true,"tv_display":true,"erp_sync":true,"report_scheduling":true}'::jsonb,
     true, 3)
ON CONFLICT (code) DO UPDATE SET
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  max_vehicles   = EXCLUDED.max_vehicles,
  max_users      = EXCLUDED.max_users,
  max_api_keys   = EXCLUDED.max_api_keys,
  max_storage_gb = EXCLUDED.max_storage_gb,
  features       = EXCLUDED.features,
  is_public      = EXCLUDED.is_public,
  sort_order     = EXCLUDED.sort_order,
  updated_at     = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. LAZY PROVISIONER — guarantee the caller's org has a subscription row
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_org_subscription()
RETURNS public.org_subscriptions LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  v_org uuid := public.app_current_org();
  v_row public.org_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.org_subscriptions
   WHERE organisation_id IS NOT DISTINCT FROM v_org
   ORDER BY created_at LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.org_subscriptions
      (organisation_id, plan_code, status, billing_interval, seats,
       trial_ends_at, current_period_start, current_period_end)
    VALUES
      (v_org, 'trial', 'trialing', 'monthly', 1,
       now() + interval '14 days', now(), now() + interval '14 days')
    ON CONFLICT (organisation_id) DO NOTHING;

    SELECT * INTO v_row FROM public.org_subscriptions
     WHERE organisation_id IS NOT DISTINCT FROM v_org
     ORDER BY created_at LIMIT 1;
  END IF;

  RETURN v_row;
END $fn$;
GRANT EXECUTE ON FUNCTION public.ensure_org_subscription() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. AGGREGATE OVERVIEW — plan + subscription + LIVE usage in one call
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_subscription_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  v_org      uuid := public.app_current_org();
  v_sub      public.org_subscriptions%ROWTYPE;
  v_plan     public.subscription_plans%ROWTYPE;
  v_vehicles bigint := 0;
  v_users    bigint := 0;
  v_api_keys bigint := 0;
BEGIN
  -- Read-only functions cannot INSERT, so provision separately: try to read an
  -- existing row; if absent, synthesise a default trial view (the page's first
  -- write — a plan change — will persist a real row via ensure_org_subscription).
  SELECT * INTO v_sub FROM public.org_subscriptions
   WHERE organisation_id IS NOT DISTINCT FROM v_org
   ORDER BY created_at LIMIT 1;

  SELECT * INTO v_plan FROM public.subscription_plans
   WHERE code = COALESCE(v_sub.plan_code, 'trial');

  -- LIVE usage. Guard each source table with to_regclass so the function works
  -- in partially-migrated environments. NULL org counts everything (single tenant).
  IF to_regclass('public.vehicle_fleet') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.vehicle_fleet
             WHERE $1 IS NULL OR organisation_id IS NULL OR organisation_id = $1'
      INTO v_vehicles USING v_org;
  END IF;
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.profiles
             WHERE $1 IS NULL OR org_id IS NULL OR org_id = $1'
      INTO v_users USING v_org;
  END IF;
  IF to_regclass('public.api_keys') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.api_keys
             WHERE $1 IS NULL OR organisation_id IS NULL OR organisation_id = $1'
      INTO v_api_keys USING v_org;
  END IF;

  RETURN jsonb_build_object(
    'organisation_id', v_org,
    'subscription', CASE WHEN v_sub.id IS NULL THEN
        jsonb_build_object(
          'plan_code','trial','status','trialing','billing_interval','monthly',
          'seats',1,'cancel_at_period_end',false,
          'trial_ends_at', NULL,'current_period_end', NULL,'provisioned', false)
      ELSE
        jsonb_build_object(
          'id', v_sub.id,'plan_code', v_sub.plan_code,'status', v_sub.status,
          'billing_interval', v_sub.billing_interval,'seats', v_sub.seats,
          'cancel_at_period_end', v_sub.cancel_at_period_end,
          'trial_ends_at', v_sub.trial_ends_at,
          'current_period_start', v_sub.current_period_start,
          'current_period_end', v_sub.current_period_end,'provisioned', true)
      END,
    'plan', to_jsonb(v_plan),
    'usage', jsonb_build_object(
      'vehicles', v_vehicles,'users', v_users,'api_keys', v_api_keys),
    'limits', jsonb_build_object(
      'vehicles', v_plan.max_vehicles,'users', v_plan.max_users,
      'api_keys', v_plan.max_api_keys,'storage_gb', v_plan.max_storage_gb),
    'generated_at', now()
  );
END $fn$;
GRANT EXECUTE ON FUNCTION public.get_subscription_overview() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ENTITLEMENT CHECK — boolean "can this org add one more <resource>?"
--    NULL limit = unlimited. Usable by future BEFORE-INSERT enforcement.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_can_add(p_resource text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  v_over jsonb := public.get_subscription_overview();
  v_limit  numeric;
  v_usage  numeric;
BEGIN
  v_limit := NULLIF(v_over -> 'limits' ->> p_resource, '')::numeric;
  IF v_limit IS NULL THEN RETURN true; END IF;   -- unlimited or unknown resource
  v_usage := COALESCE((v_over -> 'usage' ->> p_resource)::numeric, 0);
  RETURN v_usage < v_limit;
END $fn$;
GRANT EXECUTE ON FUNCTION public.org_can_add(text) TO authenticated;

COMMENT ON TABLE public.subscription_plans IS
  'Platform plan catalogue (Trial/Starter/Professional/Enterprise): prices, per-org limits (NULL = unlimited) and a feature-entitlement map. Read-all, Admin-write.';
COMMENT ON TABLE public.org_subscriptions IS
  'One subscription per organisation: plan, status, billing interval, seats, trial/period window, Stripe external ids. Org-scoped; Admin-write.';
COMMENT ON TABLE public.invoices IS
  'Billing history per organisation. Org-scoped read; Admin/service write. external_invoice_id links to Stripe when wired.';
COMMENT ON FUNCTION public.get_subscription_overview() IS
  'Aggregate: org plan + subscription + live usage (vehicles/users/api_keys) + limits, one round trip. Fail-safe in partially-migrated DBs.';
