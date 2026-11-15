-- Role matrix for the work order permission drafts (WO-1 to WO-4), run on a private copy of the
-- LOCAL staging database only (synthetic companies Alpha, Beta, Gamma). Never run on production.
-- Driver: supabase/tests/staging_work_order_permissions.sh
--
-- Every case runs as a signed-in synthetic person inside a sub-transaction that is rolled back, so
-- the cases do not affect each other and the stored work orders end exactly as they started (the
-- driver hashes the table before and after).
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

begin;

-- ── synthetic people (inserted with triggers off: this is a test fixture, not an app path) ─────
set local session_replication_role = replica;
insert into public.profiles (id, org_id, organisation_id, role, country, sites, approved, locked, is_super_admin, full_name, username)
select v.id::uuid, v.org::uuid, v.org2::uuid, v.role, v.country::text[], v.sites::text[], v.approved, v.locked, v.sup, v.full_name, 'syn_wo_' || right(v.id, 2)
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Workshop Supervisor',               '{KSA}', '{ALL}',               true, false, false, 'Synthetic Supervisor All'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Workshop Supervisor',               '{KSA}', '{ALPHA NORTH PLANT}', true, false, false, 'Synthetic Supervisor North'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Maintenance Supervisor',            '{KSA}', '{ALPHA NORTH PLANT}', true, false, false, 'Synthetic Maintenance Supervisor'),
  ('aaaaaaaa-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Workshop Maintenance Area Manager', '{KSA}', '{ALL}',               true, false, false, 'Synthetic Area Manager'),
  ('aaaaaaaa-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Mechanic',                          '{KSA}', '{ALPHA NORTH PLANT}', true, false, false, 'Synthetic Mechanic'),
  ('aaaaaaaa-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Tyre Data Collector',               '{KSA}', '{ALL}',               true, false, false, 'Synthetic Collector'),
  ('aaaaaaaa-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Manager',                           '{KSA}', '{ALL}',               true, false, false, 'Synthetic Revoked Manager'),
  ('aaaaaaaa-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Workshop Supervisor',               '{KSA}', '{ALL}',               true, true,  false, 'Synthetic Locked Supervisor'),
  ('aaaaaaaa-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Store Keeper',                      '{KSA}', '{ALL}',               true, false, false, 'Synthetic Granted Store Keeper'),
  ('aaaaaaaa-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Electrician',                       '{KSA}', '{ALL}',               true, false, false, 'Synthetic Electrician'),
  ('aaaaaaaa-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Welder',                            '{KSA}', '{ALL}',               true, false, false, 'Synthetic Granted Welder')
) v(id, org, org2, role, country, sites, approved, locked, sup, full_name);
set local session_replication_role = origin;

-- Alpha's Access Control matrix in the shape production stores it (a JSON string inside jsonb).
update public.organisations
   set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{app_settings}',
         coalesce(settings -> 'app_settings', '{}'::jsonb) || jsonb_build_object('permission_overrides',
           '{"version":1,"overrides":{"Tyre Data Collector":{"work_orders":{"create":true,"edit":true,"export":true,"approve":true}},"Tyre Man":{"work_orders":{"create":false,"edit":false}}}}'))
 where id = '00000000-0000-0000-0000-000000000001';

-- Production holds the Work Orders menu switch for the collector role; staging does not.
insert into public.module_permissions (role, module_key, org_id, enabled)
select 'Tyre Data Collector', 'work_orders', null, true
 where not exists (select 1 from public.module_permissions
                    where org_id is null and role = 'Tyre Data Collector' and module_key = 'work_orders');

insert into public.user_access_grants (user_id, module_key, capability, effect, org_id)
select v.uid::uuid, 'work_orders', v.cap, v.effect, '00000000-0000-0000-0000-000000000001'
  from (values ('aaaaaaaa-0000-4000-8000-000000000007', 'edit', 'revoke'),
               ('aaaaaaaa-0000-4000-8000-000000000009', 'edit', 'grant'),
               ('aaaaaaaa-0000-4000-8000-000000000011', 'edit', 'grant')) v(uid, cap, effect);

-- Beta switches assigning OFF for its Managers with a company rule row.
insert into public.work_order_role_rules (organisation_id, role, actions, scope, note)
values ('bbbbbbbb-0000-4000-8000-000000000002', 'Manager', array['create', 'edit', 'progress'], 'all', 'test: Beta override');

-- ── named actors and work orders ─────────────────────────────────────────────────────────────
create temp table actor (name text primary key, id uuid) on commit drop;
insert into actor
select 'admin',     id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' and role = 'Admin' and not is_super_admin limit 1;
insert into actor select 'super', id from public.profiles where is_super_admin limit 1;
insert into actor select 'manager', id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' and role = 'Manager' and id::text not like 'aaaaaaaa%' limit 1;
insert into actor select 'director', id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' and role = 'Director' limit 1;
insert into actor select 'engineer', id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' and role = 'Tyre Engineer' limit 1;
insert into actor select 'tyreman', id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' and role = 'Tyre Man' limit 1;
insert into actor select 'inspector', id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' and role = 'Inspector' limit 1;
insert into actor select 'driver', id from public.profiles where org_id = '00000000-0000-0000-0000-000000000001' and role = 'Driver' limit 1;
insert into actor select 'beta_manager', id from public.profiles where org_id = 'bbbbbbbb-0000-4000-8000-000000000002' and role = 'Manager' limit 1;
insert into actor values
  ('sup_all',   'aaaaaaaa-0000-4000-8000-000000000001'), ('sup_north', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('maint_sup', 'aaaaaaaa-0000-4000-8000-000000000003'), ('area_mgr',  'aaaaaaaa-0000-4000-8000-000000000004'),
  ('mechanic',  'aaaaaaaa-0000-4000-8000-000000000005'), ('collector', 'aaaaaaaa-0000-4000-8000-000000000006'),
  ('revoked',   'aaaaaaaa-0000-4000-8000-000000000007'), ('locked',    'aaaaaaaa-0000-4000-8000-000000000008'),
  ('granted',   'aaaaaaaa-0000-4000-8000-000000000009'), ('electrician', 'aaaaaaaa-0000-4000-8000-000000000010'),
  ('granted_tech', 'aaaaaaaa-0000-4000-8000-000000000011');
-- The seeded engineer works in the UAE; give the seeded Tyre Man and Manager the whole of KSA.

create temp table wo (name text primary key, id uuid) on commit drop;
insert into wo select 'open_north', id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA NORTH PLANT' and status = 'In Progress' order by id limit 1;
insert into wo select 'open_north2', id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA NORTH PLANT' and status in ('Open', 'Waiting for Parts') order by id limit 1;
insert into wo select 'closed_north', id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA NORTH PLANT' and status = 'Completed' order by id limit 1;
insert into wo select 'open_east', id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA EAST PLANT' and status <> 'Completed' order by id limit 1;
insert into wo select 'open_uae', id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'UAE' and status <> 'Completed' order by id limit 1;
insert into wo select 'tyre_uae', id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'UAE' and status <> 'Completed' order by id offset 1 limit 1;
insert into wo select 'approved_north', id from public.work_orders where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA NORTH PLANT' and status <> 'Completed' order by id desc limit 1;
insert into wo select 'open_beta', id from public.work_orders where organisation_id = 'bbbbbbbb-0000-4000-8000-000000000002' and country = 'KSA' and status <> 'Completed' order by id limit 1;
do $$ begin
  if (select count(*) from wo) <> 8 or (select count(*) from actor) <> 20
     or (select count(distinct id) from wo) <> 8 then
    raise exception 'fixture incomplete: % work orders, % actors', (select count(*) from wo), (select count(*) from actor);
  end if;
end $$;

-- Fixture state on those rows (triggers off so the guards under test are not what sets it up).
set local session_replication_role = replica;
update public.work_orders set work_type = 'Tyre Change' where id = (select id from wo where name = 'tyre_uae');
insert into public.approval_execution_requests (id, organisation_id, entity_type, work_order_id, asset_no, title, payload, source_snapshot, operation_id, submitted_by, approval_status, status)
values ('aaaaaaaa-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'work_order', (select id from wo where name = 'approved_north'), 'TST1', 'Synthetic approved scope',
        '{}'::jsonb, '{}'::jsonb, gen_random_uuid(), (select id from actor where name = 'admin'), 'approved', 'executed');
update public.work_orders set execution_approval_id = 'aaaaaaaa-0000-4000-8000-0000000000e1', parts_cost = 100
 where id = (select id from wo where name = 'approved_north');
insert into public.wo_assignments (job_id, user_id, role, active, organisation_id, country, site)
select (select id from wo where name = 'open_north'), (select id from actor where name = 'tyreman'), 'primary', true,
       '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA NORTH PLANT';
-- The collector is assigned to the East plant job (and to nothing else).
insert into public.wo_assignments (job_id, user_id, role, active, organisation_id, country, site)
select (select id from wo where name = 'open_east'), 'aaaaaaaa-0000-4000-8000-000000000006', 'primary', true,
       '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA EAST PLANT';
insert into public.wo_tasks (id, job_id, title, status, assignee_user_id, organisation_id, country, site)
values ('aaaaaaaa-0000-4000-8000-0000000000f1', (select id from wo where name = 'open_north2'), 'Synthetic task', 'pending',
        'aaaaaaaa-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA NORTH PLANT');
set local session_replication_role = origin;

-- ── harness ──────────────────────────────────────────────────────────────────────────────────
create temp table result (n serial, actor text, what text, want text, got text) on commit drop;
grant all on result, actor, wo to authenticated;

create function pg_temp.try(p_actor text, p_sql text) returns text language plpgsql as $f$
declare v_uid uuid; n bigint; r text;
begin
  if p_actor is not null then
    select id into strict v_uid from actor where name = p_actor;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  else
    perform set_config('request.jwt.claims', '', true);   -- no signed-in user: service role / pipe
  end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
    raise exception using errcode = 'T0000', message = 'ok:' || n;   -- undo the case
  exception
    when sqlstate 'T0000' then r := sqlerrm;
    when others then r := 'err:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

create function pg_temp.id(p text) returns uuid language sql as $f$ select id from wo where name = p $f$;
create function pg_temp.who(p text) returns uuid language sql as $f$ select id from actor where name = p $f$;

create function pg_temp.sql_for(p_what text, p_actor text) returns text language sql as $f$
  select case
    when p_what like 'create:%' then format(
      $q$insert into public.work_orders (work_order_no, asset_no, organisation_id, country, site, status, work_type)
         values ('T-' || left(gen_random_uuid()::text, 8), 'TST1', %L, %L, nullif(%L, ''), 'New', %L)$q$,
      case split_part(p_what, ':', 2) when 'beta' then 'bbbbbbbb-0000-4000-8000-000000000002' else '00000000-0000-0000-0000-000000000001' end,
      case split_part(p_what, ':', 2) when 'uae' then 'UAE' when 'uae_tyre' then 'UAE' else 'KSA' end,
      case split_part(p_what, ':', 2) when 'north' then 'ALPHA NORTH PLANT' when 'east' then 'ALPHA EAST PLANT'
           when 'uae' then 'ALPHA COAST PLANT' when 'uae_tyre' then 'ALPHA COAST PLANT' when 'beta' then 'BETA DEPOT ONE' else '' end,
      case split_part(p_what, ':', 2) when 'uae_tyre' then 'Tyre Change' else 'Repair' end)
    when p_what like 'edit:%'     then format('update public.work_orders set description = ''t'' where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'progress:%' then format('update public.work_orders set status = ''Waiting for Parts'', notes = ''t'' where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'complete:%' then format('update public.work_orders set status = ''Completed'', completed_at = now() where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'toqc:%'     then format('update public.work_orders set status = ''Quality Inspection'' where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'close:%'    then format('update public.work_orders set status = ''Closed'' where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'qcpass:%'   then format('update public.work_orders set status = ''Completed'', qc_status = ''passed'' where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'cancel:%'   then format('update public.work_orders set status = ''Cancelled'' where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'owner:%'    then format('update public.work_orders set assigned_owner_id = %L, status = ''Assigned'' where id = %L', pg_temp.who('mechanic'), pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'qc:%'       then format('update public.work_orders set qc_status = ''passed'' where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'cost:%'     then format('update public.work_orders set parts_cost = 55 where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'move:%'     then format('update public.work_orders set site = ''ALPHA EAST PLANT'' where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'rehome:%'   then format('update public.work_orders set organisation_id = ''bbbbbbbb-0000-4000-8000-000000000002'' where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'delete:%'   then format('delete from public.work_orders where id = %L', pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'assign:%'   then format(
      $q$insert into public.wo_assignments (job_id, user_id, organisation_id, country, site)
         select w.id, %L, w.organisation_id, w.country, w.site from public.work_orders w where w.id = %L$q$,
      pg_temp.who('mechanic'), pg_temp.id(split_part(p_what, ':', 2)))
    when p_what like 'event:%'    then format(
      $q$insert into public.tech_activity_events (user_id, job_id, event_type, organisation_id, country, site)
         values (%L, %L, 'start_job', '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA NORTH PLANT')$q$,
      pg_temp.who(p_actor), pg_temp.id(split_part(p_what, ':', 2)))
    when p_what = 'checkin'       then format(
      $q$insert into public.tech_activity_events (user_id, event_type, organisation_id, country, site)
         values (%L, 'check_in', '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA NORTH PLANT')$q$, pg_temp.who(p_actor))
    when p_what = 'event_other'   then format(
      $q$insert into public.tech_activity_events (user_id, event_type, organisation_id, country, site)
         values (%L, 'pause_job', '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA NORTH PLANT')$q$, pg_temp.who('mechanic'))
    when p_what = 'task_status'   then 'update public.wo_tasks set status = ''done'' where id = ''aaaaaaaa-0000-4000-8000-0000000000f1'''
    when p_what = 'task_title'    then 'update public.wo_tasks set title = ''changed'' where id = ''aaaaaaaa-0000-4000-8000-0000000000f1'''
    when p_what = 'task_create'   then format(
      $q$insert into public.wo_tasks (job_id, title, organisation_id, country, site)
         values (%L, 'new', '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA NORTH PLANT')$q$, pg_temp.id('open_north'))
  end $f$;

create function pg_temp.expect(p_actor text, p_what text, p_want text) returns void language plpgsql as $f$
declare v_sql text := pg_temp.sql_for(p_what, p_actor); v_got text;
begin
  if v_sql is null then raise exception 'unknown case %', p_what; end if;
  v_got := pg_temp.try(p_actor, v_sql);
  insert into result (actor, what, want, got) values (coalesce(p_actor, '(no user)'), p_what, p_want, v_got);
end $f$;

-- want: ok = one row written; no = refused by a policy (zero rows, or 42501 on insert);
--       err = refused by a guard with a plain message (42501).
create function pg_temp.verdict(p_want text, p_got text) returns boolean language sql as $f$
  select case p_want
    when 'ok'  then p_got = 'ok:1'
    when 'no'  then p_got in ('ok:0', 'err:42501')
    when 'err' then p_got = 'err:42501'
  end $f$;

-- ── the matrix ─────────────────────────────────────────────────────────────────────────────────
-- Managers: create, assign, update and manage inside their company, country and sites.
select pg_temp.expect('manager', c, w) from (values
  ('create:north', 'ok'), ('create:uae', 'no'), ('create:beta', 'no'), ('edit:open_north', 'ok'), ('progress:open_north', 'ok'),
  ('complete:open_north', 'ok'), ('cancel:open_north', 'ok'), ('owner:open_north', 'ok'), ('assign:open_north', 'ok'),
  ('qc:open_north', 'ok'), ('cost:open_north', 'ok'), ('move:open_north', 'ok'), ('task_create', 'ok'), ('event_other', 'ok'),
  ('edit:open_uae', 'no'), ('edit:open_beta', 'no'), ('assign:open_beta', 'no'),
  ('edit:closed_north', 'err'), ('cost:closed_north', 'err'), ('cost:approved_north', 'err'), ('edit:approved_north', 'ok'),
  ('rehome:open_north', 'no'), ('delete:open_north', 'no'), ('delete:closed_north', 'no')) t(c, w);
select pg_temp.expect('director', c, w) from (values
  ('create:north', 'ok'), ('create:uae', 'ok'), ('edit:open_uae', 'ok'), ('assign:open_north', 'ok'),
  ('edit:closed_north', 'err'), ('delete:open_north', 'no'), ('create:beta', 'no')) t(c, w);

-- Workshop Supervisors: the same, inside their sites.
select pg_temp.expect('sup_all', c, w) from (values
  ('create:north', 'ok'), ('create:east', 'ok'), ('create:none', 'ok'), ('create:uae', 'no'), ('create:beta', 'no'),
  ('edit:open_north', 'ok'), ('progress:open_east', 'ok'), ('owner:open_north', 'ok'), ('assign:open_east', 'ok'),
  ('qc:open_north', 'ok'), ('task_create', 'ok'), ('task_title', 'ok'), ('event_other', 'ok'),
  ('edit:closed_north', 'err'), ('cost:approved_north', 'err'), ('delete:open_north', 'no'), ('edit:open_beta', 'no')) t(c, w);
select pg_temp.expect('sup_north', c, w) from (values
  ('create:north', 'ok'), ('create:east', 'no'), ('create:none', 'no'), ('edit:open_north', 'ok'), ('assign:open_north', 'ok'),
  ('edit:open_east', 'no'), ('assign:open_east', 'no'), ('move:open_north', 'no'), ('edit:closed_north', 'err'),
  ('delete:open_north', 'no')) t(c, w);
select pg_temp.expect('maint_sup', c, w) from (values
  ('create:north', 'ok'), ('assign:open_north', 'ok'), ('progress:open_north', 'ok'), ('edit:open_east', 'no')) t(c, w);
select pg_temp.expect('area_mgr', c, w) from (values
  ('create:east', 'ok'), ('assign:open_east', 'ok'), ('qc:open_east', 'ok'), ('delete:open_east', 'no')) t(c, w);
select pg_temp.expect('locked', c, w) from (values
  ('create:north', 'no'), ('edit:open_north', 'no'), ('assign:open_north', 'no'), ('checkin', 'no')) t(c, w);

-- Tyre Engineers: tyre work only, inside their country and sites.
select pg_temp.expect('engineer', c, w) from (values
  ('create:uae_tyre', 'ok'), ('create:uae', 'no'), ('edit:tyre_uae', 'ok'), ('assign:tyre_uae', 'ok'), ('qc:tyre_uae', 'ok'),
  ('edit:open_uae', 'no'), ('assign:open_uae', 'no'), ('edit:open_north', 'no'), ('delete:tyre_uae', 'no')) t(c, w);

-- Tyremen and technicians: their ASSIGNED job only; progress and evidence; no final closure.
select pg_temp.expect('tyreman', c, w) from (values
  ('progress:open_north', 'ok'), ('toqc:open_north', 'ok'), ('event:open_north', 'ok'), ('checkin', 'ok'),
  ('complete:open_north', 'err'), ('close:open_north', 'err'), ('qcpass:open_north', 'err'),
  ('edit:open_north', 'err'), ('cost:open_north', 'err'), ('owner:open_north', 'err'), ('qc:open_north', 'err'),
  ('cancel:open_north', 'err'), ('move:open_north', 'err'),
  ('progress:open_east', 'no'), ('event:open_east', 'no'), ('create:north', 'no'), ('assign:open_north', 'no'),
  ('task_create', 'no'), ('event_other', 'no'), ('delete:open_north', 'no'), ('progress:closed_north', 'no')) t(c, w);
select pg_temp.expect('mechanic', c, w) from (values
  ('progress:open_north', 'no'), ('event:open_north', 'no'), ('create:north', 'no'), ('checkin', 'ok'), ('task_status', 'no')) t(c, w);
select pg_temp.expect('electrician', c, w) from (values
  ('task_status', 'ok'), ('task_title', 'err'), ('progress:open_north2', 'ok'), ('progress:open_north', 'no'),
  ('toqc:open_north2', 'ok'), ('complete:open_north2', 'err'), ('edit:open_north2', 'err'), ('cost:open_north2', 'err'),
  ('event:open_north2', 'ok'), ('event:open_north', 'no'), ('delete:open_north2', 'no')) t(c, w);
-- A per-user edit grant for a technician adds edit and progress, never the quality check or closure.
select pg_temp.expect('granted_tech', c, w) from (values
  ('edit:open_north', 'ok'), ('progress:open_north', 'ok'), ('qc:open_north', 'err'), ('complete:open_north', 'err'),
  ('owner:open_north', 'err'), ('assign:open_north', 'no'), ('create:north', 'no'), ('delete:open_north', 'no')) t(c, w);

-- Tyre Data Collector (owner decision round 2): create, update and document anywhere in their walls;
-- quality check on ASSIGNED work orders only; no assigning, no final closure, no approved cost,
-- no closed work order, no delete. (open_east is assigned to the collector, open_north is not.)
select pg_temp.expect('collector', c, w) from (values
  ('create:north', 'ok'), ('create:east', 'ok'), ('edit:open_north', 'ok'), ('progress:open_north', 'ok'),
  ('toqc:open_north', 'ok'), ('cost:open_north', 'ok'), ('event:open_north', 'ok'),
  ('qc:open_east', 'ok'), ('qc:open_north', 'err'),
  ('complete:open_north', 'err'), ('complete:open_east', 'err'), ('close:open_east', 'err'), ('cancel:open_east', 'err'),
  ('qcpass:open_east', 'err'), ('qcpass:open_north', 'err'),
  ('owner:open_north', 'err'), ('assign:open_north', 'no'), ('assign:open_east', 'no'), ('task_create', 'no'),
  ('edit:closed_north', 'err'), ('cost:closed_north', 'err'), ('cost:approved_north', 'err'), ('edit:approved_north', 'ok'),
  ('create:uae', 'no'), ('create:beta', 'no'), ('edit:open_beta', 'no'), ('rehome:open_north', 'no'),
  ('delete:open_north', 'no'), ('delete:open_east', 'no'), ('delete:closed_north', 'no')) t(c, w);
-- Access Control keeps working for roles with no rule, and per person.
select pg_temp.expect('granted', c, w) from (values
  ('edit:open_north', 'ok'), ('create:north', 'no'), ('assign:open_north', 'no'), ('edit:closed_north', 'err')) t(c, w);
select pg_temp.expect('revoked', c, w) from (values
  ('create:north', 'ok'), ('edit:open_north', 'no'), ('progress:open_north', 'no'), ('assign:open_north', 'no')) t(c, w);
select pg_temp.expect('inspector', c, w) from (values
  ('create:north', 'no'), ('edit:open_north', 'no'), ('assign:open_north', 'no')) t(c, w);
select pg_temp.expect('driver', c, w) from (values
  ('create:north', 'no'), ('progress:open_north', 'no'), ('event:open_north', 'no')) t(c, w);

-- A company rule row replaces the built-in default for that company only.
select pg_temp.expect('beta_manager', c, w) from (values
  ('create:beta', 'ok'), ('edit:open_beta', 'ok'), ('assign:open_beta', 'no'), ('owner:open_beta', 'err'),
  ('qc:open_beta', 'err'), ('edit:open_north', 'no'), ('create:north', 'no')) t(c, w);

-- Admin and super admin: everything, including the restricted actions. Admin stays in the company.
select pg_temp.expect('admin', c, w) from (values
  ('create:north', 'ok'), ('edit:closed_north', 'ok'), ('cost:closed_north', 'ok'), ('cost:approved_north', 'ok'),
  ('delete:closed_north', 'ok'), ('assign:open_north', 'ok'), ('edit:open_beta', 'no'), ('delete:open_beta', 'no')) t(c, w);
select pg_temp.expect('super', c, w) from (values
  ('edit:closed_north', 'ok'), ('delete:closed_north', 'ok'), ('edit:open_beta', 'ok')) t(c, w);

-- No signed-in user (service role, dashboard staging pipe, cron): the guards do not judge.
select pg_temp.expect(null, c, w) from (values
  ('edit:closed_north', 'ok'), ('cost:approved_north', 'ok'), ('delete:closed_north', 'ok'), ('owner:open_north', 'ok')) t(c, w);

-- ── ERP import paths still work ────────────────────────────────────────────────────────────────
-- 1. The dashboard staging pipe (process_stg_job_cards): a new job card, then the same card again
--    as a refresh of a card that is by then CLOSED. No signed-in user in either.
create temp table erp (step text, n bigint) on commit drop;
insert into public.stg_job_cards (country, "Job Card No", "Location", "Status", "Type", "Asset Code", "Production Out", "Workshop In")
values ('KSA', 'TST/JC/0001/1126', 'ALPHA NORTH PLANT', 'Closed', 'Break Down', 'TST1', '01-11-2026 05:00', '01-11-2026 08:00');
insert into erp select 'pipe insert', count(*) from public.work_orders where work_order_no = 'TST/JC/0001/1126';
insert into public.stg_job_cards (country, "Job Card No", "Location", "Status", "Type", "Asset Code", "Production Out", "Workshop In", "Production Complaint")
values ('KSA', 'TST/JC/0001/1126', 'ALPHA NORTH PLANT', 'Closed', 'Break Down', 'TST1', '01-11-2026 05:00', '01-11-2026 08:00', 'refreshed');
insert into erp select 'pipe refresh of a closed card', count(*) from public.work_orders
 where work_order_no = 'TST/JC/0001/1126' and description = 'refreshed';
insert into erp select 'pipe left one row', count(*) from public.work_orders where work_order_no = 'TST/JC/0001/1126';
insert into result (actor, what, want, got)
select '(no user)', 'erp ' || step, 'ok', case when n = 1 then 'ok:1' else 'ok:' || n end from erp;
-- 2. The in-app intake as an Admin: inserts a closed job card and refreshes it (a plain table write).
select pg_temp.expect('admin', 'create:north', 'ok');
insert into result (actor, what, want, got)
select 'admin', 'erp in-app refresh of a closed card', 'ok',
       pg_temp.try('admin', format('update public.work_orders set description = ''intake'' where id = %L', pg_temp.id('closed_north')));
-- 3. The same refresh by a non-admin intake user is refused with a plain message, not silently.
insert into result (actor, what, want, got)
select 'collector', 'erp in-app refresh of a closed card', 'err',
       pg_temp.try('collector', format('update public.work_orders set description = ''intake'' where id = %L', pg_temp.id('closed_north')));

-- ── the resolver the screen reads agrees with what the database enforced ───────────────────────
create function pg_temp.access(p_actor text) returns jsonb language plpgsql as $f$
declare j jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.who(p_actor), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.work_order_my_access();
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return j;
end $f$;
insert into result (actor, what, want, got)
select a, 'my_access ' || want_json, 'ok',
       case when pg_temp.access(a) @> want_json::jsonb then 'ok:1' else 'mismatch ' || pg_temp.access(a)::text end
from (values
  ('manager',      '{"admin":false,"create":"all","edit":"all","assign":"all","progress":"all","qc":"all","close":"all"}'),
  ('sup_north',    '{"admin":false,"create":"all","assign":"all","all_sites":false}'),
  ('engineer',     '{"create":"tyre","edit":"tyre","assign":"tyre","progress":"tyre","qc":"tyre","close":"tyre"}'),
  ('tyreman',      '{"create":null,"edit":null,"assign":null,"progress":"assigned","qc":null,"close":null}'),
  ('electrician',  '{"create":null,"edit":null,"assign":null,"progress":"assigned","qc":null,"close":null}'),
  ('collector',    '{"admin":false,"create":"all","edit":"all","assign":null,"progress":"all","qc":"assigned","close":null}'),
  ('granted',      '{"create":null,"edit":"all","assign":null,"progress":"all","qc":"all","close":"all"}'),
  ('granted_tech', '{"create":null,"edit":"all","assign":null,"progress":"all","qc":null,"close":null}'),
  ('revoked',      '{"create":"all","edit":null,"assign":null,"progress":null}'),
  ('beta_manager', '{"create":"all","edit":"all","assign":null,"progress":"all","qc":null}'),
  ('inspector',    '{"create":null,"edit":null,"assign":null,"progress":null,"qc":null}'),
  ('locked',       '{"create":null,"edit":null,"assign":null,"progress":null,"qc":null}'),
  ('admin',        '{"admin":true,"create":"all","assign":"all"}')) t(a, want_json);

-- Supervisors see their technicians' events (Workshop Live Control); technicians see only their own.
set local session_replication_role = replica;
insert into public.tech_activity_events (user_id, event_type, organisation_id, country, site)
values ('aaaaaaaa-0000-4000-8000-000000000005', 'check_in', '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA NORTH PLANT'),
       ('aaaaaaaa-0000-4000-8000-000000000005', 'check_in', '00000000-0000-0000-0000-000000000001', 'KSA', 'ALPHA EAST PLANT');
set local session_replication_role = origin;
create function pg_temp.sees(p_actor text) returns bigint language plpgsql as $f$
declare n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.who(p_actor), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.tech_activity_events where user_id = 'aaaaaaaa-0000-4000-8000-000000000005';
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return n;
end $f$;
insert into result (actor, what, want, got)
select a, 'sees ' || want_n || ' of the mechanic''s 2 events', 'ok',
       case when pg_temp.sees(a) = want_n then 'ok:1' else 'saw ' || pg_temp.sees(a) end
from (values ('sup_all', 2), ('sup_north', 1), ('manager', 2), ('tyreman', 0), ('mechanic', 1), ('beta_manager', 0)) t(a, want_n);

-- Rule table: only an Admin of the company (or a super admin) can change it; nobody edits the built-in rows but a super admin.
insert into result (actor, what, want, got) values
  ('manager', 'rule table: add a company rule', 'no', pg_temp.try('manager',
     $q$insert into public.work_order_role_rules (organisation_id, role, actions) values ('00000000-0000-0000-0000-000000000001', 'Driver', array['create'])$q$)),
  ('admin', 'rule table: add a company rule', 'ok', pg_temp.try('admin',
     $q$insert into public.work_order_role_rules (organisation_id, role, actions) values ('00000000-0000-0000-0000-000000000001', 'Driver', array['progress'])$q$)),
  ('admin', 'rule table: add a rule for another company', 'no', pg_temp.try('admin',
     $q$insert into public.work_order_role_rules (organisation_id, role, actions) values ('bbbbbbbb-0000-4000-8000-000000000002', 'Driver', array['progress'])$q$)),
  ('admin', 'rule table: change a built-in rule', 'no', pg_temp.try('admin',
     $q$update public.work_order_role_rules set actions = '{}' where organisation_id is null and role = 'Tyre Man'$q$)),
  ('super', 'rule table: change a built-in rule', 'ok', pg_temp.try('super',
     $q$update public.work_order_role_rules set actions = '{}' where organisation_id is null and role = 'Tyre Man'$q$));

-- An edit form that resends the creator: accepted, and the stored creator is kept (not overwritten).
insert into result (actor, what, want, got)
select 'manager', 'edit that resends created_by keeps the stored creator', 'ok',
       pg_temp.try('manager', format(
         $q$with u as (update public.work_orders set description = 't', created_by = %L where id = %L returning created_by)
            select 1 / (case when (select created_by from u) is distinct from %L::uuid then 1 else 0 end)$q$,
         pg_temp.who('manager'), pg_temp.id('open_north'), pg_temp.who('manager')));
-- Quality check pass in one write (status Completed + result): a supervisor may; a technician may not
-- (the collector cases are in the matrix above).
insert into result (actor, what, want, got) values
  ('sup_all', 'qc pass in one write', 'ok', pg_temp.try('sup_all', format(
     'update public.work_orders set status = ''Completed'', qc_status = ''passed'' where id = %L', pg_temp.id('open_north')))),
  ('tyreman', 'qc pass in one write', 'err', pg_temp.try('tyreman', format(
     'update public.work_orders set status = ''Completed'', qc_status = ''passed'' where id = %L', pg_temp.id('open_north'))));

-- The delete guard itself: a definer function run by a non-admin must not remove a work order.
-- (Direct deletes are already stopped by the Admin-only delete policy, so this is the only way to
-- reach the trigger.)
create function public.zz_test_definer_delete(p uuid) returns void language sql security definer
  set search_path to 'public' as $f$ delete from public.work_orders where id = p $f$;
grant execute on function public.zz_test_definer_delete(uuid) to authenticated;
insert into result (actor, what, want, got) values
  ('manager', 'definer delete of a closed work order', 'err',
     pg_temp.try('manager', format('select public.zz_test_definer_delete(%L)', pg_temp.id('closed_north')))),
  ('sup_all', 'definer delete of an open work order', 'err',
     pg_temp.try('sup_all', format('select public.zz_test_definer_delete(%L)', pg_temp.id('open_north')))),
  ('admin', 'definer delete of a closed work order', 'ok',
     pg_temp.try('admin', format('select public.zz_test_definer_delete(%L)', pg_temp.id('closed_north'))));

-- Hand-deleting through a definer function is refused for a collector too.
insert into result (actor, what, want, got) values
  ('collector', 'definer delete of an open work order', 'err',
     pg_temp.try('collector', format('select public.zz_test_definer_delete(%L)', pg_temp.id('open_east'))));

-- Cost approval (WO-4): a collector is not an eligible approver of a work order; a supervisor is;
-- the collector's eligibility for checklists is not changed by this draft.
insert into result (actor, what, want, got)
select v.who, v.what, 'ok',
       case when approval_private.person_eligible(pg_temp.who(v.who), '00000000-0000-0000-0000-000000000001', v.typ, 'KSA', null) = v.want
            then 'ok:1' else 'eligible=' || (not v.want)::text end
from (values ('collector', 'approver of a work order: not eligible', 'work_order', false),
             ('sup_all',   'approver of a work order: eligible', 'work_order', true)) v(who, what, typ, want);

insert into result (actor, what, want, got)
select '(catalog)', 'approver list for other record types still names the collector', 'ok',
       case when position($s$ELSE ARRAY['Admin','Maintenance Supervisor','Workshop Supervisor','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector'] END$s$ in p.prosrc) > 0
             and position($s$WHEN p_type='inspection' THEN ARRAY['Admin','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector']$s$ in p.prosrc) > 0
            then 'ok:1' else 'changed' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'approval_private' and p.proname = 'person_eligible';

-- Menu switches (WO-3): technicians and supervisors can open Work Orders; technicians not Live Control.
insert into result (actor, what, want, got)
select v.role, 'module ' || v.key || ' = ' || v.want, 'ok',
       case when coalesce((select m.enabled from public.module_permissions m
                            where m.org_id is null and m.role = v.role and m.module_key = v.key), false) = v.want
            then 'ok:1' else 'wrong' end
from (values ('Tyre Man', 'work_orders', true), ('Mechanic', 'work_orders', true), ('Helper PMV', 'work_orders', true),
             ('Tyre Man', 'workshop_live', false), ('Mechanic', 'workshop_live', false),
             ('Workshop Supervisor', 'work_orders', true), ('Workshop Supervisor', 'workshop_live', true)) v(role, key, want);

-- Stored costs and approvals are not rewritten by anything above (the driver also hashes work_orders).
insert into result (actor, what, want, got)
select '(fixture)', 'approval request row unchanged', 'ok',
       case when (select approval_status || '/' || status from public.approval_execution_requests
                   where id = 'aaaaaaaa-0000-4000-8000-0000000000e1') = 'approved/executed' then 'ok:1' else 'changed' end;

-- ── report ───────────────────────────────────────────────────────────────────────────────────────
select 'FAIL  ' || actor || '  ' || what || '  want=' || want || '  got=' || got
  from result where not coalesce(pg_temp.verdict(want, got), false) order by n;
select 'cases=' || count(*) || ' passed=' || count(*) filter (where coalesce(pg_temp.verdict(want, got), false))
       || ' failed=' || count(*) filter (where not coalesce(pg_temp.verdict(want, got), false))
  from result;

rollback;
