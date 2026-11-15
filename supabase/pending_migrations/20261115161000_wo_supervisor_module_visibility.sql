-- WO-3: workshop supervisors can open Work Orders and Workshop Live Control.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15 from the LIVE public.module_permissions rows
--         (read only). Applied only to a private copy of the local staging database by
--         supabase/tests/staging_work_order_permissions.sh. NEEDS THE OWNER'S YES.
--
-- DEPENDS ON: 20261115160000 and 20261115160500 (the rights). This file is only the menu and
--   route switch (the "view" capability). Without it the supervisors hold the rights but the web
--   sidebar and the route guards still hide both screens from them. The web change that goes with
--   it (src/lib/checklistAccess.js) lets the two checklist-only supervisor roles reach the two
--   routes; the database remains the boundary for every write.
--
-- WHAT IT WRITES (module_permissions, built-in rows, org_id null)
--   Workshop Supervisor     work_orders = true, workshop_live = true     (no row today for either)
--   Maintenance Supervisor  work_orders = true, workshop_live = true     (no row today for either)
--   Workshop Area Manager   workshop_live = true                         (work_orders already true)
--   Workshop Maintenance Area Manager already has both. Nothing else is touched: no mobile key,
--   no other role, no other module. Rows that already exist are copied to
--   _bak.wo3_module_permissions_20261115 before being changed (on production today: none exist).
--
-- WHO GAINS: Workshop Supervisor 7 and Maintenance Supervisor 1 (approved accounts) see Work Orders
--   and Workshop Live Control on the web. Loses: nobody.
--
-- VERIFY (rolled back, after applying)
--   begin;
--   select role, module_key, enabled from public.module_permissions
--    where org_id is null and module_key in ('work_orders', 'workshop_live')
--      and role in ('Workshop Supervisor', 'Maintenance Supervisor', 'Workshop Area Manager')
--    order by 1, 2;                                                    -- 5 rows, all true
--   rollback;
--
-- ROLLBACK
--   begin;
--   update public.module_permissions m set enabled = false, updated_at = now()
--    where m.org_id is null
--      and (m.role, m.module_key) in (('Workshop Supervisor', 'work_orders'), ('Workshop Supervisor', 'workshop_live'),
--                                     ('Maintenance Supervisor', 'work_orders'), ('Maintenance Supervisor', 'workshop_live'),
--                                     ('Workshop Area Manager', 'workshop_live'));
--   update public.module_permissions m set enabled = b.enabled
--     from _bak.wo3_module_permissions_20261115 b where b.id = m.id;
--   commit;

begin;

create schema if not exists _bak;
create table if not exists _bak.wo3_module_permissions_20261115 as
  select m.* from public.module_permissions m
   where m.org_id is null
     and (m.role, m.module_key) in (('Workshop Supervisor', 'work_orders'), ('Workshop Supervisor', 'workshop_live'),
                                    ('Maintenance Supervisor', 'work_orders'), ('Maintenance Supervisor', 'workshop_live'),
                                    ('Workshop Area Manager', 'workshop_live'));
revoke all on _bak.wo3_module_permissions_20261115 from public, anon, authenticated;

insert into public.module_permissions (role, module_key, org_id, enabled)
values ('Workshop Supervisor', 'work_orders', null, true),
       ('Workshop Supervisor', 'workshop_live', null, true),
       ('Maintenance Supervisor', 'work_orders', null, true),
       ('Maintenance Supervisor', 'workshop_live', null, true),
       ('Workshop Area Manager', 'workshop_live', null, true)
on conflict (role, module_key, (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)))
do update set enabled = true, updated_at = now();

commit;
