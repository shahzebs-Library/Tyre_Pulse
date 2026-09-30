-- ============================================================================
-- 20260930120001_fleet_workorder_write_gates
-- STATUS: APPLIED LIVE 2026-09-30 on owner instruction: restrict to admin only.
--
-- FINDING (audit 2026-09-30, AUD-01, HIGH): write access to the asset register
-- and to job cards is open to EVERY approved account, including the 674
-- provisioned Driver accounts, because permissive policies of the "any
-- signed-in user" shape sit beside the intended role gates and annul them
-- (same class as kpi_targets / V501):
--   vehicle_fleet.vehicle_fleet_insert  WITH CHECK (auth.uid() is not null and auth.role()='authenticated')
--   vehicle_fleet.vehicle_fleet_update  USING/CHECK same
--   vehicle_fleet.vehicle_fleet_delete  USING same (delete still stopped by the
--                                       RESTRICTIVE admin_only_delete_guard)
--   work_orders.work_orders_insert_authenticated WITH CHECK (auth.uid() is not null)
--   work_orders.work_orders_update     USING/CHECK is_approved_and_unlocked()
-- The intended gate vf_write_elevated is DEAD: it compares profiles.role to
-- lowercase 'admin','manager' while profiles.role is Title Case.
--
-- EVIDENCE (all inside DO blocks that raise at the end = rolled back):
--   Driver 69ed2a92 (app_user_can fleet_master = V---, work_orders = ----):
--     update vehicle_fleet set status='Inactive', current_km=0, site='ZZ' (3 KSA rows) -> 3 rows written
--     insert into vehicle_fleet(asset_no,country,organisation_id) values ('ZZAUDIT9','KSA',<orgA>) -> ALLOWED
--     update work_orders set labour_cost=labour_cost+1, status='Completed' (3 open KSA rows) -> 3 rows written
--   Same "update vehicle_fleet (3 rows)" -> 3 for Tyre Man 4b760941, Tyre Data
--   Collector 6b6ba363, Reporter 33e40d9c and Manager 34793423.
--   Cross-org (Demo org Manager c2f9a806) insert into org A -> 42501 (org wall holds).
--
-- WHO KEEPS WRITE ACCESS AFTER THIS MIGRATION
--   * Admin / super admin (app_user_can is TRUE for them) via the existing *_cap_* policies.
--   * Anyone the capability matrix / a per-user grant gives fleet_master or
--     work_orders create/edit (existing *_cap_* policies, untouched).
--   * SECURITY DEFINER paths (sync_asset_current_km trigger, recon_* backfills,
--     import commit, promote_erp_*) - unaffected (they bypass RLS).
-- KNOWN CLIENT IMPACT (read before applying):
--   * src/pages/Vehicle360.jsx -> vehicle360.uploadVehiclePhoto / saveVehicleGps
--     update vehicle_fleet.image_path / latitude/longitude with no role gate.
--     Non-elevated users without a fleet_master edit grant will get 42501 there.
--     Either grant fleet_master:edit to the roles that should do this, or move
--     those two writes into a narrow SECURITY DEFINER RPC first.
--   * /work-orders (ModuleRoute work_orders): users who today only hold
--     work_orders:view (e.g. Tyre Data Collector) will no longer be able to save
--     edits - which is what the matrix says they should get.
--   * Mobile (Expo/Flutter) does not write either table except the admin-only
--     mobile/app/(app)/admin/sites.tsx (Admin passes app_is_elevated).
--
-- PRE-FLIGHT: no DML; policy DDL only (brief ACCESS EXCLUSIVE on vehicle_fleet
-- 1,622 rows and work_orders ~93,730 rows - run off-peak). No triggers fire.
-- ============================================================================

begin;

-- OWNER DECISION 2026-09-30: writes are ADMIN ONLY (not admin/manager/director).
-- No new policy is needed: the existing permissive *_cap_* policies call
-- app_user_can(), which is TRUE for Admin / super admin, and TRUE for any user an
-- admin explicitly grants fleet_master / work_orders create or edit. Dropping the
-- "any signed-in user" policies (and the dead lowercase one) is the whole fix.
drop policy if exists vehicle_fleet_insert on public.vehicle_fleet;
drop policy if exists vehicle_fleet_update on public.vehicle_fleet;
drop policy if exists vehicle_fleet_delete on public.vehicle_fleet;
drop policy if exists vf_write_elevated    on public.vehicle_fleet;

drop policy if exists work_orders_insert_authenticated on public.work_orders;
drop policy if exists work_orders_update               on public.work_orders;

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (after apply). Each DO block raises its result, so it rolls back.
--
-- do $$ declare r jsonb := '{}'; n int; begin
--   perform set_config('request.jwt.claims', json_build_object('sub','69ed2a92-0e66-4d5a-a118-9354eb1fb1f4','role','authenticated')::text, true);
--   set local role authenticated;
--   with u as (update public.vehicle_fleet set make=make where id in (select id from public.vehicle_fleet where country='KSA' order by id limit 3) returning 1) select count(*) into n from u; r:=r||jsonb_build_object('drv_fleet_upd',n);          -- expect 0
--   begin insert into public.vehicle_fleet(asset_no,country,organisation_id) values ('ZZAUDIT9','KSA','00000000-0000-0000-0000-000000000001'); r:=r||'{"drv_fleet_ins":"ALLOWED"}';
--   exception when others then r:=r||jsonb_build_object('drv_fleet_ins',sqlstate); end;                                                                                                            -- expect 42501
--   with u as (update public.work_orders set status=status where id in (select id from public.work_orders where country='KSA' order by id limit 3) returning 1) select count(*) into n from u; r:=r||jsonb_build_object('drv_wo_upd',n);        -- expect 0
--   reset role; raise exception 'RESULT %', r; end $$;
--
-- Repeat with Manager 34793423-43df-4b6f-9270-9d1e8be6fa30: fleet update 3,
-- work order update 3 (elevated keeps access). Repeat with Admin
-- d2d43a5f-0906-4f7a-9577-e36d89164914: 3 / 3.
-- Then: get_advisors security -> no new finding.
--
-- ROLLBACK:
-- begin;
-- drop policy if exists vehicle_fleet_insert_elevated on public.vehicle_fleet;
-- drop policy if exists vehicle_fleet_update_elevated on public.vehicle_fleet;
-- drop policy if exists vehicle_fleet_delete_elevated on public.vehicle_fleet;
-- drop policy if exists work_orders_insert_elevated   on public.work_orders;
-- drop policy if exists work_orders_update_elevated   on public.work_orders;
-- create policy vehicle_fleet_insert on public.vehicle_fleet for insert to authenticated
--   with check (((select auth.uid()) is not null) and ((select auth.role()) = 'authenticated'));
-- create policy vehicle_fleet_update on public.vehicle_fleet for update to authenticated
--   using (((select auth.uid()) is not null) and ((select auth.role()) = 'authenticated'))
--   with check (((select auth.uid()) is not null) and ((select auth.role()) = 'authenticated'));
-- create policy vehicle_fleet_delete on public.vehicle_fleet for delete to authenticated
--   using (((select auth.uid()) is not null) and ((select auth.role()) = 'authenticated'));
-- create policy vf_write_elevated on public.vehicle_fleet for all to authenticated
--   using (exists (select 1 from public.profiles where profiles.id = (select auth.uid())
--     and profiles.role = any (array['admin','manager']) and profiles.approved = true));
-- create policy work_orders_insert_authenticated on public.work_orders for insert to authenticated
--   with check ((select auth.uid()) is not null);
-- create policy work_orders_update on public.work_orders for update to authenticated
--   using (public.is_approved_and_unlocked()) with check (public.is_approved_and_unlocked());
-- commit;
-- ----------------------------------------------------------------------------
