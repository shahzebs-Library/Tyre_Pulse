-- ============================================================================
-- MIGRATIONS_V208 — Fitment Rules + Validation Ledger
-- ============================================================================
-- PURELY ADDITIVE. Deepens the Fitment Validation module (route
-- /fitment-validation) from a fleet size-audit scanner into a full single-tyre
-- fitment validation ENGINE (ported from tyre_saas fitment_engine.py) by
-- introducing two org-scoped tables:
--
--   • fitment_rules       — the org's tyre-to-position fitment policy (approved
--                           sizes, minimum tread, retread policy, dual-pair
--                           rules). The pure engine (src/lib/fitmentValidation.js)
--                           evaluates a tyre against the matching rule.
--   • fitment_validations — an audit ledger of every validation run (persisted
--                           "Validate" actions), recording verdict + violations.
--
-- This phase deliberately DOES NOT touch any existing table, RLS policy, or
-- operational module (tyre_records / vehicle_fleet remain untouched — the size
-- audit keeps deriving from them). Only the checks that map to columns that
-- actually exist in tyre_records (size, tread_depth, status) are enforced by the
-- engine; age / retread / dual-wheel-pairing checks are surfaced honestly as
-- "requires data not present in this dataset" and never fabricated. Safe to
-- apply and to reverse (see footer) with zero blast radius on current features.
--
-- Org-scoped (RESTRICTIVE org isolation). Reads: any authenticated org member.
-- Writes: elevated roles only (Admin/Manager/Director), matching V201/V206/V207.
-- Depends on existing helpers: app_current_org(), get_my_role(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

-- 1. Fitment rules (org fitment policy) --------------------------------------
-- One row per fitment rule. `applies_to_vehicle_types` / `applies_to_axle_roles`
-- scope the rule (empty array = applies to all). `approved_sizes` (empty = any).
-- Thresholds default to the GCC-standard values used by the pure engine.
CREATE TABLE IF NOT EXISTS public.fitment_rules (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid DEFAULT public.app_current_org(),
  rule_name                 text NOT NULL,
  applies_to_vehicle_types  text[] NOT NULL DEFAULT '{}',
  applies_to_axle_roles     text[] NOT NULL DEFAULT '{}',
  approved_sizes            text[] NOT NULL DEFAULT '{}',
  min_tread_depth_mm        numeric NOT NULL DEFAULT 3.0,
  max_tyre_age_years        numeric NOT NULL DEFAULT 6,
  allow_retread             boolean NOT NULL DEFAULT true,
  max_retread_count         integer NOT NULL DEFAULT 2,
  require_matching_pair     boolean NOT NULL DEFAULT true,
  max_tread_delta_dual_mm   numeric NOT NULL DEFAULT 2.0,
  is_active                 boolean NOT NULL DEFAULT true,
  notes                     text,
  created_by                uuid DEFAULT auth.uid(),
  country                   text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fitment_rules_org     ON public.fitment_rules (organisation_id);
CREATE INDEX IF NOT EXISTS idx_fitment_rules_active  ON public.fitment_rules (is_active);
CREATE INDEX IF NOT EXISTS idx_fitment_rules_country ON public.fitment_rules (country);

DROP TRIGGER IF EXISTS set_updated_at_fitment_rules ON public.fitment_rules;
CREATE TRIGGER set_updated_at_fitment_rules BEFORE UPDATE ON public.fitment_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read; only elevated roles may mutate.
ALTER TABLE public.fitment_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fitment_rules_org_isolation ON public.fitment_rules;
CREATE POLICY fitment_rules_org_isolation ON public.fitment_rules
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS fitment_rules_read ON public.fitment_rules;
CREATE POLICY fitment_rules_read ON public.fitment_rules FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fitment_rules_insert ON public.fitment_rules;
CREATE POLICY fitment_rules_insert ON public.fitment_rules FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS fitment_rules_update ON public.fitment_rules;
CREATE POLICY fitment_rules_update ON public.fitment_rules FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS fitment_rules_delete ON public.fitment_rules;
CREATE POLICY fitment_rules_delete ON public.fitment_rules FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.fitment_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fitment_rules TO authenticated;

-- 2. Fitment validations (audit ledger) --------------------------------------
-- One row per persisted validation run. `violations` / `warnings` store the
-- engine output verbatim (jsonb array of {rule, severity, message}). `is_valid`
-- is false when any critical violation was raised.
CREATE TABLE IF NOT EXISTS public.fitment_validations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  tyre_serial      text,
  asset_no         text,
  position_code    text,
  axle_role        text,
  is_valid         boolean,
  violations       jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings         jsonb NOT NULL DEFAULT '[]'::jsonb,
  validated_by     uuid DEFAULT auth.uid(),
  validated_at     timestamptz NOT NULL DEFAULT now(),
  country          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fitment_validations_org        ON public.fitment_validations (organisation_id);
CREATE INDEX IF NOT EXISTS idx_fitment_validations_serial     ON public.fitment_validations (tyre_serial);
CREATE INDEX IF NOT EXISTS idx_fitment_validations_asset      ON public.fitment_validations (asset_no);
CREATE INDEX IF NOT EXISTS idx_fitment_validations_validated  ON public.fitment_validations (validated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fitment_validations_country    ON public.fitment_validations (country);

DROP TRIGGER IF EXISTS set_updated_at_fitment_validations ON public.fitment_validations;
CREATE TRIGGER set_updated_at_fitment_validations BEFORE UPDATE ON public.fitment_validations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fitment_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fitment_validations_org_isolation ON public.fitment_validations;
CREATE POLICY fitment_validations_org_isolation ON public.fitment_validations
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS fitment_validations_read ON public.fitment_validations;
CREATE POLICY fitment_validations_read ON public.fitment_validations FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Any authenticated org member may record a validation they ran; the ledger is
-- append-only for non-elevated users (no UPDATE/DELETE granted to them).
DROP POLICY IF EXISTS fitment_validations_insert ON public.fitment_validations;
CREATE POLICY fitment_validations_insert ON public.fitment_validations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fitment_validations_update ON public.fitment_validations;
CREATE POLICY fitment_validations_update ON public.fitment_validations FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS fitment_validations_delete ON public.fitment_validations;
CREATE POLICY fitment_validations_delete ON public.fitment_validations FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.fitment_validations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fitment_validations TO authenticated;

-- Reversible:
--   DROP TABLE IF EXISTS public.fitment_validations;
--   DROP TABLE IF EXISTS public.fitment_rules;
