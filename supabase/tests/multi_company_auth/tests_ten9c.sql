-- Duplicate usernames across companies. ONLY on a private staging copy with the HOLD
-- file ten9c applied (it removes the global username / employee id keys).
-- One transaction, rolled back.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set ALPHA_ORG  '00000000-0000-0000-0000-000000000001'
\set BETA_ORG   'bbbbbbbb-0000-4000-8000-000000000002'
\set GAMMA_ORG  'cccccccc-0000-4000-8000-000000000003'
\set BETA_ADMIN '9c149942-c3b2-54c6-a6e8-c34b2933bb3c'

begin;
-- Beta invites a person who picks Alpha's "field.ali".
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member(null, 'Driver', 7)) ->> 'invite_token' as tok \gset
reset role;
insert into auth.users(id, email, raw_user_meta_data)
values ('e0000000-0000-4000-8000-000000000001', 'field.ali+beta-haulage@users.tyrepulse.app',
        json_build_object('username','field.ali','employee_id','GC-7001','invite_token', :'tok','company_code','beta-haulage')::jsonb);
select tt.ok('7a ten9c: a second company may hold the same username and employee id',
  p.org_id = :'BETA_ORG'::uuid and p.approved) from public.profiles p where p.id = 'e0000000-0000-4000-8000-000000000001';
select tt.ok('7b plain "field.ali" still names the ORIGINAL company''s account (rule 1, legacy preferred)',
  public.resolve_sign_in_user('field.ali') = 'a1111111-0000-4000-8000-000000000001');
select tt.ok('7c plain employee id "GC-7001" still names the original account',
  public.resolve_sign_in_user('gc-7001') = 'a1111111-0000-4000-8000-000000000001');
select tt.ok('7d beta-haulage/field.ali names the Beta account',
  public.resolve_sign_in_user('beta-haulage/field.ali') = 'e0000000-0000-4000-8000-000000000001');
select tt.ok('7e alpha-readymix/field.ali names the Alpha account',
  public.resolve_sign_in_user('alpha-readymix/field.ali') = 'a1111111-0000-4000-8000-000000000001');
select tt.ok('7f get_email_by_identifier: Beta code form gives the Beta address',
  public.get_email_by_identifier('beta-haulage/field.ali') = 'field.ali+beta-haulage@users.tyrepulse.app');

-- Same name in two NON-legacy companies: a plain name is ambiguous -> nobody.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member(null, 'Driver', 7)) ->> 'invite_token' as tok2 \gset
select set_config('request.jwt.claims', json_build_object('sub', 'fac31cd3-66a9-595c-9725-0b00beaa4f2d', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member(null, 'Driver', 7)) ->> 'invite_token' as tok3 \gset
reset role;
insert into auth.users(id, email, raw_user_meta_data) values
 ('e0000000-0000-4000-8000-000000000002', 'twin+beta-haulage@users.tyrepulse.app', json_build_object('username','twin','invite_token', :'tok2')::jsonb),
 ('e0000000-0000-4000-8000-000000000003', 'twin+gamma-new-fleet@users.tyrepulse.app', json_build_object('username','twin','invite_token', :'tok3')::jsonb);
select tt.ok('7g plain "twin" (Beta + Gamma, neither legacy) resolves to nobody, not to a guess',
  public.resolve_sign_in_user('twin') is null);
select tt.ok('7h beta-haulage/twin and gamma-new-fleet/twin each name their own account',
  public.resolve_sign_in_user('beta-haulage/twin') = 'e0000000-0000-4000-8000-000000000002'
  and public.resolve_sign_in_user('gamma-new-fleet/twin') = 'e0000000-0000-4000-8000-000000000003');
alter table public.profiles disable trigger trg_guard_profile_privileged;
select tt.try($$insert into auth.users(id, email, raw_user_meta_data) values ('e0000000-0000-4000-8000-000000000004','twin2@users.tyrepulse.app','{"username":"TWIN"}'::jsonb);
           update public.profiles set org_id = 'bbbbbbbb-0000-4000-8000-000000000002', organisation_id = 'bbbbbbbb-0000-4000-8000-000000000002' where id = 'e0000000-0000-4000-8000-000000000004'$$) as dup_res \gset
alter table public.profiles enable trigger trg_guard_profile_privileged;
select tt.ok('7i a duplicate inside ONE company is still refused (per-company key)', :'dup_res' like '23505%', :'dup_res');

-- Lockout counter: the counter is keyed on the TYPED text, so a Beta "field.ali" who
-- types the bare name burns the ORIGINAL company's account attempts.
select public.record_login_failure('field.ali') from generate_series(1, 5) \g /dev/null
select tt.ok('7j KNOWN RISK documented: 5 bare "field.ali" failures lock the bare name (original account)',
  (public.login_attempt_status('field.ali') ->> 'locked')::boolean);
select tt.ok('7k the Beta account is still reachable through its code form',
  not (public.login_attempt_status('beta-haulage/field.ali') ->> 'locked')::boolean);
rollback;
