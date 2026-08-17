-- ============================================================================
-- V568 - THE ACCIDENT WORKFLOW'S ENUM GUARDS WERE ALWAYS TRUE, SO 14 RPCs
--        COULD NEVER SUCCEED FOR ANYONE, IN ANY COUNTRY, SINCE THEY SHIPPED.
--
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A).
-- Next free migration after this one: V569 (owned by a sibling agent).
--
-- ----------------------------------------------------------------------------
-- THE BUG, AND WHY `<> any` IS ALWAYS TRUE
-- ----------------------------------------------------------------------------
-- Every one of these 14 functions validated its enum argument like this:
--
--     if v_priority <> any (array['low','medium','high','critical']) then
--       raise exception 'Invalid task priority "%".', p_priority;
--     end if;
--
-- `x <> any (array[...])` asks "does x differ from AT LEAST ONE element?".
-- For any array holding two or more distinct values that is TRUE for EVERY x,
-- including the valid ones: 'medium' differs from 'low', so the test passes on
-- the first element and the guard fires. Measured on this database:
--
--     'medium' <> any (array['low','medium','high','critical'])  ->  true   (BUG: valid value refused)
--     'medium' <> all (array['low','medium','high','critical'])  ->  false  (correct: accepted)
--     'banana' <> any (array['low','medium','high','critical'])  ->  true
--     'banana' <> all (array['low','medium','high','critical'])  ->  true   (correct: refused)
--
-- The intended operator is `<> all (...)`, i.e. "differs from EVERY element"
-- = "is not in the list". The repair is that one word, 20 times.
--
-- NOTE the near-miss that makes this easy to misread: `= any (array[...])` IS
-- the correct spelling of "is in the list", and it is used correctly elsewhere
-- in this very family (accident_ws_mark_na's NON_WAIVABLE spine check, and
-- public.app_write_country_ok). Only the NEGATED form is wrong. The anchor used
-- below therefore includes the `<>` and cannot touch a correct `= any`.
--
-- CONSEQUENCE (measured, not inferred): the entire accident workflow has been
-- write-dead since it shipped. Row counts at repair time:
--     accident_case_tasks             0
--     accident_evidence               0
--     accident_insurance_claims       0
--     accident_insurance_decisions    0
--     accident_financial_transactions 0
--     accident_claim_recoveries       0
--     accident_closure_reviews        0
--     accident_repair_orders          0
--     accident_repair_quality_checks  0
--     accident_vehicle_downtime       0
--     accident_case_workstreams       2  (both written by a super admin through
--                                         a direct table insert, not these RPCs)
--
-- Found by the V559 security pass, which correctly refused to repair it inside
-- a security migration because turning 14 permanently-refusing RPCs into working
-- writers is a behaviour change, not a hardening.
--
-- ----------------------------------------------------------------------------
-- PRECONDITION 1 - THE COUNTRY/SITE BOUNDARY IS REAL *BEFORE* THIS REPAIR
-- ----------------------------------------------------------------------------
-- These functions only become reachable writers once repaired, so the wall in
-- front of them had to be proven first, not assumed. All 14 route through
-- public._accident_rpc_context(), which since V559 re-asserts org, then
-- `app_write_country_ok(country) is not false AND app_can_see_site(site)`.
--
-- Re-proven here by impersonation (set_config('request.jwt.claims',...) +
-- `set local role authenticated`), against REAL rows only - every one of the 38
-- accidents on this database is KSA, so the cross-country probe uses a real
-- UAE-scoped user rather than a fabricated case:
--
--   T1  KSA-only Manager 34793423 -> KSA case 01c92287
--         SERVED   org=00000000-...-0001 country=KSA site=NHC
--   T2  UAE-only PMV Manager 08aac5e1 -> the SAME KSA case
--         REFUSED  42501 "Not permitted for this case country/site scope."
--   T3  app_write_country_ok('KSA') read as that UAE user
--         false
--
-- So the boundary held before the repair. It is re-proven again after it, below.
--
-- ----------------------------------------------------------------------------
-- PRECONDITION 2 - WHERE EACH ALLOWED-VALUE LIST COMES FROM
-- ----------------------------------------------------------------------------
-- A repaired guard that admits the WRONG vocabulary is worse than one that
-- admits everything, so no list was taken on trust. Each of the 20 in-function
-- lists was compared, value by value, against the CHECK constraint on the column
-- the function actually writes. ALL TWENTY MATCH THAT CHECK EXACTLY (same set;
-- two differ only in element order, noted). Nothing in this migration edits a
-- list - only the operator changes.
--
--  #  function / variable                    target column                                     CHECK constraint (the evidence)
--  1  accident_claim_decision.v_decision     accident_insurance_decisions.decision             accident_insurance_decisions_decision_check          (9 values, exact)
--  2  accident_decide_closure.v_level        accident_closure_reviews.level                    accident_closure_reviews_level_check                 (3 values, exact)
--  3  accident_decide_closure.v_decision     accident_closure_reviews.decision                 accident_closure_reviews_decision_check              (3 values, exact)
--  4  accident_downtime_set.v_status         accident_vehicle_downtime.vehicle_status          accident_vehicle_downtime_vehicle_status_check       (11 values, exact; CHECK also allows NULL, and the guard is `is not null and ...` to match)
--  5  accident_evidence_add.v_kind           accident_evidence.kind                            accident_evidence_kind_check                         (3 values, exact)
--  6  accident_evidence_verify.v_decision    accident_evidence.verification_status             accident_evidence_verification_status_check          (3 values, same set, different order)
--  7  accident_finance_txn_add.v_txn_type    accident_financial_transactions.txn_type          accident_financial_transactions_txn_type_check       (15 values, exact)
--  8  accident_finance_txn_add.v_direction   accident_financial_transactions.direction         accident_financial_transactions_direction_check      (3 values, exact)
--  9  accident_recovery_record.v_source      accident_claim_recoveries.source                  accident_claim_recoveries_source_check               (4 values, exact)
-- 10  accident_recovery_record.v_status      accident_claim_recoveries.status                  accident_claim_recoveries_status_check               (6 values, exact)
-- 11  accident_repair_order_upsert.v_route   accident_repair_orders.repair_route               accident_repair_orders_repair_route_check            (11 values, exact; NULL-tolerant both sides)
-- 12  accident_repair_order_upsert.v_wtype   accident_repair_orders.workshop_type              accident_repair_orders_workshop_type_check           (5 values, exact; NULL-tolerant both sides)
-- 13  accident_repair_qc.v_result            accident_repair_quality_checks.result             accident_repair_quality_checks_result_check          (3 values, exact)
-- 14  accident_request_closure.v_level       accident_closure_reviews.level                    accident_closure_reviews_level_check                 (3 values, exact)
-- 15  accident_task_create.v_priority        accident_case_tasks.priority                      accident_case_tasks_priority_check                   (4 values, exact)
-- 16  accident_task_create.v_ws              accident_case_workstreams.workstream_key          accident_case_workstreams_workstream_key_check       (10 values, exact)
-- 17  accident_ws_assign.p_workstream_key    accident_case_workstreams.workstream_key          accident_case_workstreams_workstream_key_check       (10 values, exact)
-- 18  accident_ws_mark_na.p_workstream_key   accident_case_workstreams.workstream_key          accident_case_workstreams_workstream_key_check       (10 values, exact)
-- 19  accident_ws_set_status.p_workstream_key accident_case_workstreams.workstream_key         accident_case_workstreams_workstream_key_check       (10 values, exact)
-- 20  accident_ws_set_status.v_status        accident_case_workstreams.status                  accident_case_workstreams_status_check               (12 values, exact)
--
-- ----------------------------------------------------------------------------
-- PRECONDITION 3 - SQL AND THE JS DECISION ENGINE AGREE
-- ----------------------------------------------------------------------------
-- src/lib/accidentCase.js and docs/accident-module/08_ENGINE_SQL_MIRROR.sql are
-- a documented PAIR that must agree, so a repair that made them disagree would
-- be a finding, not something to paper over. Checked, and they agree:
--
--   WORKSTREAMS (accidentCase.js, 10 keys, in order)
--     incident_evidence, fleet_validation, liability, insurance, assessment,
--     repair, workshop_qc, handover, finance, corrective
--   == the SQL guard list in items 16-19 above, and == the
--      accident_case_workstreams_workstream_key_check CHECK.
--
--   WORKSTREAM_STATUS (accidentCase.js, 12 tokens, in order)
--     not_required, not_started, assigned, in_progress, waiting_info,
--     waiting_approval, waiting_external, on_hold, completed, rejected,
--     reopened, cancelled
--   == the SQL guard list in item 20, and == the
--      accident_case_workstreams_status_check CHECK.
--
-- Three-way agreement (JS engine / SQL guard / column CHECK). The only live
-- client caller in src/ is src/components/accidents/CaseWorkstreamsPanel.jsx,
-- which calls accident_ws_mark_na with a key taken straight from the engine's
-- WORKSTREAMS array and renders WORKSTREAM_STATUS_TOKENS in its status picker -
-- so the client already sends exactly this vocabulary. NO CLIENT CHANGE IS
-- NEEDED, and none was made. (The other 13 RPCs have no caller under src/ yet;
-- they are granted API surface awaiting UI. They are repaired anyway because
-- they are executable by every authenticated user today.)
--
-- ----------------------------------------------------------------------------
-- NULL SEMANTICS ARE UNCHANGED BY THIS EDIT (deliberate)
-- ----------------------------------------------------------------------------
--   NULL <> any (array[...])  ->  NULL   -> `if NULL` not taken -> falls through
--   NULL <> all (array[...])  ->  NULL   -> `if NULL` not taken -> falls through
-- Identical. The guards that must reject a missing value already say so
-- explicitly (`p_workstream_key is null or ...`), or coalesce to '' first, and
-- '' <> all (...) is true, so a blank is still refused. The two NULL-tolerant
-- guards (items 4, 11, 12) keep their `is not null and ...` prefix, matching
-- their column CHECKs which also permit NULL.
--
-- ----------------------------------------------------------------------------
-- METHOD
-- ----------------------------------------------------------------------------
-- Nothing is retyped. Each function is read from its own LIVE pg_get_functiondef
-- and edited by an anchored replace() of the exact token
--
--     '<> any (array['   ->   '<> all (array['
--
-- The anchor carries `<>`, so a correct `= any (array[` can never be hit -
-- verified: accident_ws_mark_na contains one such correct occurrence and it is
-- left alone. The DO block ABORTS (raise exception, whole migration rolls back)
-- unless each function's anchor occurs EXACTLY the expected number of times, and
-- again unless the rewritten text contains exactly that many replacements and
-- zero residual '<> any'. A partial run is the failure mode that matters here.
--
-- CREATE OR REPLACE preserves SECURITY DEFINER, the pinned search_path and the
-- grants; all three are re-verified after applying.
--
-- ROLLBACK
--   Restore each prior definition verbatim from the snapshot:
--     do $$ declare r record; begin
--       for r in select def_before from _bak.accident_enum_guard_v568 loop
--         execute r.def_before;
--       end loop;
--     end $$;
--   (That reinstates the always-refusing behaviour exactly as it was.)
-- ============================================================================

create schema if not exists _bak;

drop table if exists _bak.accident_enum_guard_v568;
create table _bak.accident_enum_guard_v568 (
  sig           text primary key,
  def_before    text not null,
  anchor_count  int  not null,
  captured_at   timestamptz not null default now()
);

do $$
declare
  -- signature -> expected number of '<> any (array[' occurrences.
  -- Measured live before writing this migration; the run aborts on any drift.
  v_expect  constant jsonb := jsonb_build_object(
    'public.accident_claim_decision(uuid,text,numeric,text)',                                        1,
    'public.accident_decide_closure(uuid,text,text,uuid,text,jsonb)',                                2,
    'public.accident_downtime_set(uuid,text,date,date)',                                             1,
    'public.accident_evidence_add(uuid,text,text,text,text,text)',                                   1,
    'public.accident_evidence_verify(uuid,uuid,text,text)',                                          1,
    'public.accident_finance_txn_add(uuid,text,text,numeric,text)',                                  2,
    'public.accident_recovery_record(uuid,text,numeric,text,date)',                                  2,
    'public.accident_repair_order_upsert(uuid,text,text,text,numeric,date)',                         2,
    'public.accident_repair_qc(uuid,text,text)',                                                     1,
    'public.accident_request_closure(uuid,text,text,uuid)',                                          1,
    'public.accident_task_create(uuid,text,text,uuid,text,text,text,timestamp with time zone,text)', 2,
    'public.accident_ws_assign(uuid,text,uuid,text,text)',                                           1,
    'public.accident_ws_mark_na(uuid,text,text,uuid)',                                               1,
    'public.accident_ws_set_status(uuid,text,text,text)',                                            2
  );
  k             text;
  v_want        int;
  v_oid         oid;
  v_def         text;
  v_new         text;
  v_found       int;
  v_made        int;
  v_residual    int;
  v_total_fn    int := 0;
  v_total_edits int := 0;
  c_anchor  constant text := '<> any (array[';
  c_fixed   constant text := '<> all (array[';
begin
  for k, v_want in select key, value::int from jsonb_each_text(v_expect) loop
    v_oid := k::regprocedure::oid;
    v_def := pg_get_functiondef(v_oid);

    v_found := (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor);
    if v_found <> v_want then
      raise exception
        'V568 ABORT: % has % occurrence(s) of the anchor, expected %. Live definition has drifted; re-measure before repairing.',
        k, v_found, v_want using errcode = '55000';
    end if;

    v_new := replace(v_def, c_anchor, c_fixed);

    -- The rewrite must have made exactly the expected number of edits ...
    v_made := (length(v_new) - length(replace(v_new, c_fixed, ''))) / length(c_fixed);
    if v_made <> v_want then
      raise exception 'V568 ABORT: % produced % replacement(s), expected %.', k, v_made, v_want
        using errcode = '55000';
    end if;
    -- ... and must leave no negated `any` behind anywhere in the body.
    v_residual := (length(v_new) - length(replace(v_new, '<> any', ''))) / length('<> any');
    if v_residual <> 0 then
      raise exception 'V568 ABORT: % still carries % residual "<> any".', k, v_residual
        using errcode = '55000';
    end if;
    -- Stripping the fix must reproduce the backed-up definition BYTE FOR BYTE,
    -- so the operator is provably the only thing that changed.
    if replace(v_new, c_fixed, c_anchor) is distinct from v_def then
      raise exception 'V568 ABORT: % rewrite is not reversible byte-for-byte.', k using errcode = '55000';
    end if;

    insert into _bak.accident_enum_guard_v568 (sig, def_before, anchor_count)
      values (k, v_def, v_found);

    execute v_new;

    v_total_fn := v_total_fn + 1;
    v_total_edits := v_total_edits + v_made;
  end loop;

  if v_total_fn <> 14 or v_total_edits <> 20 then
    raise exception 'V568 ABORT: repaired % function(s) / % guard(s); expected 14 / 20.',
      v_total_fn, v_total_edits using errcode = '55000';
  end if;

  raise notice 'V568: repaired % functions, % guards.', v_total_fn, v_total_edits;
end $$;

-- ---- post-conditions: nothing may be left half-repaired -------------------
do $$
declare
  v_left int;
  v_bad  int;
begin
  select count(*) into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and pg_get_functiondef(p.oid) like '%<> any%';
  if v_left <> 0 then
    raise exception 'V568 POSTCHECK: % function(s) still carry "<> any".', v_left using errcode = '55000';
  end if;

  -- SECURITY DEFINER + pinned search_path + grants must be intact on all 14.
  select count(*) into v_bad
    from _bak.accident_enum_guard_v568 b
    join pg_proc p on p.oid = b.sig::regprocedure::oid
   where not p.prosecdef
      or p.proconfig is distinct from array['search_path=public']
      or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or not has_function_privilege('service_role',  p.oid, 'EXECUTE')
      or has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad <> 0 then
    raise exception 'V568 POSTCHECK: % function(s) lost DEFINER/search_path/grant posture.', v_bad
      using errcode = '55000';
  end if;
end $$;

-- ============================================================================
-- POST-APPLY STRUCTURAL VERIFICATION (measured live)
-- ----------------------------------------------------------------------------
--   functions still carrying '<> any'                        0   (was 14)
--   functions repaired, snapshot rows                       14 / 14
--   guards repaired                                         20
--   DEFINER + search_path=public + authenticated&service_role
--     EXECUTE + anon REVOKED, intact on                     14 / 14
--   accident_ws_mark_na's CORRECT '= any (array[' occurrence  1  (untouched)
--
-- Two OTHER public functions already contained '<> all (array[' and were NOT
-- touched: get_accident_case_kpis (2 guards) and get_accident_workstream_bottleneck
-- (1 guard) - the V427 read-only reporting RPCs. Worth recording, because it shows
-- the correct operator WAS known to the author: the reporting side got it right
-- and only the 14 WRITERS got it wrong. (Totals therefore read 16 functions /
-- 23 guards fleet-wide, of which this migration owns 14 / 20.)
--
-- ROLLBACK PATH TESTED (applied then rolled back): replaying every def_before
-- from _bak.accident_enum_guard_v568 puts all 14 back to '<> any' and reproduces
-- each prior definition BYTE FOR BYTE (md5 match, 14/14). The repair is in place.
--
-- ============================================================================
-- BEHAVIOURAL VERIFICATION - RUN LIVE, ROLLED BACK, AS A REAL APPROVED USER
-- ----------------------------------------------------------------------------
-- Actor: 34793423-43df-4b6f-9270-9d1e8be6fa30 (adnan mohammad alhaj ali, role
-- Manager, country {KSA}, sites {ALL}, org Company A), impersonated with
-- set_config('request.jwt.claims',...) + `set local role authenticated`, against
-- the real KSA case 01c92287-7880-483f-817c-a6fa7105598e (site NHC).
--
-- BOTH HALVES were run for every one of the 14: a VALID value is now ACCEPTED,
-- and an INVALID value ('banana') is still REFUSED with 22023. Every one of the
-- VALID calls below was REFUSED before this migration.
--
--  #  function                     VALID arg                    BEFORE (valid arg)                            AFTER valid  AFTER invalid
--  1  accident_ws_set_status       status=in_progress           REFUSED 22023 Unknown workstream "repair"     ACCEPTED     REFUSED 22023 Invalid workstream status "banana"
--  2  accident_ws_assign           ws=repair                    REFUSED 22023 Unknown workstream "repair"     ACCEPTED     REFUSED 22023 Unknown workstream "banana"
--  3  accident_ws_mark_na          ws=repair (+approver)        REFUSED 22023 Unknown workstream "repair"     ACCEPTED     REFUSED 22023 Unknown workstream "banana"
--  4  accident_task_create         priority=medium              REFUSED 22023 Invalid task priority "medium"  ACCEPTED     REFUSED 22023 Invalid task priority "banana"
--  5  accident_evidence_add        kind=photo                   REFUSED 22023 Invalid evidence kind "photo"   ACCEPTED     REFUSED 22023 Invalid evidence kind "banana"
--  6  accident_evidence_verify     decision=verified            REFUSED 22023 Invalid verification decision   ACCEPTED     REFUSED 22023 Invalid verification decision "banana"
--  7  accident_claim_decision      decision=settled             REFUSED 22023 Invalid claim decision "settled" ACCEPTED    REFUSED 22023 Invalid claim decision "banana"
--  8  accident_finance_txn_add     txn_type=towing              REFUSED 22023 Invalid transaction type        ACCEPTED     REFUSED 22023 Invalid transaction type "banana"
--  9  accident_recovery_record     source=insurer               REFUSED 22023 Invalid recovery source         ACCEPTED     REFUSED 22023 Invalid recovery source "banana"
-- 10  accident_repair_order_upsert route=internal               REFUSED 22023 Invalid repair route "internal" ACCEPTED     REFUSED 22023 Invalid repair route "banana"
-- 11  accident_repair_qc           result=pass                  REFUSED 22023 Invalid quality-check result    ACCEPTED     REFUSED 22023 Invalid quality-check result "banana"
-- 12  accident_downtime_set        vehicle_status=under_repair  REFUSED 22023 Invalid vehicle status          ACCEPTED     REFUSED 22023 Invalid vehicle status "banana"
-- 13  accident_request_closure     level=operationally_completed REFUSED 22023 Invalid closure level          ACCEPTED     REFUSED 22023 Invalid closure level "banana"
-- 14  accident_decide_closure      decision=approved            REFUSED 22023 Invalid closure level           ACCEPTED     REFUSED 22023 Invalid closure decision "banana"
--
-- Chained rather than seeded where possible, so the proof exercises the real
-- path: #6 verifies the evidence row #5 created, and #11 quality-checks the
-- repair order #10 created. #7's parent claim came from accident_claim_register,
-- which carries no such guard and was already working.
--
-- NOTE on #4: 'medium' is accident_task_create's OWN DEFAULT for p_priority, so
-- before this repair the function refused even a call that passed no priority at
-- all.
--
-- NOTE on #3, recorded rather than glossed: the first VALID run of
-- accident_ws_mark_na still refused, but with 42501 "An approver is required to
-- mark a workstream not applicable." - a DIFFERENT and legitimate rule
-- (na_requires_approval, V417/V553), reached only because the enum guard had
-- already passed. Re-run supplying p_approved_by it ACCEPTED and returned the
-- updated workstream row. Its sibling check that 'liability' is NON_WAIVABLE -
-- the one written with the CORRECT `= any (array[...])` that this migration
-- deliberately does not touch - still refuses with 42501 "Workstream
-- \"liability\" is mandatory and cannot be marked not applicable.", confirming
-- the anchor did not damage correct usage.
--
-- ----------------------------------------------------------------------------
-- COUNTRY BOUNDARY RE-PROVEN *AFTER* THE REPAIR - the important half, because
-- these are live writers now rather than functions that refused everyone.
-- Real UAE-only PMV Manager 08aac5e1-8fe6-42fa-b51a-ef0a168f99cb, same real KSA
-- case, on six repaired writers:
--   accident_ws_set_status        -> REFUSED 42501 "Not permitted for this case country/site scope."
--   accident_task_create          -> REFUSED 42501
--   accident_evidence_add         -> REFUSED 42501
--   accident_finance_txn_add      -> REFUSED 42501
--   accident_repair_order_upsert  -> REFUSED 42501
--   accident_downtime_set         -> REFUSED 42501
--   CONTROL, KSA Manager, same case, accident_ws_set_status -> ACCEPTED
-- The wall still stands, and it is load-bearing now instead of academic.
--
-- ----------------------------------------------------------------------------
-- NO PROBE ROW WAS KEPT. Every behavioural test ran inside `begin; ... rollback;`.
-- Re-counted afterwards: accident_case_tasks 0, accident_evidence 0,
-- accident_insurance_claims 0, accident_insurance_decisions 0,
-- accident_financial_transactions 0, accident_claim_recoveries 0,
-- accident_closure_reviews 0, accident_repair_orders 0,
-- accident_repair_quality_checks 0, accident_vehicle_downtime 0,
-- accident_case_workstreams 2 (the two pre-existing rows, untouched).
-- ============================================================================
