-- ACCEPTANCE TEST USERS (snapshot copy rh_a only)
set session_replication_role = replica;
insert into auth.users (id, aud, role, email, created_at, updated_at, is_sso_user, is_anonymous) values
 ('a0000000-0000-4000-8000-000000000001','authenticated','authenticated','qa.admin@example.invalid',now(),now(),false,false),
 ('a0000000-0000-4000-8000-000000000002','authenticated','authenticated','qa.manager@example.invalid',now(),now(),false,false),
 ('a0000000-0000-4000-8000-000000000003','authenticated','authenticated','qa.storekeeper@example.invalid',now(),now(),false,false),
 ('a0000000-0000-4000-8000-000000000004','authenticated','authenticated','qa.invctl@example.invalid',now(),now(),false,false),
 ('a0000000-0000-4000-8000-000000000005','authenticated','authenticated','qa.finance@example.invalid',now(),now(),false,false),
 ('a0000000-0000-4000-8000-000000000006','authenticated','authenticated','qa.pmv@example.invalid',now(),now(),false,false),
 ('a0000000-0000-4000-8000-000000000007','authenticated','authenticated','qa.otherco@example.invalid',now(),now(),false,false);
insert into public.profiles (id, username, full_name, role, country, sites, approved, locked, is_super_admin, org_id, organisation_id, email, web_access)
select v.id::uuid, v.u, v.n, v.r, v.c::text[], v.s::text[], true, false, false, v.o::uuid, v.o::uuid, v.u||'@example.invalid', true from (values
 ('a0000000-0000-4000-8000-000000000001','qa.admin','QA Admin','Admin','{KSA}','{ALL}','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-000000000002','qa.manager','QA Manager','Manager','{KSA}','{ALL}','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-000000000003','qa.storekeeper','QA Store Keeper','Store Keeper','{KSA}','{NHC}','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-000000000004','qa.invctl','QA Inventory Controller','Inventory Controller','{KSA}','{ALL}','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-000000000005','qa.finance','QA Finance Manager','Finance Manager','{KSA}','{ALL}','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-000000000006','qa.pmv','QA PMV Manager','PMV Manager','{KSA}','{ALL}','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-000000000007','qa.otherco','QA Other Company Manager','Manager','{Egypt}','{ALL}','e340fa7a-fd5c-466f-a4c3-d60c3d03d74e')
) v(id,u,n,r,c,s,o);
set session_replication_role = origin;
-- site-restricted Store Keeper: same 4 grants as 94_prepared/store_keeper_capabilities.sql, scope = profiles.sites {NHC}
insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note)
select '00000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, 'stock', c, 'grant',
       'a0000000-0000-4000-8000-000000000001'::uuid, 'inv-release-2026-11: Store Keeper operations (receive/issue/transfer/count)'
from unnest(array['receive','issue','transfer','count']) c on conflict do nothing;
