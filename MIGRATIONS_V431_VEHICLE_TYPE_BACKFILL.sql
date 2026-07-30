-- V431 — vehicle_fleet.vehicle_type backfill from work_orders.asset_category
-- STATUS: APPLIED LIVE 2026-07-30 (project jhssdmeruxtrlqnwfksc, org Company A).
--
-- WHY: the accident form auto-fills site + vehicle_type from vehicle_fleet on asset pick,
-- but 921 of the fleet rows carried a BLANK vehicle_type (Egypt 133/133, KSA 417/1019,
-- UAE 371/371), so type never populated. The value exists on the job cards
-- (work_orders.asset_category), so it can be recovered without asking the customer.
--
-- WHAT: for each fleet row with a blank vehicle_type, take the MODE (most frequent
-- non-blank) asset_category across that asset's work_orders (same org + country) and
-- write it. The V245 BEFORE trigger trg_normalize_vehicle_type UPPER-cases it on write.
-- Result: 424 rows filled (TR-MIXER 248, PUMPS 71, GENERATOR 31, BT-PLANT 22,
-- WHEEL_LOADER 17, PICKUP 11, HEAVY EQP 6, BUS 5, EXCAVATOR 5, ICE PLANT 4, BUILDINGS 2,
-- PLACING BOOM 1, TRAILER 1). Blank vehicle_type fleet-wide 921 -> 497.
--
-- HONEST GAP: 497 rows stay NULL — those assets have NO asset_category on any job card
-- (and tyre_records carries none either), so there is no source to derive from. Left
-- NULL rather than fabricated. tyre_records.asset_category filled 0 of the 921.
--
-- REVERSIBLE: snapshot _bak.vehicle_type_backfill_20260730 holds the 424 changed rows'
-- prior (blank) value. Undo at the bottom.
--
-- NOTE: applied via execute_sql (the UPDATE client-timed-out at 60s but COMMITTED
-- server-side, verified by a follow-up count 921 -> 497). This file is the record.

-- ---------------------------------------------------------------------------
-- 1. snapshot (already taken live)
-- ---------------------------------------------------------------------------
create schema if not exists _bak;

create table if not exists _bak.vehicle_type_backfill_20260730 as
select f.id, f.asset_no, f.country, f.vehicle_type as prior_vehicle_type
from public.vehicle_fleet f
where coalesce(btrim(f.vehicle_type), '') = '';

-- ---------------------------------------------------------------------------
-- 2. backfill from the mode asset_category on the asset's job cards
-- ---------------------------------------------------------------------------
with cat_mode as (
  select w.organisation_id, w.country, w.asset_no,
         (array_agg(w.asset_category order by cnt desc))[1] as top_cat
  from (
    select organisation_id, country, asset_no, asset_category, count(*) as cnt
    from public.work_orders
    where coalesce(btrim(asset_category), '') <> ''
    group by organisation_id, country, asset_no, asset_category
  ) w
  group by w.organisation_id, w.country, w.asset_no
)
update public.vehicle_fleet f
set vehicle_type = m.top_cat            -- trg_normalize_vehicle_type UPPER-cases it
from cat_mode m
where coalesce(btrim(f.vehicle_type), '') = ''
  and m.organisation_id = f.organisation_id
  and m.country = f.country
  and m.asset_no = f.asset_no
  and coalesce(btrim(m.top_cat), '') <> '';

-- ---------------------------------------------------------------------------
-- UNDO
-- ---------------------------------------------------------------------------
-- update public.vehicle_fleet f
--   set vehicle_type = b.prior_vehicle_type
--   from _bak.vehicle_type_backfill_20260730 b
--   where b.id = f.id;
