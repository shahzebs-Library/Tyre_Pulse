-- ============================================================================
-- MIGRATIONS_V196 — Supplier Marketplace: Listings + RFQs
-- ============================================================================
-- Backs the Supplier Marketplace module (/supplier-marketplace). Two related
-- entities:
--
--   • marketplace_listings — a catalog of supplier offers (tyres, retreads,
--     parts, services) with pricing, MOQ, lead time, stock and rating. This is
--     the buy-side "shelf" fleets browse to compare supply options.
--
--   • marketplace_rfqs — buyer-issued Requests For Quotation. A fleet publishes
--     what it needs (product, quantity, target price, needed-by) and tracks the
--     responses/best-quote/award lifecycle, turning ad-hoc sourcing into a
--     measurable, auditable procurement funnel.
--
-- Both are org-scoped and country-scoped, following the V130 RLS pattern
-- (RESTRICTIVE org isolation + authenticated read/insert/update/delete +
-- set_updated_at trigger + REVOKE anon / GRANT authenticated). Depends on the
-- V42 helpers: app_current_org(), set_updated_at(). Idempotent and safe to
-- re-run; a reversible DROP is provided at the end.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- (a) marketplace_listings — supplier catalog offers
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  listing_no       text,
  supplier         text NOT NULL,
  category         text
                     CHECK (category IN ('tyre','retread','parts','service','other')),
  product_name     text,
  brand            text,
  size_spec        text,
  unit_price       numeric,
  currency         text,
  moq              integer,
  lead_time_days   numeric,
  rating           numeric,
  in_stock         boolean DEFAULT true,
  status           text
                     CHECK (status IN ('active','out_of_stock','archived')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_org      ON public.marketplace_listings (organisation_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_category ON public.marketplace_listings (category);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_supplier ON public.marketplace_listings (supplier);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status   ON public.marketplace_listings (status);

DROP TRIGGER IF EXISTS set_updated_at_marketplace_listings ON public.marketplace_listings;
CREATE TRIGGER set_updated_at_marketplace_listings BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read; authenticated members may create, update and delete their
-- own org's listings.
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_listings_org_isolation ON public.marketplace_listings;
CREATE POLICY marketplace_listings_org_isolation ON public.marketplace_listings
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS marketplace_listings_read ON public.marketplace_listings;
CREATE POLICY marketplace_listings_read ON public.marketplace_listings FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS marketplace_listings_insert ON public.marketplace_listings;
CREATE POLICY marketplace_listings_insert ON public.marketplace_listings FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS marketplace_listings_update ON public.marketplace_listings;
CREATE POLICY marketplace_listings_update ON public.marketplace_listings FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS marketplace_listings_delete ON public.marketplace_listings;
CREATE POLICY marketplace_listings_delete ON public.marketplace_listings FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.marketplace_listings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_listings TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- (b) marketplace_rfqs — buyer Requests For Quotation
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_rfqs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  rfq_no           text,
  product_name     text NOT NULL,
  category         text,
  quantity         numeric,
  target_price     numeric,
  currency         text,
  needed_by        date,
  responses_count  integer,
  best_quote       numeric,
  awarded_supplier text,
  status           text
                     CHECK (status IN ('open','quoting','awarded','closed','cancelled')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_rfqs_org       ON public.marketplace_rfqs (organisation_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_rfqs_status    ON public.marketplace_rfqs (status);
CREATE INDEX IF NOT EXISTS idx_marketplace_rfqs_needed_by ON public.marketplace_rfqs (needed_by);

DROP TRIGGER IF EXISTS set_updated_at_marketplace_rfqs ON public.marketplace_rfqs;
CREATE TRIGGER set_updated_at_marketplace_rfqs BEFORE UPDATE ON public.marketplace_rfqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
ALTER TABLE public.marketplace_rfqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_rfqs_org_isolation ON public.marketplace_rfqs;
CREATE POLICY marketplace_rfqs_org_isolation ON public.marketplace_rfqs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS marketplace_rfqs_read ON public.marketplace_rfqs;
CREATE POLICY marketplace_rfqs_read ON public.marketplace_rfqs FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS marketplace_rfqs_insert ON public.marketplace_rfqs;
CREATE POLICY marketplace_rfqs_insert ON public.marketplace_rfqs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS marketplace_rfqs_update ON public.marketplace_rfqs;
CREATE POLICY marketplace_rfqs_update ON public.marketplace_rfqs FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS marketplace_rfqs_delete ON public.marketplace_rfqs;
CREATE POLICY marketplace_rfqs_delete ON public.marketplace_rfqs FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.marketplace_rfqs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_rfqs TO authenticated;

-- Reversible:
--   DROP TABLE IF EXISTS public.marketplace_rfqs;
--   DROP TABLE IF EXISTS public.marketplace_listings;
