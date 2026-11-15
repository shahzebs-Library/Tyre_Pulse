-- CLO-3: supervisors can open Corrective Actions on the web.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15 from the LIVE public.module_permissions rows
--         (read only: no corrective_actions row exists for either role). NEEDS THE OWNER'S YES.
--
-- WHY: 20261116100000 makes Workshop Supervisor a default reviewer of corrective action closures,
--   but the role is limited to checklist pages, so the review screen sent them back to Checklists
--   (browser test defect C1). The web change (src/lib/checklistAccess.js) lets the two supervisor
--   roles reach /actions; this file is the module switch the route guard also needs. The database
--   remains the boundary: every review goes through the closure RPCs.
--
-- DEPENDS ON: 20261116100000_clo_corrective_action_review.sql.
--
-- WHAT IT WRITES (module_permissions, built-in rows, org_id null)
--   Workshop Supervisor     corrective_actions = true   (no row today)
--   Maintenance Supervisor  corrective_actions = true   (no row today)
--   Nothing else is touched. No rights change: this is the menu and route switch only.
--
-- VERIFY (after applying)
--   select role, module_key, enabled from public.module_permissions
--    where org_id is null and module_key = 'corrective_actions'
--      and role in ('Workshop Supervisor', 'Maintenance Supervisor');   -- 2 rows, both true
--
-- ROLLBACK
--   update public.module_permissions set enabled = false, updated_at = now()
--    where org_id is null and module_key = 'corrective_actions'
--      and role in ('Workshop Supervisor', 'Maintenance Supervisor');

begin;

insert into public.module_permissions (role, module_key, org_id, enabled)
values ('Workshop Supervisor', 'corrective_actions', null, true),
       ('Maintenance Supervisor', 'corrective_actions', null, true)
on conflict (role, module_key, (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)))
do update set enabled = true, updated_at = now();

commit;
