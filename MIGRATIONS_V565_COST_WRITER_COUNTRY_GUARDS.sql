-- =====================================================================================
-- V565  THE FOUR COST WRITERS — COUNTRY GUARD + THE CURRENCY-BLENDING REPAIR
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A), 2026-08-17
-- Applied as ONE migration: v565_cost_writer_country_guards
-- Scope: cost_apply_actual_budgets, cost_clear_value, cost_convert_line_totals,
--        cost_set_monthly_budget. Signatures re-derived live, not inherited.
-- =====================================================================================
--
-- READ THIS FIRST — THE HEADLINE IS NOT WHAT THE BRIEF EXPECTED
-- -------------------------------------------------------------------------------------
-- These four were handed to me as "the highest-consequence writers left", to be closed
-- against the V559 attacker (the real approved KSA-only Manager 34793423). MEASUREMENT
-- CONTRADICTED THAT PREMISE, and the contradiction is the most important thing in this
-- file:
--
--   ** ALL FOUR ARE GATED app_is_org_admin(), NOT app_is_elevated(). **
--   app_is_org_admin() = is_super_admin() OR app_role() = 'admin'.
--   A Manager does NOT pass. The named attacker cannot reach any of them.
--
-- Proven, not read — impersonated in a rolled-back transaction, all four called:
--     app_role()=manager  app_is_elevated()=TRUE  app_is_org_admin()=FALSE
--     ATTACK cost_convert_line_totals()   -> REFUSED [42501] Admin only.
--     ATTACK cost_clear_value(900)        -> REFUSED [42501] Admin only.
--     ATTACK cost_apply_actual_budgets()  -> REFUSED [42501] Admin only.
--     ATTACK cost_set_monthly_budget(...) -> REFUSED [42501] Admin only.
--   privileged recount after `reset role`, SAME transaction: 6,832 priced tyres before
--   AND after; vehicle_fleet budgets 0 of 1,617 before AND after. Nothing was written.
--
-- And the population that DOES pass the gate was counted:
--   ** EXACTLY 2 accounts pass app_is_org_admin(), and BOTH are super admins.
--      There are ZERO plain Admins on this database. **
--   (d2d43a5f "Anum" and 58787cc7 "shahzeb Rahman", both country = NULL = all countries.)
--   A super admin crossing a country boundary is not a hole — app_write_country_ok()
--   returns TRUE for them by design; they are the platform owner.
--
-- SO: **NO CROSS-COUNTRY DISCLOSURE OR WRITE WAS OBSERVED FOR ANY REAL ACCOUNT.**
-- This is NOT the V559 shape and MUST NOT be cited as a leak. It is the V552
-- gate_pass_blockers shape: guarded because the hole ARMS the moment someone creates a
-- country-scoped plain Admin — one UPDATE on profiles, a role the app already offers —
-- at which point all four become live cross-country money rewrites. That is why the
-- guard went in anyway, and it is labelled honestly rather than dressed up.
--
-- THE LIVE DEFECT IS SOMETHING ELSE ENTIRELY, AND THE COUNTRY GUARD DOES NOT FIX IT.
-- See "FINDING 1" below: cost_apply_actual_budgets ADDS SAR + AED + EGP TOGETHER and
-- writes the result into a machine's budget column. That is live TODAY, for the only
-- callers that exist, and no country guard touches it because a super admin passes every
-- country. It needed the aggregate PARTITIONED by country. That repair is the substance
-- of this migration; the guard is the cheap half.
--
--
-- =====================================================================================
-- FINDING 1 — ** MONEY IS BLENDED ACROSS COUNTRIES, AND WRITTEN TO A COLUMN. LIVE. **
-- cost_apply_actual_budgets()  —  the governing rule of this codebase, violated
-- =====================================================================================
-- The per_asset CTE grouped tyre spend by `lower(btrim(asset_no))` with NO country term,
-- then joined vehicle_fleet on asset_no alone. But vehicle_fleet is UNIQUE per
-- (org, country, asset_no) and asset codes are a PER-COUNTRY sequence (V348/V376) — the
-- same code in two countries is usually a DIFFERENT MACHINE. So the function pooled every
-- country's spend under one code and wrote that single figure onto every country's row.
--
-- MEASURED read-only, by reproducing the function's own CTE and join exactly.
-- Of the 701 vehicle_fleet rows it would write:
--
--   own country only (clean) ............................. 519 rows
--       KSA 336 | UAE 137 | Egypt 46
--   BLENDED: own + another country's money ................  68 rows
--       KSA+UAE mix ... 33 KSA rows + 33 UAE rows
--       Egypt+KSA mix .. 1 KSA row  +  1 Egypt row
--   FOREIGN: the money is ENTIRELY another country's ...... 114 rows
--       85 KSA rows  <- budget derived purely from UAE (AED) spend
--       22 UAE rows  <- budget derived purely from KSA (SAR) spend
--        3 KSA rows  <- from Egypt (EGP)
--        2 Egypt rows <- from KSA (SAR)
--        2 UAE rows  <- from Egypt (EGP), total 191,514 written across the two
--
--   ** 182 of 701 rows (26%) get a monthly tyre budget that is either two currencies
--      added together or another country's currency outright. **
--
-- The two UAE machines receiving ~95,757 each derived from Egyptian pounds are the
-- clearest statement of the defect: EGP is worth roughly a thirteenth of AED, so that is
-- not a rounding error, it is an order-of-magnitude fabrication written into the column
-- that VehicleHistory.jsx then uses to raise BUDGET_BREACH alerts.
--
-- 34 asset codes have their budget computed by adding two currencies:
--   KSA+UAE .... 33 codes, summing to 96,784
--   Egypt+KSA ... 1 code,  summing to    923
-- A figure that adds SAR to AED is not a quantity of anything.
--
-- THIS IS NOT DEAD CODE. Its own audit trail shows it has been run in production:
--   import_audit_events 'budget_from_actuals', 2026-07-05 08:07:22,
--   {"vehicles":162,"total_monthly":7955799}   <- 7,955,799 is a blended figure
-- The fleet was 162 vehicles then and is 1,617 now, so a re-run today writes 701 rows,
-- not 162. All four functions have live audit rows (see FINDING 3).
--
-- WHY THE COUNTRY GUARD ALONE WOULD HAVE BEEN A FIX THAT FIXES NOTHING: the only accounts
-- that can call this are the two super admins, and app_write_country_ok() is TRUE for them
-- on every country. Guarding the write and stopping there would have shipped a migration
-- that provably changes nothing about the live defect. The aggregate had to be PARTITIONED.
--
-- THE REPAIR IS WHAT THE FUNCTION'S OWN CLIENT ALREADY PROMISES. src/lib/api/imports.js:
--     /** Admin: set each vehicle's budget to ITS OWN actual average monthly spend. */
-- Joining a UAE machine to KSA tyre history is not "its own". Partitioning by country is
-- a correctness repair to match the documented contract, not a new behaviour.
--
-- BEFORE / AFTER, measured read-only then confirmed by the live control:
--   rows written .................. 701  ->  587
--   rows no longer written ........ 114   (they had NO own-country tyre history at all;
--                                          they were receiving a purely foreign figure,
--                                          and now correctly get none)
--   rows whose value changes .......  64   (were blended, now own-country only)
--   rows BYTE-IDENTICAL ........... 523   (75% — single-country assets, untouched)
--   total_monthly ............ 5,157,430  ->  4,755,167
--
-- ** ZERO STORED VALUES CHANGED. ** vehicle_fleet.monthly_tyre_budget is NULL on all
-- 1,617 rows today, so this repair costs nothing to apply now and prevents 182 wrong
-- budgets the next time anyone presses the button. That timing is why it was fixed here
-- rather than deferred: the same change after a run would require unpicking real data.
--
--
-- =====================================================================================
-- FINDING 2 — A SECOND BLENDED FIGURE, REPORTED NOT SILENTLY REDEFINED
-- =====================================================================================
-- cost_convert_line_totals() returns `total_spend` = sum(cost_per_tyre * qty) over EVERY
-- country in the org. Confirmed live during the control run:
--     {"converted": 0, "total_spend": 12450390.96}
-- 12,450,390.96 is SAR + AED + EGP added together. It is returned to the caller AND
-- written into import_audit_events.detail.
--
-- It reaches a screen. src/components/intake/CostControlPanel.jsx:61 renders it through
-- money(res.total_spend) — a single currency-labelled figure — and the same panel renders
-- cost_apply_actual_budgets' total_monthly the same way at line 83. On the All-countries
-- scope activeCurrency falls back to the org default (SAR), so the panel labels a
-- three-currency sum as riyals. This is the exact defect PROJECT_MEMORY records having
-- already fixed at four separate reader sites.
--
-- ** DELIBERATELY NOT REDEFINED. ** The response KEYS are a client contract I am forbidden
-- to follow into src/**, and splitting the figure per country would change the shape that
-- panel destructures. What WAS done is the honest half: the total_spend read is now scoped
-- by app_write_country_ok, so a future country-scoped Admin is never handed another
-- country's money back as a report. For the two super admins the helper is true on every
-- country, so **today's number does not move** — verified, still 12,450,390.96.
-- Making that figure per-currency is a product decision and needs the owner.
--
--
-- =====================================================================================
-- FINDING 3 — BLAST RADIUS OF EACH WRITER, BOUNDED BEFORE ANYTHING WAS RUN
-- The brief asked for this explicitly, and for a read to settle it wherever a read could.
-- Every figure below is from a read-only query, not a rolled-back write.
-- =====================================================================================
--
-- cost_convert_line_totals()  — "bulk rewrite" by shape, INERT BY DATA TODAY.
--     UPDATE tyre_records SET cost_per_tyre = cost_per_tyre/qty WHERE qty > 1.
--     ** qty is 1 on EVERY row in the org — exactly one distinct value present. **
--     So rows matching its predicate: 0. Confirmed by the live control: {"converted": 0}.
--     Its audit trail shows it DID convert 1,251 rows on 2026-07-05, so it is a real tool
--     that is merely out of matching data now. LABEL HONESTLY: empty by today's data, not
--     by rule. It re-arms the moment an ERP file lands with qty > 1.
--
-- cost_clear_value(numeric)  — the genuine cross-country mass-delete, and the cleanest
--     demonstration available. One call NULLs every tyre price equal to a given value,
--     in every country at once. Measured, per value:
--         900.00 -> 3,975 rows (all KSA)
--         950    ->   179 rows = ** 170 KSA + 9 UAE **   <- spans two countries
--       1,800    ->   389 rows (all KSA)
--         700    ->   206 rows (all UAE)
--     Its audit trail: cost_clear_flat_rate, 2026-07-05, {"value":1200,"records":2383} —
--     2,383 tyre prices destroyed in a single call, in production.
--     950 is the value used for the attack proof below precisely because it straddles KSA
--     and UAE, so the guard has something real to discriminate on.
--
-- cost_set_monthly_budget(text,text,numeric) — the V550 shape, twice over.
--     p_scope='all' has no country term of ANY kind; p_scope='country' takes a country
--     VALUE the caller was never checked against. Target: 1,617 vehicle_fleet rows
--     (KSA 1,030 | UAE 452 | Egypt 135). Audit trail shows two live runs on 2026-07-05,
--     both scope='all', 162 vehicles each (amount 2000, then amount 0).
--     THE GUARD GOES ON THE ROWS, NEVER THE ARGUMENT — that is the whole V550 lesson, and
--     it is why one predicate closes both the 'all' and 'country' branches at once.
--
-- cost_apply_actual_budgets() — see FINDING 1. 701 rows written, 182 of them wrong.
--
-- NULL-country edge, checked before relying on an equality join:
--     tyre_records  country IS NULL: 0 of 11,191
--     vehicle_fleet country IS NULL: 0 of  1,617
--   Moot today, but the new join uses IS NOT DISTINCT FROM so a future NULL-country row
--   still matches its own kind instead of silently dropping out.
--
-- Tenancy, checked rather than assumed: exactly ONE organisation holds fleet/tyre rows,
-- and 0 rows sit outside it. The `v_org IS NULL OR ...` branch in all four is therefore
-- not a live cross-tenant path — and is unreachable anyway (see the backend note below).
--
--
-- =====================================================================================
-- WHAT WAS CHANGED
-- =====================================================================================
--
-- HELPER CHOICE. public.app_write_country_ok(text) (V555), never app_can_see_country.
-- The latter bypasses for app_is_org_admin() = super OR PLAIN ADMIN — which is precisely
-- the account this migration exists to constrain, so building the guard on it would have
-- produced a guard that cannot refuse the only attacker it has.
--
-- THE GUARD SCOPES THE ROWS, NEVER THE ARGUMENT (V550). Every predicate sits in the WHERE
-- clause of the write itself. None of these four even takes a country argument, so an
-- argument guard was never an option — but the all-scope path is exactly where V550's
-- omitted-argument hole lived, and row scoping is what closes it.
--
-- REFUSAL SHAPE, PER FUNCTION, so nothing is invented. All four already return a COUNT of
-- what they did, so out-of-scope rows simply fall out of that count and the caller gets a
-- smaller, honest number in the function's existing jsonb shape:
--     cost_convert_line_totals .... {"converted": N, "total_spend": ...}
--     cost_clear_value ............ {"cleared": N}
--     cost_set_monthly_budget ..... {"updated": N}
--     cost_apply_actual_budgets ... {"updated": N, "total_monthly": ...}
-- ** Never a populated row of zeros ** — that asserts a measurement instead of refusing.
-- It refuses the out-of-scope PART; it does not refuse the operation (the V559
-- parts_cost_fill_undo posture).
--
-- NO CLIENT CHANGE IS NEEDED — VERIFIED BY READING THE CALLERS, not assumed.
-- src/lib/api/imports.js wraps all four; each throws ServiceError(error.message) on error
-- and returns `data` verbatim otherwise. No key was added, removed or renamed, and no new
-- error is raised — the only 42501 on this path is the PRE-EXISTING 'Admin only.', which
-- CostControlPanel.jsx already handles. src/** was NOT modified.
--
-- THE BACKEND / no-JWT PATH — MEASURED, NOT REASONED ABOUT.
-- app_write_country_ok() returns FALSE (not NULL) with no JWT, so `is not false` does NOT
-- protect a backend caller by itself. Settled empirically instead, `set local role
-- authenticated` with NO claims:
--     app_current_org() ............ NULL
--     is_approved_and_unlocked() ... false
--     app_is_org_admin() ........... NULL
--     no-JWT cost_clear_value(900) ......... REFUSED [42501] Not authorised.
--     no-JWT cost_apply_actual_budgets() ... REFUSED [42501] Not authorised.
-- All four already refuse a no-JWT caller at is_approved_and_unlocked(), BEFORE reaching
-- any write. The guard is downstream of a door that is already shut, so V565 introduces
-- NO backend regression. `is not false` is retained throughout because it refuses only on
-- a DEFINITIVE false, which is the correct posture.
--
--
-- =====================================================================================
-- VERIFICATION
-- =====================================================================================
--
-- 1. TEXTUAL REGRESSION PROOF — the strongest one. Stripping the inserted text back out of
--    each LIVE definition reproduces the backup **BYTE FOR BYTE**, so the change is
--    provably only what was intended and a permitted caller cannot take a different path:
--        cost_clear_value ............ BYTE-IDENTICAL   (1 guard)
--        cost_convert_line_totals .... BYTE-IDENTICAL   (2 guards)
--        cost_set_monthly_budget ..... BYTE-IDENTICAL   (1 guard)
--        cost_apply_actual_budgets ... BYTE-IDENTICAL   (1 guard + the country partition;
--                                      1,409 chars stripped == 1,409 chars backed up)
--    NOTHING WAS RETYPED. Every change was inserted by reading the function's own live
--    pg_get_functiondef and doing an anchored replace(), and EVERY replacement ABORTS
--    unless its anchor occurs EXACTLY the expected number of times — a partial run is the
--    failure mode that matters, because half a boundary reads as a closed one (V396).
--
-- 2. THE GUARD HAD TO BE PROVED AGAINST AN ACCOUNT THAT CAN ACTUALLY REACH THESE.
--    No country-scoped plain Admin exists, so one was SYNTHESISED in a ROLLED-BACK
--    transaction: the real KSA-only Manager 34793423 was promoted to role 'Admin' (keeping
--    country = {KSA}), authorised by setting request.jwt.claims to a real super admin so
--    trg_guard_profile_privileged passes — the V553 method. ** NO trigger was disabled and
--    no ACCESS EXCLUSIVE lock was taken on profiles. **
--        synthetic account ............ Admin / country=KSA / super=false
--        app_is_org_admin() ........... true      <- now reaches all four
--        app_write_country_ok('KSA') .. true
--        app_write_country_ok('UAE') .. false
--
--    ATTACKS, with the privileged recount taken after `reset role` IN THE SAME
--    TRANSACTION — because a count taken from inside an impersonated session counts what
--    is READABLE, not what was written, and a blocked write and an invisible write look
--    identical:
--        ATTACK cost_clear_value(950) [170 KSA + 9 UAE] ... {"cleared": 170}
--            -> privileged: UAE tyres still priced at 950 .... 9   ** SURVIVED **
--            -> privileged: KSA tyres still priced at 950 .... 0   (own country cleared)
--        ATTACK cost_set_monthly_budget('country','UAE',777)  {"updated": 0}
--            -> privileged: UAE fleet budgeted .............. 0 of 452
--        ATTACK cost_set_monthly_budget('all','',777) ....... {"updated": 1030}
--            -> ** 1,030 KSA rows, NOT all 1,617. ** UAE 0 of 452, Egypt 0 of 135.
--               This is the V550 all-scope hole closed: the omitted/blanket scope no
--               longer reaches a country the caller cannot write.
--        ATTACK cost_apply_actual_budgets() ................. {"updated": 370, ...}
--            -> privileged: UAE 0 of 452, Egypt 0 of 135 budgeted
--
-- 3. CONTROLS — a fix that breaks the feature is not a fix.
--    THE CALLER'S OWN COUNTRY STILL WORKS (same synthetic KSA Admin):
--        KSA fleet rows budgeted .......... 1,030 of 1,030
--        own 170 KSA tyres at 950 ......... cleared
--    THE PLATFORM OWNER STILL CROSSES EVERY BOUNDARY (real super admin d2d43a5f):
--        cost_apply_actual_budgets() ...... {"updated": 587, "total_monthly": 4755167}
--                                           (exactly the read-only prediction — the
--                                            partition behaves as measured)
--        cost_convert_line_totals() ....... {"converted": 0, "total_spend": 12450390.96}
--        cost_clear_value(950) ............ {"cleared": 179}  (170 KSA + 9 UAE, both)
--        cost_set_monthly_budget(UAE,777) . {"updated": 452}  -> UAE 452 of 452
--
-- 4. OBJECT INTEGRITY after the change, all four: SECURITY DEFINER preserved,
--    search_path still pinned to 'public', owner postgres, authenticated keeps EXECUTE,
--    anon has NONE.
--
-- 5. NO RESIDUE. Every probe above ran in a rolled-back transaction. Post-state confirmed:
--        attacker role .............. 'Manager' (restored)
--        plain Admins ............... 0
--        priced tyres ............... 6,832   (unchanged)
--        tyres at 950 ............... 179     (unchanged)
--        fleet budgets set .......... 0       (unchanged)
--        cost-writer audit rows ..... 5       (unchanged — no probe left an audit row)
--    No table, column, policy, grant or row of business data was altered by V565.
--
--
-- =====================================================================================
-- DISMISSED, WITH THE EVIDENCE
-- =====================================================================================
-- * "The KSA-only Manager can rewrite other countries' money through these four."
--   FALSE, and it was the brief's premise. The gate is app_is_org_admin(), not
--   app_is_elevated(). All four returned REFUSED [42501] Admin only. to that account, and
--   the privileged recount confirmed nothing moved. Do NOT cite these as V559-style leaks.
-- * "Guarding the country fixes cost_apply_actual_budgets."
--   FALSE. The only callers are super admins, for whom app_write_country_ok is true on
--   every country, so the guard alone changes nothing about the blended write. Only the
--   country PARTITION fixes it. This is why the guard was not shipped on its own.
-- * The `v_org IS NULL` branch in all four (a NULL org would reach every tenant).
--   NOT a live path: a no-JWT caller is refused at is_approved_and_unlocked() before the
--   write, proven empirically above; and exactly one organisation holds any fleet or tyre
--   rows. Left alone rather than "hardened" on a path that cannot be reached.
--
--
-- =====================================================================================
-- OPEN — FOR THE OWNER, NOT WORK
-- =====================================================================================
-- * total_spend (cost_convert_line_totals) and total_monthly (cost_apply_actual_budgets)
--   are still single scalars summed across whatever countries the caller may see, and
--   CostControlPanel.jsx renders both through money() under one currency label. For the
--   two super admins that is SAR + AED + EGP in one number — 12,450,390.96 today.
--   Making them per-currency changes the jsonb shape the panel destructures, i.e. a
--   coordinated DB + src change and a product decision. NOT done here.
-- * cost_clear_value takes a bare numeric and NULLs every tyre priced at it, org-wide.
--   Even correctly country-scoped, 900.00 is 3,975 KSA tyres in one unconfirmed click and
--   the prior values are not recoverable (no undo log, unlike tyre_price_backfill).
--   Whether that button should require a preview/confirmation is a product call.
-- * app_is_org_admin() admits a plain Admin to every one of these bulk money rewrites.
--   Today that set is empty, which is the only reason this migration is precautionary
--   rather than an incident. Whether a plain Admin SHOULD hold fleet-wide destructive cost
--   tools at all — as opposed to is_super_admin() — is worth deciding before one is created.
--
--
-- =====================================================================================
-- ROLLBACK
-- =====================================================================================
-- Every prior definition is in _bak.cost_writer_country_v565 (proname, args, def,
-- captured_at) — 4 rows. To revert one function:
--     do $$ declare d text; begin
--       select def into d from _bak.cost_writer_country_v565 where proname = '<name>';
--       execute d;
--     end $$;
-- To revert all four, loop that over the table. CREATE OR REPLACE restores the exact prior
-- body and preserves SECURITY DEFINER, the pinned search_path and the grants.
-- NOTE: reverting cost_apply_actual_budgets restores the currency blending described in
-- FINDING 1 along with the guard. Those two are separable in the source below (the
-- partition is the `t.country AS c` / `GROUP BY 1, 2` / `IS NOT DISTINCT FROM p.c` triple;
-- the guard is the app_write_country_ok term) if only one is to be undone.
-- No table, column, policy, grant or row of business data was altered by V565.
-- =====================================================================================


-- =====================================================================================
-- PART A — snapshot the four cost writers before touching them.
-- =====================================================================================

create table if not exists _bak.cost_writer_country_v565 (
  proname text, args text, def text, captured_at timestamptz default now()
);

insert into _bak.cost_writer_country_v565 (proname, args, def)
select p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('cost_apply_actual_budgets','cost_clear_value',
                    'cost_convert_line_totals','cost_set_monthly_budget')
  and not exists (select 1 from _bak.cost_writer_country_v565 b where b.proname = p.proname);


-- =====================================================================================
-- PART B — anchored replacements. NOTHING IS RETYPED: each guard is inserted into the
-- function's own LIVE pg_get_functiondef text, and every replacement ABORTS unless its
-- anchor occurs EXACTLY the expected number of times. A partial run is the failure mode
-- that matters, because half a boundary reads as a closed one (the V396 lesson).
-- =====================================================================================

do $mig$
declare d text; n int;

  -- 1. cost_convert_line_totals(): scope the bulk divide-by-qty UPDATE ...
  a1 text := E'  WHERE t.cost_per_tyre IS NOT NULL AND coalesce(t.qty,1) > 1\n    AND (v_org IS NULL OR t.organisation_id = v_org);';
  r1 text := E'  WHERE t.cost_per_tyre IS NOT NULL AND coalesce(t.qty,1) > 1\n    AND (v_org IS NULL OR t.organisation_id = v_org)\n    AND public.app_write_country_ok(t.country) IS NOT FALSE;';
  -- ... and the total_spend read, so a country-scoped admin is never handed another
  -- country's money back. For a super admin the helper is true everywhere: no change.
  a2 text := E'  SELECT coalesce(sum(coalesce(cost_per_tyre,0)*coalesce(qty,1)),0) INTO v_total FROM tyre_records t\n    WHERE (v_org IS NULL OR t.organisation_id = v_org);';
  r2 text := E'  SELECT coalesce(sum(coalesce(cost_per_tyre,0)*coalesce(qty,1)),0) INTO v_total FROM tyre_records t\n    WHERE (v_org IS NULL OR t.organisation_id = v_org)\n      AND public.app_write_country_ok(t.country) IS NOT FALSE;';

  -- 2. cost_clear_value(): scope the mass NULL-out of a flat rate.
  a3 text := E'  WHERE t.cost_per_tyre = p_value AND (v_org IS NULL OR t.organisation_id = v_org);';
  r3 text := E'  WHERE t.cost_per_tyre = p_value AND (v_org IS NULL OR t.organisation_id = v_org)\n    AND public.app_write_country_ok(t.country) IS NOT FALSE;';

  -- 3. cost_set_monthly_budget(): the guard goes on the ROWS, never the p_value argument.
  --    p_scope='all' has no country term at all, and p_scope='country' takes a country
  --    the caller was never checked against - the V550 shape exactly. Scoping the rows
  --    covers every scope branch at once.
  a4 text := E'  WHERE (v_org IS NULL OR f.organisation_id = v_org)\n    AND (p_scope=''all''';
  r4 text := E'  WHERE (v_org IS NULL OR f.organisation_id = v_org)\n    AND public.app_write_country_ok(f.country) IS NOT FALSE\n    AND (p_scope=''all''';

  -- 4. cost_apply_actual_budgets(): TWO defects, and the guard alone fixes neither of them
  --    for the only caller that exists. The aggregate pools every country's tyre spend
  --    under one asset_no and writes that single blended figure onto EVERY country's
  --    vehicle_fleet row carrying that code. vehicle_fleet is unique per
  --    (org, country, asset_no) and asset codes are a per-country sequence (V348/V376),
  --    so joining without country joins two DIFFERENT machines. Partitioning by country
  --    is what makes the function do what its own client JSDoc already promises:
  --    "set each vehicle's budget to ITS OWN actual average monthly spend".
  a5 text := E'    SELECT lower(btrim(asset_no)) AS a,';
  r5 text := E'    SELECT lower(btrim(asset_no)) AS a, t.country AS c,';
  a6 text := E'    GROUP BY 1\n  ),';
  r6 text := E'    GROUP BY 1, 2\n  ),';
  a7 text := E'    WHERE lower(btrim(f.asset_no)) = p.a AND (v_org IS NULL OR f.organisation_id = v_org)';
  r7 text := E'    WHERE lower(btrim(f.asset_no)) = p.a AND f.country IS NOT DISTINCT FROM p.c\n      AND (v_org IS NULL OR f.organisation_id = v_org)\n      AND public.app_write_country_ok(f.country) IS NOT FALSE';
begin
  d := pg_get_functiondef('public.cost_convert_line_totals()'::regprocedure);
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'V565 abort: cost_convert_line_totals update-anchor x%, expected 1', n; end if;
  n := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'V565 abort: cost_convert_line_totals total-anchor x%, expected 1', n; end if;
  execute replace(replace(d, a1, r1), a2, r2);

  d := pg_get_functiondef('public.cost_clear_value(numeric)'::regprocedure);
  n := (length(d) - length(replace(d, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'V565 abort: cost_clear_value anchor x%, expected 1', n; end if;
  execute replace(d, a3, r3);

  d := pg_get_functiondef('public.cost_set_monthly_budget(text,text,numeric)'::regprocedure);
  n := (length(d) - length(replace(d, a4, ''))) / length(a4);
  if n <> 1 then raise exception 'V565 abort: cost_set_monthly_budget anchor x%, expected 1', n; end if;
  execute replace(d, a4, r4);

  d := pg_get_functiondef('public.cost_apply_actual_budgets()'::regprocedure);
  n := (length(d) - length(replace(d, a5, ''))) / length(a5);
  if n <> 1 then raise exception 'V565 abort: cost_apply_actual_budgets select-anchor x%, expected 1', n; end if;
  n := (length(d) - length(replace(d, a6, ''))) / length(a6);
  if n <> 1 then raise exception 'V565 abort: cost_apply_actual_budgets groupby-anchor x%, expected 1', n; end if;
  n := (length(d) - length(replace(d, a7, ''))) / length(a7);
  if n <> 1 then raise exception 'V565 abort: cost_apply_actual_budgets join-anchor x%, expected 1', n; end if;
  execute replace(replace(replace(d, a5, r5), a6, r6), a7, r7);

  raise notice 'V565 applied';
end
$mig$;
