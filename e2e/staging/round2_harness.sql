-- Round 2 browser tests: extra synthetic people and state, applied ONLY to the e2e database COPY
-- (never to staging or production). Invented people. The password arrives as the psql variable
-- :pw from round2_setup.sh, which generates it per run and keeps it outside the repository.
\set ON_ERROR_STOP 1
begin;

insert into public.custom_roles (organisation_id, name, description, active)
select '00000000-0000-0000-0000-000000000001', r, 'Synthetic role for round 2 browser tests', true
  from (values ('Tire Planning Engineer'), ('Mechanic')) v(r)
 where not exists (select 1 from public.custom_roles c where c.name = v.r and c.organisation_id = '00000000-0000-0000-0000-000000000001');

create temp table r2_users (id uuid, username text, role text, country text, sites text[]) on commit drop;
insert into r2_users values
 ('d1000000-0000-4000-8000-000000000001', 'r2.tpe',      'Tire Planning Engineer', 'KSA', '{ALL}'),
 ('d1000000-0000-4000-8000-000000000002', 'r2.mechanic', 'Mechanic',               'KSA', '{ALPHA NORTH PLANT}'),
 ('d1000000-0000-4000-8000-000000000003', 'r2.sup.all',  'Workshop Supervisor',    'KSA', '{ALL}');

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       username || '@staging.tyrepulse.invalid', now(), now() from r2_users;
alter table public.profiles disable trigger user;
insert into public.profiles (id, username) select id, username from r2_users on conflict (id) do nothing;
update public.profiles p set username = u.username, full_name = 'Test ' || u.username, role = u.role, region = u.country,
       country = array[u.country], countries = array[u.country],
       org_id = '00000000-0000-0000-0000-000000000001', organisation_id = '00000000-0000-0000-0000-000000000001',
       approved = true, locked = false, is_super_admin = false, sites = u.sites, web_access = true,
       email = u.username || '@staging.tyrepulse.invalid'
  from r2_users u where p.id = u.id;
alter table public.profiles enable trigger user;

-- Sign-in for the round 2 people and for the closure fixture people (clo.*), who were created without a password.
update auth.users u set encrypted_password = extensions.crypt(:'pw', extensions.gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now())
 where u.email like 'r2.%@staging.tyrepulse.invalid' or u.email like 'clo.%@staging.tyrepulse.invalid';

-- Module switches in the shape production holds today for these roles (role rows only, no data):
-- Tire Planning Engineer and Tyre Data Collector have Work Orders and Corrective Actions on;
-- the collector also has Checklists and Live Control on. Mechanic has no row (as on production).
insert into public.module_permissions (module_key, role, org_id, enabled)
select v.k, v.r, null, true from (values
  ('work_orders', 'Tire Planning Engineer'), ('corrective_actions', 'Tire Planning Engineer'),
  ('work_orders', 'Tyre Data Collector'), ('corrective_actions', 'Tyre Data Collector'),
  ('checklists', 'Tyre Data Collector'), ('workshop_live', 'Tyre Data Collector')) v(k, r)
 where not exists (select 1 from public.module_permissions m where m.module_key = v.k and m.role = v.r and m.org_id is null);

-- Alpha's Access Control matrix in the shape production stores it: collectors may create and edit work orders.
update public.organisations
   set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{app_settings}',
         coalesce(settings -> 'app_settings', '{}'::jsonb) || jsonb_build_object('permission_overrides',
           '{"version":1,"overrides":{"Tyre Data Collector":{"work_orders":{"create":true,"edit":true}}}}'))
 where id = '00000000-0000-0000-0000-000000000001';

-- Work order state for the browser cases (triggers off: this is fixture setup, not an app path).
set local session_replication_role = replica;
-- R2-APPROVED: an open North job whose cost carries an execution approval.
insert into public.approval_execution_requests (id, organisation_id, entity_type, work_order_id, asset_no, title, payload, source_snapshot, operation_id, submitted_by, approval_status, status)
select 'd2000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'work_order', w.id, w.asset_no, 'Synthetic approved scope',
       '{}'::jsonb, '{}'::jsonb, gen_random_uuid(), (select id from public.profiles where username = 'alpha.admin'), 'approved', 'executed'
  from (select id, asset_no from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA'
          and site = 'ALPHA NORTH PLANT' and status = 'Waiting for Parts' order by id limit 1) w;
update public.work_orders set execution_approval_id = 'd2000000-0000-4000-8000-0000000000e1', parts_cost = 100, description = 'R2-APPROVED synthetic approved cost'
 where id = (select work_order_id from public.approval_execution_requests where id = 'd2000000-0000-4000-8000-0000000000e1');
-- R2-ASSIGNED: the one In Progress North job, assigned to the Tyre Man and the Mechanic.
update public.work_orders set description = 'R2-ASSIGNED synthetic assigned job',
       assigned_owner_id = (select id from public.profiles where username = 'alpha.tyreman')
 where id = (select id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA'
               and site = 'ALPHA NORTH PLANT' and status = 'In Progress' order by id limit 1);
insert into public.wo_assignments (job_id, user_id, role, active, organisation_id, country, site)
select w.id, p.id, case when p.username = 'alpha.tyreman' then 'primary' else 'helper' end, true, '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA NORTH PLANT'
  from public.work_orders w, public.profiles p
 where w.description = 'R2-ASSIGNED synthetic assigned job' and p.username in ('alpha.tyreman', 'r2.mechanic');
-- R2-TYRE: an open North job that is tyre work; R2-EAST: an open East job (other site for the North supervisor).
update public.work_orders set work_type = 'Tyre Change', description = 'R2-TYRE synthetic tyre job'
 where id = (select id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA'
               and site = 'ALPHA NORTH PLANT' and status = 'Open' order by id limit 1);
update public.work_orders set description = 'R2-GENERAL synthetic general job'
 where id = (select id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA'
               and site = 'ALPHA NORTH PLANT' and status = 'Open' order by id offset 1 limit 1);
update public.work_orders set description = 'R2-EAST synthetic east job'
 where id = (select id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA'
               and site = 'ALPHA EAST PLANT' and status = 'In Progress' order by id limit 1);
update public.work_orders set description = 'R2-CLOSED synthetic closed job'
 where id = (select id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA'
               and site = 'ALPHA NORTH PLANT' and status = 'Completed' order by opened_at desc, id limit 1);
-- R2-QC: a North job waiting for its quality check. R2-PARTS: a North job that carries a parts cost but no parts lines.
update public.work_orders set status = 'Quality Inspection', description = 'R2-QC synthetic quality check job'
 where id = (select id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA'
               and site = 'ALPHA NORTH PLANT' and status = 'Waiting for Parts' and description not like 'R2-%' order by id limit 1);
update public.work_orders set parts_cost = 250, parts_used = '[]'::jsonb, description = 'R2-PARTS synthetic parts cost job'
 where id = (select id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA'
               and site = 'ALPHA NORTH PLANT' and status = 'Waiting for Parts' and description not like 'R2-%' order by id limit 1);
set local session_replication_role = origin;
commit;

-- Checklist fixture shape: the closure fixture's fields carry no `options_ref`, which the database rule does not
-- need but the screen does (real templates answer against the shared legend). Give the synthetic templates and the
-- snapshots of their sheets the same shape real templates have, so the browser sees the fault the database sees.
begin;
set local session_replication_role = replica;
create temp table r2_fix on commit drop as
select t.id,
       (select jsonb_agg(f || '{"options_ref":"legend","options":["OK","Not OK","Repaired"]}'::jsonb order by ord) from jsonb_array_elements(t.fields) with ordinality x(f, ord)) as fields,
       jsonb_set(t.option_sets, '{legend,options}', '["OK","Not OK","Repaired"]'::jsonb) as option_sets
  from public.checklist_templates t where t.id::text like 'c2000000-%';
update public.checklist_templates t set fields = f.fields, option_sets = f.option_sets from r2_fix f where f.id = t.id;
update public.checklist_submissions s
   set template_snapshot = s.template_snapshot || jsonb_build_object('fields', f.fields, 'option_sets', f.option_sets)
  from r2_fix f where f.id = s.template_id and s.template_snapshot is not null;
update public.checklist_template_revisions r
   set snapshot = r.snapshot || jsonb_build_object('fields', f.fields, 'option_sets', f.option_sets)
  from r2_fix f where f.id = r.template_id;
set local session_replication_role = origin;
commit;

select 'round2 harness: people=' || (select count(*) from public.profiles where username like 'r2.%' or username like 'clo.%')
    || ' marked work orders=' || (select count(*) from public.work_orders where description like 'R2-%');
