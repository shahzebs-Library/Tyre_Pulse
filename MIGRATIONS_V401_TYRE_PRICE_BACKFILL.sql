-- =====================================================================
-- V401 / V401b - FILL A TYRE'S MISSING PRICE FROM EVIDENCE, AND REFUSE
--                TO FILL IT FROM THE WRONG EVIDENCE
-- Applied live 2026-07-28. This file is the record of both.
-- =====================================================================
--
-- User: "if a tyre has same period of time but uploaded with zero cost add
-- backfill based on previous data plus also if in the description it shows
-- repair tyre not to add or warranty tyre cost must be zero"
--
-- MEASURED FIRST, and two of the three assumptions in the request needed
-- correcting before anything could be built:
--
--  1. "ZERO COST" IS NOT ZERO, IT IS NULL. `cost_per_tyre = 0` matches ZERO rows
--     in every country. 3,665 tyres carry no price at all: KSA 2,183, and UAE
--     (1,007) and Egypt (475) are 100% priceless. The fill condition covers both
--     forms, because a literal 0 is the same problem and must not be skipped.
--
--  2. THE DESCRIPTION IS NOT ON THE TYRE. `tyre_records.description` is NULL on
--     all 7,508 rows, so the repair/warranty wording can only come from the
--     expense grid's item_description - which is also where the price lives.
--
--  3. EVERY PRICELESS TYRE HAS A JOB CARD (3,665 of 3,665), so the grid link is
--     available for all of them.
--
-- =====================================================================
-- THE EXISTING BACKFILL WAS WRONG AND IS SUPERSEDED
-- =====================================================================
-- V327's backfill_tyre_prices_from_grid took `round(avg(tyre_cost))` - the LINE
-- total - and wrote it as the per-tyre price, never dividing by quantity.
-- Measured on the live grid, 4,334 of 14,911 tyre lines (29%) cover more than
-- one tyre, up to 20 on a single line:
--     UAE    line avg 2,162.20  vs unit avg   692.38   = 3.1x overstated
--     KSA    line avg 2,350.73  vs unit avg   940.07   = 2.5x overstated
--     Egypt  line avg 53,865.77 vs unit avg 10,508.11  = 5.1x overstated
-- It also had no repair exclusion, no dry run and no undo. It is left in place
-- but COMMENTed as superseded so nobody calls it by accident.
--
-- =====================================================================
-- THE THREE RULES
-- =====================================================================
-- A REPAIR IS NOT A PRICE. Egypt carries 35 lines reading "Repair TIRE
-- 315/80R22.5" and "Repair TIRE 385/65/R22.5", EGP 155,504 in total, sitting in
-- the tyre bucket. Repairing a tyre is a service; using that figure as a tyre's
-- purchase price would be wrong twice over. Verified live: a tyre whose ONLY
-- grid evidence was a planted repair line priced at 99,999 was NOT FILLED AT ALL.
--
-- A WARRANTY REPLACEMENT COSTS NOTHING, so it is stamped 0 rather than
-- backfilled, and warranty outranks even a measured price - if the tyre was
-- replaced free, what an equivalent tyre costs is not what THIS one cost.
-- Verified live: a tyre pricing at 885.83 AED from its own job card became
-- 0 via warranty once a warranty line existed on that card.
-- HONEST NOTE: no warranty wording exists anywhere in the grid today - the probe
-- returns zero rows in all three countries - so this rule currently matches
-- nothing. It is built for when that data arrives, and every surface reports the
-- count so it never looks like it did something.
--
-- THE SOURCE LADDER, strongest first:
--   1. warranty      -> 0
--   2. own_jobcard   -> this tyre's own purchase, value / quantity, repairs excluded
--   3. comparable    -> the MEDIAN price of the same country + brand + size bought
--                       earlier. A median, not the nearest row, so one mistyped
--                       price cannot become the fleet's answer. Comparables are
--                       drawn only from tyres with a REAL price, never from ones
--                       this process filled, or one guess would seed the next.
--   4. nothing       -> left NULL. Never invented.
--
-- =====================================================================
-- V401b - MONEY IS REPORTED PER COUNTRY, NEVER BLENDED
-- =====================================================================
-- V401's response carried one by_source.value and avg_price across all three
-- countries: SAR + AED + EGP added together, the exact illegal arithmetic this
-- repo has already fixed at four separate reader sites. It showed immediately -
-- the "own_jobcard" average read 6,348.90, which is not a tyre price anywhere,
-- only Egypt's EGP figures dragging a mixed-currency mean. Counts are
-- currency-free and stay at the top level; every money figure now sits inside a
-- country, so there is nothing a caller can render as one total.
--
-- =====================================================================
-- WHAT IT WOULD DO TODAY (dry run, verified live)
-- =====================================================================
--   2,989 of 3,665 priceless tyres can be priced (82%)
--     KSA    2,017 rows  SAR 1,904,355  median   900.00
--     UAE      568 rows  AED   424,468  median   714.71
--     Egypt    404 rows  EGP 5,893,604  median 14,181.29
--   by source: own_jobcard 1,001 | comparable 1,988 | warranty 0
--   Every median is a plausible tyre price in its own currency.
--
-- ROUND TRIP VERIFIED LIVE, ROLLED BACK (UAE):
--   priceless 1,007 -> applied 568 -> 439 remain -> undo restored 568 -> 1,007
--   0 rows had a pre-existing price, so nothing was overwritten.
--
-- =====================================================================

create or replace function public.tyre_price_is_repair(p_text text)
returns boolean language sql immutable parallel safe set search_path to 'public'
as $$
  -- Whole-word. Substring matching is what once made "Shell RIMula" match "rim".
  -- Plurals are listed, never implied.
  select coalesce(p_text, '') ~*
    '\y(repair|repairs|repairing|puncture|punctures|patch|patches|patching|vulcaniz\w*|vulcanis\w*|retread|retreads|remould|remold)\y';
$$;

create or replace function public.tyre_price_is_warranty(p_text text)
returns boolean language sql immutable parallel safe set search_path to 'public'
as $$
  select coalesce(p_text, '') ~*
    '\y(warranty|warrantee|guarantee|free of charge|no charge|zero charge|f\.o\.c|foc|replacement claim|under claim)\y';
$$;

create table if not exists public.tyre_price_backfill_log (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  batch_id uuid not null,
  tyre_id uuid not null,
  country text,
  asset_no text,
  serial_no text,
  old_cost numeric,          -- what it was, so the undo is exact and not re-derived
  new_cost numeric not null,
  source text not null,      -- own_jobcard | comparable | warranty
  samples integer,           -- how many rows a comparable price rests on
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists tyre_price_backfill_log_batch_idx
  on public.tyre_price_backfill_log (organisation_id, batch_id);
create index if not exists tyre_price_backfill_log_tyre_idx
  on public.tyre_price_backfill_log (organisation_id, tyre_id);

alter table public.tyre_price_backfill_log enable row level security;

drop policy if exists tyre_price_backfill_log_org on public.tyre_price_backfill_log;
create policy tyre_price_backfill_log_org on public.tyre_price_backfill_log
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

drop policy if exists tyre_price_backfill_log_read on public.tyre_price_backfill_log;
create policy tyre_price_backfill_log_read on public.tyre_price_backfill_log
  for select to authenticated using (public.app_is_active());

-- No client write policy on purpose: the log is written only by the DEFINER
-- function below. A price-change record a client can forge is not a record.

-- The full bodies of tyre_price_backfill (V401b), tyre_price_backfill_undo and
-- tyre_price_coverage are applied live; see the migration history for
-- v401_tyre_price_backfill and v401b_backfill_money_per_country. The shape:
--   tyre_price_backfill(p_dry_run boolean default true, p_country text default null)
--     -> jsonb {ok, dry_run, batch_id, country, rows, by_source, by_country, sample}
--   tyre_price_backfill_undo(p_batch_id uuid) -> jsonb {ok, restored}
--   tyre_price_coverage() -> table(country, tyres, priced, missing, coverage_pct,
--                                  filled_by_backfill, missing_no_brand_or_size)

comment on function public.backfill_tyre_prices_from_grid() is
  'SUPERSEDED by V401 tyre_price_backfill. DO NOT USE: it averages the LINE cost without dividing by quantity, overstating the per-tyre price 2.5x-5.1x on the 29% of lines covering more than one tyre, and it has no repair exclusion, no dry run and no undo.';

-- =====================================================================
-- MIRROR - change together
--   SQL  tyre_price_is_repair / tyre_price_is_warranty
--   JS   src/lib/tyrePriceRules.js  isTyreRepair / isTyreWarranty / unitPrice
-- The SQL decides; the JS exists so the UI can explain a decision and so the
-- rules are testable without a database. Pinned by src/test/tyrePriceRules.test.js.
--
-- UNDO
--   Per batch, from the app or:
--     select public.tyre_price_backfill_undo('<batch_id>');
--   Every filled row is listed in tyre_price_backfill_log with its prior value,
--   including NULL, so an undo restores what the row actually held rather than
--   what today's rules would say.
-- =====================================================================
