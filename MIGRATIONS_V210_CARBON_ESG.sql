-- ============================================================================
-- MIGRATIONS_V210 — Carbon ESG (offsets ledger + reduction initiatives)
-- ============================================================================
-- PURELY ADDITIVE. Deepens the Carbon Tracker module (route /carbon-tracker)
-- by restoring the tyre-lifecycle ESG model from the original tyre_saas app.
-- The lifecycle carbon roll-up itself (manufacturing / transport / end-of-life
-- CO2, retread savings, under-inflation impact, ESG score) is DERIVED entirely
-- from the existing `tyre_records` and `vehicle_fleet` tables in the pure
-- service `src/lib/carbon.js` — it needs no new schema.
--
-- What this migration adds are the two operator-authored stores the original
-- kept only in process memory (a non-persistent, non-isolated demo dict):
--   • carbon_offsets      — carbon-credit / offset certificate purchases
--   • carbon_initiatives  — CO2-reduction programmes with claimed savings
-- Persisting them as real, org-isolated tables replaces that mock in-memory
-- store with durable, multi-tenant data. NO mock rows are seeded — the module
-- shows honest empty states until an operator records real offsets/initiatives.
--
-- This phase deliberately DOES NOT touch `tyre_records`, `vehicle_fleet`, any
-- existing RLS policy, or any operational module. Safe to apply and to reverse
-- (see footer) with zero blast radius on current functionality.
--
-- Org-scoped (RESTRICTIVE org isolation). Reads: any authenticated org member.
-- Writes: elevated roles only (Admin/Manager/Director), matching V201/V206/V209.
-- Depends on existing helpers: app_current_org(), get_my_role(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

-- 1. Carbon offsets ledger ---------------------------------------------------
-- One row per carbon-credit / offset certificate purchase within an org.
-- `tonnes` is CO2e offset; `aed_cost` the purchase price; `trees_equivalent`
-- an intuitive absorption equivalent. `purchased_at` records when the offset
-- was bought (defaults to now). `provider`/`project` name the registry and
-- programme (e.g. Verra — UAE Mangrove Restoration).
CREATE TABLE IF NOT EXISTS public.carbon_offsets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),
  provider          text,
  project           text,
  tonnes            numeric NOT NULL DEFAULT 0
                      CHECK (tonnes >= 0),
  aed_cost          numeric NOT NULL DEFAULT 0
                      CHECK (aed_cost >= 0),
  trees_equivalent  numeric NOT NULL DEFAULT 0
                      CHECK (trees_equivalent >= 0),
  purchased_at      timestamptz NOT NULL DEFAULT now(),
  notes             text,
  created_by        uuid DEFAULT auth.uid(),
  country           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carbon_offsets_org        ON public.carbon_offsets (organisation_id);
CREATE INDEX IF NOT EXISTS idx_carbon_offsets_purchased  ON public.carbon_offsets (purchased_at);
CREATE INDEX IF NOT EXISTS idx_carbon_offsets_country    ON public.carbon_offsets (country);

DROP TRIGGER IF EXISTS set_updated_at_carbon_offsets ON public.carbon_offsets;
CREATE TRIGGER set_updated_at_carbon_offsets BEFORE UPDATE ON public.carbon_offsets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
ALTER TABLE public.carbon_offsets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS carbon_offsets_org_isolation ON public.carbon_offsets;
CREATE POLICY carbon_offsets_org_isolation ON public.carbon_offsets
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS carbon_offsets_read ON public.carbon_offsets;
CREATE POLICY carbon_offsets_read ON public.carbon_offsets FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS carbon_offsets_insert ON public.carbon_offsets;
CREATE POLICY carbon_offsets_insert ON public.carbon_offsets FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS carbon_offsets_update ON public.carbon_offsets;
CREATE POLICY carbon_offsets_update ON public.carbon_offsets FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS carbon_offsets_delete ON public.carbon_offsets;
CREATE POLICY carbon_offsets_delete ON public.carbon_offsets FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.carbon_offsets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carbon_offsets TO authenticated;

-- 2. Reduction initiatives register ------------------------------------------
-- One row per CO2-reduction programme within an org. `name` is required;
-- `claimed_savings_kg` the programme's claimed annual CO2 saving; `owner` the
-- accountable team; `status` its lifecycle state (application-layer vocabulary,
-- e.g. active / pilot / planned / completed / on_hold).
CREATE TABLE IF NOT EXISTS public.carbon_initiatives (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid DEFAULT public.app_current_org(),
  name               text NOT NULL,
  description        text,
  claimed_savings_kg numeric
                       CHECK (claimed_savings_kg IS NULL OR claimed_savings_kg >= 0),
  owner              text,
  status             text NOT NULL DEFAULT 'active',
  created_by         uuid DEFAULT auth.uid(),
  country            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carbon_initiatives_org      ON public.carbon_initiatives (organisation_id);
CREATE INDEX IF NOT EXISTS idx_carbon_initiatives_status   ON public.carbon_initiatives (status);
CREATE INDEX IF NOT EXISTS idx_carbon_initiatives_country  ON public.carbon_initiatives (country);

DROP TRIGGER IF EXISTS set_updated_at_carbon_initiatives ON public.carbon_initiatives;
CREATE TRIGGER set_updated_at_carbon_initiatives BEFORE UPDATE ON public.carbon_initiatives
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
ALTER TABLE public.carbon_initiatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS carbon_initiatives_org_isolation ON public.carbon_initiatives;
CREATE POLICY carbon_initiatives_org_isolation ON public.carbon_initiatives
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS carbon_initiatives_read ON public.carbon_initiatives;
CREATE POLICY carbon_initiatives_read ON public.carbon_initiatives FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS carbon_initiatives_insert ON public.carbon_initiatives;
CREATE POLICY carbon_initiatives_insert ON public.carbon_initiatives FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS carbon_initiatives_update ON public.carbon_initiatives;
CREATE POLICY carbon_initiatives_update ON public.carbon_initiatives FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS carbon_initiatives_delete ON public.carbon_initiatives;
CREATE POLICY carbon_initiatives_delete ON public.carbon_initiatives FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.carbon_initiatives FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carbon_initiatives TO authenticated;

-- Reversible:
--   DROP TABLE IF EXISTS public.carbon_offsets;
--   DROP TABLE IF EXISTS public.carbon_initiatives;
