-- =====================================================================================
-- V567  THE IMPORT AND ERP-PROMOTION WRITERS - THE GUARD CHECKED THE DECLARED
--       COUNTRY, THE WRITE USED A DERIVED ONE
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A), 2026-08-17
-- Applied as three migrations:
--   v567_import_promotion_country_writes_part_a   (snapshot, helper, 3 promoters)
--   v567_import_promotion_country_writes_part_b   (pending-upload pair + policy)
--   v567_import_promotion_country_writes_part_c   (promote_erp_undo ledger tail)
-- =====================================================================================
--
-- WHY THIS LANE MATTERS
-- ---------------------
-- These functions move rows from staging into the MASTER tables - vehicle_fleet,
-- tyre_records, parts_consumption, stock_records. A cross-country defect here does not
-- disclose anything; it INJECTS. The result is a row in another country's registers,
-- cost reports and exports, created by someone who cannot see it to undo it (V542).
--
-- Same root cause as every migration in this sweep: a SECURITY DEFINER function runs as
-- its OWNER, no public table sets FORCE ROW LEVEL SECURITY, so RLS NEVER RUNS INSIDE
-- ONE. Such a function must re-ask org, country and site itself.
--
-- V555 already corrected the record for this lane: the import gap is NOT bounded to
-- staging. It proved import_reverse_batch let a KSA-only Manager DELETE master rows for
-- UAE (1 -> 0 on a privileged recount). V559 then added a batch-level country guard to
-- the three ERP promoters. V567 is what those two left behind.
--
--
-- THE ATTACKER  (one real account; every figure below is from it)
-- --------------------------------------------------------------
--   34793423-43df-4b6f-9270-9d1e8be6fa30 - "adnan mohammad alhaj ali"
--   Manager, approved, unlocked, country = {KSA}, sites = {ALL}, org = Company A.
--     app_role() = manager   -> app_is_elevated() TRUE, is_elevated_user() TRUE
--                               (a plain Manager passes every "elevated" gate)
--     is_super_admin() = false
--     app_write_country_ok('UAE') = FALSE      app_write_country_ok('KSA') = TRUE
--     DIRECT read: vehicle_fleet country='UAE' -> 0 rows
--                  parts_consumption country='UAE' -> 0 rows / 0.00
--
-- Population, re-measured rather than inherited: 38 profiles, 2 super admins, 0 plain
-- Admins, 0 non-supers with a NULL country, 0 holding the 'All' sentinel. Country values
-- in profiles are exactly {KSA} x32, {Egypt} x2, {UAE} x1, {KSA,UAE,Egypt} x1, NULL x2
-- (both supers) - all canonical spelling.
--
--
-- =====================================================================================
-- REPRODUCED BEFORE ANYTHING WAS TOUCHED
-- Every write below was confirmed by `reset role` and recounting as a PRIVILEGED reader
-- IN THE SAME TRANSACTION, then rolled back. A count taken from inside the impersonated
-- session counts what is READABLE, not what was written; a blocked write and an
-- invisible write are otherwise indistinguishable.
-- =====================================================================================
--
-- HOLE 1 - THE THREE ERP PROMOTERS. The guard inspects the DECLARED country; the
--          country actually WRITTEN is DERIVED, and NULL slips between the two.
--
--   V559's _erp_promote_guard_c refuses a batch containing a row whose country the
--   caller cannot write - but only looks at rows `where s.country is not null`.
--   All three promoters then compute the destination themselves:
--       v_country := coalesce(normalize_country(r.country),
--                             _erp_country_from_prefix(<asset or job card>), 'KSA')
--   and _erp_country_from_prefix maps  RM% -> UAE,  EG% -> Egypt,  AFKR%/GCKR% -> KSA.
--
--   The erp_*_import write policies EXPLICITLY permit `country IS NULL` (the standing
--   null-dimension convention), so the attacker stages the launch pad HIMSELF. He never
--   names a country he is not allowed to name; he simply omits it and lets the asset or
--   job-card prefix choose the destination.
--
--   NULL is the ONLY way through, and that was checked rather than assumed: an empty or
--   whitespace-only country is NOT exempt (app_write_country_ok('') is false, so the
--   guard refuses), and normalize_country never maps a permitted spelling onto a
--   different country ('KSA'/'ksa'/' KSA ' all normalise to KSA).
--
--   1a  promote_erp_assets -> vehicle_fleet
--       staged: country NULL, asset_no 'RM90001'
--       rpc: {"to_insert_total":1,"to_insert_by_country":{"UAE":1}}
--       PRIVILEGED recount: vehicle_fleet asset_no='RM90001' UAE=1, KSA=0
--                           row: country=UAE region=UAE status=Active
--
--   1b  promote_erp_tyre_expense -> parts_consumption   ** THE FINANCIAL LEDGER **
--       staged: country NULL, asset_no NULL, job_card 'RM/JC/V567', 4 x 2500 AED
--       rpc: {"by_country":{"UAE":{"count":1,"value":10000.00,"currency":"AED"}}}
--       attacker-visible UAE spend ................ 0.00
--       PRIVILEGED UAE spend BEFORE ... 15,631,222.96 over 59,810 rows
--       PRIVILEGED UAE spend AFTER .... 15,641,222.96 over 59,811 rows
--       DELTA .......................... AED 10,000.00 exactly
--       This variant needs no asset at all: with asset_no NULL the derivation falls
--       through to the JOB CARD prefix, and job-card prefixes are the very signal V491
--       measured across 201,861 rows with zero conflicts.
--
--   1c  promote_erp_tyre_changes -> tyre_records
--       staged: country NULL, asset_no 'RM90002', position LHF1
--       rpc: {"to_insert_active":1,"to_insert_by_country":{"UAE":1}}
--       PRIVILEGED UAE tyre_records 2,455 -> 2,456, planted row status=Active
--
--   A MEASUREMENT TRAP HIT AND CORRECTED WHILE DOING 1b, recorded because it produced a
--   plausible and completely wrong number: the first run read the "before" total from
--   INSIDE the impersonated session (which sees 0) and the "after" total as a privileged
--   reader, and reported a delta of 15,641,222.96 - the whole UAE ledger presented as if
--   the attacker had created it. Both sides must be read by the SAME reader. Re-measured
--   privileged-to-privileged the true delta is AED 10,000.00.
--
--   NOT REPRODUCED, AND LABELLED AS SUCH: the UPDATE branch. promote_erp_assets also
--   matches an EXISTING fleet row on (org, derived country, asset_no) and patches 25
--   columns including status, registration_no, purchase_value and the insurance dates.
--   Measured: of 1,617 live fleet assets, ZERO carry an RM / EG / AFKR / GCKR prefix
--   (Egypt 135, KSA 1,030, UAE 452, all zero), so the derivation cannot land on a live
--   row today. That is a fact about today's DATA, not a rule - the first asset numbered
--   in the ERP's own prefix scheme arms it. The INSERT branch is what was proven.
--
--
-- HOLE 2 - restamp_pending_upload_country TOOK ANY COUNTRY
--   Gate is is_elevated_user() (admin|manager|director - a plain Manager passes) plus an
--   org check. p_country was used unchecked, and the function stamps it onto the batch
--   HEADER and onto EVERY ROW of the staged jsonb.
--       restamp_pending_upload_country(<id>, 'UAE') -> {"ok":true,"country":"UAE"}
--       header country afterwards: UAE
--   for a caller whose app_write_country_ok('UAE') is false.
--
-- HOLE 3 - approve_pending_upload HAD NO COUNTRY CHECK OF ANY KIND
--   It inserts the staged rows into a master table, overriding only organisation_id. The
--   country travels inside the attacker-controlled `rows` jsonb.
--       approve -> {"ok":true,"target":"stock_records","imported":1}
--       PRIVILEGED stock_records country='UAE': 0 -> 1
--   INDEPENDENT OF HOLE 2, and that was verified separately: supplying "country":"UAE"
--   inside `rows` while leaving the header 'KSA' reaches the master table without
--   touching restamp at all (imported 1, privileged UAE stock row = 1).
--
--   TWO HONEST LIMITS ON HOLE 3, measured, so it is not overstated:
--     * THE 'tyres' BRANCH IS DEAD and has been since V320. `INSERT INTO tyre_records
--       SELECT r.*` is a POSITIONAL insert over a column list that includes the
--       GENERATED ALWAYS column fitment_date, so it raises
--           428C9 cannot insert a non-DEFAULT value into column "fitment_date"
--       Measured: UAE tyre_records 2,455 -> 2,455, planted rows 0. The country hole is
--       real in the code but UNREACHABLE for tyres. This is the defect already carried
--       as open in PROJECT_MEMORY; V567 does not fix it, and it must NOT be cited as a
--       tyre leak. Only the 'stock' branch reaches a master table.
--     * The insert only works at all when the uploaded row carries an explicit `id`.
--       jsonb_populate_recordset yields NULL for an absent key and the positional insert
--       sends that NULL explicitly, defeating the column default - the first attempt
--       failed with 23502 on stock_records.id. An attacker composing the jsonb supplies
--       one; an ordinary spreadsheet upload does not, which is why this path has been
--       quietly broken rather than quietly exploited.
--
-- HOLE 4 - promote_erp_undo DESTROYED ANOTHER COUNTRY'S UNDO LEDGER
--   V559 scoped every MASTER write in this function and stated the principle in its own
--   header - "a naive guard that scoped only the UPDATE would still have let a KSA
--   Manager delete UAE's undo records, destroying another country's ability to recover" -
--   then did not apply it to this function's own tail. Both remaining statements are
--   batch-and-org keyed with no country term:
--     * the staging un-stamp clears promoted_at / promoted_by on rows the caller could
--       not undo, so they read as un-promoted while their master row still exists - a
--       later legitimate promote would re-insert them as DUPLICATES;
--     * the promotion_log DELETE removes the undo records for exactly the master rows
--       this call deliberately refused to touch.
--   GUARDED WITHOUT AN OBSERVED DISCLOSURE: erp_promote_bak.promotion_log holds 0 rows,
--   so nothing was reproduced. Not a leak; do not cite it as one.
--
-- HOLE 5 - import_user_can_commit_country: A BLANK SCOPE GRANTED EVERY COUNTRY
--   `pr.country IS NULL OR ...` means a profile with no country scope may commit into
--   any country - the exact inversion V309 settled ("blank scope = NO access"). V558
--   measured this, left it deliberately to keep its own change a single provable
--   substitution, and named the pass that should close it: "its own pass over the import
--   path". This is that pass.
--   0 non-super profiles carry a NULL country today (the 2 that do are both super admins,
--   who pass through is_super_admin() above regardless), so 0 users change behaviour.
--   It arms the first time a non-super is created without a country.
--
--
-- =====================================================================================
-- THE import_rows RE-JUDGEMENT  (V555 deliberately excluded it; re-examined here)
-- =====================================================================================
--
-- V555 gave import_batches and import_files a write policy and left import_rows without
-- one, on the grounds that its country check is a per-row function call on the one hot
-- bulk path in the system, and that "both ends that consume them - commit and now
-- reverse - gate on the batch country independently".
--
-- THAT ENUMERATION WAS INCOMPLETE. Re-derived from pg_proc rather than inherited, the
-- consumer set is FIVE, not two:
--   import_commit_batch ....... gates import_user_can_commit_country(b.country) AND
--                               FORCES `'country', b.country` onto every inserted row.
--                               Closed - the write country is the checked country.
--   import_enrich_batch ....... gates on b.country; its row lookup runs through
--                               import_natural_key, which PREFIXES the country
--                               (lower(btrim(coalesce(p_d->>'country','')))) and enrich
--                               forces `|| jsonb_build_object('country', b.country)`.
--                               So its id-only UPDATE of the master table is only ever
--                               reached via a country-bearing key. Closed, but by
--                               INDIRECTION - named here because it is fragile: anyone
--                               removing country from import_natural_key opens a
--                               cross-country master UPDATE with no other guard.
--   import_reverse_batch ...... gated by V555.
--   import_reprocess_row ...... NO batch, org or country gate at all, but writes ONLY
--                               import_rows.validation_status / processed_at, and only
--                               on rows with target_record_id IS NULL. Never touches a
--                               master table. A staging-integrity nuisance, not a
--                               boundary breach.
--   admin_dup_resolve ......... is_super_admin() gated. A real restriction.
-- Every consumer that writes a MASTER table gates on the batch country.
--
-- THE RESIDUAL, MEASURED AS THE ATTACKER RATHER THAN REASONED ABOUT:
--   can SELECT the live UAE batch ............ 0 rows  (cannot even list it)
--   CAN INSERT an import_rows row into it .... 1 row landed, privileged reader confirms
--   can read those rows back ................. 0 rows
--   can commit that batch .................... 42501 Cross-country commit denied
--
-- THE COST OF CLOSING IT, measured A/B inside ONE transaction, 5,000 rows each, same
-- session, same batch, policy created between the two inserts:
--   without the WITH CHECK ....... 386.6 ms
--   with the WITH CHECK ........ 1,420.8 ms      (+1,034.2 ms, +267.5%)
-- On the 100k-row browser bulk path that is roughly +20 s against a 120 s
-- statement_timeout.
--
-- CONCLUSION: THE EXCLUSION IS CONFIRMED, WITH EVIDENCE, AND NOT CLOSED. The residual is
-- precise and is not a cross-country write: rows can be attached to a foreign-country
-- batch inside the same org, and cannot be read, committed, enriched or reversed by
-- their author. The one path that remains is a legitimate holder of that country
-- committing a batch containing rows they did not stage - and commit FORCES
-- country = b.country, so those rows land as that country's data, under that country's
-- own approver, in that approver's own batch. That is an integrity and audit concern,
-- not a country-boundary breach, and paying +267% on every bulk import to restate a
-- boundary already enforced at all three master writers is cost without a boundary.
-- Closing it cheaply would need a denormalised country column on import_rows maintained
-- by trigger - a schema change, not a policy - and is recorded here rather than done.
--
--
-- =====================================================================================
-- DISMISSED, WITH THE EVIDENCE
-- =====================================================================================
--   import_commit_batch ....... Named in scope; genuinely closed. Its stale-candidate
--                               re-read (`SELECT to_jsonb(t) ... WHERE t.id::text = $1
--                               AND t.organisation_id = $2`) is org-scoped but not
--                               country-scoped, so it can read a same-org row of another
--                               country by id. It writes NOTHING to master on that path -
--                               it only decides duplicate-vs-insert - so at worst it is a
--                               one-bit oracle that already requires knowing the row's
--                               uuid. Named, not inflated, not changed.
--   reject_pending_upload ..... Sibling of approve; sets status only, writes no master
--                               row and carries no country. Nothing to guard.
--   erp_batch_promotion_status  Read-only counter over the staging tables.
--
--
-- =====================================================================================
-- THE FIX
-- =====================================================================================
--
-- HELPER: public.app_write_country_ok(text) throughout - NEVER app_can_see_country.
-- V558 removed the app_is_org_admin() bypass from app_can_see_country, so the two now
-- agree, but app_write_country_ok is the one that copies the V542 write-policy
-- expression verbatim and is therefore the rule the TABLE would apply to an ordinary
-- writer. A definer write is judged by exactly that rule and the two cannot drift.
--
-- THE GUARD SCOPES THE VALUE THAT IS ABOUT TO BE WRITTEN, not an argument. In the three
-- promoters it sits one line after v_country is computed, inside each function's single
-- existing derivation site, so the derivation is not duplicated anywhere. In
-- approve_pending_upload it reads the country of each ROW that is about to be inserted.
--
-- THE NO-JWT PATH WAS SETTLED EMPIRICALLY, PER FUNCTION, BEFORE CHOOSING THE SHAPE -
-- because app_write_country_ok returns FALSE (not NULL) without a JWT, and a bulk import
-- that legitimately runs on the service role would be broken by a guard placed above its
-- own gate. Probed with role service_role and request.jwt.claims cleared:
--     auth.uid() ............................ NULL
--     app_current_org() ..................... NULL
--     app_write_country_ok('UAE') ........... false
--     app_write_country_ok(NULL) ............ true      (null convention intact)
--     import_user_can_commit_country('UAE') . false
--     is_elevated_user() .................... false     -> restamp + approve refuse
--     is_approved_and_unlocked() ............ false     -> commit / enrich / reprocess refuse
--     _erp_promote_guard() .................. RAISES 42501 'No active organisation'
--                                                       -> all 3 promoters + undo refuse
-- EVERY function in scope already refuses a no-JWT caller BEFORE any country term is
-- reached, so these guards cannot break a service-role bulk load: there is no
-- service-role path through any of them today. promote_erp_undo keeps V559's `is not
-- false` idiom in its tail for consistency with the master statements above it.
--
-- REFUSAL SHAPE, CHOSEN PER FUNCTION so nothing is invented. Never a populated row of
-- zeros - that asserts a measurement instead of refusing:
--   promote_erp_*   RAISE 42501 'Cross-country promotion denied (X).' - byte-identical
--                   in wording and errcode to the refusal _erp_promote_guard_c already
--                   raises for a declared foreign country.
--   restamp         RAISE 42501, matching its own existing RAISE-on-refusal style.
--   approve         RAISE 42501 naming the offending country, so the reviewer can act.
--                   It REFUSES rather than silently re-labelling the rows to fit the
--                   caller's scope - relabelling would assert a fact nobody recorded.
--   undo            no refusal; the out-of-scope rows simply fall out of the statements,
--                   exactly as V559 scoped the master writes in the same function.
--
-- A ROW CARRYING NO COUNTRY IS STILL PERMITTED EVERYWHERE. app_write_country_ok(NULL) is
-- true; that is the standing null-dimension convention and precisely what the V542 write
-- policies allow an ordinary writer. A blank-string country is refused, which is likewise
-- exactly what those policies do. Proven by control C8 below.
--
-- NOTHING WAS RETYPED. Every change is an anchored replace() over the function's own LIVE
-- pg_get_functiondef, aborting unless the anchor occurs EXACTLY the expected number of
-- times, plus a re-apply guard. A partial run is the failure mode that matters: half a
-- boundary reads as a closed one.
--
--
-- =====================================================================================
-- VERIFIED AFTER  (all impersonation rolled back; nothing persisted - see FINAL SWEEP)
-- =====================================================================================
--
-- EVERY REPRODUCTION RE-RUN, SAME ATTACKER, SAME CALLS:
--   promote_erp_assets   (NULL country, RM-prefixed asset) . 42501 Cross-country promotion denied (UAE).
--   promote_erp_tyre_expense (NULL country, RM job card) ... 42501 Cross-country promotion denied (UAE).
--   promote_erp_tyre_changes (NULL country, RM asset) ...... 42501 Cross-country promotion denied (UAE).
--   restamp_pending_upload_country(..., 'UAE') ............. 42501 Cross-country restamp denied:
--                                                            you are not assigned to country UAE.
--   approve_pending_upload (UAE inside rows, no restamp) ... 42501 Cross-country import denied:
--                                                            this upload carries rows for country UAE.
--   PRIVILEGED recount of every planted artefact:
--     vehicle_fleet RM90001 = 0 | parts_consumption ZZBRAND = 0
--     tyre_records ZZV567TYRE = 0 | stock_records ZZV567* = 0
--
-- CONTROLS - THE CALLER'S OWN COUNTRY MUST STILL WORK, END TO END:
--   C1 promote_erp_assets, country DECLARED 'KSA' ......... {"to_insert_by_country":{"KSA":1}}
--   C2 promote_erp_assets, country LEFT BLANK, ordinary
--      non-prefixed asset -> derives KSA ................. {"to_insert_by_country":{"KSA":1}}
--      (this is the everyday case and the one a naive guard would have broken)
--   C3 promote_erp_tyre_expense 'KSA' .................... {"KSA":{"count":1,"value":200.00,"currency":"SAR"}}
--   C4 promote_erp_tyre_changes 'KSA' ................... {"to_insert_active":1,"to_insert_by_country":{"KSA":1}}
--   C5 promote_erp_undo of that own KSA batch ........... {"deleted":1,"restored":0}
--   C6 restamp to own country 'KSA' ..................... {"ok":true,"country":"KSA"}
--   C7 approve_pending_upload, KSA rows ................. {"ok":true,"target":"stock_records","imported":1}
--   C8 approve_pending_upload, row with NO country ...... {"ok":true,"imported":1}   (null convention)
--   PRIVILEGED: 2 KSA fleet rows created; tyre 1 -> 0 across the undo.
--
-- SCOPE-TRACKING CONTROL - the guard follows the caller's scope, it is not a hard-coded
-- refusal. Same person, same call, only their country array differs (widened in a
-- rolled-back transaction by presenting a super admin's claims so
-- trg_guard_profile_privileged passes - NO trigger was disabled and no ACCESS EXCLUSIVE
-- lock was taken on profiles):
--   scope {ksa} ......... 42501 Cross-country promotion denied (UAE).
--   scope {ksa,uae} ..... {"to_insert_total":1,"to_insert_by_country":{"UAE":1}}
--   PRIVILEGED fleet rows created = 1 - only the widened call.
--
-- CROSS-USER: import_user_can_commit_country after the blank-scope fix
--   super admin ......... KSA t / UAE t / Egypt t   (via is_super_admin)
--   3-country engineer .. KSA t / UAE t / Egypt t
--   UAE-only PMV Mgr .... KSA f / UAE t / Egypt f
--   KSA-only Manager .... KSA t / UAE f / Egypt f
--   NULL argument ....... true for all - unchanged, the null convention.
--   (The 3-country engineer and the UAE PMV Manager cannot stage into erp_asset_import
--   at all - its INSERT policy requires role Admin|Manager|Director and theirs are
--   'Tire Planning Engineer' / 'PMV Manager'. Pre-existing, unrelated to V567, and the
--   reason their promote probes returned an RLS refusal rather than a country refusal.)
--
-- TEXTUAL REGRESSION PROOF - the strongest evidence available, and worth more than
-- re-timing: stripping the V567 guard from each LIVE definition reproduces
-- _bak.rpc_defs_v567 BYTE FOR BYTE, so the guard is provably the only change and a
-- permitted country cannot take a different path.
--   promote_erp_assets ............. BYTE-IDENTICAL
--   promote_erp_tyre_changes ....... BYTE-IDENTICAL
--   promote_erp_tyre_expense ....... BYTE-IDENTICAL
--   promote_erp_undo ............... BYTE-IDENTICAL
--   restamp_pending_upload_country . BYTE-IDENTICAL
--   approve_pending_upload ......... BYTE-IDENTICAL
--   import_user_can_commit_country . BYTE-IDENTICAL
--
-- FINAL SWEEP - every live count back to its pre-session baseline:
--   import_batches 44 | import_rows 3,555 | import_files 11 | erp_asset_import 0
--   erp_tyre_change_import 18 | erp_tyre_expense_import 0 | pending_uploads 0
--   promotion_log 0 | vehicle_fleet 1,617 | tyre_records UAE 2,455
--   parts_consumption UAE 59,810 | stock_records 1 (pre-existing, country NULL)
--   test artefacts left 0 | probe policies left 0 | attacker country back to {KSA}
--
--
-- NO CLIENT CHANGE IS NEEDED - VERIFIED BY READING THE CALLERS, not assumed. src/** was
-- NOT modified.
--   src/lib/api/erpImport.js ......... promote / preview / undo all wrapped in
--                                      toUserMessage(error, ...)
--   mobile/app/(app)/admin/approvals.tsx  approve / restamp / reject all wrapped in
--                                      toUserMessage(error)
--   src/lib/safeError.js:25 .......... '42501' -> "You do not have permission to do that."
--   mobile/lib/safeError.ts:66 ....... 42501 mapped to the same class.
-- Cosmetic, not a boundary: the mobile restamp picker offers every country in COUNTRIES
-- regardless of the reviewer's scope. Choosing one outside it now returns a clean refusal
-- instead of silently stamping another country's batch. Narrowing that list is a UI
-- nicety and is deliberately not done here.
--
--
-- OPEN - RECORDED, NOT CLOSED
-- ---------------------------
-- 1. approve_pending_upload's 'tyres' branch remains BROKEN (428C9 on the GENERATED
--    fitment_date), and its 'stock' branch still only works when the uploaded row
--    carries an explicit id. Both are the pre-existing V320 positional-insert defect.
--    Fixing them means naming the column list instead of `SELECT r.*` - a behaviour
--    change to a mobile approval path, not a boundary fix, so it is not bolted on here.
-- 2. pending_uploads has NO ORGANISATION isolation policy at all (its only policies are
--    own-row insert, own-or-Admin/Manager select, Admin update/delete). Both RPCs check
--    org in-body, so nothing crosses tenants through them, but the table itself is
--    unwalled. That is the V551 tenant lane, not this one.
-- 3. import_user_can_commit_country compares `p_country = ANY(pr.country)` CASE
--    SENSITIVELY while app_write_country_ok lowercases and btrims. Every profile country
--    is canonical today so the two agree; the divergence can only produce a FALSE
--    REFUSAL, never a false permit, so it is left alone rather than widened.
-- 4. import_rows still has no write check - see THE import_rows RE-JUDGEMENT above for
--    the measurement and the reason.
-- 5. import_reprocess_row is reachable by any approved user for any row in any batch in
--    any org. It writes only staging status fields, but it is genuinely ungated.
--
--
-- ROLLBACK
-- --------
--   do $$ declare r record; begin
--     for r in select def from _bak.rpc_defs_v567 loop execute r.def; end loop;
--   end $$;
--   drop policy if exists pending_uploads_country_write on public.pending_uploads;
--
-- =====================================================================================


-- =====================================================================================
-- PART A: snapshot + import_user_can_commit_country + the three ERP promoters
-- =====================================================================================
create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v567;
create table _bak.rpc_defs_v567 (sig text, proname text, def text, saved_at timestamptz default now());

insert into _bak.rpc_defs_v567 (sig, proname, def)
select p.oid::regprocedure::text, p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('promote_erp_assets','promote_erp_tyre_changes','promote_erp_tyre_expense',
                    'promote_erp_undo','restamp_pending_upload_country','approve_pending_upload',
                    'import_user_can_commit_country');

do $chk$
declare n int;
begin
  select count(*) into n from _bak.rpc_defs_v567;
  if n <> 7 then raise exception 'V567 abort: expected 7 prior definitions, saved %', n; end if;
end $chk$;

-- ---------------------------------------------------------------------------
-- A1  import_user_can_commit_country: a BLANK country scope granted EVERY country.
-- V558 measured this and deferred it to "its own pass over the import path".
-- V309 already settled the rule: blank scope = NO access, never all access.
-- Measured now: 2 profiles carry country IS NULL and BOTH are super admins, who
-- pass through is_super_admin() above regardless -> 0 users change today.
-- ---------------------------------------------------------------------------
do $mig$
declare
  d text; n int;
  a constant text := E'           AND ( pr.country IS NULL OR p_country = ANY(pr.country) OR ''All'' = ANY(pr.country) )';
  b constant text := E'           AND ( p_country = ANY(pr.country) OR ''All'' = ANY(pr.country) )';
begin
  d := pg_get_functiondef('public.import_user_can_commit_country(text)'::regprocedure);
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'V567 abort: commit-country null-scope anchor matched % times', n; end if;
  d := replace(d, a, b);
  if position('pr.country IS NULL' in d) > 0 then
    raise exception 'V567 abort: null-scope branch still present after replace';
  end if;
  execute d;
end $mig$;

-- ---------------------------------------------------------------------------
-- A2  THE THREE PROMOTERS: the guard checked the DECLARED country, the write
--     used a DERIVED one.
--
-- V559's _erp_promote_guard_c inspects staged rows `where s.country is not null`.
-- Every promoter then computes the country it will actually WRITE as
--     coalesce(normalize_country(r.country), _erp_country_from_prefix(...), 'KSA')
-- so a row staged with country NULL - which the erp_*_import write policies
-- EXPLICITLY permit (`country IS NULL`), i.e. the attacker can stage it himself -
-- skips the guard entirely and the destination is then decided by the asset or
-- job-card PREFIX: RM% -> UAE, EG% -> Egypt.
--
-- This is the V550 lesson exactly: the guard checked the argument, not the write.
-- The predicate below sits on the value that is about to be written, one line
-- after it is computed, in each function's own single derivation site - so the
-- derivation is not duplicated anywhere and the two cannot drift.
-- ---------------------------------------------------------------------------
do $mig$
declare
  d text; n int; nm text; anchor text;
  guard constant text :=
    E'    -- V567: the V559 batch guard inspects the DECLARED country and skips rows\n'
 || E'    -- whose country is NULL; the country actually WRITTEN is DERIVED above from\n'
 || E'    -- the asset / job-card prefix, so a NULL-country staged row walked past it.\n'
 || E'    -- Scope the value that is about to be written.\n'
 || E'    if not public.app_write_country_ok(v_country) then\n'
 || E'      raise exception ''Cross-country promotion denied (%).'', v_country using errcode=''42501'';\n'
 || E'    end if;\n';
begin
  for nm, anchor in
    select 'public.promote_erp_assets(uuid,boolean)',
           E'\n    v_country := coalesce(public.normalize_country(r.country), public._erp_country_from_prefix(v_asset), ''KSA'');\n'
    union all
    select 'public.promote_erp_tyre_changes(uuid,boolean)',
           E'\n    v_country:=coalesce(public.normalize_country(r.country),public._erp_country_from_prefix(coalesce(v_asset,r.job_card)),''KSA'');\n'
    union all
    select 'public.promote_erp_tyre_expense(uuid,boolean)',
           E'\n    v_country := coalesce(public.normalize_country(r.country),\n      public._erp_country_from_prefix(coalesce(v_asset, r.job_card)), ''KSA'');\n'
  loop
    d := pg_get_functiondef(nm::regprocedure);
    if position('Cross-country promotion denied (%).'', v_country' in d) > 0 then
      raise exception 'V567 abort: % already row-guarded - refusing to re-apply', nm;
    end if;
    n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if n <> 1 then raise exception 'V567 abort: % derivation anchor matched % times, expected 1', nm, n; end if;
    execute replace(d, anchor, anchor || guard);
  end loop;
end $mig$;

do $v$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and p.proname in ('promote_erp_assets','promote_erp_tyre_changes','promote_erp_tyre_expense')
    and pg_get_functiondef(p.oid) not like '%app_write_country_ok(v_country)%';
  if bad is not null then raise exception 'V567 verify: derived-country guard missing on %', bad; end if;

  if (select pg_get_functiondef('public.import_user_can_commit_country(text)'::regprocedure))
       ilike '%pr.country IS NULL%' then
    raise exception 'V567 verify: blank-scope branch still present';
  end if;

  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and p.proname in ('promote_erp_assets','promote_erp_tyre_changes','promote_erp_tyre_expense',
                      'import_user_can_commit_country')
    and (not p.prosecdef
         or p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         or has_function_privilege('anon', p.oid, 'EXECUTE')
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if bad is not null then raise exception 'V567 verify: DEFINER/search_path/grant regression on %', bad; end if;
end $v$;


-- =====================================================================================
-- PART B: the mobile pending-upload approval path
-- =====================================================================================
--
-- restamp_pending_upload_country took ANY country and stamped it onto the batch
-- header AND every staged row. approve_pending_upload then inserted those rows
-- into a master table with NO country check of any kind - the row's country came
-- straight out of the attacker-controlled `rows` jsonb.
-- The two are INDEPENDENT: supplying the foreign country inside `rows` reaches
-- the master table without touching restamp at all.

-- ---------------------------------------------------------------------------
-- B1  restamp_pending_upload_country - check the country being stamped
-- ---------------------------------------------------------------------------
do $mig$
declare
  d text; n int;
  a constant text := E'  IF p_country IS NULL OR btrim(p_country) = '''' THEN\n    RAISE EXCEPTION ''A country is required.'';\n  END IF;\n';
  g constant text :=
     E'\n  -- V567: p_country was accepted unchecked, so a country-scoped reviewer could\n'
  || E'  -- re-stamp a whole batch - header AND every row - into a country they are not\n'
  || E'  -- assigned to, and then approve it into the master table.\n'
  || E'  IF NOT public.app_write_country_ok(p_country) THEN\n'
  || E'    RAISE EXCEPTION ''Cross-country restamp denied: you are not assigned to country %.'', p_country\n'
  || E'      USING errcode = ''42501'';\n'
  || E'  END IF;\n';
begin
  d := pg_get_functiondef('public.restamp_pending_upload_country(uuid,text)'::regprocedure);
  if position('Cross-country restamp denied' in d) > 0 then
    raise exception 'V567 abort: restamp already guarded - refusing to re-apply';
  end if;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'V567 abort: restamp anchor matched % times', n; end if;
  execute replace(d, a, a || g);
end $mig$;

-- ---------------------------------------------------------------------------
-- B2  approve_pending_upload - scope the ROWS that are about to be written
--
-- Refuses rather than silently re-labelling: relabelling an operator's data to
-- make it fit their scope would assert a fact nobody recorded. A row carrying NO
-- country is still permitted - that is the standing null-dimension convention
-- (app_write_country_ok(NULL) is true), and it is exactly what the table's own
-- V542 write policy permits an ordinary writer. A blank-string country is
-- refused, which is likewise what that policy does.
-- ---------------------------------------------------------------------------
do $mig$
declare
  d text; n int;
  a_decl constant text := E'\n  v_reviewer  text;\nBEGIN\n';
  a_rows constant text := E'  IF v_rows IS NULL OR jsonb_typeof(v_rows) <> ''array'' THEN\n    v_rows := ''[]''::jsonb;\n  END IF;\n';
  g constant text :=
     E'\n  -- V567: the row country came straight from the uploaded jsonb and was never\n'
  || E'  -- checked, so an elevated but country-scoped reviewer could import rows into\n'
  || E'  -- another country''s register. This is a DEFINER function, so RLS never runs\n'
  || E'  -- inside it and this check IS the enforcement.\n'
  || E'  SELECT string_agg(DISTINCT COALESCE(NULLIF(e->>''country'', ''''), ''(blank)''), '', '')\n'
  || E'    INTO v_bad_ctry\n'
  || E'    FROM jsonb_array_elements(v_rows) e\n'
  || E'   WHERE NOT public.app_write_country_ok(e->>''country'');\n'
  || E'  IF v_bad_ctry IS NOT NULL THEN\n'
  || E'    RAISE EXCEPTION ''Cross-country import denied: this upload carries rows for country %.'', v_bad_ctry\n'
  || E'      USING errcode = ''42501'';\n'
  || E'  END IF;\n';
begin
  d := pg_get_functiondef('public.approve_pending_upload(uuid)'::regprocedure);
  if position('Cross-country import denied' in d) > 0 then
    raise exception 'V567 abort: approve already guarded - refusing to re-apply';
  end if;

  n := (length(d) - length(replace(d, a_decl, ''))) / length(a_decl);
  if n <> 1 then raise exception 'V567 abort: approve declare anchor matched % times', n; end if;
  d := replace(d, a_decl, E'\n  v_reviewer  text;\n  v_bad_ctry  text;\nBEGIN\n');

  n := (length(d) - length(replace(d, a_rows, ''))) / length(a_rows);
  if n <> 1 then raise exception 'V567 abort: approve rows anchor matched % times', n; end if;
  execute replace(d, a_rows, a_rows || g);
end $mig$;

-- ---------------------------------------------------------------------------
-- B3  pending_uploads gains the write half it never had.
--
-- The V555 treatment of import_batches / import_files, for the same reason: the
-- cross-country DRAFT is the launch pad. This table has NO country policy of any
-- kind, and its INSERT policy is only `uploaded_by = auth.uid()`, so any
-- authenticated user could author an upload stamped for any country.
-- RESTRICTIVE FOR ALL carrying one expression in BOTH halves, so the read rule
-- and the write rule can never disagree. Expression is the canonical V542 form,
-- copied from erp_asset_import_country_write, keeping the InitPlan shape.
-- The table holds 0 rows, so this is inert today; the in-function guards above
-- are the load-bearing fix and this is defence in depth (both RPCs are SECURITY
-- DEFINER and therefore step around RLS entirely).
-- ---------------------------------------------------------------------------
do $mig$
begin
  if exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
             join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and c.relname='pending_uploads'
               and p.polname='pending_uploads_country_write') then
    raise exception 'V567 abort: pending_uploads_country_write already exists';
  end if;
  execute $p$
    create policy pending_uploads_country_write on public.pending_uploads
      as restrictive for all to authenticated
      using ((country is null)
             or (select public.is_super_admin())
             or (select public.app_sees_all_countries())
             or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))))
      with check ((country is null)
             or (select public.is_super_admin())
             or (select public.app_sees_all_countries())
             or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))))
  $p$;
end $mig$;

do $v$
declare bad text;
begin
  if (select pg_get_functiondef('public.restamp_pending_upload_country(uuid,text)'::regprocedure))
       not like '%app_write_country_ok(p_country)%' then
    raise exception 'V567 verify: restamp guard missing';
  end if;
  if (select pg_get_functiondef('public.approve_pending_upload(uuid)'::regprocedure))
       not like '%app_write_country_ok(e->>%' then
    raise exception 'V567 verify: approve row guard missing';
  end if;
  if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                 where c.relname='pending_uploads' and p.polname='pending_uploads_country_write'
                   and not p.polpermissive and p.polcmd='*'
                   and p.polqual is not null and p.polwithcheck is not null) then
    raise exception 'V567 verify: pending_uploads write policy missing or wrong shape';
  end if;

  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and p.proname in ('restamp_pending_upload_country','approve_pending_upload')
    and (not p.prosecdef
         or p.proconfig is null
         or has_function_privilege('anon', p.oid, 'EXECUTE')
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if bad is not null then raise exception 'V567 verify: DEFINER/grant regression on %', bad; end if;
end $v$;


-- =====================================================================================
-- PART C: promote_erp_undo's LEDGER tail
-- =====================================================================================
--
-- V559 scoped every MASTER write in this function (`app_write_country_ok(...) is
-- not false` on both restore-UPDATEs and all three DELETEs) and stated the
-- principle in its own header - "a naive guard that scoped only the UPDATE would
-- still have let a KSA Manager delete UAE's undo records, destroying another
-- country's ability to recover" - but did not apply it to this function's own
-- tail. Both remaining statements are batch-and-org keyed with no country term:
--   * the staging un-stamp clears promoted_at / promoted_by on rows the caller
--     could not touch, so they look un-promoted while their master row still
--     exists - a later legitimate promote would re-insert them as DUPLICATES;
--   * the promotion_log DELETE removes the undo records for master rows this
--     call deliberately refused to undo, so the country that owns them loses the
--     ability to undo them at all.
--
-- Both are now scoped through the staging row's country, using the same
-- `is not false` idiom the master statements in this function already use.
-- Log rows whose staging row no longer exists are still cleared, preserving the
-- prior cleanup behaviour.
do $mig$
declare
  d text; n int;
  a constant text :=
     E'  execute format(''update public.%I s set promoted_at=null,promoted_by=null\n'
  || E'    from erp_promote_bak.promotion_log l where l.dataset=$1 and l.batch_id=$2\n'
  || E'      and l.organisation_id=$3 and l.source_staging_id=s.id'',v_staging)\n'
  || E'    using p_dataset,p_batch,v_org;\n'
  || E'  delete from erp_promote_bak.promotion_log l\n'
  || E'    where l.dataset=p_dataset and l.batch_id=p_batch and l.organisation_id=v_org;\n';
  b constant text :=
     E'  -- V567: scope the staging un-stamp to rows this caller could actually undo.\n'
  || E'  execute format(''update public.%I s set promoted_at=null,promoted_by=null\n'
  || E'    from erp_promote_bak.promotion_log l where l.dataset=$1 and l.batch_id=$2\n'
  || E'      and l.organisation_id=$3 and l.source_staging_id=s.id\n'
  || E'      and public.app_write_country_ok(s.country) is not false'',v_staging)\n'
  || E'    using p_dataset,p_batch,v_org;\n'
  || E'  -- V567: keep each country''''s own undo ledger. Entries whose staging row has\n'
  || E'  -- since been deleted are still cleared, preserving the prior cleanup.\n'
  || E'  execute format(''delete from erp_promote_bak.promotion_log l\n'
  || E'     where l.dataset=$1 and l.batch_id=$2 and l.organisation_id=$3\n'
  || E'       and (exists (select 1 from public.%I s where s.id = l.source_staging_id\n'
  || E'                      and public.app_write_country_ok(s.country) is not false)\n'
  || E'            or not exists (select 1 from public.%I s where s.id = l.source_staging_id))'',\n'
  || E'    v_staging, v_staging)\n'
  || E'    using p_dataset,p_batch,v_org;\n';
begin
  d := pg_get_functiondef('public.promote_erp_undo(text,uuid)'::regprocedure);
  if position('keep each country' in d) > 0 then
    raise exception 'V567 abort: promote_erp_undo tail already scoped - refusing to re-apply';
  end if;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'V567 abort: undo tail anchor matched % times, expected 1', n; end if;
  execute replace(d, a, b);
end $mig$;

do $v$
declare d text;
begin
  d := pg_get_functiondef('public.promote_erp_undo(text,uuid)'::regprocedure);
  -- 5 pre-existing (V559) + 2 added here (un-stamp + the log delete's scoped arm)
  if (length(d) - length(replace(d, 'app_write_country_ok', ''))) / length('app_write_country_ok') < 7 then
    raise exception 'V567 verify: promote_erp_undo lost a country term';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='promote_erp_undo'
                   and p.prosecdef and p.proconfig is not null) then
    raise exception 'V567 verify: promote_erp_undo lost DEFINER/search_path';
  end if;
end $v$;
