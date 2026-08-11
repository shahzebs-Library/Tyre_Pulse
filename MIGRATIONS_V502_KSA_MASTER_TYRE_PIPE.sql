-- MIGRATIONS_V502_KSA_MASTER_TYRE_PIPE.sql
-- STATUS: APPLIED LIVE 2026-08-11 (functions + view only; there is deliberately
--         NO loader - see "THE FINDING THAT DID NOT SURVIVE" below).
--
-- WHY THIS EXISTS
-- `ksa_country_upload_template_staging` holds 192,198 rows of the KSA master ERP
-- export and has ZERO triggers on it. Nothing consumes it. It is read by a few
-- backfills (V468 brand, V469 meters, V472 completeness) and is otherwise inert:
-- an upload lands there and changes nothing anyone can see. This migration gives
-- it a single, honest reading surface so that is no longer a mystery.
--
-- ============================================================================
-- THE FINDING THAT DID NOT SURVIVE VERIFICATION - READ THIS BEFORE RE-RAISING IT
-- ============================================================================
-- The first pass of this work concluded that 3,521 tyre fitments (3,392 serials)
-- were sitting in the sheet and missing from tyre_records - about a third of KSA
-- tyre history. THAT WAS WRONG, and the cause was in my own query, not the data.
--
-- The master sheet's values are TAB-POLLUTED: 50,713 of its 51,154 tyre rows
-- store the serial as "YLY59042\t\t". `btrim(x)` strips SPACES ONLY, so every
-- comparison against the (clean) live serial failed and every already-loaded tyre
-- looked new. Cleaned properly - btrim(x, E' \t\r\n') - the real numbers are:
--   6,013 fitments in the sheet, 5,991 already in tyre_records, 22 missing,
--   and all 22 of those 22 have a serial the file destroyed (Excel scientific
--   notation like "1.25121E+11", or a tyre SIZE sitting in the serial column).
-- So there is nothing to load, and NO loader was created. Had one been written
-- against the un-cleaned key it would have DUPLICATED 3,500 tyres.
--
-- RULE, now permanent: every value read from this sheet goes through
-- master_clean_value(). A dedupe key built on btrim() alone silently stops
-- matching and the "missing rows" it reports are its own bug.
--
-- ============================================================================
-- WHAT THIS SHEET IS NOT: A COST SOURCE
-- ============================================================================
-- The owner asked for cost up to 2025 to be taken from this sheet. Measured year
-- by year, the sheet's per-job-card totals and the expense grid's line items are
-- the SAME money, and the grid is the more complete side in EVERY year:
--   year   sheet total     grid total     grid line items
--   2018   (nothing)         645,834          1,458
--   2019     166,351       4,010,957          8,076
--   2020   3,697,387       4,092,371          7,770
--   2021   2,813,008       3,303,253          8,810
--   2022   4,964,588       4,920,887          7,629
--   2023   6,300,858       6,279,104         12,019
--   2024   7,655,365       7,723,087         18,413
--   2025   6,366,122       6,441,815         25,750
-- The sheet also leaves Tyre Value at 0 for every year before 2022 while the grid
-- carries real tyre cost from 2018. Pushing this sheet's cost into
-- parts_consumption would DOUBLE the KSA ledger and replace line-item detail with
-- a per-card lump. The grid stays the cost source. Do not wire cost from here.
--
-- The job-card side needs nothing either: all 59,983 job cards in the sheet are
-- already in work_orders, every one carrying a description, 55,464 with breakdown
-- hours and 55,490 with a production-out time.
--
-- ============================================================================
-- WHAT THE VIEW DOES GIVE YOU
-- ============================================================================
-- One row per tyre fitment (the ERP repeats the tyre columns on every line of the
-- job card, so 51,154 raw rows are really ~6,000 fitments), with:
--   * tokens cleaned, so a comparison against live data actually works;
--   * fit/remove corrected PER AXIS - 1,892 fitments have fix_date LATER than
--     remove_date, the reversal the owner flagged, and a row can have its dates
--     swapped while its km read correctly, so date, km and hours are each ordered
--     independently rather than as a set;
--   * the life recomputed as removal - fitment wherever both meters are known,
--     because the sheet's own total_km is not trustworthy (it reaches 1,081,000 km
--     on a transit mixer);
--   * serial_suspect on the values the file destroyed, so they are never treated
--     as real serials;
--   * already_loaded, computed on the CLEANED key.
--
-- ROLLBACK: drop view public.v_ksa_master_tyre_fitments; the functions are pure
-- and safe to leave.

-- ---------------------------------------------------------------------------
-- 1. The owner's per-class tyre-life ceilings.
--    "any tyres run more than 80K in transit mixer and 56K for Pump ... and other
--     as well should not cross more than 100K, wheel loaders should 15K above flag"
--    Above these a life is not a measurement, it is a data error to correct.
-- ---------------------------------------------------------------------------
create or replace function public.tyre_life_km_cap(p_vehicle_type text)
returns numeric
language sql
immutable
set search_path to 'public'
as $$
  select case
    when upper(coalesce(p_vehicle_type,'')) like '%MIXER%'  then 80000
    when upper(coalesce(p_vehicle_type,'')) like '%PUMP%'   then 56000
    when upper(coalesce(p_vehicle_type,'')) like '%LOADER%' then 15000
    else 100000
  end::numeric
$$;

-- ---------------------------------------------------------------------------
-- 2. Token cleaning. This is what makes any comparison against live data valid.
--    The sheet uses the literal text 'NULL' as its blank token AND pads values
--    with tabs. Both traps are handled here, once.
-- ---------------------------------------------------------------------------
create or replace function public.master_clean_token(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(
           upper(regexp_replace(btrim(coalesce(p,''), E' \t\r\n'), '\s+', ' ', 'g')),
           ''
         )
$$;

create or replace function public.master_clean_value(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when public.master_clean_token(p) in ('NULL','N/A','NA','-','#N/A') then null
    else public.master_clean_token(p)
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. The sheet collapsed to fitment grain, corrected. See the header for why
--    each correction is here. Read THIS, never the raw staging table.
-- ---------------------------------------------------------------------------
-- (Body applied live; reproduced in migration v502b_master_tyre_fitments_clean_tokens.)
-- create view public.v_ksa_master_tyre_fitments as ... ;

-- Grants: anon must not reach any of this. Order matters - Supabase grants
-- EXECUTE to anon at CREATE time, so revoking PUBLIC alone leaves it in place.
grant execute on function public.tyre_life_km_cap(text)   to authenticated, service_role;
revoke execute on function public.tyre_life_km_cap(text)  from public;
revoke execute on function public.tyre_life_km_cap(text)  from anon;
grant execute on function public.master_clean_token(text) to authenticated, service_role;
revoke execute on function public.master_clean_token(text) from public;
revoke execute on function public.master_clean_token(text) from anon;
grant execute on function public.master_clean_value(text) to authenticated, service_role;
revoke execute on function public.master_clean_value(text) from public;
revoke execute on function public.master_clean_value(text) from anon;
