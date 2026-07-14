-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V221 — Accident Report Builder saved layouts
-- ─────────────────────────────────────────────────────────────────────────────
-- Persists named, reusable report layouts (an ordered list of blocks — header/
-- logo, KPI rows, charts, text, tables, page breaks — plus report settings) for
-- the customizable Accident Report Builder. Org-isolated; team-visible; members
-- own their own layouts, elevated roles manage any.
-- Depends on existing helpers: app_current_org(), get_my_role(), set_updated_at().
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.accident_report_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  name             text NOT NULL,
  description      text,
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ordered block list + report settings
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accident_report_templates_org     ON public.accident_report_templates (organisation_id);
CREATE INDEX IF NOT EXISTS idx_accident_report_templates_creator ON public.accident_report_templates (created_by);

DROP TRIGGER IF EXISTS set_updated_at_accident_report_templates ON public.accident_report_templates;
CREATE TRIGGER set_updated_at_accident_report_templates BEFORE UPDATE ON public.accident_report_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accident_report_templates ENABLE ROW LEVEL SECURITY;

-- Hard org boundary (RESTRICTIVE: applies on top of every permissive policy).
DROP POLICY IF EXISTS accident_report_templates_org_isolation ON public.accident_report_templates;
CREATE POLICY accident_report_templates_org_isolation ON public.accident_report_templates
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

-- Any authenticated org member can see the team's saved report layouts.
DROP POLICY IF EXISTS accident_report_templates_read ON public.accident_report_templates;
CREATE POLICY accident_report_templates_read ON public.accident_report_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Members create their own layouts (created_by must be self to prevent spoofing).
DROP POLICY IF EXISTS accident_report_templates_insert ON public.accident_report_templates;
CREATE POLICY accident_report_templates_insert ON public.accident_report_templates FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND (created_by IS NULL OR created_by = auth.uid()));

-- Owner edits/deletes own; elevated roles manage any in the org.
DROP POLICY IF EXISTS accident_report_templates_update ON public.accident_report_templates;
CREATE POLICY accident_report_templates_update ON public.accident_report_templates FOR UPDATE
  USING (created_by = auth.uid() OR public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (created_by = auth.uid() OR public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS accident_report_templates_delete ON public.accident_report_templates;
CREATE POLICY accident_report_templates_delete ON public.accident_report_templates FOR DELETE
  USING (created_by = auth.uid() OR public.get_my_role() IN ('Admin','Manager','Director'));

-- ── Rollback ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.accident_report_templates CASCADE;
