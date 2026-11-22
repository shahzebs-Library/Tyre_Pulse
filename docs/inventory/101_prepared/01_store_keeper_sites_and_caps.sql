-- =============================================================================
-- 101_prepared/01_store_keeper_sites_and_caps.sql
-- STATUS: PREPARED, NOT APPLIED. Owner approval required (doc 101 section 1).
-- Supersedes the all-site, all-seven grant in 94_prepared/store_keeper_capabilities.sql:
-- only the THREE Store Keepers whose site is evidenced in production are granted, and
-- each is narrowed from {ALL} to the named sites first. The other four stay as they are
-- (no stock capability) until the owner names their sites.
--
-- Evidence (production, read-only, 2026-11-21):
--   MD JAHID       (10011207)  stock entry request at DIRIYAH-ST2 (store of DIRIYAH);
--                              audit rows on DIRIYAH                       -> {DIRIYAH}
--   SOMANATH NAYAK (SmNayak)   3 stock entry requests at NHC               -> {NHC}
--   Wasim khan     (Wkhan)     audit rows on RIY-MET and QIDDIYA-LOWER PLATEAU
--                                                        -> {RIY-MET, QIDDIYA-LOWER PLATEAU}
--   All four sites exist in public.sites (KSA).
--
-- Capabilities granted: receive, issue, transfer, count. NOT granted: any approval,
-- adjustment_approve, discrepancy_review, financial_post, scrap_approve, view_value,
-- recount, audit_create. 113000 also refuses a Store Keeper as approver by role,
-- whatever is granted.
--
-- Order matters: sites are narrowed BEFORE the capabilities exist, so there is no
-- moment where a Store Keeper can write stock at every site.
-- =============================================================================
begin;

do $$
declare v_n int;
begin
  if to_regprocedure('public.inv_can(text)') is null then
    raise exception 'Inventory release not applied (inv_can missing).';
  end if;
  select count(*) into v_n from public.profiles p
   where p.id in ('69faeb71-7ad5-497d-b583-55665797b009',   -- MD JAHID
                  '649cf3f7-59bb-47aa-9e0b-ae60cfa9c85e',   -- SOMANATH NAYAK
                  '249b32c1-06bf-4580-a12c-81262c896e40')   -- Wasim khan
     and p.role = 'Store Keeper' and coalesce(p.approved,false) and not coalesce(p.locked,false)
     and p.org_id = '00000000-0000-0000-0000-000000000001' and 'KSA' = any (p.country);
  if v_n <> 3 then raise exception 'Expected 3 eligible Store Keepers, found %.', v_n; end if;
  select count(distinct upper(name)) into v_n from public.sites
   where upper(name) in ('DIRIYAH','NHC','RIY-MET','QIDDIYA-LOWER PLATEAU');
  if v_n <> 4 then raise exception 'Expected the 4 named sites to exist, found %.', v_n; end if;
end $$;

-- Snapshot for exact rollback.
create schema if not exists _bak;
create table if not exists _bak.inv_store_keeper_sites_20261121 (
  user_id uuid primary key, old_sites text[], new_sites text[], changed_at timestamptz default now());
revoke all on _bak.inv_store_keeper_sites_20261121 from public;
insert into _bak.inv_store_keeper_sites_20261121 (user_id, old_sites, new_sites)
select p.id, p.sites, v.s from public.profiles p
  join (values ('69faeb71-7ad5-497d-b583-55665797b009'::uuid, array['DIRIYAH']),
               ('649cf3f7-59bb-47aa-9e0b-ae60cfa9c85e'::uuid, array['NHC']),
               ('249b32c1-06bf-4580-a12c-81262c896e40'::uuid, array['RIY-MET','QIDDIYA-LOWER PLATEAU'])) v(id, s)
    on v.id = p.id
on conflict (user_id) do nothing;

-- 1. Narrow sites through the guarded writer, acting as the platform-owner super admin
--    (aal2 because is_super_admin() requires it when MFA is enrolled).
select set_config('request.jwt.claims',
  '{"sub":"d2d43a5f-0906-4f7a-9577-e36d89164914","role":"authenticated","aal":"aal2"}', true);
select public.admin_set_user_sites('69faeb71-7ad5-497d-b583-55665797b009', array['DIRIYAH'], 'inv-ops-2026-11-21 doc 101 s1');
select public.admin_set_user_sites('649cf3f7-59bb-47aa-9e0b-ae60cfa9c85e', array['NHC'], 'inv-ops-2026-11-21 doc 101 s1');
select public.admin_set_user_sites('249b32c1-06bf-4580-a12c-81262c896e40', array['RIY-MET','QIDDIYA-LOWER PLATEAU'], 'inv-ops-2026-11-21 doc 101 s1');

do $$
begin
  if exists (select 1 from public.profiles
              where id in ('69faeb71-7ad5-497d-b583-55665797b009','649cf3f7-59bb-47aa-9e0b-ae60cfa9c85e',
                           '249b32c1-06bf-4580-a12c-81262c896e40')
                and ('ALL' = any (sites) or '*' = any (sites) or sites is null)) then
    raise exception 'A Store Keeper still has all-site scope; refusing to grant capabilities.';
  end if;
end $$;

-- 2. Capabilities (12 rows = 3 people x 4).
insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note)
select '00000000-0000-0000-0000-000000000001'::uuid, u.id, 'stock', c.cap, 'grant',
       'd2d43a5f-0906-4f7a-9577-e36d89164914'::uuid,
       'inv-ops-2026-11-21: Store Keeper site-scoped operations'
  from (values ('69faeb71-7ad5-497d-b583-55665797b009'::uuid),
               ('649cf3f7-59bb-47aa-9e0b-ae60cfa9c85e'),
               ('249b32c1-06bf-4580-a12c-81262c896e40')) u(id)
 cross join (values ('receive'), ('issue'), ('transfer'), ('count')) c(cap)
on conflict (user_id, module_key, capability, effect) do nothing;

-- The other four Store Keepers (Hosham Homeda, Mohammad Ansari, Mohd Asad,
-- MUHAMMAD NASIR HUSSAIN) have no site evidence. Owner names the sites, then repeat
-- blocks 1-2 for them. Never grant them while sites = {ALL}.

commit;

-- VERIFY (rolled back, one person at a time):
-- begin read only;
-- select set_config('request.jwt.claims','{"sub":"649cf3f7-59bb-47aa-9e0b-ae60cfa9c85e","role":"authenticated"}', true);
-- set local role authenticated;
-- select c, public.inv_can(c) from unnest(array['receive','issue','transfer','count',
--   'adjustment_approve','discrepancy_review','financial_post','view_value','recount','audit_create']) c;
-- select public._inv_scope_ok('KSA','NHC') as own_site, public._inv_scope_ok('KSA','DIRIYAH') as other_site;
-- rollback;   -- expect the 4 operational caps true, the rest false, own_site true, other_site false

-- ROLLBACK (exact):
-- begin;
-- delete from public.user_access_grants
--  where note = 'inv-ops-2026-11-21: Store Keeper site-scoped operations' and module_key = 'stock';  -- 12
-- select set_config('request.jwt.claims','{"sub":"d2d43a5f-0906-4f7a-9577-e36d89164914","role":"authenticated","aal":"aal2"}', true);
-- select public.admin_set_user_sites(b.user_id, b.old_sites, 'rollback doc 101 s1') from _bak.inv_store_keeper_sites_20261121 b;
-- commit;
