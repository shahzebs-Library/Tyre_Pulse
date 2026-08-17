-- =====================================================================================
-- V564 - THE OPERATIONAL WRITERS: INVENTORY DESTROYED, A WASH RECORD REWRITTEN,
--        A MAINTENANCE SCHEDULE PUSHED FIVE MONTHS, A CHECKLIST CYCLE SKIPPED
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A), 2026-08-17.
-- Applied as supabase migration `v564_operational_writer_country_guards`.
-- =====================================================================================
--
-- ROOT CAUSE, unchanged from V559 / V562 and every migration in this family:
-- A SECURITY DEFINER function runs as its OWNER, and no public table sets FORCE ROW
-- LEVEL SECURITY, so RLS NEVER RUNS INSIDE ONE. Measured for these five tables rather
-- than assumed: relforcerowsecurity = false on stock_records, stock_movements,
-- wash_records, pm_programs, pm_service_records, checklist_schedules and
-- checklist_assignments. V542 gave 78 country tables a RESTRICTIVE FOR ALL write policy,
-- but that governs writes made THROUGH RLS. A definer function steps around it and must
-- re-check org, country and site itself.
--
-- All five functions below check ORGANISATION and stop there. Org separates one company
-- from another; it says nothing about country.
--
-- Attacker throughout is the real approved KSA-only Manager
-- 34793423-43df-4b6f-9270-9d1e8be6fa30 (org Company A, country {KSA}, sites {ALL}).
-- MEASURED, not assumed, that this user passes every gate these five functions already
-- have:
--     app_current_org()          = 00000000-0000-0000-0000-000000000001   (matches)
--     get_my_role()              = 'Manager'  -> passes record_pm_service's
--                                  IN ('Admin','Manager','Director')
--     app_is_elevated()          = TRUE       -> passes correct_wash_record and
--                                  generate_checklist_assignments
--     is_approved_and_unlocked() = TRUE       -> passes both stock writers
--     app_write_country_ok('KSA')= TRUE   ('UAE') = FALSE   (null) = TRUE
-- app_is_elevated() is admin|manager|director, so a plain Manager PASSES every
-- "elevated" gate. It is not a meaningful restriction and it is the only gate three of
-- these five carry.
--
--
-- =====================================================================================
-- THE MEASUREMENT RULE - it decided three of the five findings
-- =====================================================================================
-- A count taken from inside the attacker's session counts what is READABLE, not what was
-- WRITTEN, so a blocked write and an invisible write look identical. Every reproduction
-- below does `reset role` and recounts as a PRIVILEGED reader in the SAME transaction,
-- and every transaction was rolled back.
--
-- It mattered immediately: on the stock probe the attacker's own read of UAE stock
-- returned 0 rows while the write landed. Trusting the attacker-side count would have
-- reported "refused" on a hole that destroyed 97 units of stock.
--
--
-- =====================================================================================
-- THE FIVE HOLES - each reproduced live before it was touched
-- =====================================================================================
--
-- 1. post_stock_movement(uuid,text,numeric,text,text) - DESTROYED UAE INVENTORY.
--    Loads the stock row, checks organisation, and posts the movement. No country term
--    anywhere. PROVEN against a UAE stock row while the attacker's own read of
--    stock_records WHERE country='UAE' returned 0:
--        stock_qty      100 -> 3        (adjustment_down 97)
--        stock_status   'OK' -> 'Critical'
--        a stock_movements ledger row created, created_by = the KSA manager
--    Privileged recount in the same transaction confirmed all three. This is the one
--    with the most direct operational weight in this batch: it is a real inventory
--    balance for a country the caller cannot see, moved by someone who cannot see it to
--    put it back.
--
-- 2. set_stock_count(uuid,numeric,text) - WROTE TO A UAE STOCK ROW, but see the label.
--    Same shape: organisation checked, country never. PROVEN: the attacker's call
--    returned {"status":"counted"} against a UAE row and the privileged recount showed
--    updated_by stamped to the KSA manager on that row.
--
--    LABELLED HONESTLY - the QUANTITY could not be changed today, and NOT because of any
--    boundary. set_stock_count writes movement_type 'stocktake', and
--    stock_movements_movement_type_check does not allow that value:
--        CHECK (movement_type = ANY (ARRAY['In','Out','Adjustment','Initial','Reorder',
--          'Scrap','receipt','return','transfer_in','adjustment_up','issue',
--          'transfer_out','scrap','adjustment_down']))
--    So every count that DIFFERS from the current quantity aborts with 23514 (reproduced:
--    sqlstate 23514 on a count of 7 against a quantity of 100), and only the no-delta
--    path completes. That is a pre-existing BEHAVIOUR bug, not a security control - the
--    mobile stock-take feature (mobile/lib/stock.ts setStockCount) cannot record a
--    differing count for anyone, in any country. It is reported here and deliberately NOT
--    repaired inside a security pass: widening that CHECK changes what the stock ledger
--    accepts and belongs to whoever owns the stock-take feature. The guard is applied
--    regardless, because the day that CHECK is corrected the country hole opens with it.
--
-- 3. correct_wash_record(uuid,jsonb,text) - REWROTE A UAE WASH RECORD.
--    Selects the row on `id = p_id and organisation_id = v_org`, then applies the patch
--    field by field. No country term. PROVEN, attacker read of UAE wash_records = 0:
--        notes   'original UAE note' -> 'OVERWRITTEN BY A KSA-ONLY USER'
--        site    'JEBEL ALI'         -> 'ZZ-MOVED-BY-KSA'
--        status  'Completed'         -> 'Cancelled'
--        3 rows written to wash_record_corrections against a record they cannot see
--    The correction ledger is the sharp part: the audit trail that exists to make a
--    correction accountable was itself filled in on another country's record.
--    NOT a payload-injection path: 'country' is absent from the function's own v_allowed
--    list, so a patch cannot restamp the row's country. Checked, not assumed.
--
-- 4. record_pm_service(...14 args) - INSERTED A UAE COST ROW AND MOVED A UAE SERVICE
--    FIVE MONTHS LATER. Checks organisation and role, never country. PROVEN:
--        pm_service_records: 1 row INSERTED with country = 'UAE' (parts 500 + labour 300
--          = generated total_cost 800 booked into UAE's maintenance ledger),
--          created_by = the KSA manager
--        pm_programs:  next_due        2026-09-01 -> 2027-02-17   (~5 months later)
--                      last_done_meter      10000 -> 99999
--                      next_due_meter        NULL -> 104999
--    The country of the inserted row is NOT taken off the payload - it is copied from
--    the program (v_plan.country) - so this is not the V562 apply_tyre_change injection
--    shape. It is worse in a different way: advancing next_due silently retires a real
--    UAE machine's due service, and nobody in UAE is shown anything.
--
-- 5. generate_checklist_assignments() - SKIPPED A UAE CHECKLIST CYCLE.
--    Loops every active, due schedule in the caller's org and has no country term.
--    PROVEN: a UAE schedule due 2026-08-10 was processed by the KSA manager -
--        checklist_assignments: 1 row created, country 'UAE', site 'JEBEL ALI'
--        checklist_schedules:   next_due 2026-08-10 -> 2026-08-17
--    Advancing next_due is the damage: the cycle is consumed, so the assignment the UAE
--    team should have received on the next legitimate run is never generated.
--
--
-- =====================================================================================
-- THE METER SIDE EFFECT ON record_pm_service - CHECKED, AND IT NEEDS NO GUARD
-- =====================================================================================
-- record_pm_service is documented in this repo as also logging the reading into
-- odometer_logs / engine_hours_logs. That is TRUE of the feature and FALSE of the
-- function: the live body writes only pm_service_records and pm_programs. The meter
-- capture is CLIENT-side, in src/lib/api/pmPrograms.js captureMeterReading(), as a plain
--     supabase.from('odometer_logs').insert({ ..., country: record.country })
-- i.e. an ordinary PostgREST insert as the CALLER, where RLS does apply.
--
-- Verified by measurement rather than by reading: odometer_logs and engine_hours_logs
-- both carry the V542 RESTRICTIVE FOR ALL `_country_write` policy, and the attacker
-- issuing exactly the insert that client makes was REFUSED with 42501
-- ("new row violates row-level security policy odometer_logs_country_write"), privileged
-- recount 0 rows. So the side effect is already walled, the guard does not need to reach
-- it, and after this migration it is unreachable anyway - the RPC raises first, unwrap()
-- throws, and captureMeterReading never runs.
--
--
-- =====================================================================================
-- THE CRON TRAP - why generate_checklist_assignments is guarded DIFFERENTLY
-- =====================================================================================
-- app_write_country_ok returns FALSE, not NULL, with no JWT. Measured in a bare session:
--     app_write_country_ok('KSA') = FALSE     app_write_country_ok('UAE') = FALSE
--     app_write_country_ok(null)  = TRUE      app_country_scope() = {}
-- generate_checklist_assignments IS cron-driven: cron.job 8 `checklist_assignments_daily`,
-- schedule '15 0 * * *', active = true, command `SELECT
-- public.generate_checklist_assignments();`. That run has auth.uid() IS NULL.
--
-- So a blanket `if not app_write_country_ok(...) then raise` on this function would have
-- made the nightly job generate ZERO assignments, every night, silently, for every
-- country - a scheduled job stopped by the guard meant to protect it.
--
-- The function already distinguishes the two callers with `(v_uid IS NULL OR ...)`, and
-- the guard MIRRORS that idiom exactly rather than inventing a second one:
--     AND (v_uid IS NULL OR public.app_write_country_ok(cs.country))
-- Cron keeps its global sweep; an authenticated caller advances only their own countries.
--
-- It is a ROW PREDICATE, not an exception, and that is deliberate and specific to this
-- function: a KSA manager pressing the on-demand button legitimately wants their KSA
-- schedules generated, so refusing the whole call would break the feature to close the
-- hole. Refusal here correctly means "the foreign rows are not touched", and the return
-- value stays an honest count of what was actually created.
--
--
-- =====================================================================================
-- THE GUARDS - six insertions over five functions
-- =====================================================================================
--   post_stock_movement            1  v_rec.country,  after the cross-org check
--   set_stock_count                1  v_rec.country,  after the cross-org check
--   correct_wash_record            1  v_row.country,  after the row is locked and found
--   record_pm_service              1  v_plan.country, after the org and role checks
--   generate_checklist_assignments 2  row predicates on cs.country and ca.country
--
-- public.app_write_country_ok(text) is used, NOT app_can_see_country. V555 added it
-- because the older helper bypassed for app_is_org_admin() = super OR plain admin, so a
-- guard built on it returns TRUE for a country-scoped plain Admin. It is also the byte
-- expression V542 put in the tables' own write policies, so a definer write is judged by
-- exactly the rule an ordinary writer is judged by.
--
-- NULL COUNTRY PASSES, DELIBERATELY. app_write_country_ok(null) = TRUE, so a row with no
-- country stays writable by every scope. That is the convention every RLS policy in this
-- database uses and the one live stock_records row carries country IS NULL - a guard that
-- refused nulls would have broken the only stock record that exists.
--
-- 'All' IS NOT EXEMPTED ON ANY OF THE FIVE, and that is a per-function decision, not a
-- blanket one (the V552 rule). None of these five takes a country ARGUMENT at all - every
-- guard reads the country off a ROW that has already been loaded - so the app's 'All'
-- sentinel can never arrive here. A sentinel exemption would be dead code at best and a
-- widening at worst.
--
-- REFUSAL SHAPE IS CHOSEN PER FUNCTION so nothing is invented:
--   post_stock_movement / set_stock_count / record_pm_service -> RAISE, errcode 42501,
--     matching the cross-organisation refusal that already sits one line above.
--     (record_pm_service's own raises carry no errcode and default to P0001; 42501 is
--     used for the new guard because it is what src/lib/safeError.js maps.)
--   correct_wash_record -> return jsonb_build_object('ok', false, 'reason', 'forbidden'),
--     which is this function's OWN existing refusal for a non-elevated caller.
--   generate_checklist_assignments -> zero rows touched, via the row predicate.
-- Never a populated row of zeros - none of these returns a fabricated success.
--
-- NO CLIENT CHANGE NEEDED, verified by READING the callers rather than assuming:
--   src/lib/safeError.js maps '42501' -> 'You do not have permission to do that.', so
--     postStockMovement / setStockCount / recordPmService surface a clean sentence
--     (each throws through unwrap()).
--   src/pages/VehicleWashing.jsx ALREADY maps reason === 'forbidden' to
--     'You do not have permission to correct a wash record.'
--
-- TRADE-OFF STATED: correct_wash_record returns 'forbidden' rather than 'not_found' for a
-- foreign-country row, which confirms the row exists. 'forbidden' is the function's own
-- vocabulary and the one the page already renders; the alternative asserts a falsehood
-- about a row that does exist. The disclosure is the bare existence of a wash record, and
-- the caller must already know its uuid to ask.
--
-- NOTHING WAS RETYPED. Each live body is read with pg_get_functiondef and the guard
-- inserted by an anchored replace() that ABORTS unless the anchor occurs EXACTLY the
-- expected number of times, plus an abort if the replacement produced no change. All six
-- anchors were confirmed to occur exactly once before the migration was written. A
-- partial run is the failure mode that matters: half a boundary reads as a closed one.
--
--
-- =====================================================================================
-- VERIFICATION - attacks refused, and the features still work
-- =====================================================================================
-- ATTACKS REFUSED (privileged recount in the same transaction, rolled back):
--   post_stock_movement on the UAE row  -> 42501, stock_qty UNCHANGED at 100,
--                                          0 stock_movements rows created
--   set_stock_count on the UAE row      -> 42501, updated_by NOT stamped
--   correct_wash_record on the UAE row  -> {"ok":false,"reason":"forbidden"},
--                                          notes survived as 'original UAE note',
--                                          0 wash_record_corrections rows
--   record_pm_service on the UAE program-> 42501, 0 pm_service_records rows,
--                                          next_due UNCHANGED at 2026-09-01
--   generate_checklist_assignments      -> returned 0, UAE schedule next_due UNCHANGED
--                                          at 2026-08-10, 0 assignments created
--
-- CONTROLS PASS - this is the half that proves it is a fix and not a breakage. The SAME
-- KSA-only Manager, against their OWN country:
--   post_stock_movement on a KSA row    -> {"status":"posted"}, stock_qty 100 -> 60
--   set_stock_count on a KSA row        -> {"status":"counted"} (the no-delta path, 60 -> 60;
--                                          the delta path is the 23514 CHECK bug, not the guard)
--   correct_wash_record on a KSA row    -> {"ok":true,"changed":1}, notes actually rewritten
--   record_pm_service on a KSA program  -> 1 pm_service_records row created, country 'KSA',
--                                          generated total_cost 800, and the program's
--                                          next_due advanced 2026-09-01 -> 2027-02-17
--   generate_checklist_assignments      -> returned 1, and the privileged read shows the
--                                          created assignment is the KSA one while the UAE
--                                          schedule sat untouched at next_due 2026-08-10
--
-- And the CRON path, which is the one a blanket guard would have destroyed:
--   generate_checklist_assignments() with NO JWT (auth.uid() IS NULL, exactly how pg_cron
--   job 8 runs it) -> returned 2, and the privileged read confirms it DID process the UAE
--   schedule that the KSA manager had just been refused. So the nightly job keeps its
--   global sweep across every country.
--
-- THE PLATFORM OWNER IS NOT LOCKED OUT - the V549 trap #1, checked rather than assumed.
-- The super admin's profiles.country IS NULL, so BOTH scope readers are empty for them:
--     is_super_admin() = TRUE   app_sees_all_countries() = FALSE   app_country_scope() = {}
-- A guard built from the scope readers alone - the obvious shape - would have returned
-- FALSE and refused the platform owner on all five functions. app_write_country_ok carries
-- the is_super_admin() term, so app_write_country_ok('UAE') = TRUE for them. Verified by
-- impersonating super admin 58787cc7 against UAE rows:
--     post_stock_movement -> posted, 100 -> 90
--     correct_wash_record -> {"ok":true,"changed":1}
--     record_pm_service   -> service row created with country 'UAE'
--
-- BLAST RADIUS MEASURED FIRST, so no legitimate writer can be refused: of 38 approved and
-- unlocked users, 2 are super admins (which app_write_country_ok passes via
-- is_super_admin()), 36 carry a real country scope, and NON-SUPER USERS WITH NO COUNTRY
-- SCOPE = 0. The only country values anywhere are KSA, UAE and Egypt. So there is no user
-- for whom this guard turns a working write into a refusal in their own country.
--
-- TEXTUAL REGRESSION PROOF, worth more than re-timing: stripping every inserted guard
-- from each live definition reproduces the backed-up definition BYTE FOR BYTE, so the
-- guard is provably the only change and a permitted country cannot take a different path.
--   strip_back_byte_identical = true on all 5
--   live_matches_applied      = true on all 5
--
-- PRESERVED on all five: SECURITY DEFINER = true, the pinned search_path
-- (search_path=public on four, search_path="" on generate_checklist_assignments),
-- authenticated EXECUTE = true, anon EXECUTE = false.
--
--
-- =====================================================================================
-- DISMISSED WITH EVIDENCE - not claimed as leaks
-- =====================================================================================
-- * The meter side effect on record_pm_service. Client-side, RLS applies, refused with
--   42501 when reproduced. Detailed above.
-- * set_stock_count's quantity path. Cannot change a quantity today for anyone, in any
--   country, because of the 'stocktake' CHECK - the no-delta write is the only reachable
--   damage and it changes no balance. Guarded anyway; labelled, not dressed up.
-- * stock_movements has NO country column at all (checked in pg_attribute), so the
--   movement ledger carries no country of its own to guard - it inherits country from the
--   stock_records row through stock_id, which is exactly what the guard reads.
-- * wash_record_corrections likewise has no country column; it is reached only through
--   correct_wash_record, so guarding that function closes it.
-- * No payload-country injection in this batch. The V562 apply_tyre_change defect was a
--   row whose country came straight off the payload. Checked all five: correct_wash_record
--   excludes 'country' from v_allowed; record_pm_service copies v_plan.country;
--   generate_checklist_assignments copies s.country; the two stock writers do not write a
--   country at all. Every country here is read off an existing row.
--
--
-- =====================================================================================
-- STILL OPEN after this migration - stated rather than left silent
-- =====================================================================================
-- 1. pm_programs, pm_service_records, checklist_schedules and checklist_assignments HAVE
--    NO COUNTRY POLICY AT ALL - only org isolation. They were not in V226's 16 tables and
--    not in V542's 78. MEASURED, as the same KSA-only Manager, on planted UAE rows:
--        update public.pm_programs        set notes = 'DIRECT' where country='UAE'
--            -> privileged recount: 1 ROW WRITTEN
--        update public.checklist_schedules set name = 'DIRECT' where country='UAE'
--            -> privileged recount: 1 ROW WRITTEN
--        select from pm_programs where country='UAE'  -> 1 row READABLE
--    against the same probe on the two tables that DO carry the V542 policy:
--        update public.wash_records  ... -> 0 rows   (RLS filtered, no error raised)
--        update public.stock_records ... -> 0 rows
--    So for wash and stock this migration's guards ARE the whole boundary and are fully
--    load-bearing, but for PM and checklists they close the DEFINER path only - the
--    ordinary PostgREST path across those four tables remains open by country, for both
--    read and write. That is a POLICY gap, not a function gap, and the fix is a V542-style
--    RESTRICTIVE FOR ALL policy carrying each table's own expression in USING and
--    WITH CHECK. Deliberately not done here: this migration owns five functions, and
--    adding policies to four tables is a different change with a different blast radius.
--    DO NOT read this migration as having closed country isolation on PM or checklists.
-- 2. stock_movements_movement_type_check omits 'stocktake', so set_stock_count can never
--    record a differing count. A behaviour repair, not a security one; deliberately not
--    made inside a security pass. Whoever fixes it must not assume the country hole is
--    still theoretical afterwards - it is guarded here, but that guard is the only thing
--    that will stand between a working stock-take and cross-country inventory writes.
-- 3. The site dimension is untouched on all five. correct_wash_record can restate 'site'
--    freely, and the two stock writers never look at site. All 38 users are on {ALL} so
--    nothing is reachable today; this is the same all-sites gap V553/V554 record.
-- 4. The 9 argument-only-guarded writers (the V550 class) and the remaining unguarded
--    writers named in V562's own open list are untouched here.
--
--
-- =====================================================================================
-- ROLLBACK
-- =====================================================================================
--     do $$ declare r record; begin
--       for r in select def_before from _bak.rpc_defs_v564 loop execute r.def_before; end loop;
--     end $$;
-- =====================================================================================

create schema if not exists _bak;
create table if not exists _bak.rpc_defs_v564 (
  proc text primary key, def_before text not null, def_after text,
  guards jsonb, captured_at timestamptz not null default now()
);

do $mig$
declare
  r record;
  v_before text; v_after text; v_n int; v_guards jsonb;
  specs jsonb := jsonb_build_array(
    -- 1. post_stock_movement: the SOURCE stock row's country, right after the cross-org check
    jsonb_build_object(
      'proc','public.post_stock_movement(uuid,text,numeric,text,text)',
      'anchor', E'  IF v_rec.organisation_id IS NOT NULL AND v_rec.organisation_id IS DISTINCT FROM v_org THEN\n    RAISE EXCEPTION ''Cross-organisation stock movement denied.'' USING errcode=''42501''; END IF;\n',
      'add',    E'  IF NOT public.app_write_country_ok(v_rec.country) THEN\n    RAISE EXCEPTION ''Cross-country stock movement denied.'' USING errcode=''42501''; END IF;\n',
      'count', 1),
    -- 2. set_stock_count: same row, same place
    jsonb_build_object(
      'proc','public.set_stock_count(uuid,numeric,text)',
      'anchor', E'  IF v_rec.organisation_id IS NOT NULL AND v_rec.organisation_id IS DISTINCT FROM v_org THEN\n    RAISE EXCEPTION ''Cross-organisation stock update denied.'' USING errcode = ''42501'';\n  END IF;\n',
      'add',    E'  IF NOT public.app_write_country_ok(v_rec.country) THEN\n    RAISE EXCEPTION ''Cross-country stock update denied.'' USING errcode = ''42501'';\n  END IF;\n',
      'count', 1),
    -- 3. correct_wash_record: after the row is locked and found; refuses in the function's OWN shape
    jsonb_build_object(
      'proc','public.correct_wash_record(uuid,jsonb,text)',
      'anchor', E'  if not found then\n    return jsonb_build_object(''ok'', false, ''reason'', ''not_found'');\n  end if;\n',
      'add',    E'  if not public.app_write_country_ok(v_row.country) then\n    return jsonb_build_object(''ok'', false, ''reason'', ''forbidden'');\n  end if;\n',
      'count', 1),
    -- 4. record_pm_service: the PROGRAM's country, after the org and role checks
    jsonb_build_object(
      'proc','public.record_pm_service(uuid,date,numeric,text,text,text,jsonb,jsonb,numeric,numeric,text,text,text,text)',
      'anchor', E'  IF public.get_my_role() NOT IN (''Admin'',''Manager'',''Director'') THEN\n    RAISE EXCEPTION ''Not authorized to record a service'';\n  END IF;\n',
      'add',    E'  IF NOT public.app_write_country_ok(v_plan.country) THEN\n    RAISE EXCEPTION ''Cross-country service record denied.'' USING errcode = ''42501'';\n  END IF;\n',
      'count', 1),
    -- 5a. generate_checklist_assignments: schedules loop. MIRRORS the existing
    --     (v_uid IS NULL OR ...) idiom so the pg_cron run (auth.uid() IS NULL) is untouched.
    jsonb_build_object(
      'proc','public.generate_checklist_assignments()',
      'anchor', E'       AND (v_uid IS NULL OR cs.organisation_id = v_org)\n',
      'add',    E'       AND (v_uid IS NULL OR public.app_write_country_ok(cs.country))\n',
      'count', 1),
    -- 5b. generate_checklist_assignments: the overdue sweep. Anchor deliberately EXCLUDES the
    --     trailing semicolon - appending after it would place the predicate after the
    --     statement terminator and produce a syntax error.
    jsonb_build_object(
      'proc','public.generate_checklist_assignments()',
      'anchor', E'     AND (v_uid IS NULL OR ca.organisation_id = v_org)',
      'add',    E'\n     AND (v_uid IS NULL OR public.app_write_country_ok(ca.country))',
      'count', 1)
  );
begin
  for r in
    select value->>'proc' proc,
           jsonb_agg(jsonb_build_object('anchor', value->>'anchor','add', value->>'add','count',(value->>'count')::int)
                     order by ord) gs
    from jsonb_array_elements(specs) with ordinality t(value, ord)
    group by value->>'proc'
  loop
    v_before := pg_get_functiondef(r.proc::regprocedure);
    v_after  := v_before;
    v_guards := '[]'::jsonb;

    for v_n in 0 .. jsonb_array_length(r.gs) - 1 loop
      declare
        a text := r.gs->v_n->>'anchor';
        g text := r.gs->v_n->>'add';
        c int  := (r.gs->v_n->>'count')::int;
        hits int;
      begin
        select count(*) into hits
        from regexp_matches(v_after, regexp_replace(a, '([.^$*+?()\[\]{}|\\])', E'\\\\\\1', 'g'), 'g');
        if hits <> c then
          raise exception 'V564 ABORT %: anchor expected % times, found %', r.proc, c, hits;
        end if;
        v_after := replace(v_after, a, a || g);
        v_guards := v_guards || jsonb_build_object('add', g, 'count', c);
      end;
    end loop;

    if v_after = v_before then
      raise exception 'V564 ABORT %: no change produced', r.proc;
    end if;

    insert into _bak.rpc_defs_v564 (proc, def_before, def_after, guards)
    values (r.proc, v_before, v_after, v_guards)
    on conflict (proc) do update set def_before=excluded.def_before,
      def_after=excluded.def_after, guards=excluded.guards, captured_at=now();

    execute v_after;
  end loop;
end
$mig$;
