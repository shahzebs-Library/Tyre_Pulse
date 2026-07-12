-- ============================================================================
-- MIGRATIONS_V123 — Custom Checklist Templates + Submissions
-- ============================================================================
-- A tenant-configurable checklist builder: admins/managers design reusable
-- checklist TEMPLATES (ordered fields of many types, per-field options, photo
-- capture, required flags, sections), optionally requiring a signature and/or
-- an approval chain. Operators then RUN a template to produce a SUBMISSION
-- (answers + photos + signature), which can route through the Universal
-- Approval Engine (entity_type 'checklist_submission').
--
-- Fields are embedded as JSONB on the template (like workflow steps) — no child
-- table, no joins on the hot path. Each field:
--   { "id","type","label","help","section","required","allow_photo",
--     "options":[...], "min","max","default" }
-- Types: section, text, textarea, number, select, multiselect, boolean, date,
--        rating, photo, signature. (See src/lib/checklist/fieldTypes.js.)
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

-- 1. TEMPLATES ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),
  country           text,
  name              text NOT NULL,
  description       text,
  category          text,
  icon              text,
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published','archived')),
  version           integer NOT NULL DEFAULT 1,
  require_signature boolean NOT NULL DEFAULT false,
  require_approval  boolean NOT NULL DEFAULT false,
  fields            jsonb   NOT NULL DEFAULT '[]'::jsonb,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_org     ON public.checklist_templates (organisation_id);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_status  ON public.checklist_templates (status);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_country ON public.checklist_templates (country);

DROP TRIGGER IF EXISTS set_updated_at_checklist_templates ON public.checklist_templates;
CREATE TRIGGER set_updated_at_checklist_templates BEFORE UPDATE ON public.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. SUBMISSIONS -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),
  template_id       uuid REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  template_name     text,
  template_version  integer,
  country           text,
  site              text,
  asset_no          text,
  title             text,
  status            text NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('draft','submitted','approved','rejected')),
  answers           jsonb NOT NULL DEFAULT '{}'::jsonb,
  photos            jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_data    text,
  printed_name      text,
  submitted_by      uuid DEFAULT auth.uid(),
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_sub_org      ON public.checklist_submissions (organisation_id);
CREATE INDEX IF NOT EXISTS idx_checklist_sub_template ON public.checklist_submissions (template_id);
CREATE INDEX IF NOT EXISTS idx_checklist_sub_country  ON public.checklist_submissions (country);
CREATE INDEX IF NOT EXISTS idx_checklist_sub_asset    ON public.checklist_submissions (asset_no);
CREATE INDEX IF NOT EXISTS idx_checklist_sub_created  ON public.checklist_submissions (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_checklist_submissions ON public.checklist_submissions;
CREATE TRIGGER set_updated_at_checklist_submissions BEFORE UPDATE ON public.checklist_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. RLS ---------------------------------------------------------------------
-- Org isolation is the real security boundary (RESTRICTIVE): a row is only ever
-- visible/writable within its own organisation. Layered on top: read is open to
-- authenticated members; template authoring is elevated (Admin/Manager/Director);
-- submissions may be created by any authenticated member of the org.
ALTER TABLE public.checklist_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_templates_org_isolation ON public.checklist_templates;
CREATE POLICY checklist_templates_org_isolation ON public.checklist_templates
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS checklist_templates_read ON public.checklist_templates;
CREATE POLICY checklist_templates_read ON public.checklist_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS checklist_templates_write ON public.checklist_templates;
CREATE POLICY checklist_templates_write ON public.checklist_templates FOR ALL
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS checklist_submissions_org_isolation ON public.checklist_submissions;
CREATE POLICY checklist_submissions_org_isolation ON public.checklist_submissions
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS checklist_submissions_read ON public.checklist_submissions;
CREATE POLICY checklist_submissions_read ON public.checklist_submissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS checklist_submissions_insert ON public.checklist_submissions;
CREATE POLICY checklist_submissions_insert ON public.checklist_submissions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS checklist_submissions_update ON public.checklist_submissions;
CREATE POLICY checklist_submissions_update ON public.checklist_submissions FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON public.checklist_templates   FROM anon;
REVOKE ALL ON public.checklist_submissions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_templates   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_submissions TO authenticated;

-- 4. Default approval chain for checklist submissions -------------------------
-- So a template with require_approval=true has a chain to start. Org-NULL global
-- default; a tenant can customise its own in /workflow-settings.
INSERT INTO public.workflow_definitions (organisation_id, name, description, entity_type, steps, active)
SELECT NULL,
  'Checklist Approval',
  'Two-step review of a submitted checklist: supervisor review then manager sign-off.',
  'checklist_submission',
  '[
     {"name":"Supervisor Review","approver_role":"fleet_supervisor","sla_hours":24,"allow_return":true},
     {"name":"Manager Sign-off","approver_role":"manager","sla_hours":48,"require_signature":true}
   ]'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.workflow_definitions d
  WHERE d.organisation_id IS NULL AND d.entity_type = 'checklist_submission'
);

-- Reversible:
--   DROP TABLE public.checklist_submissions;
--   DROP TABLE public.checklist_templates;
--   DELETE FROM public.workflow_definitions
--    WHERE organisation_id IS NULL AND entity_type = 'checklist_submission';
