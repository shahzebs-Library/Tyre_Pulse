-- =====================================================================
-- V403 - THE BRAND WAS NEVER MISSING, IT WAS IN THE WRONG COLUMN
-- Applied live 2026-07-28, together with V401c.
-- =====================================================================
--
-- User: "if something is not missing, backfill it if it's safe and correct."
--
-- MEASURED: 1,839 tyre rows held a BRAND in `removal_reason` - a column
-- misalignment on the UAE/Egypt tyre import. This closes the long-standing open
-- item "Egypt 475 blank brand, needs a re-import from the source files" WITHOUT
-- a re-import: 469 of those 475 were carrying a real brand all along.
--
-- WHICH VALUES MOVE IS DECIDED BY EVIDENCE, NOT A HAND-WRITTEN LIST.
-- A value moves only if it matches `brain_tokens('tyre_brand')`, the catalog the
-- classifier already uses - the same principle as V400d's veto reusing
-- `oil_part`. There is no second list to drift out of step.
--
-- THE SPLIT IS PERFECTLY CLEAN, and that is what makes this safe rather than a
-- judgement call:
--   IN the catalog     -> 582 rows, EVERY ONE of them UAE or Egypt
--        PIRELLI 454 (Egypt) · ROADX 67 · FIREMAX 15 · TRIANGLE 15
--        BRIDGESTONE 12 (Egypt) · ROCK HOLDER 7 · LONGMARCH 5 · BLACKHAWK 4
--        SAILUN 2 (Egypt) · TEGRYS 1 (Egypt)
--   NOT in the catalog -> 65 rows, EVERY ONE of them KSA, and every one a real
--        removal reason: WORN OUT 29, PUNCTURE 14, BLAST/BURST 6, DAMAGED 5,
--        THREAD SEPRATION 2, REPLACED 2, SIDE WALL DAMAGE 1, ALIGNMENT 1.
-- The misalignment is UAE/Egypt only; the genuine reasons are KSA only. Two
-- independent signals agreeing is what turns this from a guess into a fix.
--
-- RADIAL IS DELIBERATELY NOT MOVED. It is used as a brand on a handful of rows
-- elsewhere, so a purely data-driven test would have accepted it - but radial is
-- a tyre CONSTRUCTION type, not a manufacturer, and moving it would propagate a
-- bad value rather than recover a good one. It affects 1 row.
--
-- removal_reason IS CLEARED on the moved rows. A brand sitting there is not a
-- removal reason and actively corrupts the analysis: before this, ROADX was the
-- SECOND most common "reason a tyre was removed" in the entire fleet.
--
-- RESULT, VERIFIED LIVE:
--   582 rows moved, Egypt and UAE only
--   blank brand across the fleet   752 -> 170
--   Egypt blank brand              475 -> 6
--   brands left in removal_reason  0
--   KSA removal reasons preserved  2,232 (untouched)
--
-- =====================================================================

create table if not exists public._brand_from_removal_reason_v403 (
  id uuid primary key,
  country text,
  asset_no text,
  serial_no text,
  old_brand text,
  old_removal_reason text,
  new_brand text,
  moved_at timestamptz not null default now()
);

revoke all on public._brand_from_removal_reason_v403 from anon, authenticated;

with catalog as (
  select distinct regexp_replace(lower(tok), '[^a-z0-9]', '', 'g') as b
  from unnest(public.brain_tokens('tyre_brand')) as tok
),
target as (
  select t.id, t.country, t.asset_no, t.serial_no, t.brand as old_brand,
         t.removal_reason as old_removal_reason,
         upper(btrim(t.removal_reason)) as new_brand
  from public.tyre_records t
  where t.organisation_id = '00000000-0000-0000-0000-000000000001'
    and (t.brand is null or btrim(t.brand) = '')
    and t.removal_reason is not null and btrim(t.removal_reason) <> ''
    and regexp_replace(lower(btrim(t.removal_reason)), '[^a-z0-9]', '', 'g')
        in (select b from catalog)
)
insert into public._brand_from_removal_reason_v403
       (id, country, asset_no, serial_no, old_brand, old_removal_reason, new_brand)
select id, country, asset_no, serial_no, old_brand, old_removal_reason, new_brand
from target
on conflict (id) do nothing;

update public.tyre_records t
   set brand = s.new_brand,
       removal_reason = null
  from public._brand_from_removal_reason_v403 s
 where t.id = s.id
   and t.organisation_id = '00000000-0000-0000-0000-000000000001';

-- =====================================================================
-- V401c (applied with this) - A FILLED PRICE MUST NEVER BECOME EVIDENCE
--
-- V401's comment claimed comparables are "never drawn from tyres this process
-- filled". The code did not do that: the `known` CTE took any row with
-- cost_per_tyre > 0, and after one run the rows this process wrote satisfy that.
-- A second run would have priced tyres from the first run's guesses, and a third
-- from guesses about guesses - drifting further from any measured price while
-- looking exactly as confident.
--
-- Found by asking what a SECOND run would do, not by reading the first. Fixed
-- with one NOT EXISTS against tyre_price_backfill_log. It also makes the undo
-- meaningful: undoing a batch removes its log rows, so those tyres become
-- eligible evidence again only once they carry a real price.
--
-- =====================================================================
-- THE BACKFILL WAS THEN APPLIED FOR REAL - 3 batches, each undoable
--
--   KSA    63.8% -> 97.2% priced   2,017 filled   median SAR 900.00
--   UAE     0.0% -> 56.4% priced     568 filled   median AED 714.71
--   Egypt   0.0% -> 85.1% priced     404 filled   median EGP 14,181.29
--   by source: own_jobcard 1,001 · comparable 1,988 · warranty 0
--
-- VERIFIED AFTER APPLYING:
--   rows that already had a price and were overwritten ......... 0
--   filled prices falling outside the range of REAL observed
--     prices in their own country .............................. 0
--
-- WHAT THIS DOES AND DOES NOT CHANGE. Tyre SPEND totals are unaffected: they
-- read the expense grid via loadCostSplit, and the standing rule is never to sum
-- cost_per_tyre for a total. What it changes is CPK, which legitimately uses the
-- per-tyre price - 2,989 more tyres can now produce a cost per kilometre.
--
-- STILL UNPRICED, and honestly so: 676 tyres (KSA 166, UAE 439, Egypt 71). UAE
-- and Egypt had no measured price at all before this, so there is nothing real
-- to compare the remainder against, and V401c refuses to compare them against
-- our own fills.
--
-- UNDO
--   Brands:
--     update public.tyre_records t
--        set brand = s.old_brand, removal_reason = s.old_removal_reason
--       from public._brand_from_removal_reason_v403 s
--      where t.id = s.id;
--   Prices, per batch:
--     select public.tyre_price_backfill_undo('<batch_id>');
--     select distinct batch_id, country from public.tyre_price_backfill_log;
-- =====================================================================
