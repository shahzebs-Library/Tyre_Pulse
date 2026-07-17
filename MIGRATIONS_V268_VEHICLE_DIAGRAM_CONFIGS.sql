-- ============================================================================
-- V268: super-admin custom vehicle diagram configurations (Vehicle SVG
-- Designer, /console/vehicle-designer). Applied live via Supabase MCP
-- 2026-07-17; this file is the repo record. Next free V269.
--
-- One row per (org, vehicle_type): jsonb layout config
--   { axles: [{kind:'steer'|'drive'|'trailer'|'lift', dual:bool}],
--     spare: 0..2, body: 'truck'|'mixer'|'pump'|'bus'|'pickup'|'trailer'|
--     'loader'|'van', accents: {hazard:bool, beacon:bool} }
-- that OVERRIDES the built-in LAYOUTS in src/components/VehicleTyreDiagram.jsx
-- (engine src/lib/vehicleDiagram.js positionsFromConfig builds the layout).
-- Everyone authenticated reads (diagrams render for all); only super-admin
-- writes (console designer).
--
-- Rollback: DROP TABLE public.vehicle_diagram_configs;
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vehicle_diagram_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  vehicle_type    text NOT NULL,
  label           text,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_vehicle_diagram_org_type UNIQUE (organisation_id, vehicle_type)
);

CREATE INDEX IF NOT EXISTS idx_vdc_org_type ON public.vehicle_diagram_configs (organisation_id, vehicle_type);

DROP TRIGGER IF EXISTS trg_vdc_updated_at ON public.vehicle_diagram_configs;
CREATE TRIGGER trg_vdc_updated_at
  BEFORE UPDATE ON public.vehicle_diagram_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.vehicle_diagram_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vdc_org_isolation ON public.vehicle_diagram_configs;
CREATE POLICY vdc_org_isolation ON public.vehicle_diagram_configs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organisation_id = (SELECT public.app_current_org()) OR (SELECT public.is_super_admin()))
  WITH CHECK (organisation_id = (SELECT public.app_current_org()) OR (SELECT public.is_super_admin()));

DROP POLICY IF EXISTS vdc_select ON public.vehicle_diagram_configs;
CREATE POLICY vdc_select ON public.vehicle_diagram_configs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS vdc_write ON public.vehicle_diagram_configs;
CREATE POLICY vdc_write ON public.vehicle_diagram_configs
  FOR ALL TO authenticated
  USING ((SELECT public.is_super_admin()))
  WITH CHECK ((SELECT public.is_super_admin()));

REVOKE ALL ON public.vehicle_diagram_configs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_diagram_configs TO authenticated;
