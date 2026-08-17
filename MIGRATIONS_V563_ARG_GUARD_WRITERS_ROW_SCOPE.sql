-- =====================================================================================
-- V563 - THE ARGUMENT-GUARDED WRITERS: A GUARD ON p_country IS NOT A GUARD ON THE ROWS
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A), 2026-08-17.
-- Applied as supabase migration `v563_argument_guard_writers_row_scope`.
-- =====================================================================================
--
-- ROOT CAUSE, unchanged from every migration in this family:
-- A SECURITY DEFINER function runs as its OWNER, and no public table sets FORCE ROW
-- LEVEL SECURITY, so RLS NEVER RUNS INSIDE ONE. V542 gave 78 country tables a
-- RESTRICTIVE FOR ALL write policy, but that governs writes made THROUGH RLS. A definer
-- function steps around it and must re-check org, country and site itself.
--
-- These nine were listed by V559 as bucket "D1": they are NOT unguarded - each carries a
-- V547-era check of the form
--     if p_country is not null and not public.app_can_see_country(p_country) then ...
-- That is a guard on the ARGUMENT. V550 is the precedent and the whole lesson: its two
-- writers checked p_country, p_country DEFAULTED TO NULL, NULL legitimately means "no
-- country filter", and the writes were keyed on serial plus organisation with no country
-- predicate - so simply OMITTING the argument, which is what a caller does normally,
-- walked straight past V547's guard and still SCRAPPED 2 real UAE tyres and REBRANDED 1.
--
-- SEVEN OF THESE NINE DEFAULT p_country TO NULL. The eighth and ninth require it. The
-- shape was checked one function at a time by reading the body and asking V550's three
-- questions: what does it write, is the WRITE keyed on country, and what happens when the
-- argument is omitted or NULL.
--
--
-- =====================================================================================
-- THE ATTACKER - every figure below is from this one real account
-- =====================================================================================
--   34793423-43df-4b6f-9270-9d1e8be6fa30 - "adnan mohammad alhaj ali"
--   Manager, approved, unlocked, country = {KSA}, sites = {ALL}, org = Company A.
--     app_role() = manager      -> app_is_elevated() = TRUE   <-- passes every
--                                  "elevated" gate; app_is_elevated() is
--                                  app_role() in ('admin','manager','director'), so a
--                                  plain Manager is not restricted by it at all.
--     is_super_admin()            = false
--     app_write_country_ok('UAE') = FALSE      app_write_country_ok('KSA') = TRUE
--     app_can_see_country('All')  = FALSE      <-- 'All' is the app's own SENTINEL
--     DIRECT read: tyre_records country='UAE' -> 0 rows | 'KSA' -> 8,145 rows
--
-- Every count below was taken by a PRIVILEGED reader after `reset role` IN THE SAME
-- TRANSACTION. That rule matters more here than anywhere: a count taken from inside the
-- attacker's session counts what is READABLE, not what was WRITTEN, so a blocked write
-- and an invisible write look identical. Every reproduction was rolled back.
--
--
-- =====================================================================================
-- HOLE 1 - tyre_price_backfill(p_dry_run boolean DEFAULT true, p_country text DEFAULT NULL)
--          ** THE SENTINEL IS REFUSED AND THE EQUIVALENT NULL IS NOT **
-- =====================================================================================
-- The clearest statement of the whole defect class, because the function refuses the very
-- thing it then permits by another spelling. Probed as the KSA-only Manager:
--     tyre_price_backfill(true,'UAE') .... {"ok":false,"reason":"forbidden"}
--     tyre_price_backfill(true,'All') .... {"ok":false,"reason":"forbidden"}
--     tyre_price_backfill(true)      .... ok, rows 1976, and the payload's own
--                                          "country" field reads "All"
-- The body does `if lower(v_country)='all' then v_country := null`, so 'All' and NULL are
-- the SAME request. One is guarded and the other is not.
--
-- The candidate CTE carries `(v_country is null or t.country = v_country)` - NULL means
-- every country - and the write is keyed on the row id alone:
--     update public.tyre_records t set cost_per_tyre = f.new_cost
--       from _tyre_price_fill f where t.id = f.id and t.organisation_id = v_org;
-- No country predicate. This is the forward twin of tyre_price_backfill_undo, which V559
-- proved stripped AED 424,467.79 from 568 real UAE tyres.
--
-- WHY IT REACHED ONLY KSA ROWS ON THE DAY - and why that is DATA, not RULE. Measured:
--     country | priced | of which machine-filled | USABLE EVIDENCE
--     Egypt   |    404 |                     404 |   0
--     KSA     |  5,860 |                   2,017 |   3,680
--     UAE     |    568 |                     568 |   0
-- V401c refuses to use a price this process itself wrote as evidence, and every priced
-- UAE and Egypt tyre was machine-filled - so those countries have no eligible comparable
-- TODAY. The boundary was being held by an accident of the data.
--
-- REPRODUCED by arming exactly one real price (brand ROCK HOLDER, size 385/65 R 22.5,
-- which 36 REAL unpriced UAE tyres match), then attacking with the argument OMITTED:
--     A. BEFORE (privileged) UAE ...... 569 priced / 1,887 unpriced / AED 425,701.79
--     B. attacker DIRECT read of UAE .. 0 rows visible
--     C. ATTACK tyre_price_backfill(false)   -- p_country omitted
--        payload by_country.UAE ....... {"rows":36,"value":44424.00,"median_price":1234}
--     D. AFTER (privileged) UAE ....... 605 priced / 1,851 unpriced / AED 470,125.79
--        ................................ 36 UAE rows written to the backfill log
-- 36 real UAE tyres repriced and AED 44,424 written into another country's ledger by a
-- caller who cannot read one UAE row.
--
--
-- =====================================================================================
-- HOLE 2 - parts_cost_fill(p_country text DEFAULT NULL, p_dry_run boolean DEFAULT true)
-- =====================================================================================
-- Same shape. Candidates carry `(p_country is null or z.country = p_country)`; the write
-- is `update public.parts_consumption p ... from _fill_candidates c where p.id = c.line_id;`
-- with no country predicate, and the log insert reads the same unscoped candidate set.
--
-- REPRODUCED by planting ONE UAE zero-cost line on item_code 450002-O (ENGINE OIL -15W40,
-- which already has 1,908 priced UAE siblings, median unit 6.94):
--     A. BEFORE (privileged) UAE filled lines .. 1 line / AED 600.00
--     B. attacker DIRECT read of UAE lines ..... 0 rows
--     C. ATTACK parts_cost_fill(null, false)
--        by_country .... [{KSA: 8 lines, SAR 914.14}, {UAE: 1 line, AED 69.39}]
--     D. AFTER (privileged) UAE filled lines ... 2 lines / AED 669.39
--        ......................................... 2 UAE rows in parts_cost_fill_log
-- AED 69.39 of ESTIMATED cost written into the UAE ledger, and the log now asserts a UAE
-- fill that no UAE user authorised. V559 already proved the undo twin reverted this exact
-- cross-country batch (AED 600 + EGP 12).
--
-- LABELLED HONESTLY: there are 0 real UAE/Egypt candidates today (only KSA has 8, SAR
-- 914.14), so the UAE line in the proof was PLANTED. Armed by data, not leaking by data.
--
--
-- =====================================================================================
-- HOLE 3 - set_store_site_map(p_country, p_store_code, p_site)
--          ** THE V550 BYPASS IN ITS PUREST FORM, AND THE ONLY ONE THAT NEEDED NO PLANT **
-- =====================================================================================
-- V552 guarded this one and the guard works - for the case it tests:
--     IF p_country IS NOT NULL AND BTRIM(p_country) <> ''
--        AND public.app_can_see_country(p_country) IS FALSE THEN RAISE
-- Passing NULL or '' SKIPS IT ENTIRELY, and the row then lands with country = NULL.
--
-- A NULL-COUNTRY ROW IS A WILDCARD. classify_parts_consumption - the BEFORE INSERT OR
-- UPDATE trigger on every expense row - resolves a site with:
--     select m.site from public.store_site_map m
--      where m.store_code = NEW.store_code
--        and (m.country is null or m.country = NEW.country)
--      limit 1
-- so a NULL-country row decides the site for EVERY country.
--
-- REPRODUCED against REAL Egyptian data, no planting:
--     set_store_site_map('Egypt', 'EG_NEWCAIR', ...) ... REFUSED (V552 holds)
--     set_store_site_map(NULL,   'SP_EG_MRIL', ...) ... ACCEPTED
--     BEFORE: an Egypt line with store SP_EG_MRIL resolved to
--             <no mapping - falls back to the raw store code>
--     AFTER:  the same Egypt line resolves to  KSA-MANAGER-CHOSE-THIS
--     Egypt spend behind that store code ..... 9,202 lines / EGP 19,656,406.20
-- A KSA-only Manager silently decides which site nearly EGP 20M of Egyptian expense is
-- reported under, on every future write.
--
-- TWO SECONDARY DEFECTS FOUND WITH IT, both stated rather than overclaimed:
--   * `ON CONFLICT (organisation_id, country, store_code)` CANNOT FIRE on a NULL country -
--     the unique index is a plain btree and NULLs are DISTINCT. Three identical calls
--     produced THREE separate rows: an unbounded duplicate insert for any elevated user.
--   * The trigger's `limit 1` has NO ORDER BY, so when a country-specific row also exists
--     which one wins is ARBITRARY. In the probe the legitimate row happened to win, so
--     the hijack of an ALREADY-MAPPED store is a RISK, not a demonstrated result. The
--     UNMAPPED case above is deterministic, and that is the one cited as proven.
--
--
-- =====================================================================================
-- HOLE 4 - run_quality_checks / run_reconciliation: the ALL path measured every country
--          and PERSISTED the answer
-- =====================================================================================
-- Both default p_country to NULL and thread `(p_country is null or country=p_country)`
-- through every count, then INSERT the result into quality_results / reconciliation_runs.
--
-- PROVEN BY IDENTITY, which is the sharpest form available:
--     KSA-only Manager, p_country OMITTED .... md5 f54d8a4a...  tyre_unpriced 4,359
--     SUPER ADMIN,      p_country OMITTED .... md5 f54d8a4a...  tyre_unpriced 4,359
--     KSA-only Manager, p_country = 'KSA' .... md5 6ada425f...  tyre_unpriced 2,285
-- The scoped user's omitted-argument payload was BYTE-IDENTICAL to the platform owner's.
-- 4,359 is exactly KSA 2,285 + UAE 1,887 + Egypt 187. Explicit 'UAE' returns forbidden.
--
-- run_reconciliation likewise: fleet_asset_link OMITTED = 553 assets, 'KSA' = 370.
--
-- NOT CLAIMED: the wo_cost_components figure is SAR 35,060,742.10 on both paths, because
-- UAE and Egypt job cards carry 0.00 cost today. So there is NO blended-currency
-- disclosure to report right now - but the sum is unit-labelled 'SAR' while spanning
-- three currencies, so it becomes one the moment those job cards are costed. Armed, not
-- leaking. Saying otherwise would be the 42%-that-was-really-2.6% mistake.
--
--
-- =====================================================================================
-- GUARDED WITHOUT AN OBSERVED DISCLOSURE - armed by data, not leaking by data.
-- These must NOT be cited as leaks.
-- =====================================================================================
--   apply_production_station_map  The UPDATE carries `(p_country is null or
--                                 p.country = p_country)` and nothing else, so the
--                                 omitted argument reaches every country's rows: the
--                                 dry run reports 206,868 rows for the KSA-only Manager.
--                                 production_logs holds 212,567 rows and ALL of them are
--                                 KSA, so it cannot cross a boundary today. It arms the
--                                 moment any UAE or Egypt production is loaded.
--   scan_data_trust               Its own measurements come from the two functions above
--                                 (now scoped). Its own residual defect is that the
--                                 reconciliation half selects `where rr.run_at = v_max`
--                                 with NO country predicate, v_max being
--                                 max(run_at) over the whole ORG - so a run made for
--                                 another country at that instant would be copied into a
--                                 trust_alert stamped with THAT country and carrying its
--                                 money in the message. Not demonstrated (it needs a
--                                 concurrent cross-country run), so it is guarded and
--                                 labelled, not claimed.
--   correction_case_open          The row's country IS the argument
--                                 (`insert into correction_cases(... country ...) values
--                                 (..., p_country, ...)`), so an argument guard is
--                                 already a row guard here. Only the HELPER changed. NULL
--                                 stays permitted: openCorrectionCase() defaults
--                                 country = null and the product opens un-countried cases
--                                 deliberately.
--
--
-- =====================================================================================
-- DISMISSED, WITH THE EVIDENCE
-- =====================================================================================
--   material_master_set   IN SCOPE, NOT TOUCHED. Its country is required (`if v_ctry is
--                         null then raise 'A country is required'`) and the row it writes
--                         is keyed on exactly that value, so the argument guard IS the row
--                         guard and there is no NULL path. A SIBLING SESSION moved it onto
--                         app_write_country_ok WHILE THIS MIGRATION WAS BEING WRITTEN -
--                         detected by re-reading the live definition immediately before
--                         applying, which is why nothing here is taken from an earlier
--                         snapshot. Editing it would have clobbered that work. Verified
--                         after: it now carries app_write_country_ok and no
--                         app_can_see_country, and refuses 'UAE' for the attacker.
--
--
-- =====================================================================================
-- WHAT WAS CHANGED - 13 insertions over 8 functions
-- =====================================================================================
--   apply_production_station_map  2  ONE anchor, TWO occurrences: the dry-run count AND
--                                    the UPDATE. The preview is scoped too, or it
--                                    promises rows the write then refuses - a false
--                                    measurement, which this codebase treats as worse
--                                    than an honest refusal.
--   parts_cost_fill               2  the candidate set AND the UPDATE
--   tyre_price_backfill           2  the `need` CTE AND the UPDATE
--   run_quality_checks            2  9 bare-`country` counts + 1 aliased
--   run_reconciliation            2  3 bare-`country` counts + 1 aliased
--   scan_data_trust               2  the quality select AND the reconciliation select
--   correction_case_open          1  helper swap only
--   set_store_site_map            1  guard rewrite: the NULL/'' wildcard branch
--
-- THE GUARD SCOPES THE ROWS, NEVER THE ARGUMENT. Every predicate above sits in the WHERE
-- clause of the write itself (or of the CTE that is the write's only row source), so an
-- omitted argument cannot reach a row the caller may not write.
--
-- THE PREDICATE FORM IS A MEASURED DECISION, NOT A STYLE CHOICE.
-- PROJECT_MEMORY's rule - prefer the zero-argument scope readers over the row-argument
-- helper - was re-measured here and is emphatically right:
--     app_write_country_ok(p.country)  over production_logs (212,567 rows)
--         .................... EXCEEDED A 50-SECOND STATEMENT TIMEOUT
--     the V396/V549 InitPlan form, same query, same user
--         .................... 748 ms, plan shows every reader hoisted to an InitPlan
-- The row-argument helper takes the row value so it cannot be hoisted, and it is SECURITY
-- DEFINER so it can never be inlined: a per-row profiles lookup. So every ROW predicate
-- uses the hoisted form, which is byte-for-byte the V542 write-policy expression that
-- app_write_country_ok merely wraps:
--     (<col> is null
--      or (select public.is_super_admin())
--      or (select public.app_sees_all_countries())
--      or lower(btrim(<col>)) = any (coalesce((select public.app_country_scope()), '{}'::text[])))
-- The two SCALAR guards (correction_case_open, set_store_site_map) take an argument, not a
-- row, so they call app_write_country_ok(...) directly - one call, nothing to hoist.
--
-- NOT app_can_see_country: it bypasses for app_is_org_admin() = super OR plain admin, so
-- a guard built on it returns TRUE for a country-scoped plain Admin. Measured across all
-- 38 approved users x {KSA, UAE, Egypt, 'All', ''} = 190 combinations, the two helpers
-- differ on ZERO today, so the swap is behaviour-preserving now and strictly stricter for
-- any future country-scoped plain Admin. THE PROBE WAS POSITIVELY CONTROLLED FIRST - a
-- first attempt evaluated both helpers for the SESSION's uid rather than each user's,
-- returning a meaningless 0-differences; the corrected probe impersonates each profile in
-- turn and discriminates properly (KSA true for 35 of 38, UAE 4, Egypt 5, 'All' only the
-- 2 super admins). V551's rule: confirm a probe CAN return data before reading 0 as proof.
--
-- REFUSAL SHAPE, CHOSEN PER FUNCTION so nothing is invented. Never a populated row of
-- zeros - that asserts a measurement instead of refusing:
--   the six row-scoped functions .. the rows simply fall out of their own predicates, so
--                                   each keeps its existing payload shape with a smaller,
--                                   honest N
--   correction_case_open .......... its OWN existing {"ok":false,"reason":"forbidden"}
--   set_store_site_map ............ returns void so it cannot carry a jsonb refusal; it
--                                   keeps V552's own message and errcode 42501 for a
--                                   named country, and gains 'A store mapping must name a
--                                   country.' (also 42501) for the wildcard case
--
-- THE 'All' SENTINEL, decided PER FUNCTION as V549 requires. No blanket exemption was
-- added anywhere. tyre_price_backfill already folds 'All' to NULL internally, so scoping
-- the rows covers both spellings at once and a country-scoped user gets their own
-- countries on either - which is why the sentinel needed no special case here.
--
-- THE BACKEND / no-JWT PATH - SETTLED EMPIRICALLY PER FUNCTION, NOT REASONED ABOUT.
-- app_write_country_ok returns FALSE (not NULL) with no JWT, so the `is not false` idiom
-- does NOT protect a backend caller and could not be relied on. Measured instead: with
-- `set local role authenticated` and NO claims, app_current_org() is NULL and
-- app_is_elevated() is NULL, and ALL NINE were ALREADY inert before this migration -
-- the ORG predicate, not the role gate, is what stops them:
--     apply_production_station_map .. {"ok":false,"reason":"no_org"}
--     parts_cost_fill ............... {"ok":false,"reason":"no_org"}
--     tyre_price_backfill ........... RAISED: No organisation in session
--     run_quality_checks ............ RAISED: no organisation context
--     run_reconciliation ............ RAISED: no organisation context
--     scan_data_trust ............... RAISED: no organisation context
--     correction_case_open .......... RAISED: no organisation context
--     material_master_set ........... {"ok":false,"reason":"forbidden"}
--     set_store_site_map ............ RAISED: Not authorized to edit the store to site map.
-- So V563 introduces NO backend regression: none of these reaches a write without an org.
--
-- NO CLIENT CHANGE IS NEEDED, VERIFIED BY READING THE CALLERS rather than assumed. The
-- only new refusal a client can meet is set_store_site_map's wildcard branch, so that
-- path was traced end to end: src/lib/api/storeSiteExpense.js setStoreSiteMap() maps
-- country === 'All' -> p_country: null, and ExpenseReport.jsx saveMapping() falls back to
-- activeCountry - BUT the by-site panel is built ONCE PER COUNTRY
-- (`countries.map((c) => ({ country: c, ... }))`, and `countries` is derived from real
-- data rows via `.filter(Boolean)`), and UnmappedCell is handed `country={group.country}`.
-- So the client always passes a concrete country and never reaches the wildcard branch.
-- src/lib/safeError.js maps '42501' to "You do not have permission to do that." (read,
-- line 25). src/** was NOT modified.
--
--
-- =====================================================================================
-- VERIFICATION
-- =====================================================================================
--
-- 1. TEXTUAL REGRESSION PROOF - worth more than re-timing, and it is exact rather than a
--    regex approximation: for ALL 8 functions, inverting every replacement on the LIVE
--    definition reproduces the backed-up definition BYTE FOR BYTE, and the live
--    definition equals what was applied.
--        apply_production_station_map .. strip_back_byte_identical = true
--        correction_case_open .......... true      parts_cost_fill ....... true
--        run_quality_checks ............ true      run_reconciliation .... true
--        scan_data_trust ............... true      set_store_site_map .... true
--        tyre_price_backfill ........... true
--    live_matches_applied = true on all 8. So the guard is provably the only change and a
--    permitted country cannot take a different code path.
--    NOTHING WAS RETYPED: each body is read with pg_get_functiondef at APPLY TIME and the
--    guard inserted by an anchored replace() that ABORTS unless the anchor occurs EXACTLY
--    the expected number of times (2/1/1/1/1/9/1/3/1/1/1/1/1), plus an abort if a
--    replacement produced no change and an abort if the body already carries a scope
--    reader. A partial run is the failure mode that matters: half a boundary reads as a
--    closed one (V396).
--
-- 2. ATTACKS REFUSED - same rolled-back method, privileged recount after `reset role`:
--        tyre_price_backfill(false), argument omitted, evidence re-armed
--            BEFORE UAE 569 priced / 1,887 unpriced / AED 425,701.79
--            AFTER  UAE 569 priced / 1,887 unpriced / AED 425,701.79   <-- UNCHANGED
--            UAE rows written to the backfill log ...................... 0
--            payload ................................ no UAE rows in payload
--        parts_cost_fill(null, false), UAE candidate planted
--            BEFORE UAE 1 filled line / AED 600.00
--            AFTER  UAE 1 filled line / AED 600.00                      <-- UNCHANGED
--            by_country ....... [{KSA: 8 lines, SAR 914.14}] only
--        set_store_site_map(NULL, 'SP_EG_MRIL', ...) .. REFUSED: A store mapping must
--                                                       name a country.
--        set_store_site_map('',   ...) ................ REFUSED: same
--        set_store_site_map('Egypt', ...) ............. REFUSED: You do not have
--                                                       permission to map a store in
--                                                       that country.   (V552's message)
--        apply_production_station_map('UAE') .......... {"ok":false,"reason":"forbidden"}
--        correction_case_open(country='UAE') .......... {"ok":false,"reason":"forbidden"}
--
-- 3. THE DECISIVE CHECK, exactly as V549 framed it - the scoped user's ALL-scope result
--    is now byte-identical to their OWN country-scope result, and the platform owner is
--    untouched:
--        run_quality_checks  KSA Manager OMITTED .... md5 6ada425f...  unpriced 2,285
--        run_quality_checks  KSA Manager 'KSA' ...... md5 6ada425f...  unpriced 2,285
--        run_quality_checks  SUPER ADMIN OMITTED .... md5 f54d8a4a...  unpriced 4,359
--    Before V563 the Manager's OMITTED digest WAS f54d8a4a - the super admin's. It is now
--    their own. There is no null-country exception to note: all five affected tables hold
--    ZERO null-country rows (tyre_records 0/11,191, parts_consumption 0/209,381,
--    work_orders 0/89,628, vehicle_fleet 0/1,617, production_logs 0/212,567), so the two
--    paths are exactly comparable.
--        run_reconciliation  fleet_asset_link OMITTED .... 553 -> 370 (their own figure)
--        apply_production_station_map OMITTED ............ 206,868 = its 'KSA' result
--
-- 4. CONTROLS - a fix that breaks the feature is not a fix:
--        parts_cost_fill(null,false) ..... the caller's OWN 8 KSA lines STILL FILLED
--                                          (SAR 914.14) while UAE was left alone. It
--                                          refuses the out-of-scope part only; it does
--                                          not refuse the operation.
--        set_store_site_map('KSA', ...) .. ACCEPTED
--        correction_case_open(no country)  ACCEPTED (CC-2026-0001)
--        correction_case_open('KSA') ..... ACCEPTED (CC-2026-0002)
--        scan_data_trust(omitted) ........ ok, runs
--        apply_production_station_map('KSA') ... 206,868 rows, real preview
--    SUPER ADMIN still crosses every boundary:
--        set_store_site_map(NULL, ...)  wildcard .. ACCEPTED
--        set_store_site_map('Egypt', ...) ......... ACCEPTED
--        apply_production_station_map('UAE') ...... {"ok":true,"rows":0}  (no UAE
--                                                    production exists - allowed, empty)
--        correction_case_open('UAE') .............. ACCEPTED (CC-2026-0003)
--
-- 5. PERFORMANCE - measured, because a guard that makes a report time out is an outage:
--        apply_production_station_map (dry run, 212k rows) ..... 667 ms
--        run_quality_checks ................................... 440 ms
--        run_reconciliation ................................... 1,127 ms
--        parts_cost_fill (dry run) ............................ 1,021 ms
--        tyre_price_backfill (dry run) ........................ 42,253 ms
--    tyre_price_backfill is SLOW, and it is slow FOR A PRE-EXISTING REASON, not because
--    of this guard - proven by restoring the pre-V563 body inside a rolled-back
--    transaction and timing the identical call as the same user:
--        BEFORE (unguarded) 48,323 ms  ->  AFTER (guarded) 42,253 ms
--    It got FASTER, the same V549 effect: a scoped user now scans fewer rows. The
--    remaining 42s is the `known` correlated lateral already recorded in PROJECT_MEMORY
--    as a standing optimisation candidate for this family. Unrelated to the boundary.
--
-- 6. OBJECT INTEGRITY - preserved on all 8: SECURITY DEFINER = true,
--    search_path = 'public', authenticated EXECUTE = true, anon EXECUTE = false.
--
-- 7. NO BUSINESS DATA WAS ALTERED. Every reproduction ran in a rolled-back transaction
--    and the live state was re-checked afterwards: 0 planted tyres, 0 planted expense
--    lines, 0 planted store maps, 0 planted correction cases, UAE still 568 priced /
--    AED 424,467.79 (V559's exact figure), store_site_map back to 21 rows, trust_alerts 1.
--
--
-- =====================================================================================
-- STILL OPEN - stated rather than left silent
-- =====================================================================================
-- 1. ** store_site_map HAS NO COUNTRY POLICY AT ALL, so fixing the RPC is only half the
--    wall. ** It is NOT among V542's 78 country-write tables; its policies are org
--    isolation plus app_is_elevated() for INSERT/UPDATE/DELETE. PROVEN: the same KSA-only
--    Manager inserted an Egypt-country row DIRECTLY into the table, bypassing the RPC
--    entirely (1 row written, rolled back). So set_store_site_map is now guarded and the
--    TABLE is still open. This needs a V542-style `store_site_map_country_write`
--    RESTRICTIVE FOR ALL policy carrying the expression in USING **and** WITH CHECK - a
--    table-policy change, deliberately not made here so as not to collide with a sibling
--    session's lane. Do not record this boundary as closed.
-- 2. classify_parts_consumption's store lookup has NO organisation_id predicate and an
--    unordered `limit 1`. The missing org term is a cross-TENANT concern (inert today
--    with one tenant) and the unordered limit makes which mapping wins arbitrary when a
--    wildcard and a country row coexist. Both are outside a country-scoping pass.
-- 3. scan_data_trust's dedupe (`not exists (... a.ref_key = qr.rule_key ...)`) is not
--    country-scoped, so one country's open alert can suppress another country's. A
--    correctness defect, not a write hole; not changed inside a security pass. Its
--    `run_at = max(run_at)` selection is likewise keyed on a timestamp rather than on the
--    run - now country-guarded, but still not keyed on the run it just made.
-- 4. run_reconciliation labels wo_cost_components 'SAR' while the ALL path spans three
--    currencies. Harmless today (UAE and Egypt job cards carry 0.00) and now scoped, but
--    the unit label is still wrong by construction for a multi-country reader.
-- 5. tyre_price_backfill's 42s `known` lateral (see 5 above).
-- 6. The V559/V562 remainder is unchanged: post_stock_movement, set_stock_count,
--    correct_wash_record, record_pm_service, the cost_* family, recon_backfill_*,
--    material_master_derive / _set_bulk, data_link_create_missing_assets - and the 14
--    accident RPCs whose `x <> any (array[...])` enum check is true for every value.
--
--
-- =====================================================================================
-- ROLLBACK
-- =====================================================================================
--     do $$ declare r record; begin
--       for r in select def_before from _bak.arg_guard_writers_v563 loop
--         execute r.def_before;
--       end loop;
--     end $$;
-- CREATE OR REPLACE restores the exact prior body and preserves SECURITY DEFINER, the
-- pinned search_path and the grants. No table, column, policy, grant or row of business
-- data was altered by V563.
-- =====================================================================================


create schema if not exists _bak;
create table if not exists _bak.arg_guard_writers_v563 (
  proc text primary key, def_before text not null, def_after text,
  guards jsonb, captured_at timestamptz not null default now()
);

do $mig$
declare
  -- The V542 write-policy expression in the V396/V549 INITPLAN form. The
  -- zero-argument scope readers take no row value, so `(select f())` is an
  -- uncorrelated subquery hoisted to a once-per-query InitPlan. The row-argument
  -- helper app_write_country_ok(col) cannot be hoisted and is SECURITY DEFINER so
  -- it can never be inlined: MEASURED over production_logs (212,567 rows) it blew a
  -- 50s statement timeout where this form returns in 748 ms.
  PRED constant text :=
    '(%1$s is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())'
    || ' or lower(btrim(%1$s)) = any (coalesce((select public.app_country_scope()), ''{}''::text[])))';
  r record; v_before text; v_after text; i int; hits int; v_guards jsonb;
  a text; g text; c int; specs jsonb;
begin
  specs := jsonb_build_array(
    -- ONE anchor, TWO occurrences: the dry-run count AND the UPDATE.
    jsonb_build_object('proc','public.apply_production_station_map(text,boolean)','count',2,
      'anchor', E'\n     and (p_country is null or p.country = p_country)',
      'add',    E'\n     and (p_country is null or p.country = p_country)\n     and ' || format(PRED,'p.country')),

    jsonb_build_object('proc','public.parts_cost_fill(text,boolean)','count',1,
      'anchor', E'\n     and (p_country is null or z.country = p_country)',
      'add',    E'\n     and (p_country is null or z.country = p_country)\n     and ' || format(PRED,'z.country')),
    jsonb_build_object('proc','public.parts_cost_fill(text,boolean)','count',1,
      'anchor', E'   where p.id = c.line_id;',
      'add',    E'   where p.id = c.line_id\n     and ' || format(PRED,'p.country') || E';'),

    -- The `need` CTE drives the payload, the log AND the update, so scoping it scopes
    -- all three; the UPDATE is scoped as well so the boundary sits on the write itself.
    jsonb_build_object('proc','public.tyre_price_backfill(boolean,text)','count',1,
      'anchor', E'\n      and (v_country is null or t.country = v_country)',
      'add',    E'\n      and (v_country is null or t.country = v_country)\n      and ' || format(PRED,'t.country')),
    jsonb_build_object('proc','public.tyre_price_backfill(boolean,text)','count',1,
      'anchor', E'   where t.id = f.id\n     and t.organisation_id = v_org;',
      'add',    E'   where t.id = f.id\n     and t.organisation_id = v_org\n     and ' || format(PRED,'t.country') || E';'),

    jsonb_build_object('proc','public.run_quality_checks(text)','count',9,
      'anchor', '(p_country is null or country=p_country)',
      'add',    '(p_country is null or country=p_country) and ' || format(PRED,'country')),
    jsonb_build_object('proc','public.run_quality_checks(text)','count',1,
      'anchor', '(p_country is null or t.country=p_country)',
      'add',    '(p_country is null or t.country=p_country) and ' || format(PRED,'t.country')),

    jsonb_build_object('proc','public.run_reconciliation(text)','count',3,
      'anchor', '(p_country is null or country=p_country)',
      'add',    '(p_country is null or country=p_country) and ' || format(PRED,'country')),
    jsonb_build_object('proc','public.run_reconciliation(text)','count',1,
      'anchor', '(p_country is null or t.country=p_country)',
      'add',    '(p_country is null or t.country=p_country) and ' || format(PRED,'t.country')),

    -- scan_data_trust INSERTS trust_alerts taking `country` straight off the source row;
    -- the reconciliation half selects on run_at = max(run_at) with no country predicate.
    jsonb_build_object('proc','public.scan_data_trust(text)','count',1,
      'anchor', E'where qr.run_id = v_run and qr.status = ''fail''',
      'add',    E'where qr.run_id = v_run and qr.status = ''fail''\n    and ' || format(PRED,'qr.country')),
    jsonb_build_object('proc','public.scan_data_trust(text)','count',1,
      'anchor', E'where rr.organisation_id=v_org and rr.run_at = v_max and rr.status=''variance''',
      'add',    E'where rr.organisation_id=v_org and rr.run_at = v_max and rr.status=''variance''\n    and ' || format(PRED,'rr.country')),

    -- The row's country IS the argument here, so an argument guard is a row guard.
    -- Only the helper changes; NULL stays permitted (un-countried cases are by design).
    jsonb_build_object('proc','public.correction_case_open(text,text,text,jsonb,text,text,text)','count',1,
      'anchor', E'  if p_country is not null and not public.app_can_see_country(p_country) then\n    return json_build_object(''ok'', false, ''reason'', ''forbidden''); end if;',
      'add',    E'  if public.app_write_country_ok(p_country) is false then\n    return json_build_object(''ok'', false, ''reason'', ''forbidden''); end if;'),

    -- The V550 bypass in its purest form: the guard reads "IF p_country IS NOT NULL AND
    -- BTRIM(p_country) <> '' AND ...", so NULL or '' skips it entirely - and a
    -- NULL-country row is a WILDCARD matched against every country.
    jsonb_build_object('proc','public.set_store_site_map(text,text,text)','count',1,
      'anchor', E'  IF p_country IS NOT NULL AND BTRIM(p_country) <> ''''\n     AND public.app_can_see_country(p_country) IS FALSE THEN\n    RAISE EXCEPTION ''You do not have permission to map a store in that country.''\n      USING errcode = ''42501'';\n  END IF;',
      'add',    E'  IF NULLIF(BTRIM(p_country), '''') IS NULL THEN\n    -- A NULL country is a WILDCARD: classify_parts_consumption resolves a site with\n    -- (m.country IS NULL OR m.country = NEW.country), so such a row decides the site\n    -- for EVERY country. Creating one is a write against all of them.\n    IF NOT (public.is_super_admin() OR public.app_sees_all_countries()) THEN\n      RAISE EXCEPTION ''A store mapping must name a country.''\n        USING errcode = ''42501'';\n    END IF;\n  ELSIF public.app_write_country_ok(BTRIM(p_country)) IS FALSE THEN\n    RAISE EXCEPTION ''You do not have permission to map a store in that country.''\n      USING errcode = ''42501'';\n  END IF;')
  );

  for r in
    select value->>'proc' as proc,
           jsonb_agg(jsonb_build_object('anchor', value->>'anchor', 'add', value->>'add',
                                        'count', (value->>'count')::int) order by ord) as gs
    from jsonb_array_elements(specs) with ordinality t(value, ord)
    group by value->>'proc'
  loop
    -- Read the LIVE definition. Nothing is retyped and nothing comes from an earlier
    -- snapshot: sibling sessions are editing this same schema concurrently.
    v_before := pg_get_functiondef(r.proc::regprocedure);
    v_after  := v_before;
    v_guards := '[]'::jsonb;

    if position('app_country_scope' in v_before) > 0 then
      raise exception 'V563 ABORT: % already carries a scope-reader guard.', r.proc;
    end if;

    for i in 0 .. jsonb_array_length(r.gs) - 1 loop
      a := r.gs->i->>'anchor'; g := r.gs->i->>'add'; c := (r.gs->i->>'count')::int;

      hits := (length(v_after) - length(replace(v_after, a, ''))) / nullif(length(a), 0);
      if hits is distinct from c then
        raise exception 'V563 ABORT: % anchor #% found % times, expected %. Anchor: %',
          r.proc, i + 1, coalesce(hits, -1), c, left(a, 80);
      end if;

      v_after := replace(v_after, a, g);
      if v_after = v_before then
        raise exception 'V563 ABORT: % anchor #% produced no change.', r.proc, i + 1;
      end if;
      v_guards := v_guards || jsonb_build_object('anchor', left(a, 120), 'occurrences', c);
    end loop;

    insert into _bak.arg_guard_writers_v563 (proc, def_before, def_after, guards)
    values (r.proc, v_before, v_after, v_guards)
    on conflict (proc) do update set def_before = excluded.def_before,
      def_after = excluded.def_after, guards = excluded.guards, captured_at = now();

    execute v_after;
  end loop;
end $mig$;
