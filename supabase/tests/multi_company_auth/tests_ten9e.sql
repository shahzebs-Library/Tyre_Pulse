-- TEN-9e (a refused invitation sign-up creates no account; public config carries the
-- multi-company switch). LOCAL staging copy with TEN-9e applied. Rolled back.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set ALPHA_ORG  '00000000-0000-0000-0000-000000000001'
\set BETA_ORG   'bbbbbbbb-0000-4000-8000-000000000002'
\set BETA_ADMIN '9c149942-c3b2-54c6-a6e8-c34b2933bb3c'

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member('real.person@example.com', 'Inspector', 7)) ->> 'invite_token' as tok \gset
reset role;

select tt.signup('f0000000-0000-4000-8000-000000000001', 'wrong.person@example.com',
  json_build_object('username','chosen.name','invite_token', :'tok')::jsonb) as r1 \gset
select tt.ok('8a wrong email: the sign-up is aborted', :'r1' like 'REFUSED:22023', :'r1');
select tt.ok('8b no auth user and no profile were left behind',
  not exists (select 1 from auth.users where id = 'f0000000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.profiles where username = 'chosen.name'));
select tt.ok('8c the invitation was not consumed', public.get_invitation_preview(:'tok') ->> 'ok' = 'true');
select tt.signup('f0000000-0000-4000-8000-000000000002', 'real.person@example.com',
  json_build_object('username','chosen.name','invite_token', :'tok')::jsonb) as r2 \gset
select tt.ok('8d the same username works on the retry with the right email',
  :'r2' = 'ACCEPTED:' || :'BETA_ORG' || ':Inspector', :'r2');
select tt.ok('8e a bogus token aborts the sign-up', tt.signup('f0000000-0000-4000-8000-000000000003', 'bogus@users.tyrepulse.app',
  json_build_object('username','bogus.user','invite_token', repeat('a', 64))::jsonb) like 'REFUSED:22023');

update public.system_config set value = 'true' where key = 'single_tenant_mode';
select tt.signup('f0000000-0000-4000-8000-000000000004', 'plain.one@users.tyrepulse.app', '{"username":"plain.one"}'::jsonb) \g /dev/null
select tt.ok('8f a plain sign-up (no invitation) is unchanged: original company, pending',
  (select org_id = :'ALPHA_ORG'::uuid and not approved from public.profiles where id = 'f0000000-0000-4000-8000-000000000004'));
update public.system_config set value = 'false' where key = 'single_tenant_mode';
select tt.signup('f0000000-0000-4000-8000-000000000005', 'plain.two@users.tyrepulse.app', '{"username":"plain.two"}'::jsonb) \g /dev/null
select tt.ok('8g multi-company mode: a plain sign-up gets no company (never a default)',
  (select org_id is null from public.profiles where id = 'f0000000-0000-4000-8000-000000000005'));

set local role anon;
select tt.ok('8h anon public config carries single_tenant_mode',
  public.get_public_config() ->> 'single_tenant_mode' = 'false', public.get_public_config()::text);
reset role;
rollback;
