-- Synthetic fixture for the closure workflow staging tests. Invented people, sites and
-- sheets only. Loaded BEFORE the drafts are applied, so the "existing rows unchanged"
-- check has rows to compare. Never run against production (run_staging.sh refuses).
\set ON_ERROR_STOP 1
begin;
insert into public.custom_roles (organisation_id, name, description, active)
select o, r, 'Synthetic role for closure tests', true
  from (values ('00000000-0000-0000-0000-000000000001'::uuid), ('bbbbbbbb-0000-4000-8000-000000000002'::uuid)) org(o),
       (values ('Tyre Data Collector'), ('Workshop Supervisor'), ('Workshop Maintenance Area Manager')) role(r)
 where not exists (select 1 from public.custom_roles c where c.name = r and c.organisation_id = o);

create temp table clo_users (id uuid, username text, role text, org uuid, country text, sites text[]) on commit drop;
insert into clo_users values
 ('c1000000-0000-4000-8000-000000000001','clo.collector','Tyre Data Collector','00000000-0000-0000-0000-000000000001','KSA','{ALL}'),
 ('c1000000-0000-4000-8000-000000000002','clo.collector2','Tyre Data Collector','00000000-0000-0000-0000-000000000001','KSA','{ALL}'),
 ('c1000000-0000-4000-8000-000000000003','clo.sup.north','Workshop Supervisor','00000000-0000-0000-0000-000000000001','KSA','{ALPHA NORTH PLANT}'),
 ('c1000000-0000-4000-8000-000000000004','clo.sup.east','Workshop Supervisor','00000000-0000-0000-0000-000000000001','KSA','{ALPHA EAST PLANT}'),
 ('c1000000-0000-4000-8000-000000000005','clo.areamgr','Workshop Maintenance Area Manager','00000000-0000-0000-0000-000000000001','KSA','{ALL}'),
 ('c1000000-0000-4000-8000-000000000006','clo.sup.uae','Workshop Supervisor','00000000-0000-0000-0000-000000000001','UAE','{ALL}'),
 ('c1000000-0000-4000-8000-000000000007','clo.beta.sup','Workshop Supervisor','bbbbbbbb-0000-4000-8000-000000000002','KSA','{ALL}');

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       username || '@staging.tyrepulse.invalid', now(), now() from clo_users;
alter table public.profiles disable trigger user;
insert into public.profiles (id, username) select id, username from clo_users on conflict (id) do nothing;
update public.profiles p set username = u.username, full_name = 'Test ' || u.username, role = u.role, region = u.country,
       country = array[u.country], countries = array[u.country], org_id = u.org, organisation_id = u.org,
       approved = true, locked = false, is_super_admin = false, sites = u.sites, web_access = true,
       email = u.username || '@staging.tyrepulse.invalid'
  from clo_users u where p.id = u.id;
alter table public.profiles enable trigger user;

-- Templates: a two-signature daily sheet and a single-signature one, both with a "Not OK" blocking mark.
insert into public.checklist_templates (id, organisation_id, country, name, status, require_approval, require_area_manager, fields, option_sets, created_by)
values
 ('c2000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','KSA','Synthetic Workshop Daily','published',true,true,
  '[{"id":"f1","label":"Brakes","type":"select"},{"id":"f2","label":"Mirrors","type":"select"},{"id":"f3","label":"Seat belts","type":"select"}]',
  '{"legend":{"blocking":["Not OK"]}}','af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'),
 ('c2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001','KSA','Synthetic Single Sign','published',true,false,
  '[{"id":"g1","label":"Horn","type":"select"},{"id":"g2","label":"Lights","type":"select"}]',
  '{"legend":{"blocking":["Not OK"]}}','af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'),
 ('c2000000-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000002','KSA','Synthetic Beta Daily','published',true,true,
  '[{"id":"f1","label":"Brakes","type":"select"}]','{"legend":{"blocking":["Not OK"]}}','9c149942-c3b2-54c6-a6e8-c34b2933bb3c');

insert into public.checklist_submissions
 (id, organisation_id, template_id, template_name, country, site, asset_no, answers, submitted_by, approval_status,
  supervisor_by, supervisor_name, supervisor_signature, supervisor_at, approved_by, approver_name, approver_signature, approved_at, locked)
values
 -- S1 two-stage, waiting for the first signature, one fault
 ('c3000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic Workshop Daily','KSA','ALPHA NORTH PLANT','TM001',
  '{"f1":"Not OK","f2":"OK","f3":"OK"}','c1000000-0000-4000-8000-000000000003','pending',null,null,null,null,null,null,null,null,false),
 -- S2 two-stage, clean
 ('c3000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic Workshop Daily','KSA','ALPHA NORTH PLANT','TM004',
  '{"f1":"OK","f2":"OK","f3":"OK"}','c1000000-0000-4000-8000-000000000003','pending',null,null,null,null,null,null,null,null,false),
 -- S3 two-stage, supervisor signed, two faults
 ('c3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic Workshop Daily','KSA','ALPHA NORTH PLANT','TM001',
  '{"f1":"Not OK","f2":"Not OK","f3":"OK"}','c1000000-0000-4000-8000-000000000001','pending_area_manager',
  'c1000000-0000-4000-8000-000000000003','Test clo.sup.north','sig-first',now() - interval '20 days',null,null,null,null,false),
 -- S4 historical approved, clean
 ('c3000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic Workshop Daily','KSA','ALPHA NORTH PLANT','TM004',
  '{"f1":"OK","f2":"OK","f3":"OK"}','c1000000-0000-4000-8000-000000000003','approved',
  'c1000000-0000-4000-8000-000000000005','Test clo.areamgr','sig',now() - interval '60 days','c1000000-0000-4000-8000-000000000005','Test clo.areamgr','sig',now() - interval '60 days',true),
 -- S5 historical approved that still carries a mark (approved before the blocking rule existed)
 ('c3000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic Workshop Daily','KSA','ALPHA NORTH PLANT','TM001',
  '{"f1":"OK","f2":"OK","f3":"Not OK"}','c1000000-0000-4000-8000-000000000003','approved',
  'c1000000-0000-4000-8000-000000000005','Test clo.areamgr','sig',now() - interval '90 days','c1000000-0000-4000-8000-000000000005','Test clo.areamgr','sig',now() - interval '90 days',true),
 -- S6 single-signature sheet at another site, one fault
 ('c3000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000001','c2000000-0000-4000-8000-000000000002','Synthetic Single Sign','KSA','ALPHA EAST PLANT','TM007',
  '{"g1":"Not OK","g2":"OK"}','c1000000-0000-4000-8000-000000000001','pending',null,null,null,null,null,null,null,null,false),
 -- S7 another company
 ('c3000000-0000-4000-8000-000000000007','bbbbbbbb-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003','Synthetic Beta Daily','KSA','BETA DEPOT ONE','BT001',
  '{"f1":"Not OK"}','c1000000-0000-4000-8000-000000000007','pending',null,null,null,null,null,null,null,null,false),
 -- S8 two-stage with a fault, submitted by the area manager (self-acknowledge case)
 ('c3000000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic Workshop Daily','KSA','ALPHA NORTH PLANT','TM004',
  '{"f1":"OK","f2":"Not OK","f3":"OK"}','c1000000-0000-4000-8000-000000000005','pending',null,null,null,null,null,null,null,null,false);

-- Manual corrective actions (the checklist ones are raised by the existing trigger above).
insert into public.corrective_actions (id, organisation_id, title, priority, status, site, country, region, asset_no, tyre_serial, created_by, closed_by, closed_at, source_type)
values
 ('c4000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','Synthetic: replace worn tyre','High','Open','ALPHA NORTH PLANT','KSA','KSA','TM001','SYN-0001','af52a86f-2c24-5ce2-a00d-7ac6ca5d715f',null,null,'manual'),
 ('c4000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001','Synthetic: check pressure','Medium','In Progress','ALPHA EAST PLANT','KSA','KSA','TM007',null,'c1000000-0000-4000-8000-000000000001',null,null,'manual'),
 ('c4000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000001','Synthetic: closed long ago','Low','Closed','ALPHA NORTH PLANT','KSA','KSA','TM004',null,'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f','af52a86f-2c24-5ce2-a00d-7ac6ca5d715f',now() - interval '40 days','manual'),
 ('c4000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000001','Synthetic: UAE action','Medium','Open','ALPHA COAST PLANT','UAE','UAE','TM002',null,'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f',null,null,'manual'),
 ('c4000000-0000-4000-8000-000000000005','bbbbbbbb-0000-4000-8000-000000000002','Synthetic: Beta action','Medium','Open','BETA DEPOT ONE','KSA','KSA','BT001',null,'9c149942-c3b2-54c6-a6e8-c34b2933bb3c',null,null,'manual'),
 ('c4000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000001','Synthetic: second north action','Medium','Open','ALPHA NORTH PLANT','KSA','KSA','TM004',null,'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f',null,null,'manual');

-- Assign through the Action Center mirror, as the product does.
update public.action_items set assigned_user_id = 'c1000000-0000-4000-8000-000000000001', assigned_to = 'Test clo.collector'
 where source in ('corrective:c4000000-0000-4000-8000-000000000001','corrective:c4000000-0000-4000-8000-000000000004','corrective:c4000000-0000-4000-8000-000000000005');
update public.action_items set assigned_user_id = 'c1000000-0000-4000-8000-000000000003', assigned_to = 'Test clo.sup.north'
 where source = 'corrective:c4000000-0000-4000-8000-000000000006';
commit;
select 'fixture: actions=' || (select count(*) from public.corrective_actions) || ' sheets=' || (select count(*) from public.checklist_submissions)
    || ' mirrors=' || (select count(*) from public.action_items where source like 'corrective:%');
