-- ============================================================================
-- MIGRATIONS_V177 — Weighbridge Tickets / Axle Weight
-- ============================================================================
-- Backs the Weighbridge module (/weighbridge). Stores weighbridge tickets so
-- fleets can capture gross / tare / net weights and per-axle loads at the
-- weighbridge, flag overweight vehicles, and retain a compliance trail. Each
-- row is one weighing event for one asset at a point in time.
--
-- Overloading is a primary root cause of accelerated tyre wear, casing failure,
-- and axle/suspension damage, so axle-level weight history feeds directly into
-- tyre-life, CPK, and reliability analytics.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.weighbridge_tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  ticket_no        text,
  asset_no         text NOT NULL,
  driver_name      text,
  site             text,
  weighed_at       timestamptz,
  gross_weight_kg  numeric,
  tare_weight_kg   numeric,
  net_weight_kg    numeric,
  axle_weights     jsonb,
  gross_limit_kg   numeric,
  cargo_type       text,
  status           text
                     CHECK (status IN ('draft','recorded','overweight','disputed','cleared')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_weighbridge_tickets_org     ON public.weighbridge_tickets (organisation_id);
CREATE INDEX IF NOT EXISTS idx_weighbridge_tickets_asset   ON public.weighbridge_tickets (asset_no);
CREATE INDEX IF NOT EXISTS idx_weighbridge_tickets_weighed ON public.weighbridge_tickets (weighed_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_weighbridge_tickets ON public.weighbridge_tickets;
CREATE TRIGGER set_updated_at_weighbridge_tickets BEFORE UPDATE ON public.weighbridge_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read tickets; authenticated members may record (insert) and
-- correct (update/delete) tickets for their own org.
ALTER TABLE public.weighbridge_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weighbridge_tickets_org_isolation ON public.weighbridge_tickets;
CREATE POLICY weighbridge_tickets_org_isolation ON public.weighbridge_tickets
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS weighbridge_tickets_read ON public.weighbridge_tickets;
CREATE POLICY weighbridge_tickets_read ON public.weighbridge_tickets FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS weighbridge_tickets_insert ON public.weighbridge_tickets;
CREATE POLICY weighbridge_tickets_insert ON public.weighbridge_tickets FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS weighbridge_tickets_update ON public.weighbridge_tickets;
CREATE POLICY weighbridge_tickets_update ON public.weighbridge_tickets FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS weighbridge_tickets_delete ON public.weighbridge_tickets;
CREATE POLICY weighbridge_tickets_delete ON public.weighbridge_tickets FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.weighbridge_tickets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weighbridge_tickets TO authenticated;

-- Reversible:
--   DROP TABLE public.weighbridge_tickets;
