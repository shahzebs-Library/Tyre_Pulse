-- =============================================================================
-- 94_prepared/store_keeper_capabilities.sql
-- STATUS: PREPARED, NOT APPLIED. Owner approval required. Run ONLY AFTER all 16
--         inventory migrations (20261120100000..115000) are applied and verified.
-- Purpose: let the 7 live Store Keepers RECEIVE, ISSUE, TRANSFER and COUNT stock.
--          Nothing else: no approval, no financial posting, no unit-cost visibility.
--
-- Capability model (read from the pending migrations and the live app_user_can):
--   * every inventory write calls public.inv_can(cap) = app_user_can('stock', cap)
--     (20261120100000 line ~130);
--   * _inv_cap_for: receipt / consignment_receipt / supplier_return -> 'receive';
--     issue / return / issue_return / reserve / release -> 'issue';
--     transfer_in / transfer_out (dispatch + receive) -> 'transfer';
--     legacy set_stock_count / save_stock_entry(count) / 101000 bin count -> 'count'.
--   * NOT granted (stay false for Store Keeper): adjustment_approve, discrepancy_review,
--     financial_post, scrap_approve, view_value, procure, recount, audit_create,
--     audit_history, engineering_approve, edit, delete.
--   * Blind counts inside a physical audit are assigned per person (counter_id), not
--     by capability; an Admin / Inventory Controller with audit_create assigns them.
--   * Store Keeper is ALSO refused as approver of stock adjustments, cost
--     reconciliations and opening balances by 113000 (role refusal, whatever is granted).
--
-- Mechanism: one user_access_grants row (effect 'grant') per person per capability,
-- module 'stock'. Unique key (user_id, module_key, capability, effect) -> idempotent.
-- Chosen over a role-wide permission_overrides entry so the grant is per named person
-- and removable per person; a future Store Keeper hire does NOT inherit it.
-- Live app_user_can order: super > entitlement > Admin > (delete=false) > per-org
-- override / role default > revoke > grant. Store Keeper role default for every stock
-- capability except view/create is false (measured), so these rows are the only source.
--
-- Scope (measured on production 2026-11-20 ~21:15 UTC, read-only):
--   all 7 Store Keepers: organisation 00000000-0000-0000-0000-000000000001
--   (Default Organisation), country {KSA}, sites {ALL}, approved, not locked,
--   no existing 'stock' grant or revoke rows.
--   Company scope  = the grant row's org_id + RESTRICTIVE org isolation on every table.
--   Country scope  = profiles.country (app_write_country_ok) -> KSA only.
--   Site scope     = profiles.sites (_inv_scope_ok) -> today ALL sites.
--   Warehouse scope: the release has NO per-warehouse user assignment table; a
--                  warehouse / bin is an inventory_location under a SITE, so the
--                  narrowest enforceable scope is the site. To restrict a Store Keeper
--                  to their own store, narrow profiles.sites (block 3, OPTIONAL;
--                  the owner must name the sites per person).
--
-- granted_by = the platform-owner super admin (d2d43a5f-...); change if another
-- approver signs. note tags every row so the rollback is exact.
-- =============================================================================
begin;

-- 1. Guards: the people are exactly the reviewed ones and still eligible.
do $$
declare v_n int; v_bad text;
begin
  if to_regprocedure('public.inv_can(text)') is null then
    raise exception 'Apply the 16 inventory migrations first (inv_can missing).';
  end if;
  select count(*) into v_n
    from public.profiles p
   where p.id in ('e8c653dd-c3a3-4c79-b56f-89bf36236b8f','69faeb71-7ad5-497d-b583-55665797b009',
                  '199bb37c-593d-416d-a5ee-9d043bb93542','f6e0fa04-e9a1-4667-ad5c-b9a7e18c14c9',
                  'c5eebffc-37a8-4d98-bbbf-214b9c07873f','649cf3f7-59bb-47aa-9e0b-ae60cfa9c85e',
                  '249b32c1-06bf-4580-a12c-81262c896e40')
     and p.role = 'Store Keeper' and coalesce(p.approved, false) and not coalesce(p.locked, false)
     and p.org_id = '00000000-0000-0000-0000-000000000001' and 'KSA' = any (p.country);
  if v_n <> 7 then
    raise exception 'Expected 7 eligible Store Keepers, found %. Re-check profiles before granting.', v_n;
  end if;
  select string_agg(g.user_id::text || ':' || g.capability, ', ') into v_bad
    from public.user_access_grants g
   where g.module_key = 'stock' and g.effect = 'revoke'
     and g.capability in ('receive','issue','transfer','count')
     and g.user_id in ('e8c653dd-c3a3-4c79-b56f-89bf36236b8f','69faeb71-7ad5-497d-b583-55665797b009',
                  '199bb37c-593d-416d-a5ee-9d043bb93542','f6e0fa04-e9a1-4667-ad5c-b9a7e18c14c9',
                  'c5eebffc-37a8-4d98-bbbf-214b9c07873f','649cf3f7-59bb-47aa-9e0b-ae60cfa9c85e',
                  '249b32c1-06bf-4580-a12c-81262c896e40');
  if v_bad is not null then
    raise exception 'A revoke row would cancel the grant (revoke wins): %. Resolve it first.', v_bad;
  end if;
end $$;

-- 2. The grants (28 rows = 7 people x 4 capabilities).
insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note)
select '00000000-0000-0000-0000-000000000001'::uuid, u.id, 'stock', c.cap, 'grant',
       'd2d43a5f-0906-4f7a-9577-e36d89164914'::uuid,
       'inv-release-2026-11: Store Keeper operations (receive/issue/transfer/count)'
  from (values ('e8c653dd-c3a3-4c79-b56f-89bf36236b8f'::uuid), ('69faeb71-7ad5-497d-b583-55665797b009'),
               ('199bb37c-593d-416d-a5ee-9d043bb93542'), ('f6e0fa04-e9a1-4667-ad5c-b9a7e18c14c9'),
               ('c5eebffc-37a8-4d98-bbbf-214b9c07873f'), ('649cf3f7-59bb-47aa-9e0b-ae60cfa9c85e'),
               ('249b32c1-06bf-4580-a12c-81262c896e40')) u(id)
 cross join (values ('receive'), ('issue'), ('transfer'), ('count')) c(cap)
on conflict (user_id, module_key, capability, effect) do nothing;

-- 3. OPTIONAL site narrowing (warehouse = site). Owner fills the real sites per person.
--    profiles.sites is guarded by trg_guard_profile_privileged: use Console -> Users
--    (admin_set_user_sites) signed in as a super admin, not raw SQL.
-- select public.admin_set_user_sites('<user uuid>', array['NHC']);

commit;

-- =============================================================================
-- VERIFY (read-only, impersonates one person, rolled back; repeat per user id).
-- Expect: receive / issue / transfer / count = true; every other capability = false.
-- =============================================================================
-- begin read only;
-- select set_config('request.jwt.claims','{"sub":"e8c653dd-c3a3-4c79-b56f-89bf36236b8f","role":"authenticated"}', true);
-- set local role authenticated;
-- select c, public.inv_can(c) from unnest(array['receive','issue','transfer','count',
--   'adjustment_approve','discrepancy_review','financial_post','scrap_approve','view_value',
--   'procure','recount','audit_create','engineering_approve']) c;
-- rollback;
-- select count(*) from public.user_access_grants
--  where note = 'inv-release-2026-11: Store Keeper operations (receive/issue/transfer/count)';  -- 28

-- =============================================================================
-- ROLLBACK (exact: removes only the rows this file created).
-- =============================================================================
-- begin;
-- delete from public.user_access_grants
--  where note = 'inv-release-2026-11: Store Keeper operations (receive/issue/transfer/count)'
--    and module_key = 'stock' and effect = 'grant';                        -- expect 28
-- commit;
