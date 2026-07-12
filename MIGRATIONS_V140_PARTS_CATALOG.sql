-- ============================================================================
-- MIGRATIONS_V140 — Parts Catalog (master spare-parts inventory)
-- ============================================================================
-- A master catalog of spare parts: part number, name, category, unit cost,
-- on-hand quantity, reorder level, supplier and unit of measure. Backs the
-- /parts-catalog module. Org-isolated and country-scoped; any authenticated
-- member reads, while Admin/Manager/Director maintain the catalog.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.parts_catalog (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  part_no          text NOT NULL,
  name             text,
  category         text,
  unit_cost        numeric,
  on_hand_qty      numeric DEFAULT 0,
  reorder_level    numeric,
  supplier         text,
  uom              text,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','discontinued')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parts_catalog_org_part_no_key UNIQUE (organisation_id, part_no)
);
CREATE INDEX IF NOT EXISTS idx_parts_catalog_org      ON public.parts_catalog (organisation_id);
CREATE INDEX IF NOT EXISTS idx_parts_catalog_category ON public.parts_catalog (category);
CREATE INDEX IF NOT EXISTS idx_parts_catalog_status   ON public.parts_catalog (status);

DROP TRIGGER IF EXISTS set_updated_at_parts_catalog ON public.parts_catalog;
CREATE TRIGGER set_updated_at_parts_catalog BEFORE UPDATE ON public.parts_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read the catalog; only Admin/Manager/
-- Director may create, update or delete parts.
ALTER TABLE public.parts_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_catalog_org_isolation ON public.parts_catalog;
CREATE POLICY parts_catalog_org_isolation ON public.parts_catalog
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS parts_catalog_read ON public.parts_catalog;
CREATE POLICY parts_catalog_read ON public.parts_catalog FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS parts_catalog_insert ON public.parts_catalog;
CREATE POLICY parts_catalog_insert ON public.parts_catalog FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS parts_catalog_update ON public.parts_catalog;
CREATE POLICY parts_catalog_update ON public.parts_catalog FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS parts_catalog_delete ON public.parts_catalog;
CREATE POLICY parts_catalog_delete ON public.parts_catalog FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.parts_catalog FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parts_catalog TO authenticated;

-- Reversible:
--   DROP TABLE public.parts_catalog;
