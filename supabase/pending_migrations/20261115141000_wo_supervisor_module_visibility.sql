-- WO-3: workshop supervisors can open Work Orders and Workshop Live Control, and technicians can
--       open their own assigned jobs on the web.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15 from the LIVE public.module_permissions rows
--         (read only). Applied only to a private copy of the local staging database by
--         supabase/tests/staging_work_order_permissions.sh. NEEDS THE OWNER'S YES.
--
-- DEPENDS ON: 20261115140000 and 20261115140500 (the rights). This file is only the menu and
--   route switch (the "view" capability). Without it the supervisors hold the rights but the web
--   sidebar and the route guards still hide both screens from them. The web change that goes with
--   it (src/lib/checklistAccess.js) lets the two checklist-only supervisor roles reach the two
--   routes; the database remains the boundary for every write.
--
-- WHAT IT WRITES (module_permissions, built-in rows, org_id null)
--   Workshop Supervisor     work_orders = true, workshop_live = true     (no row today for either)
--   Maintenance Supervisor  work_orders = true, workshop_live = true     (no row today for either)
--   Workshop Area Manager   workshop_live = true                         (work_orders already true)
--   Tyre Man and the 21 workshop trade roles seeded as technicians in 20261115140000
--                           work_orders = true    (Tyre Man has a row today, switched off; the trade
--                                                  roles have no row). Owner decision 2026-11-15
--                           round 2: technicians work on their ASSIGNED jobs through web and mobile.
--                           This is the "view" switch only. On the web it opens the My Jobs screen
--                           (/my-jobs: the person's own assigned jobs); /work-orders sends them
--                           there. What they may WRITE is decided by work_order_can: progress on a
--                           job assigned to them, nothing else. Workshop Live Control stays closed.
--   Workshop Maintenance Area Manager already has both. Nothing else is touched: no mobile key,
--   no other role, no other module. Rows that already exist are copied to
--   _bak.wo3_module_permissions_20261115 before being changed (on production today: one, the
--   Tyre Man work_orders row, enabled = false).
--
-- WHO GAINS: Workshop Supervisor 7 and Maintenance Supervisor 1 (approved accounts) see Work Orders
--   and Workshop Live Control on the web. Tyre Man 17 and 38 trade accounts can open My Jobs.
--   Loses: nobody.
--
-- NOTE: every company also stores a per-company switch list in organisations.settings (Access
--   Control overrides) with work_orders create and edit = false for Tyre Man. That list is NOT
--   changed here and no longer decides for a role that has a work order rule (20261115140000,
--   precedence step 8).
--
-- VERIFY (rolled back, after applying)
--   begin;
--   select role, module_key, enabled from public.module_permissions
--    where org_id is null and module_key in ('work_orders', 'workshop_live')
--      and role in ('Workshop Supervisor', 'Maintenance Supervisor', 'Workshop Area Manager')
--    order by 1, 2;                                                    -- 5 rows, all true
--   select count(*) from public.module_permissions where org_id is null and module_key = 'work_orders'
--      and enabled and role in ('Tyre Man', 'Mechanic', 'Welder', 'Helper PMV');          -- 4
--   rollback;
--
-- ROLLBACK
--   begin;
--   update public.module_permissions m set enabled = false, updated_at = now()
--    where m.org_id is null
--      and (m.role, m.module_key) in (('Workshop Supervisor', 'work_orders'), ('Workshop Supervisor', 'workshop_live'),
--                                     ('Maintenance Supervisor', 'work_orders'), ('Maintenance Supervisor', 'workshop_live'),
--                                     ('Workshop Area Manager', 'workshop_live'));
--   update public.module_permissions m set enabled = false, updated_at = now()
--    where m.org_id is null and m.module_key = 'work_orders'
--      and lower(btrim(m.role)) in (select lower(btrim(r.role)) from public.work_order_role_rules r
--                                    where r.organisation_id is null and r.scope = 'assigned'
--                                      and r.actions = array['progress']);
--   update public.module_permissions m set enabled = b.enabled
--     from _bak.wo3_module_permissions_20261115 b where b.id = m.id;
--   commit;

begin;

create schema if not exists _bak;
create table if not exists _bak.wo3_module_permissions_20261115 as
  select m.* from public.module_permissions m
   where m.org_id is null
     and ((m.role, m.module_key) in (('Workshop Supervisor', 'work_orders'), ('Workshop Supervisor', 'workshop_live'),
                                    ('Maintenance Supervisor', 'work_orders'), ('Maintenance Supervisor', 'workshop_live'),
                                    ('Workshop Area Manager', 'workshop_live'))
          or (m.module_key = 'work_orders' and m.role in (
                'Tyre Man', 'Mechanic',
                'Electrician',
                'Diesel Mechanic',
                'Plant Mechanic',
                'Assistant Plant Mechanic',
                'Hydraulic Mechanic',
                'Auto Electrician',
                'Plant Electrician',
                'Senior Technician',
                'Senior Plant Technician',
                'Senior Plant & Chiller Technician',
                'Ice Plant Technician',
                'Welder',
                'Welder Cum Fabricator',
                'Painter',
                'Denter',
                'Concrete Breaker',
                'Helper Workshop',
                'Helper Plant',
                'Helper PMV',
                'Helper Ice Plant')));
revoke all on _bak.wo3_module_permissions_20261115 from public, anon, authenticated;

insert into public.module_permissions (role, module_key, org_id, enabled)
values ('Workshop Supervisor', 'work_orders', null, true),
       ('Workshop Supervisor', 'workshop_live', null, true),
       ('Maintenance Supervisor', 'work_orders', null, true),
       ('Maintenance Supervisor', 'workshop_live', null, true),
       ('Workshop Area Manager', 'workshop_live', null, true),
       ('Tyre Man', 'work_orders', null, true),
       ('Mechanic', 'work_orders', null, true),
       ('Electrician', 'work_orders', null, true),
       ('Diesel Mechanic', 'work_orders', null, true),
       ('Plant Mechanic', 'work_orders', null, true),
       ('Assistant Plant Mechanic', 'work_orders', null, true),
       ('Hydraulic Mechanic', 'work_orders', null, true),
       ('Auto Electrician', 'work_orders', null, true),
       ('Plant Electrician', 'work_orders', null, true),
       ('Senior Technician', 'work_orders', null, true),
       ('Senior Plant Technician', 'work_orders', null, true),
       ('Senior Plant & Chiller Technician', 'work_orders', null, true),
       ('Ice Plant Technician', 'work_orders', null, true),
       ('Welder', 'work_orders', null, true),
       ('Welder Cum Fabricator', 'work_orders', null, true),
       ('Painter', 'work_orders', null, true),
       ('Denter', 'work_orders', null, true),
       ('Concrete Breaker', 'work_orders', null, true),
       ('Helper Workshop', 'work_orders', null, true),
       ('Helper Plant', 'work_orders', null, true),
       ('Helper PMV', 'work_orders', null, true),
       ('Helper Ice Plant', 'work_orders', null, true)
on conflict (role, module_key, (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)))
do update set enabled = true, updated_at = now();

commit;
