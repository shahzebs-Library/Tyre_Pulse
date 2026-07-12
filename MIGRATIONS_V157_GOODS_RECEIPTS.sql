-- ============================================================================
-- MIGRATIONS_V157 — Stock & Procurement: Goods Receipts (GRN)
-- ============================================================================
-- Records the receipt of goods against a purchase order / supplier: GRN number,
-- PO reference, supplier, item, quantities ordered vs received, condition on
-- arrival, receipt date, receiving site, and a short status lifecycle
-- (pending → partial → received → rejected). Org-isolated, country-scoped.
--
-- Any authenticated member may read and maintain records for their organisation.
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  grn_no           text,
  po_ref           text,
  supplier         text,
  item             text,
  qty_ordered      numeric,
  qty_received     numeric,
  condition        text,
  received_date    date,
  site             text,
  status           text NOT NULL DEFAULT 'received'
                     CHECK (status IN ('pending','partial','received','rejected')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_org      ON public.goods_receipts (organisation_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status   ON public.goods_receipts (status);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_received ON public.goods_receipts (received_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_goods_receipts ON public.goods_receipts;
CREATE TRIGGER set_updated_at_goods_receipts BEFORE UPDATE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the organisation may read and maintain goods-receipt records.
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS goods_receipts_org_isolation ON public.goods_receipts;
CREATE POLICY goods_receipts_org_isolation ON public.goods_receipts
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS goods_receipts_read ON public.goods_receipts;
CREATE POLICY goods_receipts_read ON public.goods_receipts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS goods_receipts_insert ON public.goods_receipts;
CREATE POLICY goods_receipts_insert ON public.goods_receipts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS goods_receipts_update ON public.goods_receipts;
CREATE POLICY goods_receipts_update ON public.goods_receipts FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS goods_receipts_delete ON public.goods_receipts;
CREATE POLICY goods_receipts_delete ON public.goods_receipts FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.goods_receipts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goods_receipts TO authenticated;

-- Reversible:
--   DROP TABLE public.goods_receipts;
