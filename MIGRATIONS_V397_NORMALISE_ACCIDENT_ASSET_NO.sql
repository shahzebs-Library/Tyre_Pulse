-- V397: accidents.asset_no was the one table V337 missed.
--
-- APPLIED LIVE 2026-07-28 as v397_normalise_accident_asset_no.
--
-- V337 normalised asset_no to upper(btrim()) across vehicle_fleet, tyre_records,
-- work_orders, work_order_line_items and parts_consumption, and added a guard
-- trigger to each so an import cannot reintroduce the drift. `accidents` got
-- trg_normalize_site and trg_normalize_vehicle_type but NOT the asset_no one.
--
-- MEASURED CONSEQUENCE: 4 of 35 incidents carried a lower-case asset number
-- (tm673, tm373, tm642, tm686) and ALL FOUR failed to join vehicle_fleet, so
-- those incidents could not be linked to their vehicle at all - no make, no
-- model, no site from the register. It also split an asset in two for any
-- per-asset analysis: tm673 and TM673 counted as different vehicles, which is
-- exactly what hid a repeat incident and a probable duplicate record.
--
-- VERIFIED AFTER: 4 rows changed, 0 off-canonical, and unjoinable-to-fleet went
-- 4 -> 0.
--
-- The function already existed and is used by five other tables; this only
-- attaches it and backfills the rows entered before it did.
--
-- Snapshot: public._accident_asset_snapshot_v397 (deny-all). Undo:
--   update public.accidents a set asset_no = s.asset_no
--     from public._accident_asset_snapshot_v397 s where s.id = a.id;
--
-- STILL OPEN, deliberately not touched: 3 vehicle-and-date combinations appear
-- more than once (MP083 on 2026-07-08, TM673 and TM373 on their own dates). They
-- may be genuine repeat events or the same incident entered twice, and only the
-- customer can tell. The Accidents analytics page now lists them for review and
-- says outright that every count includes them.

create table if not exists public._accident_asset_snapshot_v397 as
select id, asset_no from public.accidents where asset_no <> upper(btrim(asset_no));

revoke all on public._accident_asset_snapshot_v397 from anon, authenticated;

-- The audit + domain-event triggers fire on this update, which is correct: a
-- change to a business key should be recorded like any other.
update public.accidents
   set asset_no = upper(btrim(asset_no))
 where asset_no is not null and asset_no <> upper(btrim(asset_no));

drop trigger if exists trg_normalize_asset_no on public.accidents;
create trigger trg_normalize_asset_no
  before insert or update on public.accidents
  for each row execute function public.normalize_asset_no();
