-- V566  THE RECONCILIATION, DATA-LINK AND MATERIAL-MASTER WRITERS
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A).
-- Applied as two migrations under the one V566 label:
--   v566_recon_datalink_material_master_country_guards   (the guards + the revoke)
--   v566_initplan_form_for_row_predicates                (my own perf correction, below)
--
-- Same mechanism as V542 / V550 / V555, once more: a SECURITY DEFINER function runs
-- as its OWNER, no public table sets FORCE ROW LEVEL SECURITY, so RLS NEVER RUNS
-- INSIDE ONE. Each such function must re-ask org, country and site itself. These did
-- not. Six were in scope; a seventh (material_master_set) is included and the reason
-- is stated below.
--
-- EVERY FIGURE HERE IS FROM A ROLLED-BACK TRANSACTION AGAINST LIVE DATA. Every count
-- of a cross-country write was taken as a PRIVILEGED reader after `reset role` IN THE
-- SAME TRANSACTION - counting from inside the impersonated session returns a number
-- that looks like a refusal (the V501 / V542 trap). It fired here twice, visibly:
-- on both recon probes the attacker could see exactly 1 of the rows they had just
-- created, because the others landed in countries they cannot read.
--
-- Attacker throughout: the REAL approved KSA-only Manager 34793423 (username adnan,
-- role Manager, country {KSA}, sites {ALL}, org Company A, approved, unlocked).
-- Measured for that principal: app_is_elevated() = TRUE, app_is_org_admin() = false,
-- app_write_country_ok('UAE') = false, app_write_country_ok('KSA') = true.
--
-- ============================================================================
-- 1  material_master_set_bulk(jsonb)  - THE SHARP ONE. ATTACKER-CHOSEN COUNTRY
--    AND CATEGORY, NO COUNTRY CHECK, ON A TABLE THAT DECIDES WHERE MONEY LANDS.
--
-- Gate was app_is_elevated() only. Country and category both come from the caller's
-- own jsonb payload and neither was checked. REPRODUCED as adnan, one call:
--
--   material_master_set_bulk('[{"item_code":"310673-O","country":"UAE","category":"capital"},
--                              {"item_code":"ZZ-INJECTED-UAE","country":"UAE","category":"tyre"}]')
--   -> {"ok":true,"confirmed":2,"skipped":0,"errors":[]}
--
--   PRIVILEGED RECOUNT, same transaction:
--     UAE 310673-O "LONGMARCH 315/80R22.5 20PR LM216"
--       category    tyre      -> capital
--       reviewed_by d2d43a5f  -> 34793423        (a super admin's decision, restamped
--                                                 as the attacker's)
--     UAE ZZ-INJECTED-UAE  CREATED, reviewed = true, attributed to the attacker.
--
-- WHY IT IS NOT COSMETIC. Every material_master row is reviewed = true (measured:
-- KSA 9,443 / UAE 9,321 / Egypt 3,398, unreviewed 0), and V368 ranks a REVIEWED
-- master row above every classifier token. material_category_bucket('tyre') = tyre
-- and ('capital') = spare, and that one item carries 321 UAE lines worth
-- AED 757,400.00. So the call moves AED 757,400 out of UAE's tyre bucket, and
-- reclassify_from_master is the standing lever that pushes such a decision through
-- historical rows. It also falsifies the audit trail: reviewed_by now names someone
-- who cannot see the row.
--
-- FIX: the country is checked per item against app_write_country_ok, and refusal
-- REUSES THIS FUNCTION'S OWN skip path (v_skipped + a reason in v_errors), because
-- confirming hundreds at once makes partial success normal and the client already
-- renders `res.skipped`. No client change was needed - verified by reading
-- ConsoleMaterialMaster.jsx, which already prints "N skipped."
--
-- AFTER, same two-item call: {"ok":true,"confirmed":1,"skipped":1,
--   "errors":[{"item_code":"310673-O","reason":"country outside your scope: UAE"}]}
--   UAE 310673-O still tyre, still reviewed_by d2d43a5f.
--   CONTROL: the KSA item in the same batch was confirmed. A mixed batch still does
--   the work the caller is entitled to.
--
-- ============================================================================
-- 2  material_master_set(...)  - NOT one of the six, included deliberately.
--
-- It ALREADY had a country guard (added by the V547 sweep) - but on the LOOSER
-- predicate app_can_see_country(), which V555 measured as bypassed by
-- app_is_org_admin() = is_super_admin() OR role='admin'. Leaving the single-item
-- writer on the weaker rule while its BULK sibling gets the stronger one just makes
-- the single path the bypass for the bulk path: exactly the V550 shape, where a
-- guard existed on one entry point and the sibling walked straight past it. Moved
-- onto app_write_country_ok in the same pass. Its own {"ok":false,"reason":
-- "forbidden"} return is unchanged.
--
-- ============================================================================
-- 3  material_master_derive()  - WRITES EVERY COUNTRY'S ROWS.
--
-- Gate app_is_elevated(); it read parts_consumption for the whole org with no
-- country term and upserted material_master for every country. REPRODUCED as adnan:
--   {"ok":true,"inserted":273,"updated":22146}
--   PRIVILEGED RECOUNT of what that call did, by country:
--     CREATED   UAE 210   Egypt 38   KSA 25
--     MODIFIED  UAE 940   Egypt 186  KSA 397
--
-- THE PER-COUNTRY KEY FINDING, and it is a DISMISSAL, not a leak. V367 recorded that
-- item codes are NOT globally unique (450115-O is "COMPRESSOR OIL 68" in KSA and
-- "GREASE MISC ITEMS" in UAE) and that an earlier derive keyed on item_code alone
-- MERGED them. THAT DEFECT IS NOT PRESENT. The function partitions by
-- (country, item_code) in every CTE and its conflict target is
-- (organisation_id, country, item_code) - verified by reading the live definition.
-- Measured confirmation: on the reproduction above, the count of foreign rows whose
-- reviewed decision (category or item_name) changed was ZERO - the `reviewed` guard
-- in its own DO UPDATE held. So derive cannot overwrite a human decision in another
-- country. What it could do is create foreign rows and refresh foreign counters,
-- which is still a KSA Manager writing UAE's register.
--
-- AFTER, by sentinel probe (set a UAE row and a KSA row to txn_value = -1, run
-- derive as adnan, read both back):
--   UAE 310673-O  txn_value  -1      <- NOT touched
--   KSA 450115-O  txn_value  61,898  <- recomputed  (CONTROL: own country still works)
--   {"ok":true,"inserted":25,"updated":9443} - 9,443 is exactly the KSA row count.
--
-- CONTROL THAT MATTERS MOST: the only surface that calls this is
-- /console/material-master (ConsoleMaterialMaster.jsx), and /console is super-admin
-- only. Re-run as the super admin: {"ok":true,"inserted":273,"updated":22146} -
-- BYTE-IDENTICAL to the pre-guard figures - and all three sentinels refreshed
-- (Egypt 12,000 / KSA 61,898 / UAE 757,400). The production caller is unaffected.
--
-- ============================================================================
-- 4  recon_backfill_asset(text)  - TWO defects, both reproduced.
--
-- 4a CROSS-COUNTRY STAMPING. Gate app_is_elevated(); it read tyre_records with no
--    country term and stamped the new fleet row with max(country) taken from rows
--    the caller cannot read. So the created row's country comes from data outside
--    the caller's scope. ARMED reproduction (a UAE tyre row for an unregistered
--    asset - the routine post-import state - created in the same rolled-back txn):
--      recon_backfill_asset('ZZ-UAE-ORPHAN') as adnan -> returned a uuid
--      PRIVILEGED RECOUNT: vehicle_fleet row ZZ-UAE-ORPHAN, country = UAE.
--    That is the V542 injection class: a row in another country's register, created
--    by someone who cannot see it to undo it.
--
-- 4b IT CREATED ASSETS THAT EXIST NOWHERE. Reproduced with NO precondition at all:
--      recon_backfill_asset('ZZ-DOES-NOT-EXIST-ANYWHERE') -> returned a uuid
--      PRIVILEGED RECOUNT: vehicle_fleet row created, country NULL, vehicle_type NULL.
--    Cause: `INSERT ... SELECT p_asset_no, max(...), max(...) FROM tyre_records
--    WHERE ...` has NO GROUP BY, so max() over an EMPTY set still returns exactly
--    ONE all-NULL row and the INSERT always fired. "Backfill an orphan" was really
--    "create any asset you name", and country NULL means it appears in EVERY
--    country's register under the standing null-dimension convention.
--
-- MEASUREMENT TRAP, VISIBLE: inside adnan's own session only 1 of those 2 rows was
-- countable. The UAE one was invisible to its own creator.
--
-- FIX: the source rows are scoped, and `HAVING count(*) > 0` stops the empty-set
-- insert. REFUSAL IS A RAISE (errcode 42501, the function's own existing error
-- path), NOT a NULL return - because DataReconciliation.jsx ignores the return value
-- and prints "1 asset added" on the absence of an error. A NULL return would have
-- produced a false success message; safeError.js maps 42501 to a clean sentence.
--
-- AFTER, as adnan:  UAE orphan -> REFUSED 42501.  fabricated -> REFUSED 42501.
--   CONTROL: an armed KSA orphan is still created, and the privileged recount shows
--   the KSA fleet row and nothing else.
--
-- ============================================================================
-- 5  recon_backfill_all_orphan_assets()  - MASS INJECTION, one button.
--
-- Same defect at bulk scale. ARMED with one unregistered asset per country:
--   as adnan -> created 3.  PRIVILEGED RECOUNT: KSA, UAE and Egypt rows, one each.
--   Only 1 was visible inside the attacker's session.
-- AFTER: as adnan -> created 1, and the privileged recount shows ONLY the KSA row.
--   CONTROL: the super admin then created the remaining 2 (UAE + Egypt), so the
--   feature is intact for the platform owner.
--
-- HONEST LABEL ON TODAY'S DATA: with the live table as it stands this function
-- creates NOTHING - measured, there are zero orphan assets left (V348/V351 cleared
-- them), which is why the reproduction had to be armed. It is not empty by rule: a
-- single tyre row for an unregistered asset re-arms it, and that is the ordinary
-- outcome of an import.
--
-- ============================================================================
-- 6  data_link_create_missing_assets()  - GUARDED, LATENT TODAY, REPRODUCED ANYWAY.
--
-- Its gate is is_approved_and_unlocked() AND app_is_org_admin(). Measured: 38
-- approved users, 2 super admins, and ZERO plain Admins - so today only a super
-- admin reaches it, and a super admin legitimately crosses countries. Confirmed
-- directly: called as adnan it is refused by the app_is_org_admin() gate.
--
-- SO IT IS LABELLED LATENT, NOT A LIVE LEAK. It was still reproduced, because
-- app_is_org_admin() admits any plain org Admin and the first one onboarded arms it.
-- Reproduced by promoting adnan to role Admin in a ROLLED-BACK transaction,
-- authorised the V553 way - `request.jwt.claims` set to a super admin so
-- trg_guard_profile_privileged passes. NO trigger was disabled and no ACCESS
-- EXCLUSIVE lock was taken on profiles.
--   principal: scope {ksa}, app_is_org_admin TRUE, app_write_country_ok('UAE') false
--   -> {"created":2}; PRIVILEGED RECOUNT: one UAE row, one Egypt row.
-- AFTER, same principal: {"created":1}; PRIVILEGED RECOUNT: the KSA row only.
--
-- ============================================================================
-- 7  backfill_tyre_prices_from_grid()  - REVOKED, NOT GUARDED. THE HONEST FIX.
--
-- The brief asked whether this should be fixed into usefulness. It should not.
--
--   IT HAS NO CALLER. Verified three ways, not assumed: nothing in src/ or mobile/
--   or supabase/ calls it (the only occurrence is a COMMENT in
--   src/lib/api/tyrePriceBackfill.js recording that the V401 engine REPLACES it);
--   no other function body in pg_proc calls it; no cron.job command names it.
--   The single other reference is inside owner_data_audit(), which merely prints it
--   in advisory TEXT ("fix: Backfill cost from the parts grid ...") - it does not
--   invoke it.
--
--   ITS FORMULA IS WRONG, and V327's defect is reproduced here with live rows. It
--   writes round(avg(tyre_cost)) - the LINE total - as the PER-TYRE price, never
--   dividing by quantity. Live examples:
--     RM/RMJC/0040/0725  TM489  LONGMARCH 315/80R22.5   qty 20  line 14,000
--                        true unit 700.00   this function writes 14,000  = 20x
--     GCKR/JC/0139/0622  TM340  TIRE 315/80R22.5        qty 16  line 12,000
--                        true unit 750.00   this function writes 12,000  = 16x
--   Multi-tyre lines: KSA 1,483, UAE 1,059, Egypt 296.
--
--   CROSS-COUNTRY EXPOSURE, LABELLED HONESTLY. Run as adnan it updated 311 rows and
--   the privileged recount by country shows ALL 311 ARE KSA - so NO cross-country
--   write was observed. The reason is join coverage, not a rule: of the unpriced
--   tyres, UAE has 439 carrying a job_card and Egypt 71, but today none of them
--   matches a grid tyre line on (job_card = work_order_no, asset_no = asset_code).
--   The price evidence itself exists in both (UAE 3,008 tyre lines with tyre_cost,
--   Egypt 382). It is one matching import away from being armed.
--
-- So: guarding it would harden a function nothing calls, that computes a figure
-- nobody should use. EXECUTE is withdrawn from `authenticated`, which removes it
-- from every browser client. service_role is RETAINED deliberately so the platform
-- owner keeps an explicit break-glass, and the function body is left untouched so
-- the revoke is a one-line rollback.
--
-- ============================================================================
-- THE PREDICATE, AND THE NO-JWT QUESTION SETTLED EMPIRICALLY
--
-- public.app_write_country_ok(text) (V555) is used, not app_can_see_country, which
-- V498/V555 established is bypassed by any plain org Admin.
--
-- The brief flagged that app_write_country_ok returns FALSE, not NULL, with no JWT,
-- so a strict `if not ...` guard would refuse every backend caller. MEASURED with no
-- JWT: app_write_country_ok('UAE') = false, ('KSA') = false, (null) = true,
-- app_current_org() = NULL, app_country_scope() = {}.
--
-- SO THE BACKEND PATH WAS SETTLED BY ASKING WHETHER ONE EXISTS AT ALL - it does not.
-- There is no cron job, no other function and no edge function that calls any of
-- these seven (swept pg_proc and cron.job, not the repo). And the strict form is
-- additionally CORRECT here for a reason worth recording:
--
--   app_is_elevated() RETURNS NULL WITH NO JWT, NOT FALSE. The existing gates are
--   written `IF NOT public.app_is_elevated() THEN RAISE`, and `NOT NULL` is NULL, so
--   `IF NULL` is not taken - THESE FUNCTIONS ALREADY FAIL OPEN FOR A NO-JWT CALLER.
--   material_master_derive and material_master_set_bulk then coalesce a NULL org to
--   Company A, so a no-JWT caller lands on Company A's data. The strict country
--   guard closes that path for the country dimension rather than breaking a
--   legitimate one.
--
-- This is the OPPOSITE choice from V549's `is not false` rule, and deliberately so:
-- that rule protects a REAL backend reader path. Here there is none, and `is not
-- false` would have preserved the fail-open.
--
-- 'All' SENTINEL: app_write_country_ok('All') is false. No exemption is granted to
-- any of these seven, and that is correct per function - none of them treats 'All'
-- as a scope selector. They take a real country ('UAE') or read a row's own country
-- column, and the only values in vehicle_fleet, tyre_records and material_master are
-- KSA, UAE and Egypt.
--
-- BLAST RADIUS MEASURED FIRST: 38 approved users, 2 super admins (pass via
-- is_super_admin), 0 plain Admins, 0 approved users with a NULL org_id or
-- organisation_id, 5 elevated. `country IS NULL` still passes everywhere, the
-- standing convention. No legitimate write is refused.
--
-- ============================================================================
-- THE CORRECTION I HAD TO MAKE TO MY OWN FIRST PASS - MEASURED, NOT REASONED ABOUT
--
-- The first pass wrote each guard as the ROW-ARGUMENT helper
-- app_write_country_ok(<col>). That is the shape this repo has already recorded as
-- wrong in a row predicate: it takes the row value so it cannot be hoisted, and it
-- is SECURITY DEFINER so it can never be inlined - a per-row profiles lookup.
--
--   material_master_derive over parts_consumption (216k rows)
--       row-argument helper .......... >55,000 ms, CANCELLED BY STATEMENT TIMEOUT
--       InitPlan form ................    473 ms   (EXPLAIN ANALYZE, buffers)
--   the tyre_records scan (11,191 rows)
--       row-argument helper ..........  5,573 ms
--
-- I found this because the AFTER verification timed out, not because I predicted it.
-- The same EXPLAIN shows the RLS policies' OWN country and site predicates already
-- hoisted as InitPlans (the V396 idiom), so the row-argument call was the outlier on
-- its own plan.
--
-- The four ROW PREDICATES were rewritten to inline app_write_country_ok's body with
-- the three ZERO-ARGUMENT scope readers written as (select f()), each an
-- uncorrelated subquery evaluated ONCE per query. Same truth value, same
-- is_super_admin() term, no app_is_org_admin() bypass.
--
-- The two SCALAR checks are deliberately LEFT on the plain helper
-- (material_master_set, material_master_set_bulk): one call per caller-supplied
-- item, not a predicate over a table scan. Keeping the helper there is clearer and
-- costs nothing.
--
-- ============================================================================
-- METHOD
--
-- NOTHING WAS RETYPED. Every guard was inserted by reading the function's own LIVE
-- pg_get_functiondef and doing an anchored replace() that ABORTS unless the anchor
-- occurs EXACTLY once (all 7 anchors verified to occur exactly once before applying;
-- a further 5 for the correction pass). A partial run is the failure mode that
-- matters - half a boundary reads as a closed one (the V396 lesson).
-- CREATE OR REPLACE preserved SECURITY DEFINER, the pinned search_path and grants -
-- re-verified after: all 7 still prosecdef, all still search_path=public,
-- authenticated retained on 6, anon false on all 7.
--
-- THE STRONGEST REGRESSION PROOF IS TEXTUAL. For ALL SIX guarded functions,
-- stripping the guard from the final live definition reproduces the backed-up
-- definition BYTE FOR BYTE. So the guard is provably the only change, and a
-- permitted country cannot take a different path.
--
-- ============================================================================
-- ROLLBACK
--
--   -- restore all seven definitions exactly as captured:
--   DO $$ DECLARE r record; BEGIN
--     FOR r IN SELECT def FROM _bak.defs_v566 LOOP EXECUTE r.def; END LOOP;
--   END $$;
--   -- and re-open the superseded price backfill to clients:
--   GRANT EXECUTE ON FUNCTION public.backfill_tyre_prices_from_grid() TO authenticated;
--
-- Snapshot table: _bak.defs_v566 (sig, def, captured_at) - 7 rows.
--
-- ============================================================================
-- OPEN - recorded, NOT changed by this migration
--
-- * data_link_create_missing_assets still carries `(v_org IS NULL OR
--   t.organisation_id = v_org)`. With a NULL org that reads ACROSS ORGANISATIONS.
--   It is unreachable today (0 approved users with a NULL org_id or
--   organisation_id) and org is the tenant boundary V551 owns, not country. Left
--   deliberately and flagged rather than changed in a country pass.
--
-- * material_master_derive and material_master_set_bulk both coalesce a NULL
--   app_current_org() to Company A ('00000000-...-0001'). Combined with
--   app_is_elevated() returning NULL for a no-JWT caller, that is a fail-open onto
--   one specific tenant. The country dimension is now closed; the org dimension is
--   not, and it is the same V551 territory.
--
-- * owner_data_audit() still RECOMMENDS backfill_tyre_prices_from_grid by name in
--   its advisory text, and that function is now unreachable from a client and
--   computes a wrong figure. The advice should be repointed at the V401 engine
--   (tyre_price_backfill). Owner decision, one string in another function.
--
-- * app_is_elevated() returning NULL rather than FALSE without a JWT makes every
--   `IF NOT app_is_elevated() THEN RAISE` gate in the codebase fail OPEN. That is a
--   general finding well beyond these seven functions and is not fixed here.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PASS 1 - snapshot, guards, revoke.  (applied as
--          v566_recon_datalink_material_master_country_guards)
-- ---------------------------------------------------------------------------

create schema if not exists _bak;

drop table if exists _bak.defs_v566;
create table _bak.defs_v566 as
select p.oid::regprocedure::text as sig,
       pg_get_functiondef(p.oid)  as def,
       now()                      as captured_at
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('recon_backfill_asset','recon_backfill_all_orphan_assets',
                    'data_link_create_missing_assets','material_master_derive',
                    'material_master_set_bulk','material_master_set',
                    'backfill_tyre_prices_from_grid');

do $do$
declare
  r record; v_src text; v_new text; v_n int;
begin
  for r in
    select * from (values
      ('material_master_set_bulk(jsonb)',
$a$    if v_cat is not null and v_cat not in$a$,
$b$    -- V566 COUNTRY GUARD. The country is caller-supplied, so it is judged by
    -- what this caller may WRITE (V555 helper = the table's own write rule).
    -- Refusal reuses this function's OWN per-item skip path, so a mixed batch
    -- still confirms the items the caller is entitled to.
    if not public.app_write_country_ok(v_ctry) then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_errors) < 25 then
        v_errors := v_errors || jsonb_build_object(
          'item_code', v_code, 'reason', 'country outside your scope: ' || v_ctry);
      end if;
      continue;
    end if;
    if v_cat is not null and v_cat not in$b$),

      ('material_master_set(text,text,text,text,text,text,text,boolean)',
$a$not public.app_can_see_country(p_country)$a$,
$b$not public.app_write_country_ok(p_country)$b$),

      ('material_master_derive()',
$a$       and p.country is not null$a$,
$b$       and p.country is not null
       -- V566: derive only over countries this caller may write.
       and public.app_write_country_ok(p.country)$b$),

      ('recon_backfill_asset(text)',
$a$  SELECT id INTO v_id FROM vehicle_fleet WHERE asset_no = p_asset_no AND organisation_id = v_org LIMIT 1;$a$,
$b$  SELECT id INTO v_id FROM vehicle_fleet WHERE asset_no = p_asset_no AND organisation_id = v_org
    AND public.app_write_country_ok(country) LIMIT 1;$b$),

      ('recon_backfill_asset(text)',
$a$    FROM tyre_records WHERE asset_no = p_asset_no AND organisation_id = v_org
  RETURNING id INTO v_id;$a$,
$b$    FROM tyre_records WHERE asset_no = p_asset_no AND organisation_id = v_org
      AND public.app_write_country_ok(country)
   HAVING count(*) > 0
  RETURNING id INTO v_id;
  -- V566: without the HAVING, max() over an EMPTY set still returns ONE all-NULL
  -- row, so this INSERT always fired and "backfill an orphan" was really "create
  -- any asset you name", country NULL, visible in every country's register.
  -- Refusal is a RAISE because the caller's screen reports success from the
  -- absence of an error; a NULL return would have printed "1 asset added".
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Not permitted: that asset has no tyre records in a country you can write.'
      USING errcode = '42501';
  END IF;$b$),

      ('recon_backfill_all_orphan_assets()',
$a$     WHERE tr.organisation_id = v_org AND COALESCE(tr.asset_no,'') <> ''$a$,
$b$     WHERE tr.organisation_id = v_org AND COALESCE(tr.asset_no,'') <> ''
       AND public.app_write_country_ok(tr.country)$b$),

      ('data_link_create_missing_assets()',
$a$      AND (v_org IS NULL OR t.organisation_id = v_org)$a$,
$b$      AND (v_org IS NULL OR t.organisation_id = v_org)
      AND public.app_write_country_ok(t.country)$b$)
    ) as t(sig, anchor, repl)
  loop
    v_src := pg_get_functiondef(r.sig::regprocedure);
    v_n := (length(v_src) - length(replace(v_src, r.anchor, ''))) / length(r.anchor);
    if v_n <> 1 then
      raise exception 'V566 ABORT: anchor occurs % times (expected 1) in %', v_n, r.sig;
    end if;
    v_new := replace(v_src, r.anchor, r.repl);
    if v_new = v_src then
      raise exception 'V566 ABORT: replacement was a no-op for %', r.sig;
    end if;
    execute v_new;
  end loop;
end $do$;

-- Superseded (V327 formula) and called by nothing. Withdrawn from browser clients
-- rather than guarded into usefulness. service_role retained as break-glass.
revoke execute on function public.backfill_tyre_prices_from_grid() from authenticated;

do $v$
declare v_missing text;
begin
  select string_agg(sig, ', ') into v_missing from (
    select 'material_master_set_bulk(jsonb)' sig, 'app_write_country_ok(v_ctry)' needle
    union all select 'material_master_set(text,text,text,text,text,text,text,boolean)', 'app_write_country_ok(p_country)'
    union all select 'material_master_derive()', 'app_write_country_ok(p.country)'
    union all select 'recon_backfill_asset(text)', 'app_write_country_ok(country)'
    union all select 'recon_backfill_all_orphan_assets()', 'app_write_country_ok(tr.country)'
    union all select 'data_link_create_missing_assets()', 'app_write_country_ok(t.country)'
  ) x where position(x.needle in pg_get_functiondef(x.sig::regprocedure)) = 0;
  if v_missing is not null then
    raise exception 'V566 ABORT: guard missing after replace in %', v_missing;
  end if;
  if has_function_privilege('authenticated','public.backfill_tyre_prices_from_grid()','EXECUTE') then
    raise exception 'V566 ABORT: backfill_tyre_prices_from_grid still executable by authenticated';
  end if;
end $v$;


-- ---------------------------------------------------------------------------
-- PASS 2 - the four ROW PREDICATES move to the InitPlan form.
--          (applied as v566_initplan_form_for_row_predicates)
--          Rationale + measurements in the header above.
-- ---------------------------------------------------------------------------

do $do$
declare
  r record; v_src text; v_new text; v_n int;
begin
  for r in
    select * from (values
      ('material_master_derive()',
$a$       and public.app_write_country_ok(p.country)$a$,
$b$       and (p.country is null
            or (select public.is_super_admin())
            or (select public.app_sees_all_countries())
            or lower(btrim(p.country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])))$b$),

      ('recon_backfill_all_orphan_assets()',
$a$       AND public.app_write_country_ok(tr.country)$a$,
$b$       AND (tr.country IS NULL
            OR (select public.is_super_admin())
            OR (select public.app_sees_all_countries())
            OR lower(btrim(tr.country)) = ANY (coalesce((select public.app_country_scope()), '{}'::text[])))$b$),

      ('data_link_create_missing_assets()',
$a$      AND public.app_write_country_ok(t.country)$a$,
$b$      AND (t.country IS NULL
           OR (select public.is_super_admin())
           OR (select public.app_sees_all_countries())
           OR lower(btrim(t.country)) = ANY (coalesce((select public.app_country_scope()), '{}'::text[])))$b$),

      ('recon_backfill_asset(text)',
$a$    AND public.app_write_country_ok(country) LIMIT 1;$a$,
$b$    AND (country IS NULL
         OR (select public.is_super_admin())
         OR (select public.app_sees_all_countries())
         OR lower(btrim(country)) = ANY (coalesce((select public.app_country_scope()), '{}'::text[]))) LIMIT 1;$b$),

      ('recon_backfill_asset(text)',
$a$      AND public.app_write_country_ok(country)
   HAVING count(*) > 0$a$,
$b$      AND (country IS NULL
           OR (select public.is_super_admin())
           OR (select public.app_sees_all_countries())
           OR lower(btrim(country)) = ANY (coalesce((select public.app_country_scope()), '{}'::text[])))
   HAVING count(*) > 0$b$)
    ) as t(sig, anchor, repl)
  loop
    v_src := pg_get_functiondef(r.sig::regprocedure);
    v_n := (length(v_src) - length(replace(v_src, r.anchor, ''))) / length(r.anchor);
    if v_n <> 1 then
      raise exception 'V566 ABORT: anchor occurs % times (expected 1) in %', v_n, r.sig;
    end if;
    v_new := replace(v_src, r.anchor, r.repl);
    if v_new = v_src then
      raise exception 'V566 ABORT: replacement was a no-op for %', r.sig;
    end if;
    execute v_new;
  end loop;
end $do$;

do $v$
declare v_bad text;
begin
  select string_agg(sig, ', ') into v_bad from (
    select 'material_master_derive()' sig
    union all select 'recon_backfill_all_orphan_assets()'
    union all select 'data_link_create_missing_assets()'
    union all select 'recon_backfill_asset(text)'
  ) x where position('app_write_country_ok' in pg_get_functiondef(x.sig::regprocedure)) > 0;
  if v_bad is not null then
    raise exception 'V566 ABORT: row-argument helper still present in %', v_bad;
  end if;

  select string_agg(sig, ', ') into v_bad from (
    select 'material_master_derive()' sig
    union all select 'recon_backfill_all_orphan_assets()'
    union all select 'data_link_create_missing_assets()'
    union all select 'recon_backfill_asset(text)'
  ) x where position('app_country_scope()' in pg_get_functiondef(x.sig::regprocedure)) = 0;
  if v_bad is not null then
    raise exception 'V566 ABORT: scope test missing in %', v_bad;
  end if;
end $v$;
