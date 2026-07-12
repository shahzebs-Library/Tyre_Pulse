-- ============================================================================
-- MIGRATIONS_V167 — Load Plans
-- ============================================================================
-- Backs the Load Planning module (/load-planning): per-trip load plans that
-- pair an asset with its cargo, origin/destination, and the weight/volume it is
-- scheduled to carry. Capturing planned payload against each asset's rated
-- limits lets the fleet flag overloads before dispatch — a direct driver of
-- tyre wear, axle stress, fuel burn, and compliance risk — and feeds
-- utilisation, cost, and CPK analytics with the distance-and-load basis.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.load_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  reference        text NOT NULL,
  asset_no         text,
  origin           text,
  destination      text,
  plan_date        date,
  cargo_type       text,
  cargo_weight_kg  numeric,
  max_payload_kg   numeric,
  volume_m3        numeric,
  max_volume_m3    numeric,
  pallet_count     integer,
  status           text
                     CHECK (status IN ('draft','planned','loaded','dispatched','delivered')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_load_plans_org    ON public.load_plans (organisation_id);
CREATE INDEX IF NOT EXISTS idx_load_plans_asset  ON public.load_plans (asset_no);
CREATE INDEX IF NOT EXISTS idx_load_plans_date   ON public.load_plans (plan_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_load_plans ON public.load_plans;
CREATE TRIGGER set_updated_at_load_plans BEFORE UPDATE ON public.load_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and maintain load plans — trip
-- planning is a routine field/ops activity, not a privileged one.
ALTER TABLE public.load_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS load_plans_org_isolation ON public.load_plans;
CREATE POLICY load_plans_org_isolation ON public.load_plans
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS load_plans_read ON public.load_plans;
CREATE POLICY load_plans_read ON public.load_plans FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS load_plans_insert ON public.load_plans;
CREATE POLICY load_plans_insert ON public.load_plans FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS load_plans_update ON public.load_plans;
CREATE POLICY load_plans_update ON public.load_plans FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS load_plans_delete ON public.load_plans;
CREATE POLICY load_plans_delete ON public.load_plans FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.load_plans FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.load_plans TO authenticated;

-- Reversible:
--   DROP TABLE public.load_plans;
