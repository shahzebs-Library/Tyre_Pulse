-- =====================================================================================
-- V590 - THE V588 SWEEP, WIDENED. Which OTHER text column is split by case/whitespace?
-- Answer: `tyre_records.removal_reason` (FIXED here) and `tyre_records.serial_no`
-- (MEASURED, PROVEN HARMFUL, DELIBERATELY NOT FIXED - see REFUSALS).
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc as
-- `v590_tyre_removal_reason_canonicalisation`. Confirmed present in
-- supabase_migrations.schema_migrations AND as a live trigger/function, not by this header.
-- =====================================================================================
--
-- METHOD. Candidates were enumerated by what a column DOES (a GROUP BY key, a filter
-- option, a join/dedupe key, populated by an import), not by its name; then each was
-- measured with the CORRECT canonical form and, crucially, each hit was traced to the
-- READER that consumes it. A collision on a column nothing groups by is cosmetic; a
-- collision on a GROUP BY key is a wrong number. The ranking below is by reader, not by
-- row count - which is why the single LARGEST collision set in the database is a refusal.
--
-- RANKED FINDINGS (canonical form = collapse whitespace, then btrim, then upper)
--
--  # column                              groups  rows      reader                          verdict
--  1 tyre_records.removal_reason              5   2,372    get_report_tyre_maintenance     FIXED
--                                                          raw GROUP BY ... LIMIT 12
--                                                          (ANON public share board)
--  2 tyre_records.serial_no                  48      62    scrap_tyre_by_serial exact      REFUSED
--                                                          match -> PARTIAL SCRAP           (reader-first)
--  3 parts_consumption.asset_type            15 203,807    _cost_dim / _cost_var_dim       REFUSED
--                                                          both btrim() -> IMMUNE           (no defect)
--  4 parts_consumption.item_code             49      85    classify_parts_consumption      REFUSED
--                                                          upper(btrim()) -> IMMUNE         (no defect)
--  5 tyre_records."position"                 23     166    parsePosition() .trim()         REFUSED
--                                                          .toUpperCase() -> IMMUNE         (no defect)
--  6 vehicle_fleet.make                       7     625    no reader groups on it          REFUSED
--                                                          (display + ilike search only)    (cosmetic)
--  7 *_country_upload_template_staging,     many    many   verbatim import landing zones   REFUSED
--    ksa_kms, uae_kms, ksa_asset_master_                   (evidence, by design)
--    upload, insurance_policy_assets
--  - work_orders (7 text cols)                 0       0    -                               CLEAN
--
--
-- ## 1. THE FIX - removal_reason, and it changed the headline answer
--
-- `get_report_tyre_maintenance` is the ANONYMOUS public share-token board (the one
-- PROJECT_MEMORY records as deliberately excluded from every country/site guard). Line 63:
--     SELECT removal_reason AS label, count(*) FROM tr WHERE status='Removed'
--     GROUP BY removal_reason ORDER BY count(*) DESC LIMIT 12
-- A raw GROUP BY with a LIMIT. So a split does not merely mis-rank, it can push a real
-- reason off the board entirely - which is exactly what happened.
--
-- THE BOARD'S TOP ROWS, MEASURED BEFORE AND AFTER:
--     BEFORE                              AFTER
--   1 Puncture                     712  | WORN OUT                     769
--   2 ROADX                        486  | PUNCTURE                     750
--   3 Two current tyres - manual   453  | ROADX                        486
--   4 Worn Out                     363  | TWO CURRENT TYRES - MANUAL   453
--   5 WORN OUT                     288  | BLAST/BURST                  250
--   8 'WORN OUT'+86 spaces         118  | ...
--  13 PUNCTURE                      28  | (was CUT OFF by LIMIT 12)
--
-- **WORN OUT is the fleet's number-one removal reason at 769 and the board could never
-- say so** - it was split 363 / 288 / 118 across ranks 4, 5 and 8, and one variant was a
-- 100-character space-padded string that renders as a label with a huge blank gap.
-- PUNCTURE's third variant sat at rank 13, outside the LIMIT, so it was simply invisible.
--
-- THE PAD IS SPACES, NOT TABS, and that matters for why this survived: a plain `btrim()`
-- WOULD have caught it. Nobody had ever run the analysis on this column at all. The five
-- collisions are a fixed-width 100-char pad crossed with a case split:
--   WORN OUT  385 'Worn Out' + 269 'WORN OUT' + 133 padded
--   PUNCTURE  777 'Puncture' +  19 'PUNCTURE' +  12 padded
--   MISUSE 21+12 · SIDE WALL DAMAGE 8+3 · THREAD SEPRATION 17+6
--
-- SECOND READER, client-side: src/components/dashboard/WidgetRenderer.jsx:461 builds
-- `counts[r.removal_reason]` - a raw JS object key - for the Failure Reasons widget. Same
-- split, same three bars. Fixed by the same backfill; no JS change needed.
--
--
-- ## THE ORDER TRAP, RE-PROVEN FOR THIS COLUMN
-- `upper(regexp_replace(btrim(x),'\s+',' ','g'))` - btrim FIRST - turns 'WORN OUT'||chr(9)
-- into 'WORN OUT ' WITH A TRAILING SPACE, a brand-new variant that would SPLIT a value
-- that already has 269 clean rows. Verified live rather than reasoned about:
--   wrong order -> [WORN OUT ]  merges? false
--   V590        -> [WORN OUT]   merges? true
-- **COLLAPSE WHITESPACE FIRST, THEN btrim, THEN upper.**
--
--
-- ## THE 63 ROWS THAT MADE THIS NOT A NO-OP (this is where V590 differs from V588)
-- `tyre_records_master_process_tg` is BEFORE INSERT OR UPDATE and contains
--     if new.km_at_fitment = 0 then new.km_at_fitment := null; end if;
-- V588 could update 915 rows with the trigger live because it measured km_fit_zero = 0.
-- **Here it is 63.** Those are owner-approved factory-fitment zeros (PROJECT_MEMORY records
-- 232 such tyres fleet-wide), so a plain UPDATE would have silently destroyed 63 real km
-- readings while reporting success. Measured, not assumed:
--   rows_to_update 2,372 · km_fit_zero 63 · km_rem_zero 0 · km_reversed 0 · qty_suspect 0
-- So that ONE trigger is disabled for the statement and re-enabled in the same
-- transaction, and the migration ABORTS unless km_at_fitment is byte-identical afterwards
-- AND tgenabled is back to 'O'. VERIFIED: 63 km-zero rows touched, 0 km values changed.
--
-- NO OTHER TRIGGER NEEDED TOUCHING, and that was checked rather than hoped:
--   trg_guard_tyre_active_fitment is UPDATE OF status/asset_no/position/org/country, so a
--     removal_reason-only update never fires it.
--   trg_ev_tyre_installed is AFTER INSERT only.
--   trg_apply_tyre_learned_facts holds 22 facts, ALL target_field='brand'/match_type=
--     'serial', ZERO for removal_reason; and 0 of the 2,372 rows would have had a blank
--     brand filled as a side effect (measured explicitly, because that trigger does fill
--     a blank brand from a serial fact).
--
--
-- ## `trg_zz_normalize_removal_reason` - TWO NAMING/SHAPE DECISIONS, BOTH LOAD-BEARING
-- 1. The `zz` prefix. Triggers fire in NAME order and `trg_apply_tyre_learned_facts`
--    WRITES removal_reason (V472 made it a learnable target field) and sorts first. A
--    normaliser named earlier would be overwritten. Same lesson as V588's brand trigger
--    and V524's `trg_zz_normalize_site`. Fire order is asserted by the migration itself.
-- 2. Plain `BEFORE INSERT OR UPDATE`, deliberately NOT `UPDATE OF removal_reason`.
--    **A column set by an earlier BEFORE trigger is NOT in the statement's column list**,
--    so `UPDATE OF` would silently fail to fire on exactly the learning-layer write this
--    trigger exists to catch. That is the V398b defect, avoided here by construction.
--
--
-- ## VERIFICATION (live)
--   in supabase_migrations 1 · trigger live 1 · master trigger re-enabled 'O'
--   collisions 5 -> 0 · rows off-canonical 2,372 -> 0 · distinct reasons 29 -> 24
--   total rows 11,193 unchanged · rows with a reason 3,611 unchanged
--   TOTALS PRESERVED PER VALUE, not merely in aggregate: the pre-migration value of every
--     row was reconstructed from the snapshot, canonicalised, and compared to the live
--     counts - **24 canonical values, 0 mismatches, 3,611 = 3,611.**
--   Behavioural, as the REAL KSA-only Manager under RLS, rolled back:
--     'Worn   Out'||chr(9)  ->  'WORN OUT'   (tab + double space + mixed case, all folded)
--     '   '                 ->  NULL
--   Anon board unaffected: get_report_tyre_maintenance('rpt_bogus') -> {ok:false,invalid}
--
--
-- ## STATED BEHAVIOUR CHANGE
-- Removal reasons now render UPPER CASE on every surface that shows the raw value - the
-- anon public board, the Failure Reasons widget, the scrapped register, exports. That is
-- consistent with brand (V588), site (V246) and vehicle_type (V245), which are already
-- UPPER on those same screens, but it IS a visible change and is not a bug report.
--
--
-- =====================================================================================
-- REFUSALS - each measured, each with the reason. These are results, not omissions.
-- =====================================================================================
--
-- ## 2. tyre_records.serial_no - A REAL DEFECT, PROVEN, AND STILL NOT FIXED HERE
-- 48 collision groups / 62 rows. 45 of 48 are the SAME asset AND the SAME wheel position
-- with sequential dates - one physical tyre whose life is recorded half under
-- `k507B403590` and half under `K507B403590`. The 3 that span assets already span assets
-- WITHIN a single case variant, so folding case would create no conflation that is not
-- already present.
--
-- `scrap_tyre_by_serial` matches `t.serial_no = v_s` where `v_s := btrim(p_serial)` - an
-- EXACT, CASE-SENSITIVE match. PROVEN live as the super admin, rolled back, on TM662 LHRO:
--     scrap_tyre_by_serial('K507B403590')
--     -> 2025-08-04 row  K507B403590  status Removed -> **Scrapped**
--     -> 2026-05-25 row  K507b403590  status **Active -> still Active**
-- The tyre reads "Scrapped" in the scrapped register while the wheel it is fitted to is
-- still Active in the pool. That is the PARTIAL SCRAP failure mode this codebase already
-- reverted a change for once. **43 of the 48 groups contain an Active row, so 43 tyres
-- are exposed today.** serial_no is also part of the `_dup_scan_spec` duplicate key.
--
-- **WHY NOT FIXED BY NORMALISING THE COLUMN - THE ORDER OF OPERATIONS IS THE WHOLE POINT.**
-- Both serial lookups are case-sensitive `.eq()`:
--     src/lib/api/tyreExchange.js findTyreBySerial   .eq('serial_no', s)   <- feeds Scrap
--     mobile/lib/tyreLookup.ts   lookupTyreBySerial  .or(serial_no.eq...)  <- BARCODE SCAN
-- Uppercasing the column would make a barcode that reads `k507B403590` match NOTHING,
-- turning a split-history bug into a can't-find-the-tyre bug in the field. **The readers
-- must be made case-insensitive FIRST, then the column normalised.** Doing it in the other
-- order breaks scanning. That fix spans `src/` and `mobile/`, both owned by other sessions
-- right now, plus three DEFINER RPCs with physical consequences.
--
-- SAFE TO KNOW FOR WHOEVER DOES IT: `tyre_status_marks` is ALREADY 100% canonical (0 of
-- 201 rows off-canonical, 0 touching a collision group), so nothing gets orphaned;
-- `apply_tyre_learned_facts` already matches `upper(btrim(match_value))=upper(btrim(
-- NEW.serial_no))` on both sides, so the learning layer is indifferent. Residue to carry:
-- tyre_price_backfill_log 6 rows off-canonical, tyre_learned_facts 2.
-- **A cheaper first move that needs no client change at all: make the three serial RPCs
-- (scrap_tyre_by_serial / unscrap_tyre_by_serial / list_scrapped_tyres' join) match
-- case-insensitively. That closes the partial scrap without moving a single stored string.**
--
-- ## 3. parts_consumption.asset_type - THE LARGEST COLLISION SET IN THE DATABASE, AND NOT A BUG
-- 15 groups / 203,807 of 217k rows. An ERP fixed-width 30-char pad: EVERY asset type has a
-- space-padded twin (TR-MIXER 81,990 + 15,659 · PUMPS 33,876 + 7,022 · BT-PLANT 23,623 +
-- 10,123), and for MOT-VEH (53 vs 10) and TRAILER (183 vs 109) the PADDED variant is the
-- majority. It looks alarming and it is inert:
--   `_cost_dim` and `_cost_var_dim` - the ONLY readers, and the ones behind
--   get_cost_cpk_overview's `by_asset_type` and get_cost_variance - both group by
--       coalesce(nullif(btrim(%1$I::text),''),'Unspecified')
--   **btrim() already merges them**, and the pad is spaces only (0 tabs/newlines measured),
--   so btrim is sufficient. There are no case collisions in this column.
-- AND THE FIX WOULD BE ACTIVELY DANGEROUS: `trg_classify_parts_consumption` is BEFORE
-- INSERT **OR UPDATE** and RE-DERIVES cost_bucket, currency and line_cost on every write
-- (the documented V373 trap). Backfilling would re-run classification over 203,807 rows of
-- the financial ledger, on a 256 MB instance, to fix a reader that is already correct.
-- **Refused on the arithmetic, not on nerves.**
--
-- ## 4. parts_consumption.item_code - IMMUNE, and the near-miss is instructive
-- 49 groups / 85 rows, one bad import pass that wrote a lowercase `-o` suffix
-- (`221553-O` vs `221553-o`), SAR 344,179.66 of line cost. material_master is keyed on
-- (org, country, item_code) and holds **0 rows for the lowercase form and 84 for the
-- uppercase - all of them REVIEWED**, so this looked like "a human's classification
-- decision never reaches these lines". It does:
--     classify_parts_consumption:  m.item_code = upper(btrim(coalesce(NEW.item_code,'')))
-- The classifier normalises on lookup. Verified end to end: on all 85 lines the bucket
-- actually stored equals the bucket the reviewed master would give. **No money is in the
-- wrong bucket.** Residue is cosmetic (the raw code in exports and in
-- get_classification_decisions' grouping).
--
-- ## 5. tyre_records."position" - IMMUNE, but it shows an earlier cleanup was half-done
-- 166 space-padded rows (40-char pad). The 2026-08-05 session btrimmed `tyre_position` and
-- `serial_no` and MISSED the sibling `position` column - `tyre_position` is 0 off-canonical
-- today, `position` is 166. Harmless because every reader folds it:
--   tyrePositions.parsePosition  String(raw).trim().toUpperCase().replace(/\s+/g,'')
--   tyreBay.positionKeyOf / tyreChangeTracking.positionKey / exportUtils.posKey - all trim
--   `_dup_scan_spec` keys on tyre_position (clean), not on position.
-- Left alone: no reader is wrong, and `position` vs `tyre_position` differ on 672 rows, so
-- touching one without deciding which is canonical would be a guess.
--
-- ## 6. vehicle_fleet.make - COSMETIC, and normalising it would be the bigger change
-- 7 groups / 625 rows. **SANY is 294 'Sany' + 159 'SANY' = 453**, the largest manufacturer
-- in the fleet, shown as two makes (also Caterpillar 26+20, Truemax 42+4, Snowkey 29+1,
-- Mitsubishi 16+3, Tata 16+1, Tide Power 13+1). NO reader groups on it: `get_asset_master`
-- takes `max(make)`, `get_asset_ownership` already counts
-- `distinct upper(btrim(make))`, `search_fleet_assets` lowercases, FleetMaster uses ilike
-- and renders it as a display column. Forcing UPPER would rewrite the visible make on
-- ~1,300 fleet rows ('Caterpillar' -> 'CATERPILLAR') to fix a number nobody computes.
-- **Fix it the day someone builds a by-manufacturer report, and fix it then.**
--
-- ## 7. The verbatim landing zones - MUST NOT be normalised
-- `*_country_upload_template_staging`, `ksa_kms`, `uae_kms`, `ksa_asset_master_upload`,
-- `insurance_policy_assets`, `brain_cache`. These hold the customer's sheet or the broker's
-- schedule AS DELIVERED so a comparison can be re-run, and `brain_cache` is keyed on a
-- description hash that self-invalidates on brain_rules_version(). Normalising them would
-- destroy the property that makes them useful.
--
--
-- =====================================================================================
-- FOUND WHILE MEASURING, NOT FIXED - and it is now quantified
-- =====================================================================================
-- **A TYRE BRAND IS THE #3 "REMOVAL REASON" ON A CUSTOMER-FACING PUBLIC BOARD.**
-- 820 rows carry a catalog brand in `removal_reason` - ROADX 693, FIREMAX 63, LONGMARCH 53,
-- TRIANGLE 9, ALLROUND 1, BLACKHAWK 1 - **every one of them UAE, and every one with `brand`
-- already populated** (plus ROCK HOLDER and VGLORY, which the brain_tokens catalog does not
-- carry, so the contamination is slightly WIDER than a catalog join detects). This is the
-- standing open item V403 left behind ("858 rows, ALL UAE, brand already populated"),
-- re-measured at 820 and confirmed still live. V590 does not touch it: clearing a column is
-- a semantic decision about the customer's data, not a whitespace fix, and there is nothing
-- to recover into `brand` because `brand` is already correct on all 820.
--   Owner decision. The exact set:
--     select id, country, removal_reason from public.tyre_records
--      where removal_reason = any(
--        select upper(btrim(t)) from unnest(public.brain_tokens('tyre_brand')) t
--        where upper(btrim(t)) <> 'RADIAL');
--
--
-- =====================================================================================
-- ROLLBACK
-- =====================================================================================
--   alter table public.tyre_records disable trigger tyre_records_master_process_tg;
--   update public.tyre_records t set removal_reason = b.old_removal_reason
--     from _bak.tyre_removal_reason_v590 b where t.id = b.id;
--   alter table public.tyre_records enable trigger tyre_records_master_process_tg;
--   -- verify: select count(*) from pg_trigger
--   --   where tgrelid='public.tyre_records'::regclass
--   --     and tgname='tyre_records_master_process_tg' and tgenabled='O';  -- must be 1
--   drop trigger if exists trg_zz_normalize_removal_reason on public.tyre_records;
--   drop function if exists public.normalize_tyre_removal_reason();
--   drop function if exists public.tyre_removal_reason_canonical(text);
-- =====================================================================================


create schema if not exists _bak;

-- 1. Canonical form. ORDER IS LOAD-BEARING: collapse whitespace FIRST (so a tab or a
--    fixed-width pad becomes plain spaces), THEN btrim, THEN upper. btrim-then-collapse
--    leaves a trailing space and SPLITS a value instead of merging it (the V588 trap).
create or replace function public.tyre_removal_reason_canonical(p_reason text)
returns text language sql immutable parallel safe as $fn$
  select nullif(upper(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'))), '')
$fn$;

comment on function public.tyre_removal_reason_canonical(text) is
  'Canonical tyre removal reason: collapse whitespace, then btrim, then upper; blank -> NULL. '
  'Order is load-bearing (V590). Mirrors normalizeBrandToken()-style folding in src/lib/tyreLearning.js.';

-- 2. Snapshot BEFORE anything changes (rollback source).
drop table if exists _bak.tyre_removal_reason_v590;
create table _bak.tyre_removal_reason_v590 as
select id, removal_reason as old_removal_reason, km_at_fitment as old_km_at_fitment
from public.tyre_records
where removal_reason is not null
  and removal_reason is distinct from public.tyre_removal_reason_canonical(removal_reason);

-- 3. Backfill.
--    tyre_records_master_process_tg is BEFORE INSERT OR UPDATE and NULLS km_at_fitment when
--    it is 0. 63 of the rows below carry km_at_fitment = 0 (owner-approved factory fitment),
--    so a plain UPDATE would silently destroy them. Measured, not assumed. Disable that ONE
--    trigger for the statement and re-enable + verify in the same transaction.
alter table public.tyre_records disable trigger tyre_records_master_process_tg;

update public.tyre_records t
   set removal_reason = public.tyre_removal_reason_canonical(t.removal_reason)
  from _bak.tyre_removal_reason_v590 b
 where t.id = b.id;

alter table public.tyre_records enable trigger tyre_records_master_process_tg;

-- 4. Guard future writes. PLAIN `BEFORE INSERT OR UPDATE`, deliberately NOT
--    `UPDATE OF removal_reason` (see header). The `zz` sorts it after
--    trg_apply_tyre_learned_facts, which WRITES this column.
create or replace function public.normalize_tyre_removal_reason()
returns trigger language plpgsql set search_path to 'public' as $fn$
begin
  if new.removal_reason is not null then
    new.removal_reason := public.tyre_removal_reason_canonical(new.removal_reason);
  end if;
  return new;
end $fn$;

drop trigger if exists trg_zz_normalize_removal_reason on public.tyre_records;
create trigger trg_zz_normalize_removal_reason
  before insert or update on public.tyre_records
  for each row execute function public.normalize_tyre_removal_reason();

-- 5. Assertions. Abort the whole migration rather than half-apply it.
do $chk$
declare
  v_collisions int; v_off int; v_km_moved int; v_tgenabled "char"; v_order text;
begin
  select count(*) into v_collisions from (
    select public.tyre_removal_reason_canonical(removal_reason) c
    from public.tyre_records where removal_reason is not null
    group by 1 having count(distinct removal_reason) > 1) s;
  if v_collisions <> 0 then
    raise exception 'V590 abort: % removal_reason collisions remain', v_collisions;
  end if;

  select count(*) into v_off from public.tyre_records
   where removal_reason is not null
     and removal_reason is distinct from public.tyre_removal_reason_canonical(removal_reason);
  if v_off <> 0 then
    raise exception 'V590 abort: % rows still off-canonical', v_off;
  end if;

  -- NOT ONE km_at_fitment may have moved.
  select count(*) into v_km_moved
    from public.tyre_records t join _bak.tyre_removal_reason_v590 b on b.id = t.id
   where t.km_at_fitment is distinct from b.old_km_at_fitment;
  if v_km_moved <> 0 then
    raise exception 'V590 abort: km_at_fitment changed on % rows', v_km_moved;
  end if;

  select tgenabled into v_tgenabled from pg_trigger
   where tgrelid = 'public.tyre_records'::regclass and tgname = 'tyre_records_master_process_tg';
  if v_tgenabled <> 'O' then
    raise exception 'V590 abort: tyre_records_master_process_tg left disabled (%)', v_tgenabled;
  end if;

  select string_agg(tgname, ' < ' order by tgname) into v_order from pg_trigger
   where tgrelid = 'public.tyre_records'::regclass and not tgisinternal
     and tgname in ('trg_apply_tyre_learned_facts', 'trg_zz_normalize_removal_reason');
  if v_order <> 'trg_apply_tyre_learned_facts < trg_zz_normalize_removal_reason' then
    raise exception 'V590 abort: trigger fire order wrong (%)', v_order;
  end if;
end $chk$;
