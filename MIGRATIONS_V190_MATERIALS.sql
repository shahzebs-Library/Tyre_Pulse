-- ============================================================================
-- MIGRATIONS_V190 — Materials Management (workshop consumables inventory)
-- ============================================================================
-- Backs the Materials Management module (/materials). Tracks the workshop's
-- consumable materials inventory — oils, filters, valves, sealants, greases,
-- coolants, cleaning agents, fasteners and other shop consumables — that keep
-- vehicles and tyres serviceable. This is distinct from the tyre Parts Catalog
-- (which describes fitment-grade spare parts); materials are stock-managed shop
-- supplies with quantities on hand, reorder points and unit costs.
--
-- Each row is one stock-keeping unit (SKU) held at a location, with live
-- quantity_on_hand, reorder thresholds and a derived stock status so the fleet
-- can spot low / out-of-stock items and value on-hand inventory.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.materials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),
  country           text,
  sku               text,
  name              text NOT NULL,
  category          text
                      CHECK (category IN ('oil','filter','valve','sealant','grease',
                                          'coolant','cleaning','fastener','consumable','other')),
  unit              text,
  quantity_on_hand  numeric DEFAULT 0,
  reorder_point     numeric DEFAULT 0,
  reorder_qty       numeric DEFAULT 0,
  unit_cost         numeric DEFAULT 0,
  currency          text,
  supplier          text,
  location          text,
  status            text
                      CHECK (status IN ('active','low','out_of_stock','discontinued')),
  notes             text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_org      ON public.materials (organisation_id);
CREATE INDEX IF NOT EXISTS idx_materials_category ON public.materials (category);
CREATE INDEX IF NOT EXISTS idx_materials_sku      ON public.materials (sku);
CREATE INDEX IF NOT EXISTS idx_materials_status   ON public.materials (status);

DROP TRIGGER IF EXISTS set_updated_at_materials ON public.materials;
CREATE TRIGGER set_updated_at_materials BEFORE UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read materials; authenticated members may add (insert), correct
-- (update) and remove (delete) materials for their own org.
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS materials_org_isolation ON public.materials;
CREATE POLICY materials_org_isolation ON public.materials
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS materials_read ON public.materials;
CREATE POLICY materials_read ON public.materials FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS materials_insert ON public.materials;
CREATE POLICY materials_insert ON public.materials FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS materials_update ON public.materials;
CREATE POLICY materials_update ON public.materials FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS materials_delete ON public.materials;
CREATE POLICY materials_delete ON public.materials FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.materials FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materials TO authenticated;

-- Reversible:
--   DROP TABLE public.materials;
