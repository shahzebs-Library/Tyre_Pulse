-- ============================================================================
-- MIGRATIONS_V313_PLAN_LIMIT_ENFORCEMENT.sql
-- Server-side plan-limit enforcement for vehicle_fleet + api_keys inserts.
--
-- STATUS: NOT YET APPLIED. To be applied by the parent after review.
--         Reversible (drop the two triggers + the function; see Rollback).
--
-- WHY
--   Plan caps (V105 subscription_plans / org_subscriptions + org_can_add) are
--   today enforced ONLY client-side. public.org_can_add(resource) exists but is
--   wired to nothing, so a direct PostgREST/SQL insert bypasses every cap. This
--   migration adds a BEFORE INSERT trigger that consults the EXISTING
--   org_can_add() logic and blocks an over-cap insert.
--
-- SAFE BY CONSTRUCTION — three layers so it can never break the running fleet:
--
--   1. GRANDFATHER (the important one). org_can_add() falls back to the 'trial'
--      plan (25 vehicles / 1 api key) for ANY org that has NO org_subscriptions
--      row — via get_subscription_overview()'s COALESCE(plan_code,'trial'). So a
--      real, already-large org with no subscription would be judged against the
--      trial cap and BLOCKED. Verified live at authoring time:
--        * org_subscriptions: 0 rows (NO org has a subscription yet).
--        * Company A (00000000-0000-0000-0000-000000000001): 683 vehicles vs a
--          trial cap of 25  ->  org_can_add('vehicles') = FALSE.
--      Therefore this trigger enforces ONLY for an org that ACTUALLY HAS an
--      org_subscriptions row. With 0 such rows today, enforcement is INERT — the
--      pilot / Company A / every current org is untouched. It activates per-org
--      the moment that org gets a real subscription (i.e. once billing is live),
--      which is exactly when a plan cap should bite.
--
--   2. SERVICE-ROLE / SYSTEM BYPASS. Imports, backfills, Stripe webhooks and any
--      other non-interactive path (service_role key, or no JWT at all) are never
--      blocked. Only genuine authenticated end-user inserts are evaluated.
--
--   3. FAIL OPEN on the enforcement decision. Any error while deciding (missing
--      helper, RLS quirk, partial migration, unexpected exception) ALLOWS the
--      insert. The trigger's only job is to catch abusive direct inserts once
--      billing is live; it must never be the reason a legitimate insert fails.
--      The single deliberate block path raises a clean, user-facing message.
--
--   Reuses public.org_can_add(text) verbatim (single source of the cap maths) —
--   it is SECURITY DEFINER and computes usage/limits for app_current_org(), the
--   same org this trigger grandfather-checks, so the two always agree.
--
-- Resources covered: 'vehicles' (vehicle_fleet), 'api_keys' (api_keys) — the two
--   numeric caps that back a direct-insert abuse vector. 'users' is provisioned
--   through auth signup + handle_new_user, not a direct table insert, so it is
--   intentionally not triggered here.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Safe to re-run.
--
-- Rollback
--   DROP TRIGGER IF EXISTS trg_enforce_plan_limit ON public.vehicle_fleet;
--   DROP TRIGGER IF EXISTS trg_enforce_plan_limit ON public.api_keys;
--   DROP FUNCTION IF EXISTS public.enforce_plan_limit();
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENFORCEMENT FUNCTION — one function, resource passed per trigger via TG_ARGV
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_resource text := TG_ARGV[0];        -- 'vehicles' | 'api_keys'
  v_org      uuid;
  v_block    boolean := false;
  v_label    text;
BEGIN
  -- All enforcement reasoning is wrapped so ANY unexpected condition fails OPEN
  -- (allows the insert). Only an explicit, proven over-cap sets v_block = true;
  -- the RAISE for that lives OUTSIDE this guard so it can never be swallowed.
  BEGIN
    -- Layer 2: skip service_role / backfills / webhooks / no-JWT contexts.
    IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
      RETURN NEW;
    END IF;

    -- Resolve the caller's org (the org org_can_add evaluates). No org context
    -- => nothing to enforce.
    v_org := public.app_current_org();
    IF v_org IS NULL THEN
      RETURN NEW;
    END IF;

    -- Layer 1: GRANDFATHER. Enforce ONLY for an org that actually carries a
    -- subscription row. Orgs with no subscription (all of them today) are never
    -- judged against the trial fallback, so an existing large fleet is never
    -- blocked. Enforcement switches on per-org when billing provisions a row.
    IF NOT EXISTS (
      SELECT 1 FROM public.org_subscriptions s
       WHERE s.organisation_id = v_org
    ) THEN
      RETURN NEW;
    END IF;

    -- Reuse the existing cap logic (usage < limit; NULL limit = unlimited).
    IF public.org_can_add(v_resource) = false THEN
      v_block := true;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      -- Layer 3: fail open on any enforcement-decision error.
      RETURN NEW;
  END;

  IF v_block THEN
    v_label := CASE v_resource
                 WHEN 'api_keys' THEN 'API keys'
                 ELSE v_resource
               END;
    RAISE EXCEPTION
      'Plan limit reached for %. Upgrade your plan to add more.', v_label
      USING ERRCODE = 'check_violation',
            HINT    = 'Your current subscription plan does not allow additional '
                      || v_label || '. Contact your administrator to upgrade.';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.enforce_plan_limit() IS
  'BEFORE INSERT guard: blocks an over-cap insert using org_can_add(). Grandfathered (enforces only for orgs with an org_subscriptions row), skips service_role/no-auth, and fails open on any decision error. Resource passed via TG_ARGV[0].';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TRIGGERS — one per capped table, resource name passed as the argument
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_enforce_plan_limit ON public.vehicle_fleet;
CREATE TRIGGER trg_enforce_plan_limit
  BEFORE INSERT ON public.vehicle_fleet
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_plan_limit('vehicles');

DROP TRIGGER IF EXISTS trg_enforce_plan_limit ON public.api_keys;
CREATE TRIGGER trg_enforce_plan_limit
  BEFORE INSERT ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_plan_limit('api_keys');
