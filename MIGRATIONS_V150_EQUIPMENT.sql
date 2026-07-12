-- ============================================================================
-- MIGRATIONS_V150 — Tool & Equipment Registry
-- ============================================================================
-- Backs the Tool & Equipment Registry (/equipment). Registers workshop tools
-- and equipment (jacks, torque wrenches, tyre changers, balancers, gauges …)
-- with their serial, assigned site, condition, calibration due date and
-- lifecycle status. Org-isolated, country-scoped, with a lightweight status
-- lifecycle and calibration tracking.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.equipment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  name             text NOT NULL,
  equipment_type   text,
  serial_no        text,
  site             text,
  condition        text,
  calibration_due  date,
  status           text NOT NULL DEFAULT 'available'
                     CHECK (status IN ('available','in_use','maintenance','retired')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipment_org    ON public.equipment (organisation_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.equipment (status);
CREATE INDEX IF NOT EXISTS idx_equipment_site   ON public.equipment (site);

DROP TRIGGER IF EXISTS set_updated_at_equipment ON public.equipment;
CREATE TRIGGER set_updated_at_equipment BEFORE UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member may read the org's equipment; Admin/Manager/Director
-- may create, edit and delete records.
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipment_org_isolation ON public.equipment;
CREATE POLICY equipment_org_isolation ON public.equipment
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS equipment_read ON public.equipment;
CREATE POLICY equipment_read ON public.equipment FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS equipment_insert ON public.equipment;
CREATE POLICY equipment_insert ON public.equipment FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS equipment_update ON public.equipment;
CREATE POLICY equipment_update ON public.equipment FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS equipment_delete ON public.equipment;
CREATE POLICY equipment_delete ON public.equipment FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.equipment FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment TO authenticated;

-- Reversible:
--   DROP TABLE public.equipment;
