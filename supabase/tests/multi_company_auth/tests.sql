-- Multi-company sign-in + invitation behaviour tests (PR #546). LOCAL staging only.
-- Runs in ONE transaction that is rolled back. Output: one 'ok'/'not ok' line per check.
-- Impersonation: set local role authenticated + request.jwt.claims (sub/role/aal).
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
-- strict=1 (after TEN-9e): a refused invitation sign-up must create NO account.
-- strict=0 (production today): it may create an orphan (no company, unapproved).
\if :{?strict}
\else
\set strict 0
\endif

\set ALPHA_ORG    '00000000-0000-0000-0000-000000000001'
\set BETA_ORG     'bbbbbbbb-0000-4000-8000-000000000002'
\set GAMMA_ORG    'cccccccc-0000-4000-8000-000000000003'
\set ALPHA_ADMIN  'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'
\set ALPHA_MGR    '63e831d7-f511-5432-976d-439af4ccaf18'
\set BETA_ADMIN   '9c149942-c3b2-54c6-a6e8-c34b2933bb3c'
\set BETA_MGR     'cb2ee8ae-520a-5a55-818e-7786a74bfda8'
\set GAMMA_ADMIN  'fac31cd3-66a9-595c-9725-0b00beaa4f2d'
\set SUPER        '5eacf3d3-29af-5995-bc52-bcef51b82c38'
\set FIELD_ALI    'a1111111-0000-4000-8000-000000000001'

begin;

-- ===========================================================================
-- 1. Existing login compatibility, single_tenant_mode true AND false
-- ===========================================================================
create temp table ids(identifier text) on commit drop;
insert into ids
select username from public.profiles where username is not null
union all select upper(username) from public.profiles where username is not null
union all select '  ' || username || '  ' from public.profiles where username is not null
union all select employee_id from public.profiles where employee_id is not null
union all select lower(employee_id) from public.profiles where employee_id is not null
union all values ('nobody.here'), ('EMP-9999'), (''), ('   ');

update public.system_config set value = 'true' where key = 'single_tenant_mode';
select tt.ok('1a resolver == old exact lookup for every username/employee id (single_tenant_mode=true)',
  count(*) = 0, count(*) || ' mismatches: ' || string_agg(identifier, ','))
  from ids where public.resolve_sign_in_user(identifier) is distinct from tt.legacy_lookup(identifier);
select tt.ok('1b get_email_by_identifier: synthetic address for the field user (username)',
  public.get_email_by_identifier('field.ali') = 'field.ali@users.tyrepulse.app',
  public.get_email_by_identifier('field.ali'));
select tt.ok('1c get_email_by_identifier: synthetic address for the field user (employee id, any case)',
  public.get_email_by_identifier('gc-7001') = 'field.ali@users.tyrepulse.app');
select tt.ok('1d get_email_by_identifier: a real-email account is never disclosed (edge fn path)',
  public.get_email_by_identifier('alpha.admin') is null);
select tt.ok('1e get_email_by_identifier: unknown name -> null', public.get_email_by_identifier('nobody.here') is null);
select tt.ok('1f an email typed as the identifier is not resolved by the RPC (client signs in with it directly)',
  public.resolve_sign_in_user('alpha.admin@staging.tyrepulse.invalid') is null);
select tt.ok('1g lockout counter still recognises a plain username, an employee id and an email',
  public._login_identifier_exists('alpha.admin') and public._login_identifier_exists('EMP-0001')
  and public._login_identifier_exists('alpha.admin@staging.tyrepulse.invalid'));

update public.system_config set value = 'false' where key = 'single_tenant_mode';
select tt.ok('1h resolver == old exact lookup for every username/employee id (single_tenant_mode=false)',
  count(*) = 0, count(*) || ' mismatches') from ids
 where public.resolve_sign_in_user(identifier) is distinct from tt.legacy_lookup(identifier);
select tt.ok('1i get_email_by_identifier unchanged with single_tenant_mode=false',
  public.get_email_by_identifier('field.ali') = 'field.ali@users.tyrepulse.app'
  and public.get_email_by_identifier('alpha.admin') is null);
update public.system_config set value = 'true' where key = 'single_tenant_mode';

select tt.ok('1j anon cannot call resolve_sign_in_user / _resolve_sign_in_profile (service role only)',
  not has_function_privilege('anon', 'public.resolve_sign_in_user(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.resolve_sign_in_user(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public._resolve_sign_in_profile(text)', 'EXECUTE'));

-- ===========================================================================
-- 2. Company separation and the "code/username" form
-- ===========================================================================
select tt.ok('2a slug works as the code: beta-haulage/beta.admin -> Beta admin',
  public.resolve_sign_in_user('beta-haulage/beta.admin') = :'BETA_ADMIN'::uuid);
select tt.ok('2b code is case-insensitive, spaces and backslash tolerated',
  public.resolve_sign_in_user(' BETA-HAULAGE \ Beta.Admin ') = :'BETA_ADMIN'::uuid);
select tt.ok('2c code/name of ANOTHER company resolves to nobody (beta-haulage/alpha.admin)',
  public.resolve_sign_in_user('beta-haulage/alpha.admin') is null);
select tt.ok('2d code/name of ANOTHER company resolves to nobody (alpha-readymix/beta.admin)',
  public.resolve_sign_in_user('alpha-readymix/beta.admin') is null);
select tt.ok('2e code/employee id inside the company (beta-haulage/emp-0008)',
  public.resolve_sign_in_user('beta-haulage/emp-0008') = :'BETA_ADMIN'::uuid);
select tt.ok('2f unknown code -> nobody', public.resolve_sign_in_user('nope/beta.admin') is null);
select tt.ok('2g leading slash is not a code', public.resolve_sign_in_user('/beta.admin') is null);

-- super admin sets a code; slug and code both work, code wins on a clash.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'SUPER', 'role', 'authenticated', 'aal', 'aal2')::text, true) \g /dev/null
select tt.ok('2h super admin sets Beta code BETA', tt.try($$select public.admin_set_org_sign_in_code('bbbbbbbb-0000-4000-8000-000000000002','BETA')$$) = 'OK');
select tt.ok('2i super admin cannot give Gamma a code equal to Beta''s slug',
  tt.try($$select public.admin_set_org_sign_in_code('cccccccc-0000-4000-8000-000000000003','beta-haulage')$$) like '23505%');
reset role;
select tt.ok('2j BETA/beta.admin resolves after the code is set',
  public.resolve_sign_in_user('beta/beta.admin') = :'BETA_ADMIN'::uuid);
select tt.ok('2k the slug keeps working beside the code',
  public.resolve_sign_in_user('beta-haulage/beta.admin') = :'BETA_ADMIN'::uuid);

-- Reads: an Alpha user sees nothing of Beta.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ALPHA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('2l Alpha admin reads 0 Beta profiles', count(*) = 0, count(*)::text)
  from public.profiles where org_id = :'BETA_ORG'::uuid;
select tt.ok('2m Alpha admin reads 0 Beta organisation rows', count(*) = 0, count(*)::text)
  from public.organisations where id = :'BETA_ORG'::uuid;
select tt.ok('2n Alpha admin cannot call resolve_sign_in_user',
  tt.try($$select public.resolve_sign_in_user('beta.admin')$$) like '42501%');
reset role;

-- ===========================================================================
-- 3. Duplicate usernames BEFORE ten9c: the global key still holds
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member(null, 'Inspector', 7)) ->> 'invite_token' as dup_tok \gset
reset role;
select tt.ok('3a pre-ten9c: an invited sign-up reusing an Alpha username is refused (global key)',
  tt.try(format($$insert into auth.users(id,email,raw_user_meta_data) values ('d0000000-0000-4000-8000-000000000001','field.ali+beta@users.tyrepulse.app', %L::jsonb)$$,
    json_build_object('username','field.ali','invite_token', :'dup_tok')::text)) like '23505%');
select tt.ok('3b the refused sign-up did NOT consume the invitation',
  (select accepted_at is null from public.org_invitations where token_hash = encode(sha256(convert_to(:'dup_tok','utf8')),'hex')));

-- ===========================================================================
-- 4. Invitations
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member(null, 'Inspector', 7)) ->> 'invite_token' as tok \gset
select tt.ok('4a invitation lands in the inviter''s company and stores only the hash',
  i.organisation_id = :'BETA_ORG'::uuid and i.token_hash = encode(sha256(convert_to(:'tok','utf8')),'hex')
  and position(:'tok' in to_jsonb(i)::text) = 0, to_jsonb(i)::text)
  from public.org_invitations i where i.token_hash = encode(sha256(convert_to(:'tok','utf8')),'hex');
select tt.ok('4b token is 64 hex characters (two uuids)', length(:'tok') = 64 and :'tok' ~ '^[0-9a-f]+$');
select tt.ok('4c Beta admin cannot INSERT an invitation directly (no insert policy)',
  tt.try($$insert into public.org_invitations(organisation_id, role, token_hash, expires_at) values ('bbbbbbbb-0000-4000-8000-000000000002','Admin','x',now()+interval '1 day')$$) like '42501%');
select tt.ok('4d Beta admin cannot UPDATE an invitation''s role directly',
  tt.try($$update public.org_invitations set role = 'Admin' where organisation_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$) = 'OK'
  and not exists (select 1 from public.org_invitations where role = 'Admin' and organisation_id = 'bbbbbbbb-0000-4000-8000-000000000002'));
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
select tt.ok('4e anon preview shows company, code and role',
  (p ->> 'ok')::boolean and p ->> 'organisation_name' = 'Beta Haulage LLC' and p ->> 'company_code' = 'BETA'
  and p ->> 'role' = 'Inspector' and (p ->> 'email_required')::boolean = false, p::text)
  from (select public.get_invitation_preview(:'tok') p) s;
select tt.ok('4f anon cannot read org_invitations', tt.try('select * from public.org_invitations') like '42501%');
select tt.ok('4g a wrong token previews as invalid',
  public.get_invitation_preview(repeat('0', 64)) ->> 'reason' = 'invalid');
reset role;

-- Accept, with a client trying to escalate through metadata.
select tt.signup('d0000000-0000-4000-8000-000000000002', 'beta.newbie+beta@users.tyrepulse.app', json_build_object('username','beta.newbie','invite_token', :'tok','company_code','BETA',
                          'role','Admin','approved',true,'org_id', :'ALPHA_ORG','is_super_admin',true)::jsonb) \g /dev/null
select tt.ok('4h accepted: Beta company, invited role (not the client-sent Admin), approved, not super',
  p.org_id = :'BETA_ORG'::uuid and p.organisation_id = :'BETA_ORG'::uuid and p.role = 'Inspector'
  and p.approved and not coalesce(p.is_super_admin, false), to_jsonb(p)::text)
  from public.profiles p where p.id = 'd0000000-0000-4000-8000-000000000002';
select tt.ok('4i invitation marked accepted by the new user',
  accepted_by = 'd0000000-0000-4000-8000-000000000002')
  from public.org_invitations where token_hash = encode(sha256(convert_to(:'tok','utf8')),'hex');
select tt.ok('4j new user signs in with BETA/beta.newbie',
  public.resolve_sign_in_user('BETA/beta.newbie') = 'd0000000-0000-4000-8000-000000000002');
select tt.ok('4k new user gets the synthetic address from get_email_by_identifier (code form)',
  public.get_email_by_identifier('beta/beta.newbie') = 'beta.newbie+beta@users.tyrepulse.app');

-- Reuse.
select tt.signup('d0000000-0000-4000-8000-000000000003', 'reuse.try+beta@users.tyrepulse.app',
        json_build_object('username','reuse.try','invite_token', :'tok')::jsonb) as r2 \gset
select tt.ok('4l reused token: no company, not approved, Reporter',
  :'r2' like 'REFUSED:%' or (:strict = 0 and :'r2' = 'ORPHAN'), :'r2');
select tt.ok('4m preview of a used token says used', public.get_invitation_preview(:'tok') ->> 'reason' = 'used');

-- Cancel.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (r ->> 'invite_token') as tok2, (r ->> 'invitation_id') as inv2 from (select public.org_invite_member(null, 'Driver', 3) r) s \gset
select tt.ok('4n Beta admin cancels a waiting invitation', (public.org_revoke_invitation(:'inv2'::uuid) ->> 'ok')::boolean);
select tt.ok('4o cancelling twice reports ok=false', not (public.org_revoke_invitation(:'inv2'::uuid) ->> 'ok')::boolean);
reset role;
select tt.ok('4p cancelled token previews as revoked', public.get_invitation_preview(:'tok2') ->> 'reason' = 'revoked');
select tt.signup('d0000000-0000-4000-8000-000000000004', 'cancel.try+beta@users.tyrepulse.app', json_build_object('username','cancel.try','invite_token', :'tok2')::jsonb) as r4 \gset
select tt.ok('4q sign-up with a cancelled token gets no company and no approval',
  :'r4' like 'REFUSED:%' or (:strict = 0 and :'r4' = 'ORPHAN'), :'r4');

-- Expire.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member(null, 'Driver', 1)) ->> 'invite_token' as tok3 \gset
reset role;
update public.org_invitations set expires_at = now() - interval '1 minute'
 where token_hash = encode(sha256(convert_to(:'tok3','utf8')),'hex');
select tt.ok('4r expired token previews as expired', public.get_invitation_preview(:'tok3') ->> 'reason' = 'expired');
select tt.signup('d0000000-0000-4000-8000-000000000005', 'expired.try+beta@users.tyrepulse.app', json_build_object('username','expired.try','invite_token', :'tok3')::jsonb) as r5 \gset
select tt.ok('4s sign-up with an expired token gets no company and no approval',
  :'r5' like 'REFUSED:%' or (:strict = 0 and :'r5' = 'ORPHAN'), :'r5');

-- Email-bound invitation.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member('Named.Person@Example.com', 'Manager', 7)) ->> 'invite_token' as tok4 \gset
reset role;
select tt.ok('4t preview says an email is required', (public.get_invitation_preview(:'tok4') ->> 'email_required')::boolean);
select tt.signup('d0000000-0000-4000-8000-000000000006', 'someone.else@example.com', json_build_object('username','someone.else','invite_token', :'tok4')::jsonb) as r6 \gset
select tt.ok('4u a different email cannot accept an email-bound invitation',
  :'r6' like 'REFUSED:%' or (:strict = 0 and :'r6' = 'ORPHAN'), :'r6');
select tt.ok('4v the refused attempt did not consume it', public.get_invitation_preview(:'tok4') ->> 'ok' = 'true');
select tt.signup('d0000000-0000-4000-8000-000000000007', 'named.person@example.com', json_build_object('username','named.person','invite_token', :'tok4')::jsonb) \g /dev/null
select tt.ok('4w the named email accepts (case-insensitive) with the invited role',
  p.org_id = :'BETA_ORG'::uuid and p.approved and p.role = 'Manager')
  from public.profiles p where p.id = 'd0000000-0000-4000-8000-000000000007';

-- Wrong company code on a good token.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (r ->> 'invite_token') as tok5, (r ->> 'invitation_id') as inv5 from (select public.org_invite_member(null, 'Driver', 7) r) s \gset
reset role;
select tt.signup('d0000000-0000-4000-8000-000000000008', 'code.mismatch+alpha@users.tyrepulse.app',
        json_build_object('username','code.mismatch','invite_token', :'tok5','company_code','alpha-readymix')::jsonb) as r7 \gset
select tt.ok('4x a company code that does not match the invitation is refused',
  :'r7' like 'REFUSED:%' or (:strict = 0 and :'r7' = 'ORPHAN'), :'r7');
select tt.ok('4y and the invitation stays usable', public.get_invitation_preview(:'tok5') ->> 'ok' = 'true');

-- A company code alone is not an invitation.
select tt.signup('d0000000-0000-4000-8000-000000000009', 'code.only+beta@users.tyrepulse.app', json_build_object('username','code.only','company_code','BETA')::jsonb) as r9 \gset
select tt.ok('4z company code without a token: no company (even in single-tenant mode)',
  :'r9' like 'REFUSED:%' or (:strict = 0 and :'r9' = 'ORPHAN'), :'r9');

-- Invitation to a locked company.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select (public.org_invite_member(null, 'Driver', 7)) ->> 'invite_token' as tok6 \gset
reset role;
update public.organisations set locked = true where id = :'BETA_ORG'::uuid;
select tt.ok('4za a locked company''s invitation previews as unavailable',
  public.get_invitation_preview(:'tok6') ->> 'reason' = 'unavailable');
update public.organisations set locked = false where id = :'BETA_ORG'::uuid;

-- ===========================================================================
-- 5. Who may invite / cancel
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_MGR', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('5a a Manager cannot invite', tt.try($$select public.org_invite_member(null,'Driver',7)$$) like '42501%');
select tt.ok('5b a Manager cannot cancel', tt.try(format($$select public.org_revoke_invitation(%L)$$, :'tok5')) like '42501%'
  or tt.try($$select public.org_revoke_invitation(gen_random_uuid())$$) like '42501%');
select tt.ok('5c a Manager reads no invitations', count(*) = 0, count(*)::text) from public.org_invitations;

select set_config('request.jwt.claims', json_build_object('sub', :'ALPHA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('5d Alpha admin reads none of Beta''s invitations', count(*) = 0, count(*)::text)
  from public.org_invitations where organisation_id = :'BETA_ORG'::uuid;
select tt.ok('5e Alpha admin cannot cancel a Beta invitation',
  not (public.org_revoke_invitation(:'inv5'::uuid) ->> 'ok')::boolean);
select tt.ok('5f Alpha admin''s invitation lands in Alpha',
  ((public.org_invite_member(null, 'Driver', 7)) ->> 'ok')::boolean);
select tt.ok('5g Alpha admin cannot invite with another company''s custom role or a made-up role',
  tt.try($$select public.org_invite_member(null,'Owner of everything',7)$$) like '22023%');
select tt.ok('5h a company Admin may invite another Admin (by design: Admin is a company role)',
  tt.try($$select public.org_invite_member(null,'Admin',7)$$) = 'OK');
select tt.ok('5i a company Admin cannot set a company code through the RPC',
  tt.try($$select public.admin_set_org_sign_in_code('00000000-0000-0000-0000-000000000001','ALPHA')$$) like '42501%');
select tt.ok('5j a company Admin cannot set the company code by updating organisations directly',
  tt.try($$update public.organisations set sign_in_code = 'ALPHA' where id = '00000000-0000-0000-0000-000000000001'$$) like '42501%',
  tt.try($$update public.organisations set sign_in_code = 'ALPHA2' where id = '00000000-0000-0000-0000-000000000001'$$));
select tt.try($$update public.organisations set slug = 'renamed-alpha' where id = '00000000-0000-0000-0000-000000000001'$$) as slug_res \gset
select tt.ok('5k a company Admin cannot change the company slug (the fallback sign-in code)', :'slug_res' like '42501%', :'slug_res');
reset role;

-- locked admin (a second Gamma admin first: the last admin cannot be locked)
alter table public.profiles disable trigger trg_guard_profile_privileged;
select tt.signup('d0000000-0000-4000-8000-00000000000a', 'gamma.second@users.tyrepulse.app', '{"username":"gamma.second"}'::jsonb) \g /dev/null
update public.profiles set role = 'Admin', org_id = :'GAMMA_ORG'::uuid, organisation_id = :'GAMMA_ORG'::uuid, approved = true
 where id = 'd0000000-0000-4000-8000-00000000000a';
update public.profiles set locked = true where id = :'GAMMA_ADMIN'::uuid;
alter table public.profiles enable trigger trg_guard_profile_privileged;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'GAMMA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('5l a locked Admin cannot invite', tt.try($$select public.org_invite_member(null,'Driver',7)$$) like '42501%');
reset role;
alter table public.profiles disable trigger trg_guard_profile_privileged;
update public.profiles set locked = false where id = :'GAMMA_ADMIN'::uuid;
alter table public.profiles enable trigger trg_guard_profile_privileged;
update public.organisations set active = false where id = :'GAMMA_ORG'::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'GAMMA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select tt.ok('5m an Admin of a suspended company cannot invite', tt.try($$select public.org_invite_member(null,'Driver',7)$$) like '42501%');
reset role;
update public.organisations set active = true where id = :'GAMMA_ORG'::uuid;

-- super admin
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'SUPER', 'role', 'authenticated', 'aal', 'aal2')::text, true) \g /dev/null
select tt.ok('5n super admin reads every company''s invitations', count(distinct organisation_id) >= 2, count(distinct organisation_id)::text)
  from public.org_invitations;
select tt.ok('5o super admin can cancel another company''s invitation',
  (public.org_revoke_invitation(:'inv5'::uuid) ->> 'ok')::boolean);
select (public.org_invite_member(null,'Driver',7)) ->> 'invitation_id' as inv_super \gset
select tt.ok('5p super admin''s own invitation lands in the super admin''s own company (Alpha)',
  organisation_id = :'ALPHA_ORG'::uuid, organisation_id::text) from public.org_invitations where id = :'inv_super'::uuid;
reset role;

rollback;
