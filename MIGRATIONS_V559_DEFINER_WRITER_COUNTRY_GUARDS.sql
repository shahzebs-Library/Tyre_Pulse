-- =====================================================================================
-- V559  SECURITY DEFINER **WRITERS** — THE CROSS-COUNTRY WRITE PASS
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A), 2026-08-16
-- Applied as four migrations:
--   v559_definer_writer_country_guards            (Part A: snapshot + _erp_promote_guard_c)
--   v559_writer_country_guards_part_b             (Part B: 5 functions)
--   v559_writer_country_guards_part_c             (Part C: 5 functions)
--   v559_accident_rpc_context_write_helper        (Part D: the 25-writer accident gate)
-- =====================================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- A SECURITY DEFINER function runs as its OWNER, and no public table sets FORCE ROW
-- LEVEL SECURITY, so RLS NEVER RUNS INSIDE ONE. V542 gave 78 country + 55 site tables a
-- RESTRICTIVE FOR ALL write policy, but that governs only writes made THROUGH RLS. A
-- definer function steps around it entirely and must re-ask the question itself.
--
-- V556 enumerated 214 definer functions that SCAN a country-bearing relation and
-- explicitly deferred the ~95 it triaged as WRITERS. This is that pass.
--
--
-- THE ENUMERATION (re-derived independently — the V556 number was NOT trusted)
-- ---------------------------------------------------------------------------
--   SECURITY DEFINER functions in public, non-trigger .................. 344
--   ... of those, EXECUTE-able by `authenticated` ...................... 306
--   base tables in public carrying a `country` column .................. 220
--   authenticated-executable definer functions performing
--   INSERT / UPDATE / DELETE / MERGE against one of those tables ....... **98**
--
-- 98, not 95. The delta is method, not drama — but it is the reason the population was
-- re-derived rather than inherited. Post-V559 the same query buckets as:
--   A. country-guarded (V550 / V555 / V559) ............................ 14
--   B. gated is_super_admin() only — a REAL restriction ................ 18
--   C. self / own-profile scoped ....................................... 8
--   D. remaining, triaged, not guarded here ............................ 58
--        D1. carry a V547-era ARGUMENT guard on the older helper ....... 9
--        D2. no country term of any kind ............................... 49
--            (of which 25 are the accident family, which is NOT unguarded —
--             see PART D. The regex is wrong in both directions, exactly as
--             V551 warned; every bucket below was checked by reading the body.)
--
--
-- THE ATTACKER (every figure below is from this account)
-- -----------------------------------------------------
--   34793423-43df-4b6f-9270-9d1e8be6fa30 — "adnan mohammad alhaj ali"
--   Manager, approved, unlocked, country = {KSA}, sites = {ALL}, org = Company A.
--   app_role() = manager        -> app_is_elevated() = TRUE  (passes every "elevated" gate)
--   is_super_admin()            = false
--   app_sees_all_countries()    = false      app_country_scope() = {ksa}
--   app_write_country_ok('UAE') = FALSE      app_write_country_ok('KSA') = TRUE
--   DIRECT read: tyre_records country='UAE' -> 0 rows | country='KSA' -> 8,145 rows
--
--
-- =====================================================================================
-- THE FOUR HOLES THAT WERE REPRODUCED. All DESTRUCTIVE. All in rolled-back transactions,
-- every count taken by a PRIVILEGED reader after `reset role` IN THE SAME TRANSACTION —
-- because a count taken from inside an impersonated session counts what is READABLE,
-- not what was written, and a blocked write and an invisible write look identical.
-- =====================================================================================
--
-- HOLE 1 — recon_resolve_duplicate_key(text,text,date)  ** NO IDs REQUIRED **
--   Gate: app_is_elevated() + org. No country predicate anywhere. Takes a tyre's
--   serial + asset + issue_date — all discoverable, and a serial is physically
--   readable off the tyre in the yard.
--   Reachability proved first: called against a REAL UAE group it returns
--     {"resolved":false,"reason":"differs"}  — NOT "not_found".
--   That distinction is the finding: "differs" means it COUNTED 2 UAE rows for a
--   caller whose direct read of them is 0. Only byte-identity stopped the delete.
--   Then, with a byte-identical UAE pair planted (privileged) in a rolled-back txn:
--     A. planted, privileged count ................. 2
--     B. attacker DIRECT read of those rows ........ 0
--     C. ATTACK ..................... {"deleted": 1, "resolved": true}
--     D. privileged recount AFTER .................. 1     <-- A REAL UAE ROW DELETED
--
-- HOLE 2 — recon_merge_duplicate(uuid, uuid[])
--   Gate: app_is_elevated() + org. No country predicate. Same rolled-back method:
--     BEFORE (privileged) UAE rows for key ......... 3
--     attacker DIRECT read ......................... 0
--     ATTACK ....................................... 1 row deleted
--     AFTER (privileged) ........................... 2     <-- A REAL UAE ROW DELETED
--   Requires a row id. An unguessable id is obscurity, not a control — this is the
--   V555 import_reverse_batch shape exactly, and the boundary belongs in the function.
--
-- HOLE 3 — parts_cost_fill_undo(uuid)   ** LIVE, NO PLANTING NEEDED **
--   Gate: app_is_elevated() + org. No country predicate. The one live batch
--   a97352f4-fd21-4d9e-b02d-d60c2987f0a2 SPANS ALL THREE COUNTRIES:
--     KSA 1,066 lines / SAR 31,972.98 | UAE 1 line / AED 600.00 | Egypt 1 line / EGP 12.00
--     ATTACK ................................. {"ok":true,"reverted":1068}
--     AFTER (privileged) UAE+Egypt filled ..... 0 lines   <-- OTHER COUNTRIES' MONEY REVERTED
--
-- HOLE 4 — tyre_price_backfill_undo(uuid)   ** LIVE, AND UNRECOVERABLE **
--   Gate: app_is_elevated() + org. No country predicate. Batches are per country:
--     KSA b4694022 = 2,017 tyres | UAE 9822c2d8 = 568 | Egypt d85550da = 404
--     BEFORE (privileged) ..... 568 UAE tyres, 568 priced, total AED 424,467.79
--     attacker DIRECT read .... 0
--     ATTACK .................. {"ok":true,"restored":568}
--     AFTER (privileged) ...... 0 priced of 568, AED 0.00
--     AFTER undo-log rows ..... 0        <-- THE LOG IS THE ONLY RECORD OF THE PRIOR
--                                            PRICE, AND IT IS DELETED WITH IT. The
--                                            data AND the ability to restore it, gone.
--
--
-- GUARDED WITHOUT AN OBSERVED DISCLOSURE — empty TODAY by DATA, not by RULE.
-- These are labelled honestly and must NOT be cited as leaks.
-- -------------------------------------------------------------------------------------
--   promote_erp_undo(text,uuid)     erp_promote_bak.promotion_log holds 0 rows, so it
--                                   deletes nothing today. It is the V555
--                                   import_reverse_batch shape (batch-keyed DELETE of
--                                   vehicle_fleet / tyre_records / parts_consumption),
--                                   and V555 proved that shape lethal.
--   promote_erp_assets / _tyre_changes / _tyre_expense
--                                   Staging is near-empty (0 / 18 rows-1 KSA batch / 0).
--                                   The erp_*_import tables DO carry V542 _country_write
--                                   policies, so a KSA Manager cannot STAGE a UAE row —
--                                   but a UAE row staged by anyone else is promotable,
--                                   because a definer function ignores those policies.
--   tyre_learn_undo(uuid)           tyre_learn_apply_log is 100% KSA today (26 rows /
--                                   20 batches). Its sibling tyre_learn_confirm IS
--                                   country-guarded (V555), so a future UAE batch is
--                                   expected; this arms before that happens.
--   apply_station_proposals(...)    Already had a country check, but on the WRONG helper
--                                   (app_can_see_country, which bypasses for
--                                   app_is_org_admin() = super OR PLAIN admin). There
--                                   are 0 plain Admins today, so no disclosure was
--                                   observed. Its DELETE/INSERT were already row-scoped
--                                   to m.country = p_country; only the helper changed.
--
--
-- DISMISSED, WITH THE EVIDENCE
-- -------------------------------------------------------------------------------------
--   reclassify_revert(uuid)   Looks identical to holes 3/4 — batch-keyed, rewrites money
--                             across countries, no country predicate — and is CORRECTLY
--                             gated `is_super_admin()`. That is a real restriction, not
--                             an "elevated" one. NOT touched.
--   The 25 accident workstream writers  Look unscoped to a regex; they are not. They
--                             delegate to _accident_rpc_context, which re-checks org AND
--                             country AND site keyed on the CASE ROW's own country — the
--                             correct shape. Read, not assumed. See PART D for the one
--                             thing that was wrong with it.
--
--
-- =====================================================================================
-- WHAT WAS CHANGED
-- =====================================================================================
--
-- HELPER CHOICE. Every guard uses public.app_write_country_ok(text) (added by V555),
-- NEVER app_can_see_country. The latter bypasses for app_is_org_admin() = super OR plain
-- admin, so a guard built on it provably fails to block a country-scoped plain Admin.
-- app_write_country_ok copies the V542 write-policy expression verbatim: only the
-- platform owner crosses a country boundary.
--
-- THE GUARD SCOPES THE **ROWS**, NEVER THE ARGUMENT. This is the V550 lesson: those two
-- writers checked p_country, p_country DEFAULTED TO NULL, and omitting it — which is what
-- a caller does normally — walked straight past the check. Every predicate below sits in
-- the WHERE clause of the write itself.
--
-- REFUSAL SHAPE, CHOSEN PER FUNCTION so nothing is invented. Never a populated row of
-- zeros — that asserts a measurement instead of refusing:
--   recon_resolve_duplicate_key .. rows fall out of the count -> its OWN existing
--                                  {"resolved":false,"reason":"not_found"}
--   recon_merge_duplicate ........ its OWN existing exception
--                                  'Keep row not found in your organisation.'
--   parts_cost_fill_undo ......... {"ok":true,"reverted":N} with a smaller, honest N
--   tyre_price_backfill_undo ..... {"ok":true,"restored":N} likewise
--   tyre_learn_undo .............. {"ok":true,"restored":N} likewise
--   promote_erp_* ................ RAISE 42501 'Cross-country promotion denied (X).',
--                                  matching the 42501 _erp_promote_guard already raises
--   apply_station_proposals ...... its OWN existing {"ok":false,"reason":"forbidden"}
--
-- NO CLIENT CHANGE IS NEEDED, and this was VERIFIED BY READING THE CALLERS, not assumed:
--   src/lib/api/erpImport.js routes every promote/undo error through
--   toUserMessage(error, ...), and src/lib/safeError.js maps '42501' to
--   "You do not have permission to do that." Every other refusal keeps the function's
--   existing jsonb shape, so no caller sees anything new. src/** was NOT modified.
--
-- PRESERVING THE UNDO CHAIN. Holes 3 and 4 delete their own undo log. A naive guard that
-- scoped only the UPDATE would still have let a KSA Manager delete UAE's undo records,
-- destroying another country's ability to recover. Both log DELETEs are therefore scoped
-- through an EXISTS onto the in-scope rows, so each country keeps its own recoverability.
--
-- THE BACKEND / no-JWT PATH — MEASURED, NOT REASONED ABOUT.
--   app_can_see_country() returns NULL with no JWT; app_write_country_ok() returns FALSE.
--   `is not false` therefore does NOT protect a backend caller here, so the question was
--   settled empirically instead: with `set local role authenticated` and NO claims,
--   app_current_org() is NULL and app_is_elevated() is NULL, and all three probed
--   functions were ALREADY inert before this migration — the org predicate, not the role
--   gate, is what stops them. Confirmed after the change:
--     no-JWT parts_cost_fill_undo ......... {"ok":true,"reverted":0}
--     no-JWT tyre_price_backfill_undo ..... {"ok":true,"restored":0}
--     no-JWT recon_resolve_duplicate_key .. {"resolved":false,"reason":"not_found"}
--     privileged recount: KSA prices ...... 2,017 still priced (untouched)
--   So V559 introduces NO backend regression. `is not false` is retained throughout
--   because it refuses only on a DEFINITIVE false, which is the correct posture.
--
--
-- PART D — ONE SWAP THAT CLOSES 25 WRITERS AT ONCE
-- -------------------------------------------------------------------------------------
-- _accident_rpc_context(uuid) is the country/site gate for 25 accident workstream
-- WRITERS. It already scoped by the case row's own country (the correct shape) but
-- through app_can_see_country, carrying the org-admin bypass.
-- MEASURED BEFORE TOUCHING A FUNCTION 25 RPCs DEPEND ON: across all 38 approved profiles
-- x {KSA, UAE, Egypt, 'All', NULL} = 190 combinations, app_can_see_country and
-- app_write_country_ok differ on **ZERO**. Behaviour-preserving today, strictly stricter
-- for any future country-scoped plain Admin. Site is deliberately untouched (V553).
-- THE OUT-PARAMETER NAMES org / country / site ARE A CONTRACT 24 CONSUMERS COMPILE
-- AGAINST — verified preserved after the change:
--   p_accident_id uuid, OUT org uuid, OUT country text, OUT site text
--
--
-- =====================================================================================
-- VERIFICATION
-- =====================================================================================
--
-- 1. TEXTUAL REGRESSION PROOF — the strongest one, and it is worth more than re-timing.
--    For ALL 11 changed functions, stripping the guard from the LIVE definition
--    reproduces the backed-up definition **BYTE FOR BYTE**. So the guard is provably the
--    only change, and a permitted country cannot take a different code path:
--      apply_station_proposals ......... BYTE-IDENTICAL   parts_cost_fill_undo ..... BYTE-IDENTICAL
--      promote_erp_assets .............. BYTE-IDENTICAL   promote_erp_tyre_changes . BYTE-IDENTICAL
--      promote_erp_tyre_expense ........ BYTE-IDENTICAL   promote_erp_undo ......... BYTE-IDENTICAL
--      recon_merge_duplicate ........... BYTE-IDENTICAL   recon_resolve_duplicate_key BYTE-IDENTICAL
--      tyre_learn_undo ................. BYTE-IDENTICAL   tyre_price_backfill_undo . BYTE-IDENTICAL
--      _accident_rpc_context ........... BYTE-IDENTICAL
--    NOTHING WAS RETYPED. Every guard was inserted by reading the function's own live
--    pg_get_functiondef and doing an anchored replace(), and EVERY replacement ABORTS
--    unless its anchor occurs EXACTLY the expected number of times — a partial run is the
--    failure mode that matters, because half a boundary reads as a closed one (V396).
--
-- 2. ATTACKS REFUSED (same rolled-back method, privileged recount after `reset role`):
--      ATTACK recon_resolve_duplicate_key(UAE) .. {"reason":"not_found","resolved":false}
--      ATTACK recon_merge_duplicate(UAE) ........ REFUSED: Keep row not found in your organisation.
--      ATTACK parts_cost_fill_undo(cross-cty) ... {"ok":true,"reverted":1066}
--      ATTACK tyre_price_backfill_undo(UAE) ..... {"ok":true,"restored":0}
--      ATTACK accident_ws_set_status(UAE case) .. REFUSED: Not permitted for this case country/site scope.
--    AND the privileged recount confirms the other countries SURVIVED:
--      UAE rows for the planted key ......... 3 (unchanged)
--      UAE+Egypt filled_cost lines .......... 2 lines, money 612.00 (unchanged)
--      UAE tyre prices ...................... 568 priced, AED 424,467.79 (unchanged)
--      UAE undo-log rows .................... 568 (recoverability preserved)
--    Note reverted:1066 on parts_cost_fill_undo — the caller's OWN 1,066 KSA lines were
--    still reverted while UAE's 1 and Egypt's 1 were left alone. It refuses the
--    out-of-scope part only; it does not refuse the operation.
--
-- 3. CONTROLS — a fix that breaks the feature is not a fix:
--      recon_merge_duplicate(own KSA pair) ......... 1 row deleted
--      tyre_price_backfill_undo(own KSA batch) ..... {"ok":true,"restored":2017}
--      apply_station_proposals('KSA', dry run) ..... ok, real preview
--                                                    (27,981 loads / 301,843 m3, CENTRAL)
--      apply_station_proposals('UAE', dry run) ..... {"ok":false,"reason":"forbidden"}
--      promote_erp_tyre_changes(own KSA batch) ..... runs normally, full result payload
--      accident_ws_set_status(own KSA case) ........ passes the country gate and proceeds
--                                                    into business validation (see the
--                                                    pre-existing <> ANY defect below) —
--                                                    i.e. the gate discriminates on
--                                                    country and on nothing else
--    SUPER ADMIN still crosses every boundary (the platform owner is unaffected):
--      super-admin tyre_price_backfill_undo(UAE) ... {"ok":true,"restored":568}
--      super-admin apply_station_proposals('UAE') .. {"ok":true,...}
--
-- 4. OBJECT INTEGRITY after all four parts — SECURITY DEFINER preserved, search_path
--    still pinned to public, authenticated keeps EXECUTE, anon has NONE, on all 11.
--
--
-- =====================================================================================
-- INCIDENTAL FINDING — **NOT MINE, NOT FIXED, NEEDS THE OWNER'S CALL**
-- =====================================================================================
-- While running the accident control I hit a PRE-EXISTING logic bug unrelated to
-- security: 14 accident RPCs validate an enum with `x <> any (array[...])`, which is TRUE
-- whenever x differs from ANY element — i.e. it is true for every value once the array
-- has more than one entry. The correct form is `<> all (...)`. Proven:
--     'medium' <> any (array['low','medium','high','critical'])  ->  TRUE   (bug)
--     'medium' <> all (array['low','medium','high','critical'])  ->  FALSE  (correct)
-- Effect: these functions raise "Invalid task priority" / "Unknown workstream" for EVERY
-- input, for EVERY user, in EVERY country — they can never succeed. Affected:
--   accident_claim_decision, accident_decide_closure, accident_downtime_set,
--   accident_evidence_add, accident_evidence_verify, accident_finance_txn_add,
--   accident_recovery_record, accident_repair_order_upsert, accident_repair_qc,
--   accident_request_closure, accident_task_create, accident_ws_assign,
--   accident_ws_mark_na, accident_ws_set_status
-- DELIBERATELY NOT FIXED HERE: it is a behaviour change to a shipped feature, outside a
-- security pass, and repairing it turns 14 permanently-refusing RPCs into working
-- writers — which should happen only once someone has decided that is wanted. It also
-- explains why this family was never exercised in anger.
--
--
-- =====================================================================================
-- STILL OPEN AFTER V559 — recorded so it is not re-derived
-- =====================================================================================
-- * D1 (9 fns): apply_production_station_map, correction_case_open, material_master_set,
--   parts_cost_fill, run_quality_checks, run_reconciliation, scan_data_trust,
--   set_store_site_map, tyre_price_backfill. These carry a V547-era guard on the
--   ARGUMENT using the older helper. Two residual weaknesses: the org-admin bypass, and
--   the V550 shape — an argument guard says nothing about the ROWS a NULL/omitted country
--   reaches. They are NOT unguarded, but they are not row-scoped either.
-- * D2 minus the accident family (24 fns): apply_tyre_change, tyre_move,
--   backfill_tyre_prices_from_grid, cost_clear_value, cost_convert_line_totals,
--   cost_apply_actual_budgets, cost_set_monthly_budget, data_link_create_missing_assets,
--   recon_backfill_asset, recon_backfill_all_orphan_assets, import_commit_batch,
--   material_master_derive, material_master_set_bulk, post_stock_movement,
--   set_stock_count, set_scrap_reason, correct_wash_record, record_pm_service,
--   generate_checklist_assignments, holding_link_subsidiary, holding_unlink_subsidiary,
--   ack_trust_alert, correction_case_transition, correction_case_update.
--   Each needs the same treatment: read the body, find what the write is keyed on, and
--   put app_write_country_ok on the ROWS.
-- * _accident_rpc_context still uses app_can_see_site() for the site half. Site is V553
--   territory and the all-sites path is deliberately open there; left alone on purpose.
-- * Bucket B (18 fns) is gated is_super_admin() and is correct as-is. Do not re-raise it
--   without re-measuring — several were checked by reading the body, not the regex.
--
--
-- =====================================================================================
-- ROLLBACK
-- =====================================================================================
-- Every prior definition is in _bak.definer_writer_country_v559 (proname, args, def,
-- captured_at). To revert one function:
--     do $$ declare d text; begin
--       select def into d from _bak.definer_writer_country_v559 where proname = '<name>';
--       execute d;
--     end $$;
-- To revert all eleven, loop that over the table. CREATE OR REPLACE restores the exact
-- prior body and preserves SECURITY DEFINER, the pinned search_path and the grants.
-- Part A additionally created public._erp_promote_guard_c(text, uuid); after reverting
-- the three promote_erp_* functions it is unreferenced and may be dropped:
--     drop function if exists public._erp_promote_guard_c(text, uuid);
-- No table, column, policy, grant or row of business data was altered by V559.
-- =====================================================================================


-- =====================================================================================
-- PART A — snapshot + the shared ERP promote country gate
-- =====================================================================================

create table if not exists _bak.definer_writer_country_v559 (
  proname text, args text, def text, captured_at timestamptz default now()
);

insert into _bak.definer_writer_country_v559 (proname, args, def)
select p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('recon_resolve_duplicate_key','recon_merge_duplicate',
                    'parts_cost_fill_undo','tyre_price_backfill_undo','tyre_learn_undo',
                    'promote_erp_undo','promote_erp_assets','promote_erp_tyre_changes',
                    'promote_erp_tyre_expense','apply_station_proposals')
  and not exists (select 1 from _bak.definer_writer_country_v559 b where b.proname = p.proname);

-- The ERP promote family derives its authority from _erp_promote_guard(), which checks
-- elevated + org and knows nothing about country. This sibling adds the missing half:
-- every distinct country present in the staging batch must be one this caller may WRITE.
-- Scoped by the ROWS' own country, never by an argument.
create or replace function public._erp_promote_guard_c(p_staging text, p_batch uuid)
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $fn$
declare v_org uuid := public._erp_promote_guard(); v_bad text;
begin
  if p_staging not in ('erp_asset_import','erp_tyre_change_import','erp_tyre_expense_import') then
    raise exception 'Unknown staging table %', p_staging using errcode = '22023';
  end if;
  execute format(
    'select string_agg(distinct s.country, '', '')
       from public.%I s
      where s.batch_id = $1 and s.organisation_id = $2
        and s.country is not null
        and public.app_write_country_ok(s.country) is false', p_staging)
    into v_bad using p_batch, v_org;
  if v_bad is not null then
    raise exception 'Cross-country promotion denied (%).', v_bad using errcode = '42501';
  end if;
  return v_org;
end
$fn$;

revoke all on function public._erp_promote_guard_c(text, uuid) from public, anon;
grant execute on function public._erp_promote_guard_c(text, uuid) to authenticated, service_role;


-- =====================================================================================
-- PART B — five functions. Each replacement ABORTS unless its anchor count is exact.
-- =====================================================================================

do $mig$
declare d text; n int;

  a1 text := $a$WHERE t.organisation_id = v_org
     AND t.serial_no    IS NOT DISTINCT FROM p_serial$a$;
  r1 text := $a$WHERE t.organisation_id = v_org
     AND public.app_write_country_ok(t.country) IS NOT FALSE
     AND t.serial_no    IS NOT DISTINCT FROM p_serial$a$;

  a2 text := $a$FROM tyre_records t WHERE id = p_keep_id AND organisation_id = v_org;$a$;
  r2 text := $a$FROM tyre_records t WHERE id = p_keep_id AND organisation_id = v_org AND public.app_write_country_ok(t.country) IS NOT FALSE;$a$;

  a3 text := $a$DELETE FROM tyre_records WHERE id = ANY(p_remove_ids) AND id <> p_keep_id AND organisation_id = v_org;$a$;
  r3 text := $a$DELETE FROM tyre_records WHERE id = ANY(p_remove_ids) AND id <> p_keep_id AND organisation_id = v_org AND public.app_write_country_ok(country) IS NOT FALSE;$a$;

  a4 text := $a$   where l.batch_id = p_batch and l.line_id = p.id and p.organisation_id = v_org;$a$;
  r4 text := $a$   where l.batch_id = p_batch and l.line_id = p.id and p.organisation_id = v_org
     and public.app_write_country_ok(p.country) is not false;$a$;

  -- the log DELETE is scoped through the in-scope lines so another country keeps its
  -- own undo record; a blanket delete would destroy their ability to recover.
  a5 text := $a$  delete from public.parts_cost_fill_log where batch_id = p_batch and organisation_id = v_org;$a$;
  r5 text := $a$  delete from public.parts_cost_fill_log l
   where l.batch_id = p_batch and l.organisation_id = v_org
     and exists (select 1 from public.parts_consumption p
                  where p.id = l.line_id
                    and public.app_write_country_ok(p.country) is not false);$a$;

  a6 text := $a$     and t.id = l.tyre_id
     and t.organisation_id = v_org;$a$;
  r6 text := $a$     and t.id = l.tyre_id
     and t.organisation_id = v_org
     and public.app_write_country_ok(t.country) is not false;$a$;

  a7 text := $a$  delete from public.tyre_price_backfill_log
   where organisation_id = v_org and batch_id = p_batch_id;$a$;
  r7 text := $a$  delete from public.tyre_price_backfill_log l
   where l.organisation_id = v_org and l.batch_id = p_batch_id
     and exists (select 1 from public.tyre_records t
                  where t.id = l.tyre_id
                    and public.app_write_country_ok(t.country) is not false);$a$;

  -- wrong helper -> right helper. `is false` keeps the original fail-open posture.
  a8 text := $a$  if not public.app_can_see_country(p_country) then$a$;
  r8 text := $a$  if public.app_write_country_ok(p_country) is false then$a$;
begin
  d := pg_get_functiondef('public.recon_resolve_duplicate_key(text,text,date)'::regprocedure);
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  if n <> 3 then raise exception 'V559 abort: recon_resolve_duplicate_key anchor x%, expected 3', n; end if;
  execute replace(d, a1, r1);

  d := pg_get_functiondef('public.recon_merge_duplicate(uuid,uuid[])'::regprocedure);
  n := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'V559 abort: recon_merge_duplicate keep-anchor x%, expected 1', n; end if;
  n := (length(d) - length(replace(d, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'V559 abort: recon_merge_duplicate delete-anchor x%, expected 1', n; end if;
  execute replace(replace(d, a2, r2), a3, r3);

  d := pg_get_functiondef('public.parts_cost_fill_undo(uuid)'::regprocedure);
  n := (length(d) - length(replace(d, a4, ''))) / length(a4);
  if n <> 1 then raise exception 'V559 abort: parts_cost_fill_undo update-anchor x%, expected 1', n; end if;
  n := (length(d) - length(replace(d, a5, ''))) / length(a5);
  if n <> 1 then raise exception 'V559 abort: parts_cost_fill_undo logdel-anchor x%, expected 1', n; end if;
  execute replace(replace(d, a4, r4), a5, r5);

  d := pg_get_functiondef('public.tyre_price_backfill_undo(uuid)'::regprocedure);
  n := (length(d) - length(replace(d, a6, ''))) / length(a6);
  if n <> 1 then raise exception 'V559 abort: tyre_price_backfill_undo update-anchor x%, expected 1', n; end if;
  n := (length(d) - length(replace(d, a7, ''))) / length(a7);
  if n <> 1 then raise exception 'V559 abort: tyre_price_backfill_undo logdel-anchor x%, expected 1', n; end if;
  execute replace(replace(d, a6, r6), a7, r7);

  d := pg_get_functiondef('public.apply_station_proposals(text,jsonb,boolean)'::regprocedure);
  n := (length(d) - length(replace(d, a8, ''))) / length(a8);
  if n <> 1 then raise exception 'V559 abort: apply_station_proposals helper-anchor x%, expected 1', n; end if;
  execute replace(d, a8, r8);

  raise notice 'V559 part B applied';
end
$mig$;


-- =====================================================================================
-- PART C — tyre_learn_undo, promote_erp_undo, and the three forward promote writers
-- =====================================================================================

do $mig$
declare d text;

  b1 text := $a$   where organisation_id=v_org and id in ($a$;
  c1 text := $a$   where organisation_id=v_org and public.app_write_country_ok(country) is not false and id in ($a$;

  b2 text := $a$  for r in select tyre_record_id, target_field, old_value from public.tyre_learn_apply_log
           where batch_id=p_batch_id and organisation_id=v_org loop$a$;
  c2 text := $a$  for r in select l.tyre_record_id, l.target_field, l.old_value from public.tyre_learn_apply_log l
           where l.batch_id=p_batch_id and l.organisation_id=v_org
             and exists (select 1 from public.tyre_records t
                          where t.id = l.tyre_record_id
                            and public.app_write_country_ok(t.country) is not false) loop$a$;

  b3 text := $a$update public.tyre_records set %I=%L where id=%L and organisation_id=%L$a$;
  c3 text := $a$update public.tyre_records set %I=%L where id=%L and organisation_id=%L and public.app_write_country_ok(country) is not false$a$;

  b4 text := $a$  delete from public.tyre_learn_apply_log where batch_id=p_batch_id and organisation_id=v_org;$a$;
  c4 text := $a$  delete from public.tyre_learn_apply_log l where l.batch_id=p_batch_id and l.organisation_id=v_org
    and exists (select 1 from public.tyre_records t
                 where t.id = l.tyre_record_id
                   and public.app_write_country_ok(t.country) is not false);$a$;

  e1 text := $a$update public.vehicle_fleet t set %s where id=$2$a$;
  f1 text := $a$update public.vehicle_fleet t set %s where id=$2 and public.app_write_country_ok(t.country) is not false$a$;
  e2 text := $a$update public.tyre_records t set %s where id=$2$a$;
  f2 text := $a$update public.tyre_records t set %s where id=$2 and public.app_write_country_ok(t.country) is not false$a$;
  e3 text := $a$and l.master_table='vehicle_fleet' and f.id=l.master_id;$a$;
  f3 text := $a$and l.master_table='vehicle_fleet' and f.id=l.master_id
      and public.app_write_country_ok(f.country) is not false;$a$;
  e4 text := $a$and l.master_table='tyre_records' and t.id=l.master_id;$a$;
  f4 text := $a$and l.master_table='tyre_records' and t.id=l.master_id
      and public.app_write_country_ok(t.country) is not false;$a$;
  e5 text := $a$and l.master_table='parts_consumption' and p.id=l.master_id;$a$;
  f5 text := $a$and l.master_table='parts_consumption' and p.id=l.master_id
      and public.app_write_country_ok(p.country) is not false;$a$;

  g  text := $a$public._erp_promote_guard()$a$;
begin
  d := pg_get_functiondef('public.tyre_learn_undo(uuid)'::regprocedure);
  if (length(d)-length(replace(d,b1,'')))/length(b1) <> 1 then raise exception 'V559 abort: tyre_learn_undo facts-anchor'; end if;
  if (length(d)-length(replace(d,b2,'')))/length(b2) <> 1 then raise exception 'V559 abort: tyre_learn_undo loop-anchor'; end if;
  if (length(d)-length(replace(d,b3,'')))/length(b3) <> 1 then raise exception 'V559 abort: tyre_learn_undo format-anchor'; end if;
  if (length(d)-length(replace(d,b4,'')))/length(b4) <> 1 then raise exception 'V559 abort: tyre_learn_undo logdel-anchor'; end if;
  execute replace(replace(replace(replace(d,b1,c1),b2,c2),b3,c3),b4,c4);

  d := pg_get_functiondef('public.promote_erp_undo(text,uuid)'::regprocedure);
  if (length(d)-length(replace(d,e1,'')))/length(e1) <> 1 then raise exception 'V559 abort: promote_erp_undo fleet-restore-anchor'; end if;
  if (length(d)-length(replace(d,e2,'')))/length(e2) <> 1 then raise exception 'V559 abort: promote_erp_undo tyre-restore-anchor'; end if;
  if (length(d)-length(replace(d,e3,'')))/length(e3) <> 1 then raise exception 'V559 abort: promote_erp_undo fleet-del-anchor'; end if;
  if (length(d)-length(replace(d,e4,'')))/length(e4) <> 1 then raise exception 'V559 abort: promote_erp_undo tyre-del-anchor'; end if;
  if (length(d)-length(replace(d,e5,'')))/length(e5) <> 1 then raise exception 'V559 abort: promote_erp_undo parts-del-anchor'; end if;
  execute replace(replace(replace(replace(replace(d,e1,f1),e2,f2),e3,f3),e4,f4),e5,f5);

  d := pg_get_functiondef('public.promote_erp_assets(uuid,boolean)'::regprocedure);
  if (length(d)-length(replace(d,g,'')))/length(g) <> 1 then raise exception 'V559 abort: promote_erp_assets guard-anchor'; end if;
  execute replace(d, g, $a$public._erp_promote_guard_c('erp_asset_import', p_batch)$a$);

  d := pg_get_functiondef('public.promote_erp_tyre_changes(uuid,boolean)'::regprocedure);
  if (length(d)-length(replace(d,g,'')))/length(g) <> 1 then raise exception 'V559 abort: promote_erp_tyre_changes guard-anchor'; end if;
  execute replace(d, g, $a$public._erp_promote_guard_c('erp_tyre_change_import', p_batch)$a$);

  d := pg_get_functiondef('public.promote_erp_tyre_expense(uuid,boolean)'::regprocedure);
  if (length(d)-length(replace(d,g,'')))/length(g) <> 1 then raise exception 'V559 abort: promote_erp_tyre_expense guard-anchor'; end if;
  execute replace(d, g, $a$public._erp_promote_guard_c('erp_tyre_expense_import', p_batch)$a$);

  raise notice 'V559 part C applied';
end
$mig$;


-- =====================================================================================
-- PART D — the one swap that closes 25 accident workstream writers at once.
-- Measured first: 38 approved profiles x 5 country values = 190 combinations,
-- app_can_see_country vs app_write_country_ok differ on ZERO. Site untouched.
-- =====================================================================================

do $mig$
declare d text; n int;
  a text := $a$  if not (public.app_can_see_country(country) and public.app_can_see_site(site)) then$a$;
  r text := $a$  if not (public.app_write_country_ok(country) is not false and public.app_can_see_site(site)) then$a$;
begin
  insert into _bak.definer_writer_country_v559 (proname, args, def)
  select p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
  from pg_proc p where p.proname = '_accident_rpc_context' and p.pronamespace = 'public'::regnamespace
    and not exists (select 1 from _bak.definer_writer_country_v559 b where b.proname = '_accident_rpc_context');

  d := pg_get_functiondef('public._accident_rpc_context(uuid)'::regprocedure);
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'V559 abort: _accident_rpc_context anchor x%, expected 1', n; end if;
  execute replace(d, a, r);
  raise notice 'V559 part D applied';
end
$mig$;
