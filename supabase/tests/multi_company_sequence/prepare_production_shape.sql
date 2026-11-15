-- Makes a COPY of the local staging database resemble production in the four respects that
-- matter for the multi-company sequence. Synthetic rows only. Never run on production.
--   1. The current company (Alpha) has NO subscription row (production: 0 rows in org_subscriptions)
--      while holding more vehicles and members than the trial plan allows.
--   2. The current company owns a custom role whose access rows are GLOBAL rows of the role matrix
--      (production: 32 custom role names among the global rows).
--   3. Field accounts sign in with a made-up address <username>@users.tyrepulse.app.
--   4. One member of the current company holds that custom role.
\set alpha '00000000-0000-0000-0000-000000000001'
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where username = 'platform.superadmin'), 'role', 'authenticated', 'aal', 'aal2')::text, true);

delete from public.org_subscriptions where organisation_id = :'alpha';

insert into public.custom_roles (name, organisation_id)
select 'Alpha Yard Lead', :'alpha'
 where not exists (select 1 from public.custom_roles where name = 'Alpha Yard Lead' and organisation_id = :'alpha');
insert into public.module_permissions (module_key, role, org_id, enabled)
select m.module_key, 'Alpha Yard Lead', null, m.enabled
  from public.module_permissions m
 where m.org_id is null and m.role = 'Tyre Man'
   and not exists (select 1 from public.module_permissions x where x.org_id is null and x.role = 'Alpha Yard Lead' and x.module_key = m.module_key);

insert into auth.users (id, email, raw_user_meta_data)
select 'a1a1a1a1-0000-4000-8000-0000000000aa', 'alpha.yardlead@users.tyrepulse.app',
       jsonb_build_object('username', 'alpha.yardlead', 'full_name', 'Alpha Yard Lead (synthetic)', 'employee_id', 'EMP-0099', 'region', 'KSA')
 where not exists (select 1 from auth.users where id = 'a1a1a1a1-0000-4000-8000-0000000000aa');
update public.profiles set role = 'Alpha Yard Lead', approved = true, sites = array['ALL']
 where id = 'a1a1a1a1-0000-4000-8000-0000000000aa';

update auth.users u set email = p.username || '@users.tyrepulse.app'
  from public.profiles p
 where p.id = u.id and p.role not in ('Admin') and u.email not like '%@users.tyrepulse.app';
commit;
