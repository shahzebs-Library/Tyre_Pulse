-- TEN-9d (company Admin chooses the sign-in code once, multi-company mode only).
-- LOCAL staging copy with the TEN-9d draft applied. One transaction, rolled back.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set ALPHA_ORG    '00000000-0000-0000-0000-000000000001'
\set BETA_ORG     'bbbbbbbb-0000-4000-8000-000000000002'
\set ALPHA_ADMIN  'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'
\set BETA_ADMIN   '9c149942-c3b2-54c6-a6e8-c34b2933bb3c'
\set BETA_MGR     'cb2ee8ae-520a-5a55-818e-7786a74bfda8'
\set SUPER        '5eacf3d3-29af-5995-bc52-bcef51b82c38'

begin;
update public.system_config set value = 'true' where key = 'single_tenant_mode';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('6a single-company mode: the screen says why the Admin cannot set a code',
  (r ->> 'can_set')::boolean = false and r ->> 'reason' = 'single_company_mode' and r ->> 'effective_code' = 'beta-haulage', r::text)
  from (select public.get_my_org_sign_in_code() r) s;
select tt.ok('6b single-company mode: org_set_my_sign_in_code is refused',
  tt.try($$select public.org_set_my_sign_in_code('BETA')$$) like '42501%');
select tt.ok('6c direct UPDATE of sign_in_code by a company Admin is refused (guard now fires)',
  tt.try($$update public.organisations set sign_in_code = 'BETA' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$) like '42501%');
select tt.ok('6d direct UPDATE of slug by a company Admin is refused',
  tt.try($$update public.organisations set slug = 'beta-x' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$) like '42501%');
select tt.ok('6e a company Admin can still edit the company name (organisations_write intact)',
  tt.try($$update public.organisations set name = 'Beta Haulage LLC (renamed)' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$) = 'OK');
reset role;

update public.system_config set value = 'false' where key = 'single_tenant_mode';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_MGR', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('6f a Manager cannot choose the code', tt.try($$select public.org_set_my_sign_in_code('BETA')$$) like '42501%');
select tt.ok('6g the Manager''s screen says not_admin', public.get_my_org_sign_in_code() ->> 'reason' = 'not_admin');
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('6h bad shape refused', tt.try($$select public.org_set_my_sign_in_code('-x')$$) like '22023%');
select tt.ok('6i another company''s slug refused', tt.try($$select public.org_set_my_sign_in_code('Alpha-Readymix')$$) like '23505%');
select tt.ok('6j Beta Admin chooses BETA once', tt.try($$select public.org_set_my_sign_in_code('BETA')$$) = 'OK');
select tt.ok('6k a second change by the company is refused (platform changes it)',
  tt.try($$select public.org_set_my_sign_in_code('BETA2')$$) like '42501%');
select tt.ok('6l screen now says already_set', public.get_my_org_sign_in_code() ->> 'reason' = 'already_set');
select tt.ok('6l2 the company Admin cannot clear its code with a direct UPDATE',
  tt.try($$update public.organisations set sign_in_code = null where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$) like '42501%');
select tt.ok('6l3 so the code is still set and "once only" holds',
  (select sign_in_code from public.organisations where id = 'bbbbbbbb-0000-4000-8000-000000000002') = 'BETA'
  and tt.try($$select public.org_set_my_sign_in_code('BETA2')$$) like '42501%');
select tt.ok('6m the code is recorded in the company audit',
  exists (select 1 from public.org_admin_events where organisation_id = :'BETA_ORG'::uuid and action = 'company.code_set'));
reset role;
select tt.ok('6n BETA/beta.admin resolves', public.resolve_sign_in_user('beta/beta.admin') = :'BETA_ADMIN'::uuid);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ALPHA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('6o Alpha cannot take Beta''s code', tt.try($$select public.org_set_my_sign_in_code('beta')$$) like '23505%');
select set_config('request.jwt.claims', json_build_object('sub', :'SUPER', 'role', 'authenticated', 'aal', 'aal2')::text, true) \g /dev/null
select tt.ok('6p super admin can still change Beta''s code',
  tt.try($$select public.admin_set_org_sign_in_code('bbbbbbbb-0000-4000-8000-000000000002','BETA-H')$$) = 'OK');
select tt.ok('6p2 super admin can still clear a code directly',
  tt.try($$update public.organisations set sign_in_code = null where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$) = 'OK');
select tt.ok('6q super admin direct UPDATE of a code still checks the slug clash',
  tt.try($$update public.organisations set sign_in_code = 'alpha-readymix' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$) like '23505%');
reset role;
select tt.ok('6r anon cannot call either new function',
  not has_function_privilege('anon', 'public.org_set_my_sign_in_code(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_my_org_sign_in_code()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public._multi_company_on()', 'EXECUTE'));
rollback;
