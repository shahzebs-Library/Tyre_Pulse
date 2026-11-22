-- ROLLBACK for 20261116102000_clo_supervisor_actions_visibility.sql
--
-- STATUS: AUTHORED, NOT APPLIED. Rehearsed on a local copy of the staging database (tp_runbook):
--         apply, verify, this rollback, then a fingerprint (module_permissions rows) equal to the
--         one taken before the apply. See docs/commercial-readiness/RELEASE_RUNBOOK_519_520.md
--         (on the #519 branch), step 9.
-- PRE-CHECK: the apply file creates both rows only when they do not exist (production read on
--         2026-11-15: no row for either role). Confirm before the apply with
--           select role, enabled, updated_at from public.module_permissions
--            where org_id is null and module_key = 'corrective_actions'
--              and role in ('Workshop Supervisor', 'Maintenance Supervisor');
--         If a row already existed, do not run this file: set that row back to its recorded value.
-- The header's switch-off alternative (enabled = false) keeps two rows that did not exist before;
--         this file removes them instead, which restores the previous state exactly.
-- CONTAINS the word "delete": the Supabase MCP tool waits for a human confirmation.

begin;

delete from public.module_permissions
 where org_id is null and module_key = 'corrective_actions'
   and role in ('Workshop Supervisor', 'Maintenance Supervisor');

commit;
