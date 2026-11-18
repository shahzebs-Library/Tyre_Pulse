-- Gap tests for PR #546 (2026-11-16). LOCAL staging only, one rolled-back transaction.
-- Runs on a copy with TEN-9d/9e/9f/9g applied (ten9c=0) and on the copy that also
-- carries the HOLD file ten9c (ten9c=1). Sections:
--   10 existing logins unchanged      11 company separation (RLS, impersonated)
--   12 TEN-9g code form not squattable 13 duplicate usernames (both states)
--   14 invitations (extra cases)       15 company Admin cannot reach another company
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\if :{?ten9c}
\else
\set ten9c 0
\endif

\set ALPHA_ORG    '00000000-0000-0000-0000-000000000001'
\set BETA_ORG     'bbbbbbbb-0000-4000-8000-000000000002'
\set GAMMA_ORG    'cccccccc-0000-4000-8000-000000000003'
\set ALPHA_ADMIN  'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'
\set BETA_ADMIN   '9c149942-c3b2-54c6-a6e8-c34b2933bb3c'
\set SUPER        '5eacf3d3-29af-5995-bc52-bcef51b82c38'
\set FIELD_ALI    'a1111111-0000-4000-8000-000000000001'

begin;
update public.system_config set value = 'true' where key = 'single_tenant_mode';

select id as beta_driver from public.profiles where username = 'beta.driver' \gset
select id as alpha_driver from public.profiles where username = 'alpha.driver' \gset

-- ===========================================================================
-- 10. Every identifier shape used in production keeps working (single_tenant_mode on)
-- ===========================================================================
select tt.ok('10a every account: username, UPPER username and employee id resolve to itself',
  count(*) = 0, count(*) || ' mismatches: ' || string_agg(p.username, ','))
  from public.profiles p
 where p.username is not null and (
       public.resolve_sign_in_user(p.username) is distinct from p.id
    or public.resolve_sign_in_user(upper(p.username)) is distinct from p.id
    or (p.employee_id is not null and public.resolve_sign_in_user(p.employee_id) is distinct from p.id));
select tt.ok('10b every account: "<slug>/<username>" resolves to itself and nobody else',
  count(*) = 0, count(*) || ' mismatches: ' || string_agg(p.username, ','))
  from public.profiles p join public.organisations o on o.id = p.org_id
 where p.username is not null
   and public.resolve_sign_in_user(o.slug || '/' || p.username) is distinct from p.id;
select tt.ok('10c get_email_by_identifier hands out an address ONLY when it is a made-up one',
  count(*) = 0, count(*) || ' wrong: ' || string_agg(p.username, ','))
  from public.profiles p join auth.users u on u.id = p.id
 where p.username is not null
   and public.get_email_by_identifier(p.username) is distinct from
       (case when lower(u.email) like '%@users.tyrepulse.app' then u.email end);
select tt.ok('10d real-email account (edge fn path): resolver names it, auth holds the real address',
  (select u.email from auth.users u where u.id = public.resolve_sign_in_user('alpha.admin')) = 'alpha.admin@staging.tyrepulse.invalid'
  and (select u.email from auth.users u where u.id = public.resolve_sign_in_user('EMP-0001')) = 'alpha.admin@staging.tyrepulse.invalid');
select tt.ok('10e made-up address typed directly: the account exists, approved, original company',
  exists (select 1 from auth.users u join public.profiles p on p.id = u.id
           where u.email = 'field.ali@users.tyrepulse.app' and p.approved and p.org_id = :'ALPHA_ORG'::uuid));
select tt.ok('10f made-up and real addresses are recognised by the lockout gate, not locked',
  public._login_identifier_exists('field.ali@users.tyrepulse.app')
  and public._login_identifier_exists('alpha.admin@staging.tyrepulse.invalid')
  and coalesce((public.login_attempt_status('field.ali@users.tyrepulse.app') ->> 'locked')::boolean, false) = false);
select tt.ok('10g an email typed as identifier never resolves through the name path (direct sign-in only)',
  public.resolve_sign_in_user('field.ali@users.tyrepulse.app') is null);

-- ===========================================================================
-- 11. Company separation for an ordinary user of company B (RLS)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'beta_driver', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('11a Beta Driver: tyre_records only Beta rows (and some)',
  count(*) filter (where organisation_id is distinct from :'BETA_ORG'::uuid) = 0 and count(*) > 0,
  count(*) || ' rows, foreign ' || count(*) filter (where organisation_id is distinct from :'BETA_ORG'::uuid)) from public.tyre_records;
select tt.ok('11b Beta Driver: vehicle_fleet and work_orders show no other company',
  (select count(*) from public.vehicle_fleet where organisation_id is distinct from :'BETA_ORG'::uuid) = 0
  and (select count(*) from public.work_orders where organisation_id is distinct from :'BETA_ORG'::uuid) = 0);
select tt.ok('11c Beta Driver: no profile, organisation or invitation of another company',
  (select count(*) from public.profiles where org_id is distinct from :'BETA_ORG'::uuid) = 0
  and (select count(*) from public.organisations where id <> :'BETA_ORG'::uuid) = 0
  and (select count(*) from public.org_invitations) = 0);
select count(*) as upd from (select 1 from public.tyre_records where organisation_id = :'ALPHA_ORG'::uuid) s \gset
select tt.try($$update public.tyre_records set brand = 'XCO-BRAND' where organisation_id = '00000000-0000-0000-0000-000000000001'$$) as upd_res \gset
select tt.ok('11d Beta Driver sees 0 Alpha tyre records; an UPDATE aimed at them runs and reaches none (11f recounts)',
  :upd = 0 and :'upd_res' ~ '^(OK|42501)', :'upd_res');
select tt.ok('11e Beta Driver cannot INSERT a row stamped with Alpha''s company',
  tt.try($$insert into public.tyre_records(organisation_id, serial_no, asset_no) values ('00000000-0000-0000-0000-000000000001','XCO-1','XCO')$$) <> 'OK');
reset role;
select set_config('request.jwt.claims', '', true) \g /dev/null
select tt.ok('11f (privileged recount) no Alpha row was written by the Beta Driver',
  not exists (select 1 from public.tyre_records where serial_no = 'XCO-1') and not exists (select 1 from public.tyre_records where brand = 'XCO-BRAND'));

-- ===========================================================================
-- 12. TEN-9g: a username carrying the separator can never take over a code form
-- ===========================================================================
select tt.ok('12a sign-up with username "beta-haulage/beta.admin" is refused, no account',
  tt.signup('e0000000-0000-4000-8000-000000000001', 'squat1@users.tyrepulse.app', '{"username":"beta-haulage/beta.admin"}'::jsonb) like 'REFUSED:22023%'
  and not exists (select 1 from auth.users where id = 'e0000000-0000-4000-8000-000000000001'));
select tt.ok('12b backslash form refused too',
  tt.signup('e0000000-0000-4000-8000-000000000002', 'squat2@users.tyrepulse.app', '{"username":"beta-haulage\\beta.admin"}'::jsonb) like 'REFUSED:22023%');
select tt.ok('12c employee id carrying "/" refused',
  tt.signup('e0000000-0000-4000-8000-000000000003', 'squat3@users.tyrepulse.app', '{"username":"squat.three","employee_id":"beta-haulage/emp-0008"}'::jsonb) like 'REFUSED:22023%');
-- A row that already held a slash before TEN-9g (simulated: trigger off for the insert only).
alter table public.profiles disable trigger trg_guard_profile_sign_in_names;
insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-4000-8000-000000000004', 'legacy.slash@users.tyrepulse.app', '{"username":"beta-haulage/beta.admin"}'::jsonb),
  ('e0000000-0000-4000-8000-000000000005', 'legacy.slash2@users.tyrepulse.app', '{"username":"ops/legacy"}'::jsonb);
alter table public.profiles enable trigger trg_guard_profile_sign_in_names;
select tt.ok('12d a legacy slash username cannot shadow Beta''s Admin: the code form wins',
  public.resolve_sign_in_user('beta-haulage/beta.admin') = :'BETA_ADMIN'::uuid,
  public.resolve_sign_in_user('beta-haulage/beta.admin')::text);
select tt.ok('12e a legacy slash username whose prefix is no company still signs in by its exact text',
  public.resolve_sign_in_user('ops/legacy') = 'e0000000-0000-4000-8000-000000000005'::uuid);
select tt.ok('12f updating another column of a legacy slash row is allowed',
  tt.try($$update public.profiles set full_name = 'Legacy' where id = 'e0000000-0000-4000-8000-000000000005'$$) = 'OK');
select tt.ok('12g renaming any account to a slash name is refused',
  tt.try($$update public.profiles set username = 'x/y' where id = 'a1111111-0000-4000-8000-000000000001'$$) like '22023%');
select tt.ok('12h code form for a real-email account still hands out no address',
  public.get_email_by_identifier('beta-haulage/beta.admin') is null);

-- ===========================================================================
-- 13. Duplicate usernames
-- ===========================================================================
select tt.ok('13a inside ONE company a duplicate username is refused (exact)',
  tt.try($$update public.profiles set username = 'beta.admin' where username = 'beta.driver'$$) like '23505%');
select tt.ok('13b inside ONE company a duplicate differing only by case is refused',
  tt.try($$update public.profiles set username = 'BETA.ADMIN' where username = 'beta.driver'$$) like '23505%');
select tt.ok('13c inside ONE company a duplicate employee id (any case) is refused',
  tt.try($$update public.profiles set employee_id = 'emp-0008' where username = 'beta.driver'$$) like '23505%');
\if :ten9c
select tt.ok('13d ten9c: the same username in two companies is allowed',
  tt.try($$update public.profiles set username = 'alpha.driver' where username = 'beta.driver'$$) = 'OK');
select tt.ok('13e ten9c: plain "alpha.driver" still names the original company''s account',
  public.resolve_sign_in_user('alpha.driver') = :'alpha_driver'::uuid);
select tt.ok('13f ten9c: beta-haulage/alpha.driver names the Beta account only',
  public.resolve_sign_in_user('beta-haulage/alpha.driver') = :'beta_driver'::uuid);
\else
select tt.ok('13d pre-ten9c: the same username in two companies is refused (global key)',
  tt.try($$update public.profiles set username = 'alpha.driver' where username = 'beta.driver'$$) like '23505%');
select tt.ok('13e pre-ten9c: case variant across companies refused too',
  tt.try($$update public.profiles set username = 'Alpha.Driver' where username = 'beta.driver'$$) like '23505%');
select tt.ok('13f pre-ten9c: plain "alpha.driver" names the one account', public.resolve_sign_in_user('alpha.driver') = :'alpha_driver'::uuid);
\endif

-- ===========================================================================
-- 14. Invitations (extra)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member('alpha.driver@staging.tyrepulse.invalid', 'Inspector', 7)) ->> 'invite_token' as tok_exist \gset
select tt.ok('14a role ceiling: a company Admin cannot invite "Super Admin" or a made-up role',
  tt.try($$select public.org_invite_member(null,'Super Admin',7)$$) like '22023%'
  and tt.try($$select public.org_invite_member(null,'super_admin',7)$$) like '22023%');
select tt.ok('14b org_invite_member has no company or owner argument to steer',
  (select pronargs = 3 and proargtypes::regtype[]::text like '%{text,text,integer}' from pg_proc where oid = 'public.org_invite_member'::regproc));
select (public.org_invite_member(null, 'Inspector', 7)) ->> 'invite_token' as tok_ceil \gset
select (public.org_invite_member(null, 'Driver', 7)) ->> 'invite_token' as tok_wrong \gset
reset role;
select set_config('request.jwt.claims', '', true) \g /dev/null
select tt.ok('14c invitation for an email that already has an account: sign-up refused, nothing created',
  tt.signup('e0000000-0000-4000-8000-000000000010', 'alpha.driver@staging.tyrepulse.invalid',
            json_build_object('username','dupe.mail','invite_token', :'tok_exist')::jsonb) like 'REFUSED:%'
  and not exists (select 1 from public.profiles where id = 'e0000000-0000-4000-8000-000000000010'));
select tt.ok('14d the existing account stayed in its company and role',
  (select org_id = :'ALPHA_ORG'::uuid and role = 'Driver' from public.profiles where id = :'alpha_driver'::uuid));
select tt.ok('14e and that invitation is still waiting (not consumed)',
  (select accepted_at is null from public.org_invitations where token_hash = encode(sha256(convert_to(:'tok_exist','utf8')),'hex')));
select tt.signup('e0000000-0000-4000-8000-000000000011', 'ceil.try+beta@users.tyrepulse.app',
            json_build_object('username','ceil.try','invite_token', :'tok_ceil','role','Admin','is_super_admin',true,
                              'org_id', :'ALPHA_ORG')::jsonb) as r14f \gset
select tt.ok('14f client-sent role / super flag / org are ignored: invited role only, not super, Beta',
  :'r14f' = 'ACCEPTED:' || :'BETA_ORG' || ':Inspector'
  and (select not is_super_admin from public.profiles where id = 'e0000000-0000-4000-8000-000000000011'), :'r14f');
select tt.ok('14g reused token (already accepted): refused, no account',
  tt.signup('e0000000-0000-4000-8000-000000000012', 'ceil.again+beta@users.tyrepulse.app',
            json_build_object('username','ceil.again','invite_token', :'tok_ceil')::jsonb) like 'REFUSED:%'
  and not exists (select 1 from public.profiles where id = 'e0000000-0000-4000-8000-000000000012'));
select tt.ok('14h Beta token with Gamma''s company code: refused, invitation still usable',
  tt.signup('e0000000-0000-4000-8000-000000000013', 'wrong.co+gamma@users.tyrepulse.app',
            json_build_object('username','wrong.co','invite_token', :'tok_wrong','company_code','gamma-new-fleet')::jsonb) like 'REFUSED:%'
  and (select accepted_at is null and revoked_at is null from public.org_invitations where token_hash = encode(sha256(convert_to(:'tok_wrong','utf8')),'hex')));
select tt.ok('14i the same token with the right code lands in Beta',
  tt.signup('e0000000-0000-4000-8000-000000000014', 'right.co+beta@users.tyrepulse.app',
            json_build_object('username','right.co','invite_token', :'tok_wrong','company_code','beta-haulage')::jsonb)
  = 'ACCEPTED:' || :'BETA_ORG' || ':Driver');

-- ===========================================================================
-- 15. A plain Admin of company B cannot reach company A
-- ===========================================================================
update public.system_config set value = 'false' where key = 'single_tenant_mode';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('15a Beta Admin cannot set Alpha''s code through the platform RPC',
  tt.try($$select public.admin_set_org_sign_in_code('00000000-0000-0000-0000-000000000001','ALPHA')$$) like '42501%');
select tt.ok('15b Beta Admin cannot take Alpha''s slug as Beta''s code',
  tt.try($$select public.org_set_my_sign_in_code('alpha-readymix')$$) like '23505%');
select tt.ok('15c Beta Admin direct UPDATE of Alpha''s organisation row changes nothing',
  tt.try($$update public.organisations set sign_in_code = 'HIJACK', slug = 'hijack' where id = '00000000-0000-0000-0000-000000000001'$$) ~ '^(OK|42501)' );
select tt.ok('15d Beta Admin''s own code choice lands on Beta only',
  (public.org_set_my_sign_in_code('BETA2') ->> 'ok')::boolean);
select tt.ok('15e Beta Admin reads no Alpha profile, organisation or invitation',
  (select count(*) from public.profiles where org_id = :'ALPHA_ORG'::uuid) = 0
  and (select count(*) from public.organisations where id = :'ALPHA_ORG'::uuid) = 0
  and (select count(*) from public.org_invitations where organisation_id = :'ALPHA_ORG'::uuid) = 0);
select tt.ok('15f Beta Admin cannot lock / change the role of an Alpha user',
  tt.try(format($$select public.admin_mobile_user_action(%L,'lock',null,'test')$$, :'alpha_driver')) like '42501%',
  tt.try(format($$select public.admin_mobile_user_action(%L,'lock',null,'test')$$, :'alpha_driver')));
select tt.ok('15g Beta Admin direct UPDATE of an Alpha profile reaches 0 rows',
  tt.try(format($$update public.profiles set role = 'Admin', locked = true where id = %L$$, :'alpha_driver')) = 'OK');
reset role;
select set_config('request.jwt.claims', '', true) \g /dev/null
select tt.ok('15h (privileged recount) Alpha unchanged: code, slug, Alpha driver role and lock',
  (select sign_in_code is null and slug = 'alpha-readymix' from public.organisations where id = :'ALPHA_ORG'::uuid)
  and (select role = 'Driver' and not coalesce(locked, false) from public.profiles where id = :'alpha_driver'::uuid)
  and (select sign_in_code = 'BETA2' from public.organisations where id = :'BETA_ORG'::uuid));
rollback;
