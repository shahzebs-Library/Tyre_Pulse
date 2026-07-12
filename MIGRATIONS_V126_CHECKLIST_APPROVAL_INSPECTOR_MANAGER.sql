-- ============================================================================
-- MIGRATIONS_V126 — Checklist approval chain = Inspector -> Manager
-- ============================================================================
-- The predictive-maintenance rules specify approval by the Inspector then the
-- Manager. Re-point the default (org-NULL) checklist_submission chain from
-- "Supervisor Review -> Manager" to "Inspector Review -> Manager Sign-off".
-- Applied live via the connector. Idempotent.
-- ============================================================================
UPDATE public.workflow_definitions
SET steps = '[
     {"name":"Inspector Review","approver_role":"inspector","sla_hours":24,"allow_return":true},
     {"name":"Manager Sign-off","approver_role":"manager","sla_hours":48,"require_signature":true}
   ]'::jsonb,
   description = 'Two-step review of a submitted checklist: inspector review then manager sign-off.'
WHERE organisation_id IS NULL AND entity_type = 'checklist_submission';
