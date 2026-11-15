-- ROLLBACK for 20261115141000_wo_supervisor_module_visibility.sql
--
-- STATUS: AUTHORED, NOT APPLIED. Rehearsed on a local copy of the staging database (tp_runbook):
--         apply, verify, this rollback, then a schema and data fingerprint (module_permissions
--         rows including updated_at) equal to the one taken before the apply. See
--         docs/commercial-readiness/RELEASE_RUNBOOK_519_520.md, step 4.
-- EFFECT: the 27 built-in (org_id null) module_permissions rows the apply wrote go back to exactly
--         what they were: rows that existed are restored from _bak.wo3_module_permissions_20261115
--         (enabled and updated_at); rows the apply created are removed. Per-company rows are never
--         touched. The backup table is kept.
-- CAUTION: an Admin edit to one of these 27 built-in rows after the apply is undone too.
-- CONTAINS the word "delete": the Supabase MCP tool waits for a human confirmation.

begin;

update public.module_permissions m
   set enabled = b.enabled, updated_at = b.updated_at
  from _bak.wo3_module_permissions_20261115 b
 where b.id = m.id;

delete from public.module_permissions m
 where m.org_id is null
   and not exists (select 1 from _bak.wo3_module_permissions_20261115 b where b.id = m.id)
   and (m.role, m.module_key) in (
     ('Workshop Supervisor', 'work_orders'), ('Workshop Supervisor', 'workshop_live'),
     ('Maintenance Supervisor', 'work_orders'), ('Maintenance Supervisor', 'workshop_live'),
     ('Workshop Area Manager', 'workshop_live'),
     ('Tyre Man', 'work_orders'), ('Mechanic', 'work_orders'), ('Electrician', 'work_orders'),
     ('Diesel Mechanic', 'work_orders'), ('Plant Mechanic', 'work_orders'),
     ('Assistant Plant Mechanic', 'work_orders'), ('Hydraulic Mechanic', 'work_orders'),
     ('Auto Electrician', 'work_orders'), ('Plant Electrician', 'work_orders'),
     ('Senior Technician', 'work_orders'), ('Senior Plant Technician', 'work_orders'),
     ('Senior Plant & Chiller Technician', 'work_orders'), ('Ice Plant Technician', 'work_orders'),
     ('Welder', 'work_orders'), ('Welder Cum Fabricator', 'work_orders'), ('Painter', 'work_orders'),
     ('Denter', 'work_orders'), ('Concrete Breaker', 'work_orders'), ('Helper Workshop', 'work_orders'),
     ('Helper Plant', 'work_orders'), ('Helper PMV', 'work_orders'), ('Helper Ice Plant', 'work_orders'));

commit;
