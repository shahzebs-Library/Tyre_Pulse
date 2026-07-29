-- =============================================================================
-- V418 — ACCIDENT CASE ENGINE: SQL MIRROR of src/lib/accidentCase.js
-- =============================================================================
-- STATUS: DESIGN / REVIEW ARTIFACT. **DO NOT APPLY.** This file is the Postgres
-- side of the mandatory JS<->SQL mirror discipline for the accident "case brain".
-- It is written for review of parity against the committed pure engine
-- `src/lib/accidentCase.js`; it has NOT been applied to any database and carries
-- no `supabase_migrations` row. When it is eventually applied it takes the next
-- free migration number after V417 (02_DATA_MODEL.sql = V417), i.e. **V418**.
--
-- WHY IT EXISTS
--   `src/lib/accidentCase.js` is the SPEC (its own header §"DESIGN CONTRACT": the
--   SQL functions copy it verbatim, the same discipline as
--   accident_stage_order <-> STAGE_FLOW and classify_parts_consumption <->
--   partsExpense.js). The client computes route / workstream satisfaction /
--   completeness / the closure gate; the server must reach BYTE-IDENTICAL
--   decisions so it can ENFORCE closure + completeness that the client also shows
--   (brief acceptance criterion: "user cannot bypass closure requirements through
--   API calls"). This file is that server twin.
--
-- INPUTS ARE jsonb ON PURPOSE
--   Every function takes the case as `p_case jsonb`, the explicit workstream rows
--   as `p_ws jsonb` (array), the resolved route as `p_route text` and the matched
--   config profile as `p_profile jsonb`. That mirrors the JS signatures
--   (record / wsRows / route) exactly AND lets the mirror be unit-tested against
--   the JS with the same fixtures, with no dependency on the physical schema of
--   `accidents` / `accident_case_workstreams`. When wired into the guard trigger
--   (§10) the caller builds `p_case := to_jsonb(NEW)`, `p_ws := (select
--   jsonb_agg(to_jsonb(w)) from accident_case_workstreams w where ...)`, etc.
--
-- VOLATILITY (guidance in PROJECT_MEMORY: "a STABLE function reading a table is
-- fine; an IMMUTABLE function constant-folds — never benchmark it with constants")
--   * IMMUTABLE — every function whose result depends ONLY on its jsonb/text args
--     (route, workstream status, completeness, closure_level, transitions,
--     case-status derivation, all scalar helpers). They read no table and no clock.
--   * STABLE   — `accident_can_fully_close` and `_acc_to_ts` ONLY: they read the
--     clock via now() (when p_now is not supplied) and the session timezone/
--     DateStyle via a timestamptz cast, so they are STABLE, never IMMUTABLE.
--     Pass p_now explicitly to make a run fully deterministic.
--   NOTE (constant-folding trap): because the pure functions are IMMUTABLE, a
--   benchmark with CONSTANT arguments folds to a single evaluation and reports ~0.
--   Benchmark them with a non-constant input (e.g. a column) or they lie.
--
-- search_path is PINNED to 'public' on every function (V398/V367 convention), so a
-- malicious search_path cannot shadow gen_random_uuid / cast operators / helpers.
--
-- ROLLBACK (if ever applied): every object here is CREATE OR REPLACE / additive.
--   drop function if exists
--     public.accident_can_fully_close(jsonb,jsonb,text,jsonb,timestamptz),
--     public.accident_closure_blockers(jsonb,jsonb,text,jsonb),
--     public.accident_closure_level(jsonb,jsonb,text,jsonb),
--     public.accident_derive_case_status(jsonb,jsonb,text,jsonb),
--     public.accident_completeness(jsonb,jsonb,text,jsonb),
--     public.accident_required_workstreams(text,jsonb,jsonb),
--     public.accident_build_case_route(jsonb,jsonb),
--     public.accident_can_transition(text,text),
--     public.accident_allowed_transitions(text),
--     public.accident_workstream_status(text,jsonb,jsonb),
--     public.accident_workstream_satisfied(text),
--     public.accident_na_envelope_valid(jsonb,boolean),
--     ... and the accident_*/ _acc_* helpers below (full list at the tail).
-- =============================================================================

-- A migration file would open a transaction; kept commented since THIS IS NOT
-- APPLIED. `check_function_bodies=off` lets SQL-language bodies reference helpers
-- created later in the same script (plpgsql bodies are validated lazily anyway).
-- begin;
-- set local check_function_bodies = off;

-- =============================================================================
-- CONSTANTS (mirror the frozen JS enums — CHANGE BOTH SIDES TOGETHER)
-- =============================================================================
-- WORKSTREAM_KEYS (accidentCase.WORKSTREAMS[].key) — the ten canonical keys:
--   incident_evidence, fleet_validation, liability, insurance, assessment,
--   repair, workshop_qc, handover, finance, corrective
-- WORKSTREAM_STATUS_TOKENS (accidentCase.WORKSTREAM_STATUS) — twelve:
--   not_required, not_started, assigned, in_progress, waiting_info,
--   waiting_approval, waiting_external, on_hold, completed, rejected,
--   reopened, cancelled
-- WORKSTREAM_SATISFIED (accidentCase.WORKSTREAM_SATISFIED): completed |
--   not_required | cancelled  (everything else BLOCKS completion)
-- NON_WAIVABLE (accidentCase.NON_WAIVABLE): incident_evidence | liability | finance
--   — the spine of the case; a NON_WAIVABLE workstream is NEVER satisfied by a
--   Not-Applicable waiver, approved or not (encoded in _acc_closure_satisfied).
-- DIMENSIONS (accidentCase.DIMENSIONS): incident, insurance, repair, financial
-- closure_level tokens (accidentCase.closureLevel return):
--   NULL (open) | financially_open | operationally_completed | fully_closed
--   ^ see PARITY NOTE [D2]: JS returns NULL for "open" and 'financially_open';
--     the accidents.closure_level column stores 'open' for NULL and (in the
--     reconciled 02_DATA_MODEL.sql) 'financially_open'. accident_closure_reviews
--     .level still lists 'financially_pending' — a schema divergence to resolve.
-- CASE_STATUSES (accidentCase.CASE_STATUSES) — thirty tokens, see
--   accident_case_status_tokens() below.

create or replace function public.accident_workstream_keys()
returns text[] language sql immutable set search_path to 'public' as $$
  select array['incident_evidence','fleet_validation','liability','insurance',
               'assessment','repair','workshop_qc','handover','finance','corrective'];
$$;

create or replace function public.accident_workstream_status_tokens()
returns text[] language sql immutable set search_path to 'public' as $$
  select array['not_required','not_started','assigned','in_progress','waiting_info',
               'waiting_approval','waiting_external','on_hold','completed','rejected',
               'reopened','cancelled'];
$$;

create or replace function public.accident_case_status_tokens()
returns text[] language sql immutable set search_path to 'public' as $$
  select array['draft','submitted','evidence_incomplete','under_fleet_validation',
    'liability_assessment','insurance_review','claim_registration_pending',
    'awaiting_insurer_response','technical_assessment','repair_decision_pending',
    'repair_planning','awaiting_fleet_approval','awaiting_parts','awaiting_quotation',
    'awaiting_po','awaiting_external_workshop','repair_in_progress',
    'workshop_quality_inspection','fleet_inspection','rectification_required',
    'operationally_completed','insurance_settlement_pending','financial_closure_pending',
    'corrective_actions_pending','closure_review','closed','reopened',
    'cancelled_duplicate','total_loss_processing','legal_hold'];
$$;

-- Pipeline order (accidentCase.PIPELINE_ORDER) — drives the earliest-blocker walk.
create or replace function public.accident_pipeline_order()
returns text[] language sql immutable set search_path to 'public' as $$
  select array['incident_evidence','fleet_validation','liability','insurance',
               'assessment','repair','workshop_qc','handover','finance','corrective'];
$$;

-- workstream key -> owning 12-stage ledger stage (accidentCase.WORKSTREAM_STAGE).
-- Also the WORKSTREAM_BY_KEY membership test: a non-key returns NULL.
create or replace function public.accident_workstream_stage(p_ws_key text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_ws_key
    when 'incident_evidence' then 'reported'
    when 'fleet_validation'  then 'initial_review'
    when 'liability'         then 'hse_investigation'
    when 'insurance'         then 'insurance_claim'
    when 'assessment'        then 'workshop_assessment'
    when 'repair'            then 'repair_in_progress'
    when 'workshop_qc'       then 'final_inspection'
    when 'handover'          then 'vehicle_release'
    when 'finance'           then 'cost_recovery'
    when 'corrective'        then 'hse_investigation'
    else null end;
$$;

-- workstream key -> completeness dimension (accidentCase.DIMENSION_OF).
create or replace function public.accident_workstream_dimension(p_ws_key text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_ws_key
    when 'incident_evidence' then 'incident'
    when 'fleet_validation'  then 'incident'
    when 'liability'         then 'incident'
    when 'corrective'        then 'incident'
    when 'insurance'         then 'insurance'
    when 'assessment'        then 'repair'
    when 'repair'            then 'repair'
    when 'workshop_qc'       then 'repair'
    when 'handover'          then 'repair'
    when 'finance'           then 'financial'
    else null end;
$$;

-- workstream key -> human name (accidentCase.WORKSTREAMS[].name), used in blockers.
create or replace function public.accident_workstream_name(p_ws_key text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_ws_key
    when 'incident_evidence' then 'Incident & Evidence'
    when 'fleet_validation'  then 'Fleet Validation'
    when 'liability'         then 'Safety & Liability'
    when 'insurance'         then 'Insurance & Claim'
    when 'assessment'        then 'Technical Assessment'
    when 'repair'            then 'Repair'
    when 'workshop_qc'       then 'Workshop Quality Control'
    when 'handover'          then 'Fleet Handover'
    when 'finance'           then 'Finance & Settlement'
    when 'corrective'        then 'Corrective Actions'
    else p_ws_key end;
$$;

-- case_status token -> parent workflow_stage (accidentCase.CASE_STATUS_STAGE).
-- legal_hold / reopened -> NULL (keep the previous stage frozen).
create or replace function public.accident_case_status_stage(p_token text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_token
    when 'draft' then 'reported' when 'submitted' then 'reported'
    when 'evidence_incomplete' then 'reported'
    when 'under_fleet_validation' then 'initial_review'
    when 'liability_assessment' then 'hse_investigation'
    when 'insurance_review' then 'insurance_claim'
    when 'claim_registration_pending' then 'insurance_claim'
    when 'awaiting_insurer_response' then 'insurance_claim'
    when 'technical_assessment' then 'workshop_assessment'
    when 'repair_decision_pending' then 'repair_approval'
    when 'repair_planning' then 'repair_approval'
    when 'awaiting_fleet_approval' then 'repair_approval'
    when 'awaiting_parts' then 'repair_approval'
    when 'awaiting_quotation' then 'repair_approval'
    when 'awaiting_po' then 'repair_approval'
    when 'awaiting_external_workshop' then 'repair_approval'
    when 'repair_in_progress' then 'repair_in_progress'
    when 'workshop_quality_inspection' then 'repair_in_progress'
    when 'fleet_inspection' then 'final_inspection'
    when 'rectification_required' then 'final_inspection'
    when 'operationally_completed' then 'vehicle_release'
    when 'insurance_settlement_pending' then 'cost_recovery'
    when 'financial_closure_pending' then 'cost_recovery'
    when 'corrective_actions_pending' then 'cost_recovery'
    when 'closure_review' then 'closed' when 'closed' then 'closed'
    when 'cancelled_duplicate' then 'cancelled'
    when 'total_loss_processing' then 'insurance_claim'
    when 'legal_hold' then null when 'reopened' then null
    else null end;
$$;

-- =============================================================================
-- 0. SCALAR HELPERS — faithful mirrors of the tiny JS coercers (lines 36-40)
-- =============================================================================
-- These carry the load-bearing edge cases; get them wrong and every decision
-- above silently drifts. All IMMUTABLE.

-- num(v): null/undefined -> null; a string that trims to '' (blank/whitespace) ->
-- null; else Number.isFinite(Number(v)) ? Number(v) : null.
-- KEY DISTINCTION mirrored: BOTH an ABSENT record key (JS undefined) AND a PRESENT
-- JSON null map to NULL. The JS `if (v == null) return null` guard catches undefined
-- and null alike, so num(null) returns NULL, NOT 0. In jsonb that is SQL NULL when
-- the key is absent AND jsonb 'null' when present -> both return NULL here. A
-- blank/whitespace string returns NULL too (the JS `v.trim() === ''` guard). For a
-- non-blank string, Number('12abc') = NaN -> null. (Divergence, documented: JS
-- Number() also accepts '0x1A'/'Infinity'; this regex does not — vanishingly rare
-- in case data.)
create or replace function public._acc_num(v jsonb)
returns numeric language sql immutable set search_path to 'public' as $$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'null'    then null            -- JS num(null) -> null (v == null guard)
    when jsonb_typeof(v) = 'number'  then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'boolean' then case when v = 'true'::jsonb then 1 else 0 end
    when jsonb_typeof(v) = 'string'  then
      case when btrim(v #>> '{}') = '' then null          -- blank/whitespace -> null
           when btrim(v #>> '{}') ~ '^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$'
                then btrim(v #>> '{}')::numeric
           else null end
    else null end;
$$;

-- str(v): v == null ? '' : String(v).trim(). Scalars only (objects/arrays -> ''
-- here, whereas JS String({})='[object Object]'; str() is only applied to scalar
-- case fields, so this is safe — see PARITY NOTE [E1]).
create or replace function public._acc_str(v jsonb)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when v is null then ''
    when jsonb_typeof(v) = 'null' then ''
    else coalesce(btrim(v #>> '{}'), '') end;
$$;

-- truthy(v): v === true || v === 1 || TRUTHY_TOKENS.has(str(v).toLowerCase()), where
-- TRUTHY_TOKENS = {true, t, yes, y, 1}. ERP feeds carry boolean-ish text ('Yes',
-- 'Y', 'TRUE'), so the whole family is accepted case-insensitively (str() also
-- trims, hence btrim). Boolean false, string 'false'/'no', number 2 stay falsy.
create or replace function public._acc_truthy(v jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select v is not null and (
       v = 'true'::jsonb
    or (jsonb_typeof(v) = 'string' and lower(btrim(v #>> '{}')) in ('true','t','yes','y','1'))
    or (jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = 1)
  );
$$;

-- General JS truthiness (for the `||` coalescing in naEnvelopeFor): falsy are
-- false / 0 / '' / null / undefined. Objects & arrays are truthy (even {} / []).
create or replace function public._acc_truthy_json(v jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select v is not null
     and jsonb_typeof(v) <> 'null'
     and not (jsonb_typeof(v) = 'boolean' and v = 'false'::jsonb)
     and not (jsonb_typeof(v) = 'string'  and (v #>> '{}') = '')
     and not (jsonb_typeof(v) = 'number'  and (v #>> '{}')::numeric = 0);
$$;

-- "present" = JS `!= null` (excludes SQL-absent AND jsonb null).
create or replace function public._acc_present(v jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select v is not null and jsonb_typeof(v) <> 'null';
$$;

-- Safe timestamptz parse for the overdue-task check. Returns NULL on empty /
-- unparseable, mirroring `Number.isFinite(new Date(x).getTime())`. STABLE (the
-- timestamptz cast depends on session TimeZone/DateStyle) — this is the reason
-- accident_can_fully_close is STABLE, not IMMUTABLE.
create or replace function public._acc_to_ts(v jsonb)
returns timestamptz language plpgsql stable set search_path to 'public' as $$
declare t text := public._acc_str(v);
begin
  if t = '' then return null; end if;
  return t::timestamptz;
exception when others then
  return null;
end;
$$;

-- append-if-absent (Set semantics for requiredWorkstreams).
create or replace function public._acc_arr_add(p_arr text[], p_elem text)
returns text[] language sql immutable set search_path to 'public' as $$
  select case when p_elem = any(coalesce(p_arr,'{}')) then p_arr else array_append(p_arr, p_elem) end;
$$;

-- =============================================================================
-- 1. fieldFilled + stageCompletion (mirrors accidentStages.js, which
--    accidentCase.workstreamStatus reuses via stageCompletion)
-- =============================================================================
-- fieldFilled(record, field) — accidentStages.js lines 40-50. Money must be
-- NON-ZERO to count (parts_cost is 0.00 on every live row; a null check would
-- mark the cost side complete while it contributes nothing).
create or replace function public._acc_field_filled(p_case jsonb, p_key text,
                                                    p_money boolean default false,
                                                    p_kind text default null)
returns boolean language sql immutable set search_path to 'public' as $$
  select case
    when p_money then (public._acc_num(p_case -> p_key) is not null
                       and public._acc_num(p_case -> p_key) <> 0)
    when p_kind = 'bool' then jsonb_typeof(p_case -> p_key) = 'boolean'
    when jsonb_typeof(p_case -> p_key) = 'array'  then jsonb_array_length(p_case -> p_key) > 0
    when jsonb_typeof(p_case -> p_key) = 'object' then
         (select count(*) from jsonb_object_keys(p_case -> p_key)) > 0
    else public._acc_str(p_case -> p_key) <> ''
  end;
$$;

-- STAGE_FIELDS[stage].required (accidentStages.js lines 61-191). Only the REQUIRED
-- fields matter here (stageCompletion counts required only). None of the required
-- fields are kind:'bool', so only the money flag is carried.
create or replace function public._acc_stage_required(p_stage text)
returns table(field_key text, is_money boolean)
language sql immutable set search_path to 'public' as $$
  select f.field_key, f.is_money from (values
    ('reported','incident_date',false),
    ('reported','asset_no',false),
    ('reported','site',false),
    ('reported','description',false),
    ('initial_review','responsible_owner_id',false),
    ('initial_review','target_date',false),
    ('hse_investigation','root_cause',false),
    ('hse_investigation','corrective_action',false),
    ('workshop_assessment','estimated_damage_cost',true),
    ('workshop_assessment','repair_type',false),
    ('insurance_claim','insurer',false),
    ('insurance_claim','claim_amount',true),
    ('repair_approval','approved_repair_amount',true),
    ('repair_approval','estimate_approved_by',false),
    ('repair_in_progress','repair_cost',true),
    ('final_inspection','closure_evidence',false),
    ('vehicle_release','release_date',false),
    ('cost_recovery','recovered_amount',true),
    ('cost_recovery','recovery_status',false),
    ('closed','closure_evidence',false)
    -- 'cancelled' has no required fields (total 0 -> not_required); unknown stage
    -- likewise returns no rows -> total 0.
  ) f(stage, field_key, is_money)
  where f.stage = p_stage;
$$;

-- stageCompletion(record, stage) — only {total, filled, complete} are needed by
-- workstreamStatus. complete = total > 0 AND missing == 0 (accidentStages.js L288).
create or replace function public._acc_stage_completion(p_case jsonb, p_stage text)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare v_total int := 0; v_filled int := 0; r record;
begin
  for r in select field_key, is_money from public._acc_stage_required(p_stage) loop
    v_total := v_total + 1;
    if public._acc_field_filled(p_case, r.field_key, r.is_money, null) then
      v_filled := v_filled + 1;
    end if;
  end loop;
  return jsonb_build_object('total', v_total, 'filled', v_filled,
                            'complete', (v_total > 0 and v_filled = v_total));
end;
$$;

-- =============================================================================
-- 2. WORKSTREAM STATUS + SATISFIED  (accidentCase.js §1)
-- =============================================================================
-- first explicit accident_case_workstreams row for a key (matches on 'workstream'
-- OR 'key', array order preserved — accidentCase.workstreamStatus L125-128).
create or replace function public._acc_first_ws_row(p_rows jsonb, p_ws_key text)
returns jsonb language sql immutable set search_path to 'public' as $$
  select value
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) with ordinality as t(value, ord)
  where value ->> 'workstream' = p_ws_key or value ->> 'key' = p_ws_key
  order by ord
  limit 1;
$$;

-- workstreamStatus(record, workstream, rows) — accidentCase.js L124-136.
-- Explicit team-set row (with a non-empty status) WINS; else derive from the
-- owning stage's required-field coverage.
create or replace function public.accident_workstream_status(p_ws_key text, p_case jsonb,
                                                             p_rows jsonb default '[]'::jsonb)
returns text language plpgsql immutable set search_path to 'public' as $$
declare v_row jsonb; v_stage text; v_c jsonb;
begin
  v_row := public._acc_first_ws_row(p_rows, p_ws_key);
  if v_row is not null and public._acc_str(v_row -> 'status') <> '' then
    return public._acc_str(v_row -> 'status');          -- team-set truth
  end if;

  v_stage := public.accident_workstream_stage(p_ws_key);
  if v_stage is null then return 'not_required'; end if; -- unknown key

  v_c := public._acc_stage_completion(p_case, v_stage);
  if (v_c ->> 'total')::int = 0 then return 'not_required'; end if;
  if (v_c ->> 'complete')::boolean then return 'completed'; end if;
  return case when (v_c ->> 'filled')::int > 0 then 'in_progress' else 'not_started' end;
end;
$$;

-- WORKSTREAM_SATISFIED.has(str(status)) — accidentCase.js L108-109.
create or replace function public.accident_workstream_satisfied(p_status text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(btrim(p_status),'') = any(array['completed','not_required','cancelled']);
$$;

-- =============================================================================
-- 3. NOT-APPLICABLE ENVELOPE  (accidentCase.js §2)
-- =============================================================================
-- naEnvelopeValid(entry, {requireApproval}) — L153-160. Must carry reason + by +
-- at (+ approved_by where the route demands it). A bare switch-off never satisfies.
create or replace function public.accident_na_envelope_valid(p_entry jsonb,
                                                             p_require_approval boolean default false)
returns boolean language sql immutable set search_path to 'public' as $$
  select p_entry is not null
     and jsonb_typeof(p_entry) = 'object'
     and public._acc_str(p_entry -> 'reason') <> ''
     and public._acc_str(p_entry -> 'by')     <> ''
     and public._acc_str(p_entry -> 'at')     <> ''
     and (not p_require_approval or public._acc_str(p_entry -> 'approved_by') <> '');
$$;

-- naEnvelopeFor(record, workstream, rows) — L164-172. Explicit row's na_reason||na
-- first (JS `||` truthiness), else accidents.stage_waivers[stage].
create or replace function public._acc_na_envelope_for(p_case jsonb, p_ws_key text, p_rows jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare v_row jsonb; v_nr jsonb; v_na jsonb; v_stage text;
begin
  v_row := public._acc_first_ws_row(p_rows, p_ws_key);
  if v_row is not null then
    v_nr := v_row -> 'na_reason';
    v_na := v_row -> 'na';
    if public._acc_truthy_json(v_nr) or public._acc_truthy_json(v_na) then
      return case when public._acc_truthy_json(v_nr) then v_nr else v_na end;
    end if;
  end if;
  v_stage := public.accident_workstream_stage(p_ws_key);
  if v_stage is null then return null; end if;
  return p_case #> array['stage_waivers', v_stage];   -- jsonb or NULL
end;
$$;

-- markedNA(record, rows, workstream, {requireApproval}) — L182-184.
create or replace function public._acc_marked_na(p_case jsonb, p_rows jsonb, p_ws_key text,
                                                 p_require_approval boolean default false)
returns boolean language sql immutable set search_path to 'public' as $$
  select public.accident_na_envelope_valid(
           public._acc_na_envelope_for(p_case, p_ws_key, p_rows), p_require_approval);
$$;

-- =============================================================================
-- 4. ROUTE PREDICATES + buildCaseRoute + requiredWorkstreams  (accidentCase.js §3)
-- =============================================================================
-- repairOccurred(record) — L191-198. Order is load-bearing.
create or replace function public.accident_repair_occurred(p_case jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare rt text := lower(public._acc_str(p_case -> 'repair_type'));
begin
  if public._acc_truthy(p_case -> 'no_repair')
     or rt in ('none','no repair','temporary') then return false; end if;
  if rt in ('internal','external') then return true; end if;
  if coalesce(public._acc_num(p_case -> 'repair_cost'), 0) > 0 then return true; end if;
  if coalesce(public._acc_num(p_case -> 'approved_repair_amount'), 0) > 0 then return true; end if;
  return public._acc_truthy(p_case -> 'repair_started');
end;
$$;

-- correctiveRequired(record) — L201-204.
create or replace function public.accident_corrective_required(p_case jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select public._acc_truthy(p_case -> 'corrective_action_required')
      or public._acc_truthy(p_case -> 'injuries')
      or coalesce(public._acc_num(p_case -> 'injury_count'), 0) > 0;
$$;

-- insuranceInvolved(r) — L265-269.
create or replace function public.accident_insurance_involved(p_case jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
begin
  if (p_case -> 'insurance_involved') = 'false'::jsonb then return false; end if;   -- === false
  if public._acc_truthy(p_case -> 'insurance_involved') then return true; end if;
  return public._acc_str(p_case -> 'insurer') <> ''
      or public._acc_str(p_case -> 'policy_no') <> ''
      or coalesce(public._acc_num(p_case -> 'claim_amount'), 0) > 0;
end;
$$;

-- isInjury(r) — L260-263.
create or replace function public.accident_is_injury(p_case jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select public._acc_truthy(p_case -> 'injuries')
      or coalesce(public._acc_num(p_case -> 'injury_count'), 0) > 0
      or public._acc_str(p_case -> 'accident_type') ~* 'injur|fatal';
$$;

-- isTotalLoss(r) — L255-259.
create or replace function public.accident_is_total_loss(p_case jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select public._acc_truthy(p_case -> 'total_loss_route')
      or public._acc_truthy(p_case -> 'total_loss')
      or public._acc_truthy(p_case -> 'total_loss_possibility')
      or lower(public._acc_str(p_case -> 'repair_type')) = 'total loss'
      or public._acc_str(p_case -> 'accident_type') ~* 'total.?loss';
$$;

-- isMinorSeverity(r) — L270-273.
create or replace function public.accident_is_minor_severity(p_case jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select lower(public._acc_str(p_case -> 'severity')) in ('minor','low','small');
$$;

-- eq(col, val) inside ruleMatches — L278-282. Unset (null / '' / []) = wildcard.
create or replace function public._acc_rule_eq(p_col jsonb, p_val jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
begin
  if p_col is null or jsonb_typeof(p_col) = 'null' then return true; end if;
  if jsonb_typeof(p_col) = 'string' and public._acc_str(p_col) = '' then return true; end if;
  if jsonb_typeof(p_col) = 'array'  and jsonb_array_length(p_col) = 0 then return true; end if;
  if jsonb_typeof(p_col) = 'array' then
    return public._acc_str(p_val) in (select public._acc_str(e) from jsonb_array_elements(p_col) e);
  end if;
  return public._acc_str(p_col) = public._acc_str(p_val);
end;
$$;

-- ruleMatches(rule, record) — L276-291.
create or replace function public.accident_rule_matches(p_rule jsonb, p_case jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
begin
  if p_rule is null then return false; end if;
  if (p_rule -> 'active') = 'false'::jsonb then return false; end if;   -- active === false
  if not public._acc_rule_eq(p_rule -> 'country',       p_case -> 'country')       then return false; end if;
  if not public._acc_rule_eq(p_rule -> 'accident_type', p_case -> 'accident_type') then return false; end if;
  if not public._acc_rule_eq(p_rule -> 'severity',      p_case -> 'severity')      then return false; end if;
  if not public._acc_rule_eq(p_rule -> 'vehicle_type',  p_case -> 'vehicle_type')  then return false; end if;
  if public._acc_present(p_rule -> 'insurance_involved')
     and (public._acc_truthy(p_rule -> 'insurance_involved') <> public.accident_insurance_involved(p_case))
     then return false; end if;
  if public._acc_present(p_rule -> 'injury_involved')
     and (public._acc_truthy(p_rule -> 'injury_involved') <> public.accident_is_injury(p_case))
     then return false; end if;
  if public._acc_present(p_rule -> 'third_party_involved')
     and (public._acc_truthy(p_rule -> 'third_party_involved') <> public._acc_truthy(p_case -> 'third_party_involved'))
     then return false; end if;
  return true;
end;
$$;

-- buildCaseRoute(record, ruleProfiles) — L306-326. Config rule (lowest priority
-- integer, first on ties) wins; else the deterministic fallback classifier.
-- Returns { key, source: 'rule'|'fallback', profile }.
create or replace function public.accident_build_case_route(p_case jsonb,
                                                            p_rules jsonb default '[]'::jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare r jsonb; v_best jsonb := null; v_best_pri numeric := null; v_pri numeric; v_key text;
begin
  for r in select value from jsonb_array_elements(coalesce(p_rules,'[]'::jsonb)) loop
    if public.accident_rule_matches(r, p_case) then
      v_pri := coalesce(public._acc_num(r -> 'priority'), 1e9);
      if v_best is null or v_pri < v_best_pri then   -- strict < keeps the first on a tie
        v_best := r; v_best_pri := v_pri;
      end if;
    end if;
  end loop;

  if v_best is not null then
    return jsonb_build_object(
      'key', coalesce(nullif(public._acc_str(v_best -> 'route_key'), ''), 'standard'),
      'source', 'rule', 'profile', v_best);
  end if;

  -- Fallback classifier. Deliberate order: total loss removes the whole repair
  -- path (decided first); then injury; then insurance (split on repair_type);
  -- then a genuinely minor uninsured case; else standard.
  v_key := 'standard';
  if public.accident_is_total_loss(p_case) then v_key := 'total_loss';
  elsif public.accident_is_injury(p_case) then v_key := 'injury';
  elsif public.accident_insurance_involved(p_case) then
    v_key := case when lower(public._acc_str(p_case -> 'repair_type')) = 'external'
                  then 'external_repair_insurance' else 'internal_repair_insurance' end;
  elsif public.accident_is_minor_severity(p_case) then v_key := 'minor_no_insurance';
  end if;
  return jsonb_build_object('key', v_key, 'source', 'fallback', 'profile', null);
end;
$$;

-- requiredWorkstreams(route, record) — L348-355, with resolveRoute (L330-340).
-- A config profile's required_workstreams is used VERBATIM (no conditionals);
-- otherwise the core route's base set + conditionals resolved against the case.
-- Unknown route keys resolve to 'standard' (resolveRoute fallback).
create or replace function public.accident_required_workstreams(p_route text, p_case jsonb,
                                                                p_profile jsonb default null)
returns text[] language plpgsql immutable set search_path to 'public' as $$
declare v_route text; v_req text[];
begin
  -- Config profile with an explicit list wins (filtered to valid workstream keys).
  if p_profile is not null and (p_profile ? 'required_workstreams')
     and jsonb_typeof(p_profile -> 'required_workstreams') = 'array' then
    return array(
      select k from jsonb_array_elements_text(p_profile -> 'required_workstreams') as k
      where public.accident_workstream_stage(k) is not null   -- WORKSTREAM_BY_KEY membership
    );
  end if;

  v_route := coalesce(nullif(btrim(p_route), ''), 'standard');
  if v_route not in ('standard','minor_no_insurance','internal_repair_insurance',
                     'external_repair_insurance','total_loss','injury') then
    v_route := 'standard';                                     -- resolveRoute fallback
  end if;

  v_req := case v_route
    when 'minor_no_insurance' then
      array['incident_evidence','fleet_validation','liability','assessment','repair','handover','finance']
    when 'internal_repair_insurance' then
      array['incident_evidence','fleet_validation','liability','insurance','assessment','repair','workshop_qc','handover','finance']
    when 'external_repair_insurance' then
      array['incident_evidence','fleet_validation','liability','insurance','assessment','repair','workshop_qc','handover','finance']
    when 'total_loss' then
      array['incident_evidence','fleet_validation','liability','insurance','assessment','finance']
    when 'injury' then
      array['incident_evidence','fleet_validation','liability','insurance','corrective','finance']
    else -- standard
      array['incident_evidence','fleet_validation','liability','assessment','repair','handover','finance']
  end;

  -- Conditionals (CASE_ROUTES[*].conditional), resolved against the record.
  if v_route = 'standard' and public.accident_repair_occurred(p_case) then
    v_req := public._acc_arr_add(v_req, 'workshop_qc');
  end if;
  if v_route in ('standard','minor_no_insurance','internal_repair_insurance',
                 'external_repair_insurance','total_loss')
     and public.accident_corrective_required(p_case) then
    v_req := public._acc_arr_add(v_req, 'corrective');
  end if;
  if v_route = 'injury' and public.accident_repair_occurred(p_case) then
    v_req := public._acc_arr_add(v_req, 'assessment');
    v_req := public._acc_arr_add(v_req, 'repair');
    v_req := public._acc_arr_add(v_req, 'workshop_qc');
    v_req := public._acc_arr_add(v_req, 'handover');
  end if;
  return v_req;
end;
$$;

-- =============================================================================
-- 5. COMPLETENESS  (accidentCase.js §4)
-- =============================================================================
-- scored(record, rows, ws) — L368-375. Scoring-grade satisfaction: completed, OR
-- NA-with-reason (no approval required at scoring grade).
create or replace function public._acc_scored(p_case jsonb, p_rows jsonb, p_ws_key text)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare v_status text := public.accident_workstream_status(p_ws_key, p_case, p_rows);
begin
  if v_status = 'completed' then return true; end if;
  if v_status in ('not_required','cancelled') then
    return public._acc_marked_na(p_case, p_rows, p_ws_key, false);
  end if;
  return false;
end;
$$;

-- completeness(record, wsRows, route) — L391-413. Five percentages from REQUIRED
-- workstreams only; a dimension with no required items returns NULL (never 100).
-- p_route NULL / '' resolves to 'standard' (resolveRoute(null) == standard).
create or replace function public.accident_completeness(p_case jsonb,
                                                        p_ws jsonb default '[]'::jsonb,
                                                        p_route text default null,
                                                        p_profile jsonb default null)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare
  v_req text[] := public.accident_required_workstreams(p_route, p_case, p_profile);
  ws text; dim text; ok boolean;
  ri int:=0; si int:=0; rin int:=0; sin int:=0; rr int:=0; sr int:=0; rf int:=0; sf int:=0;
begin
  foreach ws in array coalesce(v_req,'{}') loop
    dim := public.accident_workstream_dimension(ws);
    if dim is null then continue; end if;                 -- if (!per[dim]) continue
    ok := public._acc_scored(p_case, p_ws, ws);
    if    dim = 'incident'  then ri  := ri +1; if ok then si  := si +1; end if;
    elsif dim = 'insurance' then rin := rin+1; if ok then sin := sin+1; end if;
    elsif dim = 'repair'    then rr  := rr +1; if ok then sr  := sr +1; end if;
    elsif dim = 'financial' then rf  := rf +1; if ok then sf  := sf +1; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'incident',  case when ri  = 0 then null else round(100.0 * si  / ri )::int end,
    'insurance', case when rin = 0 then null else round(100.0 * sin / rin)::int end,
    'repair',    case when rr  = 0 then null else round(100.0 * sr  / rr )::int end,
    'financial', case when rf  = 0 then null else round(100.0 * sf  / rf )::int end,
    'overall',   case when (ri+rin+rr+rf) = 0 then null
                      else round(100.0 * (si+sin+sr+sf) / (ri+rin+rr+rf))::int end
  );
  -- round() is half-away-from-zero; Math.round is half-up; identical for the
  -- non-negative values here (0.5 -> 1). See PARITY NOTE [C1].
end;
$$;

-- =============================================================================
-- 6. CLOSURE GATE  (accidentCase.js §5)
-- =============================================================================
-- closureGradeSatisfied(record, rows, ws, route) — accidentCase.js closureGrade-
-- Satisfied. Stricter than scored: completed OR formally NA (valid envelope, and
-- approved where the route demands it). Two guards a bare
-- `profile?.na_requires_approval` read missed, both mirrored here:
--   * A NON_WAIVABLE workstream (incident_evidence / liability / finance — the spine
--     of the case) is NEVER satisfied by NA, approved or not.
--   * A fallback / core route has NO profile, so `na_requires_approval` was
--     undefined (falsy) and an NA would waive a mandatory workstream with just a
--     bare reason. Absent a profile, approval is REQUIRED (default true), not waived
--     -> `p_profile is null` maps to requireApproval = true (not the truthy() of a
--     missing key, which is false).
create or replace function public._acc_closure_satisfied(p_case jsonb, p_rows jsonb,
                                                         p_ws_key text, p_profile jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare v_status text := public.accident_workstream_status(p_ws_key, p_case, p_rows);
        v_req_appr boolean;
begin
  if v_status = 'completed' then return true; end if;
  if v_status in ('not_required','cancelled') then
    -- NON_WAIVABLE = {incident_evidence, liability, finance}: never satisfied by NA.
    if p_ws_key in ('incident_evidence','liability','finance') then return false; end if;
    -- profile ? truthy(profile.na_requires_approval) : true — NULL profile -> true.
    v_req_appr := case when p_profile is null then true
                       else public._acc_truthy(p_profile -> 'na_requires_approval') end;
    return public._acc_marked_na(p_case, p_rows, p_ws_key, v_req_appr);
  end if;
  return false;
end;
$$;

-- isClosedCase(record) — L460-463: lower(case_status || status) === 'closed'.
create or replace function public._acc_is_closed_case(p_case jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select lower(case when public._acc_str(p_case -> 'case_status') <> ''
                    then public._acc_str(p_case -> 'case_status')
                    else public._acc_str(p_case -> 'status') end) = 'closed';
$$;

-- closureReviewApproved(record) — L464-466.
create or replace function public._acc_closure_review_approved(p_case jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select public._acc_truthy(p_case -> 'closure_review_approved')
      or public._acc_str(p_case -> 'closure_approved_by') <> '';
$$;

-- operationallyComplete — L473-486. incident+repair dimensions satisfied, EXCEPT
-- corrective (a settlement-phase control that may lag operational completion).
create or replace function public.accident_operationally_complete(p_case jsonb, p_ws jsonb,
                                                                  p_required text[], p_profile jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare ws text; dim text;
begin
  foreach ws in array coalesce(p_required,'{}') loop
    dim := public.accident_workstream_dimension(ws);
    if dim in ('incident','repair') then
      if ws = 'corrective' then continue; end if;
      if not public._acc_closure_satisfied(p_case, p_ws, ws, p_profile) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

-- financiallyComplete — L487-496.
create or replace function public.accident_financially_complete(p_case jsonb, p_ws jsonb,
                                                                p_required text[], p_profile jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare ws text;
begin
  foreach ws in array coalesce(p_required,'{}') loop
    if public.accident_workstream_dimension(ws) in ('insurance','financial') then
      if not public._acc_closure_satisfied(p_case, p_ws, ws, p_profile) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

-- correctiveComplete — L497-501.
create or replace function public.accident_corrective_complete(p_case jsonb, p_ws jsonb,
                                                               p_required text[], p_profile jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select case when 'corrective' <> all(coalesce(p_required,'{}')) then true
              else public._acc_closure_satisfied(p_case, p_ws, 'corrective', p_profile) end;
$$;

-- closureLevel(record, wsRows, route) — L515-521.
--   NULL                      -> open (vehicle not yet back in service)
--   'financially_open'        -> operationally done, money/CA outstanding
--   'operationally_completed' -> done, awaiting closure-review sign-off
--   'fully_closed'            -> everything done + closure review approved
create or replace function public.accident_closure_level(p_case jsonb,
                                                         p_ws jsonb default '[]'::jsonb,
                                                         p_route text default null,
                                                         p_profile jsonb default null)
returns text language plpgsql immutable set search_path to 'public' as $$
declare v_req text[]; v_money_done boolean;
begin
  if public._acc_is_closed_case(p_case) then return 'fully_closed'; end if;
  v_req := public.accident_required_workstreams(p_route, p_case, p_profile);
  if not public.accident_operationally_complete(p_case, p_ws, v_req, p_profile) then
    return null;                                          -- open
  end if;
  v_money_done := public.accident_financially_complete(p_case, p_ws, v_req, p_profile)
              and public.accident_corrective_complete(p_case, p_ws, v_req, p_profile);
  if not v_money_done then return 'financially_open'; end if;
  return case when public._acc_closure_review_approved(p_case)
              then 'fully_closed' else 'operationally_completed' end;
end;
$$;

-- closureBlockers(record, wsRows, route) — L421-438. Required & NOT closure-grade
-- satisfied, in pipeline order. Each: { workstream, name, dimension, status, reason }.
create or replace function public.accident_closure_blockers(p_case jsonb,
                                                            p_ws jsonb default '[]'::jsonb,
                                                            p_route text default null,
                                                            p_profile jsonb default null)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare v_req text[] := public.accident_required_workstreams(p_route, p_case, p_profile);
        v_out jsonb := '[]'::jsonb; ws text; v_status text;
begin
  foreach ws in array coalesce(public.accident_pipeline_order(),'{}') loop
    if ws <> all(coalesce(v_req,'{}')) then continue; end if;
    if public._acc_closure_satisfied(p_case, p_ws, ws, p_profile) then continue; end if;
    v_status := public.accident_workstream_status(ws, p_case, p_ws);
    v_out := v_out || jsonb_build_object(
      'workstream', ws,
      'name', public.accident_workstream_name(ws),
      'dimension', public.accident_workstream_dimension(ws),
      'status', v_status,
      'reason', public.accident_workstream_name(ws) || ' is ' || replace(v_status, '_', ' '));
  end loop;
  return v_out;
end;
$$;

-- canFullyClose(record, wsRows, route, {now}) — L562-606. Returns {ok, blockers}
-- where ok is the exact §5.3 conjunction and blockers lists every failed clause.
-- STABLE: uses now() when p_now is NULL, and parses task due dates via a
-- timestamptz cast. Pass p_now for a deterministic result.
create or replace function public.accident_can_fully_close(p_case jsonb,
                                                           p_ws jsonb default '[]'::jsonb,
                                                           p_route text default null,
                                                           p_profile jsonb default null,
                                                           p_now timestamptz default null)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare
  v_req text[] := public.accident_required_workstreams(p_route, p_case, p_profile);
  v_block jsonb := '[]'::jsonb;
  v_now timestamptz := coalesce(p_now, now());
  ws text; v_status text;
  v_overdue int; v_pending int; v_have text[]; v_missing text[];
begin
  -- (a) every required workstream must be closure-grade satisfied — this single
  -- loop is the "no workstream remains open" clause plus every per-workstream
  -- clause of §5.3 (incident..corrective), walked in pipeline order.
  foreach ws in array coalesce(public.accident_pipeline_order(),'{}') loop
    if ws <> all(coalesce(v_req,'{}')) then continue; end if;
    if public._acc_closure_satisfied(p_case, p_ws, ws, p_profile) then continue; end if;
    v_status := public.accident_workstream_status(ws, p_case, p_ws);
    v_block := v_block || jsonb_build_object(
      'workstream', ws,
      'reason', public.accident_workstream_name(ws) || ' is not complete ('
                || replace(v_status, '_', ' ') || ')');
  end loop;

  -- Workshop QC is mandatory wherever a repair actually occurred (§8.3). When QC IS
  -- a required workstream it is already graded by the loop above; this guard catches
  -- the dangerous case where a repair happened but the route did NOT gate QC — a
  -- vehicle back in service without a quality sign-off. Mirrors accidentCase.js
  -- `if (repairOccurred(record) && !required.has('workshop_qc'))`.
  if public.accident_repair_occurred(p_case)
     and 'workshop_qc' <> all(coalesce(v_req,'{}')) then
    v_block := v_block || jsonb_build_object('check','workshop_qc',
      'reason','Workshop quality control required where repair occurred');
  end if;

  -- (b) meta gates.
  v_overdue := (
    select count(*) from jsonb_array_elements(
      case when jsonb_typeof(p_case -> 'tasks') = 'array' then p_case -> 'tasks' else '[]'::jsonb end) t
    where public._acc_truthy(t -> 'mandatory')
      and not (public._acc_truthy(t -> 'resolved')
               or lower(public._acc_str(t -> 'status')) in ('done','resolved'))
      and public._acc_to_ts(t -> 'due') is not null
      and public._acc_to_ts(t -> 'due') < v_now);
  if v_overdue > 0 then
    v_block := v_block || jsonb_build_object('check','mandatory_task',
      'reason', v_overdue || ' mandatory task(s) overdue and unresolved');
  end if;

  v_pending := case when jsonb_typeof(p_case -> 'pending_approvals') = 'array'
                    then jsonb_array_length(p_case -> 'pending_approvals') else 0 end;
  if v_pending = 0 then
    v_pending := (
      select count(*) from jsonb_array_elements(
        case when jsonb_typeof(p_case -> 'approvals') = 'array' then p_case -> 'approvals' else '[]'::jsonb end) a
      where lower(public._acc_str(a -> 'status')) = 'pending');
  end if;
  if v_pending > 0 then
    v_block := v_block || jsonb_build_object('check','pending_approval',
      'reason', v_pending || ' approval(s) still pending');
  end if;

  -- missingRequiredDocuments(record, route) — L538-545.
  if p_profile is not null and jsonb_typeof(p_profile -> 'required_documents') = 'array' then
    v_have := array(
      select case when jsonb_typeof(d) = 'string' then public._acc_str(d)
                  else public._acc_str(case when public._acc_truthy_json(d -> 'type') then d -> 'type'
                                            when public._acc_truthy_json(d -> 'key')  then d -> 'key'
                                            else d -> 'name' end) end
      from jsonb_array_elements(
        case when jsonb_typeof(p_case -> 'documents') = 'array' then p_case -> 'documents' else '[]'::jsonb end) d);
    v_missing := array(
      select nd from (
        select public._acc_str(x) nd from jsonb_array_elements(p_profile -> 'required_documents') x
      ) n where nd <> '' and nd <> all(coalesce(v_have,'{}')));
    if array_length(v_missing, 1) is not null then
      v_block := v_block || jsonb_build_object('check','required_document',
        'reason', 'Missing required document(s): ' || array_to_string(v_missing, ', '));
    end if;
  end if;

  if not public._acc_closure_review_approved(p_case) then
    v_block := v_block || jsonb_build_object('check','closure_review',
      'reason','Closure review not approved');
  end if;

  return jsonb_build_object('ok', jsonb_array_length(v_block) = 0, 'blockers', v_block);
end;
$$;

-- =============================================================================
-- 7. TRANSITION MACHINE  (accidentCase.js §6)
-- =============================================================================
-- Base transition targets per status (TRANSITION_ROWS, L662-705), as data.
create or replace function public._acc_transition_targets(p_from text)
returns text[] language sql immutable set search_path to 'public' as $$
  select case coalesce(btrim(p_from),'')
    when 'draft'                       then array['submitted','draft']
    when 'submitted'                   then array['evidence_incomplete','under_fleet_validation']
    when 'evidence_incomplete'         then array['submitted']
    when 'under_fleet_validation'      then array['evidence_incomplete','liability_assessment']
    when 'liability_assessment'        then array['insurance_review','technical_assessment']
    when 'insurance_review'            then array['claim_registration_pending','technical_assessment']
    when 'claim_registration_pending'  then array['awaiting_insurer_response']
    when 'awaiting_insurer_response'   then array['technical_assessment','awaiting_insurer_response']
    when 'technical_assessment'        then array['repair_decision_pending','total_loss_processing']
    when 'total_loss_processing'       then array['insurance_settlement_pending','financial_closure_pending']
    when 'repair_decision_pending'     then array['repair_planning','operationally_completed']
    when 'repair_planning'             then array['awaiting_fleet_approval']
    when 'awaiting_fleet_approval'     then array['awaiting_parts','awaiting_quotation','repair_in_progress']
    when 'awaiting_quotation'          then array['awaiting_po']
    when 'awaiting_po'                 then array['awaiting_external_workshop']
    when 'awaiting_parts'              then array['repair_in_progress']
    when 'awaiting_external_workshop'  then array['repair_in_progress']
    when 'repair_in_progress'          then array['workshop_quality_inspection']
    when 'workshop_quality_inspection' then array['fleet_inspection','repair_in_progress']
    when 'fleet_inspection'            then array['operationally_completed','rectification_required']
    when 'rectification_required'      then array['repair_in_progress']
    when 'operationally_completed'     then array['insurance_settlement_pending','financial_closure_pending','closure_review']
    when 'insurance_settlement_pending' then array['financial_closure_pending']
    when 'financial_closure_pending'   then array['corrective_actions_pending']
    when 'corrective_actions_pending'  then array['closure_review']
    when 'closure_review'              then array['closed']
    when 'closed'                      then array['reopened']
    when 'reopened'                    then array['technical_assessment']
    when 'legal_hold'                  then array['closure_review']
    else array[]::text[] end;
$$;

-- allowedTransitions(from) — L719-727. Base targets + the universal cancel /
-- legal-hold branches reachable from any NON-terminal state (closed and
-- cancelled_duplicate are terminal).
create or replace function public.accident_allowed_transitions(p_from text)
returns text[] language plpgsql immutable set search_path to 'public' as $$
declare v_from text := coalesce(btrim(p_from),''); v_out text[];
begin
  v_out := public._acc_transition_targets(v_from);
  if v_from <> all(array['closed','cancelled_duplicate']) then   -- not TERMINAL
    if v_from <> 'cancelled_duplicate' then v_out := public._acc_arr_add(v_out,'cancelled_duplicate'); end if;
    if v_from <> 'legal_hold'          then v_out := public._acc_arr_add(v_out,'legal_hold'); end if;
  end if;
  return v_out;
end;
$$;

-- canTransition(from, to) — L728-730.
create or replace function public.accident_can_transition(p_from text, p_to text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(btrim(p_to),'') = any(public.accident_allowed_transitions(p_from));
$$;

-- =============================================================================
-- 8. CASE-STATUS PROJECTION  (accidentCase.deriveCaseStatus, L760-799)
-- =============================================================================
-- CASE_STATUS_FOR[ws][status] || default — L737-747.
create or replace function public._acc_case_status_for(p_ws_key text, p_status text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_ws_key
    when 'fleet_validation' then 'under_fleet_validation'
    when 'liability'        then 'liability_assessment'
    when 'insurance' then case p_status
      when 'in_progress'      then 'insurance_review'
      when 'waiting_approval' then 'claim_registration_pending'
      when 'waiting_external' then 'awaiting_insurer_response'
      else 'insurance_review' end
    when 'assessment' then 'technical_assessment'
    when 'repair' then case p_status
      when 'in_progress'      then 'repair_in_progress'
      when 'waiting_approval' then 'awaiting_fleet_approval'
      when 'waiting_external' then 'awaiting_external_workshop'
      when 'waiting_info'     then 'awaiting_parts'
      else 'repair_decision_pending' end
    when 'workshop_qc' then 'workshop_quality_inspection'
    when 'handover'    then 'fleet_inspection'
    when 'finance'     then 'financial_closure_pending'
    when 'corrective'  then 'corrective_actions_pending'
    else null end;
$$;

-- deriveCaseStatus(record, wsRows, route) — the projection. Never written raw.
create or replace function public.accident_derive_case_status(p_case jsonb,
                                                              p_ws jsonb default '[]'::jsonb,
                                                              p_route text default null,
                                                              p_profile jsonb default null)
returns text language plpgsql immutable set search_path to 'public' as $$
declare v_req text[]; ws text; v_status text; v_m text;
begin
  -- 0. overrides win, and the TERMINAL states (closed / cancelled) take precedence
  -- over the cross-cutting projections (total_loss / reopened). A closed total-loss
  -- case is `closed`, not `total_loss_processing`; without this ordering the
  -- total_loss flag would drag a finished case back to a live stage. Order (mirrors
  -- accidentCase.deriveCaseStatus): legal_hold -> cancelled -> closed -> reopened
  -- -> total_loss.
  if public._acc_truthy(p_case -> 'legal_hold_active') or public._acc_truthy(p_case -> 'legal_hold')
     then return 'legal_hold'; end if;
  if public._acc_truthy(p_case -> 'cancelled') or public._acc_truthy(p_case -> 'cancelled_duplicate')
     then return 'cancelled_duplicate'; end if;
  if public._acc_is_closed_case(p_case) then return 'closed'; end if;
  if public._acc_truthy(p_case -> 'reopened_flag') or public._acc_truthy(p_case -> 'reopened')
     then return 'reopened'; end if;
  if public._acc_truthy(p_case -> 'total_loss_route') or public._acc_truthy(p_case -> 'total_loss')
     then return 'total_loss_processing'; end if;

  v_req := public.accident_required_workstreams(p_route, p_case, p_profile);

  -- 1. draft / submission gate.
  if not public._acc_truthy(p_case -> 'submitted') then
    return case when public._acc_truthy(p_case -> 'returned') then 'evidence_incomplete' else 'draft' end;
  end if;
  if ('incident_evidence' = any(coalesce(v_req,'{}')))
     and not public.accident_workstream_satisfied(
               public.accident_workstream_status('incident_evidence', p_case, p_ws)) then
    return case when public._acc_truthy(p_case -> 'returned') then 'evidence_incomplete' else 'submitted' end;
  end if;

  -- 2. walk the required pipeline; first unsatisfied workstream sets the headline.
  foreach ws in array coalesce(public.accident_pipeline_order(),'{}') loop
    if ws = 'incident_evidence' or ws <> all(coalesce(v_req,'{}')) then continue; end if;
    v_status := public.accident_workstream_status(ws, p_case, p_ws);
    if public.accident_workstream_satisfied(v_status) then continue; end if;
    v_m := public._acc_case_status_for(ws, v_status);
    if v_m is null then continue; end if;
    return v_m;
  end loop;

  -- 3. everything required is satisfied -> settlement / review / closed.
  if not public.accident_financially_complete(p_case, p_ws, v_req, p_profile) then
    return case when ('insurance' = any(coalesce(v_req,'{}')))
                     and not public._acc_closure_satisfied(p_case, p_ws, 'insurance', p_profile)
                then 'insurance_settlement_pending' else 'financial_closure_pending' end;
  end if;
  if not public.accident_corrective_complete(p_case, p_ws, v_req, p_profile) then
    return 'corrective_actions_pending';
  end if;
  if not public._acc_closure_review_approved(p_case) then return 'closure_review'; end if;
  return 'closed';
end;
$$;

-- commit;

-- =============================================================================
-- 9. HOW THE CLOSURE GUARD TRIGGER ENFORCES THIS SERVER-SIDE  (sketch, §6.3 of
--    03_WORKFLOW_ENGINE.md) — mirrors V242 enforce_status_change_capability.
-- =============================================================================
-- The whole point of this mirror: the register never writes a raw status, and an
-- API caller cannot skip §5.3. A BEFORE UPDATE trigger on `accidents` rebuilds the
-- case + its workstream rows as jsonb and calls the SAME functions the client used.
--
--   create or replace function public.enforce_accident_case_close()
--   returns trigger language plpgsql security definer set search_path to 'public' as $BODY$
--   declare
--     v_case  jsonb := to_jsonb(NEW);
--     v_ws    jsonb;
--     v_prof  jsonb;
--     v_gate  jsonb;
--   begin
--     -- 1. an illegal transition is refused whatever the caller's capability.
--     if NEW.case_status is distinct from OLD.case_status
--        and not public.accident_can_transition(OLD.case_status, NEW.case_status) then
--       raise exception 'Illegal case_status transition % -> %', OLD.case_status, NEW.case_status
--         using errcode = '42501';
--     end if;
--
--     -- 2. the fully-closed gate is the server twin of §5.3. On a move to closed,
--     --    rebuild the workstream rows + matched route profile and re-run the SAME
--     --    conjunction the client showed. A malicious UPDATE that sets
--     --    case_status='closed' directly is rejected unless every clause holds.
--     if NEW.case_status = 'closed' and OLD.case_status is distinct from 'closed' then
--       v_ws := (select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
--                  from public.accident_case_workstreams w where w.accident_id = NEW.id);
--       -- The physical config table is public.accident_route_profiles
--       -- (02_DATA_MODEL.sql Part C3 / 07_SEED_CONFIG.sql Part 2); the engine design
--       -- docs refer to it by the alias workflow_route_profiles. Use the physical
--       -- name here, matched on (organisation_id, route_key) per its UNIQUE key.
--       v_prof := (select to_jsonb(p) from public.accident_route_profiles p
--                   where p.organisation_id = NEW.organisation_id and p.route_key = NEW.route_key
--                   limit 1);
--       v_gate := public.accident_can_fully_close(v_case, v_ws, NEW.route_key, v_prof, now());
--       if not (v_gate ->> 'ok')::boolean then
--         raise exception 'Closure requirements not met: %', v_gate -> 'blockers'
--           using errcode = '42501';   -- carries the exact blocker list to the client
--       end if;
--     end if;
--
--     -- 3. closed cases are read-only except a reopen (brief §8/§15).
--     if OLD.case_status = 'closed' and NEW.case_status <> 'reopened'
--        and row(NEW.*) is distinct from row(OLD.*) then
--       raise exception 'Closed case is read-only' using errcode = '42501';
--     end if;
--     return NEW;
--   end $BODY$;
--
--   -- Use plain AFTER/BEFORE UPDATE (NOT `UPDATE OF case_status`): case_status is
--   -- set by the derive projection inside a BEFORE trigger, so it is NOT in the
--   -- statement's SET column list — the exact trap V398b fixed for the stage ledger.
--   -- create trigger trg_enforce_accident_case_close before update on public.accidents
--   --   for each row execute function public.enforce_accident_case_close();
--
-- Grants (when applied): these are pure, side-effect-free readers. Grant EXECUTE
-- to authenticated (they leak nothing beyond the jsonb the caller already passes),
-- and keep the ENFORCEMENT in the DEFINER trigger above, exactly like V242.

-- =============================================================================
-- PARITY NOTES — read before changing EITHER side (accidentCase.js <-> this file)
-- =============================================================================
-- Each SQL function above names the exact JS lines it mirrors. The load-bearing
-- edge cases, grouped:
--
-- [N1] num()  — _acc_num. BOTH an absent record key (JS undefined) AND a present
--      JSON null return NULL: the JS `if (v == null) return null` guard catches
--      undefined and null alike (num(null) is null, NOT 0). In jsonb that is
--      SQL-NULL (absent) and jsonb 'null' (present); both -> NULL here. A blank /
--      whitespace-only STRING also returns NULL (the JS `v.trim() === ''` guard) —
--      NOT 0. Every USE here uses `> 0` or `?? 1e9`, so null and 0 converge to the
--      same outcome; the honest null is kept because a future field testing
--      `num(x) === 0` would depend on it.
--      DIVERGENCE (documented): JS Number() also accepts hex ('0x1A') and
--      'Infinity'; the regex here rejects both -> null. Not present in case data.
--
-- [T1] truthy()  — _acc_truthy mirrors `v === true || v === 1 ||
--      TRUTHY_TOKENS.has(str(v).toLowerCase())` with TRUTHY_TOKENS = {true, t, yes,
--      y, 1}. ERP feeds carry boolean-ish text ('Yes','Y','TRUE'), so the whole
--      family is accepted case-insensitively (str() trims -> btrim here). Boolean
--      false, string 'false'/'no', number 2 stay falsy. Keep the two sides in lock-
--      step: adding a token to TRUTHY_TOKENS means adding it to the IN-list here.
--
-- [E1] str()  — _acc_str returns '' for objects/arrays, whereas JS String() would
--      give '[object Object]' / '1,2'. str() is only applied to scalar case fields
--      in the engine, so this never bites; if a future field is an object and gets
--      str()'d, revisit.
--
-- [F1] fieldFilled money rule — a money field must be NON-ZERO to count
--      (parts_cost/estimated_damage_cost/... are 0.00 on live rows). _acc_field_filled
--      and accidentStages.fieldFilled must agree; both encode it.
--
-- [W1] workstreamStatus — an explicit accident_case_workstreams row with a
--      NON-EMPTY status wins; only then does the STAGE_FIELDS-coverage fallback run.
--      The derived path can only ever return completed / in_progress / not_started /
--      not_required; the waiting_* / on_hold / rejected / reopened tokens come ONLY
--      from explicit rows (which is why _acc_case_status_for's waiting_* branches
--      only fire with explicit rows).
--
-- [W2] WORKSTREAM-KEY SET - RECONCILED (no mapping layer needed). accidentCase.js
--      uses TEN keys: incident_evidence, fleet_validation, liability, insurance,
--      assessment, repair, workshop_qc, handover, finance, corrective. The physical
--      table accident_case_workstreams.workstream_key (02_DATA_MODEL.sql B1) now
--      CONSTRAINS to exactly those ten canonical keys, and status CONSTRAINS to the
--      twelve WORKSTREAM_STATUS tokens (not_required, not_started, assigned,
--      in_progress, waiting_info, waiting_approval, waiting_external, on_hold,
--      completed, rejected, reopened, cancelled). The route seeds (07_SEED_CONFIG.sql)
--      and the completeness engine use the SAME ten-key set, so the schema, the seeds
--      and this mirror all agree. The caller passes physical workstream_key rows
--      straight through as p_ws - there is NO mapping layer to build.
--
-- [N2] NA envelope — accident_na_envelope_valid requires reason + by + at (and
--      approved_by only where the route profile flags na_requires_approval). A bare
--      switch-off never satisfies closure. naEnvelopeFor uses JS `||` truthiness to
--      pick na_reason-or-na from an explicit row, THEN falls back to
--      stage_waivers[stage] — mirrored in _acc_na_envelope_for. NB: an explicit
--      row's na_reason is TEXT in the physical schema, so accident_na_envelope_valid
--      (which needs an OBJECT with reason/by/at) will reject it — this faithfully
--      mirrors the JS, which has the same latent shape mismatch.
--
-- [R1] Route resolution — a config profile's required_workstreams is used VERBATIM
--      (filtered to valid keys, no conditionals). Otherwise the six core routes
--      apply their base set + conditionals; an UNKNOWN route key resolves to
--      'standard' (resolveRoute fallback), and p_route NULL/'' likewise -> standard.
--      Conditionals: standard adds workshop_qc(repairOccurred) + corrective(
--      correctiveRequired); minor/internal/external/total_loss add corrective;
--      injury adds assessment/repair/workshop_qc/handover(repairOccurred).
--
-- [B1] buildCaseRoute — config rule wins by LOWEST priority integer (num(priority)
--      ?? 1e9); ties keep the FIRST rule in array order (strict `<` in the loop
--      mirrors matched[0] after a stable sort). Fallback order is deliberate:
--      total_loss -> injury -> insurance(external/internal) -> minor -> standard.
--
-- [C1] completeness — five percentages from REQUIRED workstreams ONLY. A dimension
--      with no required items returns NULL (jsonb null), NEVER 100. scored() uses
--      NA-with-reason WITHOUT approval (scoring grade); the closure gate
--      (_acc_closure_satisfied) is STRICTER: a NON_WAIVABLE workstream
--      (incident_evidence / liability / finance) is NEVER satisfied by NA, and NA
--      needs approval where the route demands it — with a NULL profile approval is
--      REQUIRED by default (true), not waived. round() (half-away) equals
--      Math.round (half-up) for the non-negative values here.
--
-- [D1] closureLevel — NULL means "open" (vehicle not back in service). Re-derive
--      after EVERY transition (never increment): a rejected handover legitimately
--      drops the repair %.
--
-- [D2] closure_level TOKEN - RECONCILED. This engine, the accidents.closure_level
--      CHECK, and accident_closure_reviews.level (02_DATA_MODEL.sql) all now use
--      'financially_open'; 'financially_pending' has been dropped everywhere. The
--      ENGINE returns NULL for "open" while the accidents.closure_level column stores
--      the literal 'open' (and 'legacy_closed' for un-verified pre-module rows) as
--      persistence-only tokens; the persistence layer maps NULL<->'open'. No further
--      alignment is needed.
--
-- [G1] canFullyClose — the blocker list order is FIXED: workstream blockers (pipeline
--      order) first, then the repair-without-QC guard, then mandatory_task,
--      pending_approval, required_document, closure_review. Workstream blockers carry
--      key 'workstream'; meta blockers carry key 'check'. The workshop_qc guard
--      (`repairOccurred && !required.has('workshop_qc')`, check 'workshop_qc') is a
--      REAL clause — it catches a repair that happened on a route that never gated
--      QC — so it is mirrored, not skipped. This is the ONLY reader that touches the
--      clock (now() when p_now is NULL) -> STABLE.
--
-- [X1] transitions — accident_can_transition mirrors allowedTransitions: base
--      targets PLUS the universal cancel / legal-hold branches from any NON-terminal
--      state (closed and cancelled_duplicate are terminal, so `closed` -> only
--      [reopened], `cancelled_duplicate` -> [], `legal_hold` -> [closure_review,
--      cancelled_duplicate], `total_loss_processing` -> [insurance_settlement_pending,
--      financial_closure_pending, cancelled_duplicate, legal_hold], `reopened` ->
--      [technical_assessment, cancelled_duplicate, legal_hold]).
--
-- [S1] deriveCaseStatus — the projection, never written raw. Overrides win in this
--      order: legal_hold -> cancelled_duplicate -> closed -> reopened ->
--      total_loss_processing (the TERMINAL closed / cancelled states take precedence
--      over the cross-cutting total_loss / reopened projections, so a finished case
--      is never dragged back to a live stage); then the draft/submission gate; then
--      the earliest unsatisfied required workstream in pipeline order via
--      _acc_case_status_for; then settlement/review/closed, where the settlement
--      leg uses the closure-GRADE predicate (accident_financially_complete /
--      _acc_closure_satisfied), the same one the fully-closed gate uses. Mirror
--      pinned by a test alongside the others.
--
-- MIRROR DISCIPLINE (must hold, pin with a test — 03_WORKFLOW_ENGINE.md §9):
--   accidentCase.js  <->  accident_required_workstreams / accident_completeness /
--   accident_derive_case_status / accident_can_fully_close / accident_can_transition
--   accidentCase.WORKSTREAM_STAGE  <->  accident_workstream_stage
--   accidentCase.DIMENSION_OF      <->  accident_workstream_dimension
--   accidentCase.CASE_STATUS_STAGE <->  accident_case_status_stage
--   accidentStages.STAGE_FIELDS    <->  _acc_stage_required (required fields only)
--   Change BOTH sides together — the same rule as accident_stage_order <-> STAGE_FLOW
--   and classify_parts_consumption <-> partsExpense.js.
-- =============================================================================
