-- =============================================================================
-- ACCIDENT CASE MODEL - INSURANCE CLAIM CHAIN RPCs (Phase 8/9)
-- =============================================================================
-- STATUS: AUTHORED, NOT YET APPLIED. This file is a REVIEW ARTIFACT only. It has
-- NOT been run against any database and carries no `supabase_migrations` row. Do
-- not apply it until it has been reviewed and the tables/helpers it depends on are
-- live.
--
-- RUN ORDER: this script RUNS AFTER V417 (02_DATA_MODEL.sql - the case model
-- tables, columns, RLS and the closure-enforcement guard) AND AFTER
-- 10_WORKSTREAM_RPCS.sql (the per-team workstream RPCs). It calls the V417 tables
-- accident_insurance_claims / accident_insurance_decisions /
-- accident_insurance_settlements / accident_case_workstreams and the pre-existing
-- accidents.claim_amount claim field, and it REUSES the context helper
-- public._accident_rpc_context(uuid) created in 10_WORKSTREAM_RPCS.sql (org +
-- country + site re-assertion). RE-CONFIRM THE NEXT-FREE MIGRATION NUMBER AT APPLY
-- TIME: V417/V418 are the accident model / engine-mirror artifacts and the
-- workstream RPCs take the next free number after them; if the standing V419-V422
-- batch (PROJECT_MEMORY part 13) or any other migration lands first, renumber this
-- file accordingly. Nothing here depends on its own number.
--
-- WHY IT EXISTS
--   The insurance workstream is a chain: a claim is REGISTERED with the insurer,
--   the insurer returns a DECISION (approve / partially approve / reject / etc.),
--   and money is SETTLED. The frontend can patch the accident_insurance_* rows
--   directly through PostgREST (governed by the V417 per-capability RLS write
--   policies), but the three chain ACTIONS each need an ATOMIC, SERVER-VALIDATED
--   transition that a raw table write cannot express:
--     * a decision token typo must be REFUSED, not silently stored,
--     * an approve decision must NOT be recorded without an approved amount,
--     * every money field must be non-negative (a claim / settlement cannot be
--       negative), and
--     * registering a claim must move the insurance workstream to in_progress in
--       the SAME transaction, so the case board never shows a registered claim
--       against an untouched insurance section.
--   These RPCs are that server boundary. No claim MATHS live here; this layer
--   validates, gates and writes the chain rows honestly.
--
-- SECURITY (house pattern - V416 / V398 / V229, identical to 10_WORKSTREAM_RPCS.sql)
--   Every RPC is SECURITY DEFINER with search_path pinned to 'public'. Because a
--   DEFINER function bypasses RLS, each one RE-CHECKS, in its own body, via
--   _accident_rpc_context(accident_id):
--     1. org: the target accident's organisation_id = app_current_org() OR super.
--     2. country + site: app_can_see_country() AND app_can_see_site() on the
--        accident's own country/site (the same scope the V417 RLS enforces).
--   plus, in the body:
--     3. capability: app_is_elevated() (Admin/Manager/Director) OR
--        app_user_can('accidents','edit_insurance') - the capability that owns the
--        insurance tables in the V417 cap_map (PART E) and _accident_ws_cap
--        ('insurance'). So a non-elevated Insurance Claims Officer granted
--        'edit_insurance' can drive the claim chain, but a repair-only role cannot,
--        and a KSA-scoped user cannot touch an Egypt case's claim.
--   anon EXECUTE is revoked on every function; authenticated is granted; the in-body
--   self-gate is the real boundary. Returns are jsonb {ok, ...} envelopes.
--
-- MIRROR DISCIPLINE
--   The claim-decision token set, the claim-status token set and the settlement-type
--   token set below are copied VERBATIM from the V417 CHECK constraints on
--   accident_insurance_decisions.decision, accident_insurance_claims.decision and
--   accident_insurance_settlements.settlement_type (02_DATA_MODEL.sql B5 / B7 / B8).
--   Change this file and those CHECKs together.
--
--   NOTE (claim amount home): accident_insurance_claims (02 B5) has NO claim_amount
--   column - it carries deductible / coverage_excess / approved_amount /
--   rejected_amount (outcome amounts), not the amount being claimed. The claimed
--   amount's canonical home in the existing model is the pre-existing
--   accidents.claim_amount field (the V300 claim value the claims analytics already
--   read). accident_claim_register therefore persists p_claim_amount THERE, never on
--   an invented child column. The child row carries insurer / policy_no / claim_no /
--   deductible / decision, all real columns from 02 B5.
--
-- ROLLBACK (paste and run to reverse this file)
--   drop function if exists
--     public.accident_claim_register(uuid,text,text,text,numeric,numeric),
--     public.accident_claim_decision(uuid,text,numeric,text),
--     public.accident_claim_settlement(uuid,numeric,date,text);
-- =============================================================================

begin;

-- =============================================================================
-- 1. accident_claim_register - open (or update) the insurance claim for a case and
--   move the insurance workstream to in_progress.
--
--   Because accident_insurance_claims has NO unique(accident_id) (02 B5), this
--   resolves the case's existing claim (the latest one, if any) and UPDATES it;
--   only when none exists does it INSERT a new claim row. The claim decision is
--   advanced to 'registered' ONLY from an early state (not_required / under_review /
--   documents_incomplete) so re-registering never regresses a claim the insurer has
--   already decided. p_claim_amount (the amount being claimed) is written to the
--   case root accidents.claim_amount (see the claim-amount-home note in the header).
-- =============================================================================
create or replace function public.accident_claim_register(
  p_accident_id  uuid,
  p_insurer      text,
  p_policy_no    text,
  p_claim_no     text,
  p_claim_amount numeric,
  p_deductible   numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org       uuid;
  v_country   text;
  v_site      text;
  v_insurer   text := nullif(btrim(coalesce(p_insurer, '')), '');
  v_policy_no text := nullif(btrim(coalesce(p_policy_no, '')), '');
  v_claim_no  text := nullif(btrim(coalesce(p_claim_no, '')), '');
  v_existing  public.accident_insurance_claims%rowtype;
  v_claim     public.accident_insurance_claims%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  -- Capability gate: elevated OR the insurance-owning capability.
  if not (public.app_is_elevated()
          or public.app_user_can('accidents', 'edit_insurance')) then
    raise exception 'Not permitted to register an insurance claim.' using errcode = '42501';
  end if;

  -- Money validation: a claimed amount / deductible can never be negative.
  if p_claim_amount is not null and p_claim_amount < 0 then
    raise exception 'Claim amount cannot be negative.' using errcode = '22023';
  end if;
  if p_deductible is not null and p_deductible < 0 then
    raise exception 'Deductible cannot be negative.' using errcode = '22023';
  end if;

  -- Resolve the case's existing claim (latest first), if any.
  select * into v_existing
    from public.accident_insurance_claims c
   where c.accident_id = p_accident_id
   order by c.created_at desc, c.id desc
   limit 1;

  if v_existing.id is null then
    insert into public.accident_insurance_claims
      (organisation_id, accident_id, country, site, insurance_applicable,
       insurer, policy_no, claim_no, deductible, decision, claim_registered_date,
       created_by, created_at, updated_at)
    values
      (v_org, p_accident_id, v_country, v_site, true,
       v_insurer, v_policy_no, v_claim_no, p_deductible, 'registered', current_date,
       auth.uid(), now(), now())
    returning * into v_claim;
  else
    update public.accident_insurance_claims c set
       insurer               = coalesce(v_insurer, c.insurer),
       policy_no             = coalesce(v_policy_no, c.policy_no),
       claim_no              = coalesce(v_claim_no, c.claim_no),
       deductible            = coalesce(p_deductible, c.deductible),
       decision              = case
                                 when c.decision in ('not_required','under_review','documents_incomplete')
                                   then 'registered'
                                 else c.decision
                               end,
       claim_registered_date = coalesce(c.claim_registered_date, current_date),
       updated_at            = now()
     where c.id = v_existing.id
    returning * into v_claim;
  end if;

  -- Persist the claimed amount on the case root (its only real home; see header).
  if p_claim_amount is not null then
    update public.accidents
       set claim_amount = p_claim_amount
     where id = p_accident_id;
  end if;

  -- Move the insurance workstream to in_progress in the same transaction, so a
  -- registered claim never sits against an untouched insurance section.
  insert into public.accident_case_workstreams
    (organisation_id, accident_id, country, site, workstream_key, status,
     started_at, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, 'insurance', 'in_progress',
     now(), auth.uid(), now(), now())
  on conflict (accident_id, workstream_key) do update set
     status     = case
                    when public.accident_case_workstreams.status
                         in ('not_required','not_started','assigned')
                      then 'in_progress'
                    else public.accident_case_workstreams.status
                  end,
     started_at = coalesce(public.accident_case_workstreams.started_at, now()),
     updated_at = now();

  return jsonb_build_object('ok', true, 'claim', to_jsonb(v_claim));
end
$$;

-- =============================================================================
-- 2. accident_claim_decision - record an insurer decision on a claim.
--   Validates p_decision against the accident_insurance_decisions CHECK (02 B7).
--   An APPROVE decision (fully_approved / partially_approved) must carry an
--   approved amount - a claim is never marked approved without a value (task
--   requirement). Writes the decision to the decisions ledger and advances the
--   parent claim's status (accident_insurance_claims.decision) to the matching
--   claim-status token, setting approved_amount for approvals and rejection_reason
--   for rejections. Case context is derived from the claim.
-- =============================================================================
create or replace function public.accident_claim_decision(
  p_claim_id        uuid,
  p_decision        text,
  p_approved_amount numeric default null,
  p_reason          text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org         uuid;
  v_country     text;
  v_site        text;
  v_decision    text := lower(btrim(coalesce(p_decision, '')));
  v_reason      text := nullif(btrim(coalesce(p_reason, '')), '');
  v_claim       public.accident_insurance_claims%rowtype;
  v_row         public.accident_insurance_decisions%rowtype;
  v_claim_dec   text;
begin
  if p_claim_id is null then
    raise exception 'A claim is required.' using errcode = '22023';
  end if;

  select * into v_claim from public.accident_insurance_claims where id = p_claim_id;
  if v_claim.id is null then
    raise exception 'Claim % not found.', p_claim_id using errcode = 'P0002';
  end if;

  -- Re-assert org + country + site scope via the claim's parent case.
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(v_claim.accident_id);

  if not (public.app_is_elevated()
          or public.app_user_can('accidents', 'edit_insurance')) then
    raise exception 'Not permitted to record a claim decision.' using errcode = '42501';
  end if;

  -- Decision token must be one of the accident_insurance_decisions CHECK values.
  if v_decision <> any (array[
       'fully_approved','partially_approved','rejected','withdrawn','documents_requested',
       'survey_ordered','acknowledged','settled','disputed']) then
    raise exception 'Invalid claim decision "%".', p_decision using errcode = '22023';
  end if;

  -- Money validation + the approve-needs-an-amount rule.
  if p_approved_amount is not null and p_approved_amount < 0 then
    raise exception 'Approved amount cannot be negative.' using errcode = '22023';
  end if;
  if v_decision in ('fully_approved','partially_approved') and p_approved_amount is null then
    raise exception 'An approved amount is required for a "%" decision.', v_decision
      using errcode = '22023';
  end if;

  -- Record the decision on the ledger.
  insert into public.accident_insurance_decisions
    (organisation_id, accident_id, claim_id, country, site, decision, amount,
     decided_at, remarks, created_by, created_at, updated_at)
  values
    (v_org, v_claim.accident_id, p_claim_id, v_country, v_site, v_decision, p_approved_amount,
     now(), v_reason, auth.uid(), now(), now())
  returning * into v_row;

  -- Map the decision token onto the parent claim's status vocabulary (02 B5). The
  -- shared tokens carry through unchanged; the workflow-only tokens map to the
  -- claim's equivalent waiting state.
  v_claim_dec := case v_decision
    when 'documents_requested' then 'documents_incomplete'
    when 'survey_ordered'      then 'awaiting_surveyor'
    when 'acknowledged'        then 'awaiting_acknowledgement'
    else v_decision   -- fully_approved / partially_approved / rejected / withdrawn / settled / disputed
  end;

  update public.accident_insurance_claims c set
     decision         = v_claim_dec,
     approved_amount  = case
                          when v_decision in ('fully_approved','partially_approved')
                            then p_approved_amount
                          else c.approved_amount
                        end,
     rejection_reason = case
                          when v_decision = 'rejected'
                            then coalesce(v_reason, c.rejection_reason)
                          else c.rejection_reason
                        end,
     updated_at       = now()
   where c.id = p_claim_id
  returning * into v_claim;

  return jsonb_build_object('ok', true, 'decision', to_jsonb(v_row), 'claim', to_jsonb(v_claim));
end
$$;

-- =============================================================================
-- 3. accident_claim_settlement - record a settlement against a claim.
--   Writes a row to accident_insurance_settlements (02 B8, settlement_type defaults
--   to 'claim_payment') and advances the parent claim to 'settled' (a valid
--   accident_insurance_claims.decision token) because money has moved. The settled
--   amount is validated non-negative and a settlement date is mandatory. Case
--   context is derived from the claim.
-- =============================================================================
create or replace function public.accident_claim_settlement(
  p_claim_id       uuid,
  p_settled_amount numeric,
  p_settled_at     date,
  p_reference      text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org        uuid;
  v_country    text;
  v_site       text;
  v_reference  text := nullif(btrim(coalesce(p_reference, '')), '');
  v_claim      public.accident_insurance_claims%rowtype;
  v_row        public.accident_insurance_settlements%rowtype;
begin
  if p_claim_id is null then
    raise exception 'A claim is required.' using errcode = '22023';
  end if;

  select * into v_claim from public.accident_insurance_claims where id = p_claim_id;
  if v_claim.id is null then
    raise exception 'Claim % not found.', p_claim_id using errcode = 'P0002';
  end if;

  -- Re-assert org + country + site scope via the claim's parent case.
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(v_claim.accident_id);

  if not (public.app_is_elevated()
          or public.app_user_can('accidents', 'edit_insurance')) then
    raise exception 'Not permitted to record a settlement.' using errcode = '42501';
  end if;

  if p_settled_amount is null then
    raise exception 'A settlement amount is required.' using errcode = '22023';
  end if;
  if p_settled_amount < 0 then
    raise exception 'Settlement amount cannot be negative.' using errcode = '22023';
  end if;
  if p_settled_at is null then
    raise exception 'A settlement date is required.' using errcode = '22023';
  end if;

  insert into public.accident_insurance_settlements
    (organisation_id, accident_id, claim_id, country, site, settlement_type, amount,
     settled_at, payment_reference, created_by, created_at, updated_at)
  values
    (v_org, v_claim.accident_id, p_claim_id, v_country, v_site, 'claim_payment', p_settled_amount,
     p_settled_at, v_reference, auth.uid(), now(), now())
  returning * into v_row;

  -- Money has moved: advance the parent claim to 'settled' (valid claim token).
  update public.accident_insurance_claims c set
     decision   = 'settled',
     updated_at = now()
   where c.id = p_claim_id
  returning * into v_claim;

  return jsonb_build_object('ok', true, 'settlement', to_jsonb(v_row), 'claim', to_jsonb(v_claim));
end
$$;

-- -----------------------------------------------------------------------------
-- GRANTS - anon revoked, authenticated granted; the in-body self-gate is the real
-- boundary (house pattern, V416).
-- -----------------------------------------------------------------------------
revoke all on function public.accident_claim_register(uuid,text,text,text,numeric,numeric) from anon;
revoke all on function public.accident_claim_decision(uuid,text,numeric,text) from anon;
revoke all on function public.accident_claim_settlement(uuid,numeric,date,text) from anon;

grant execute on function public.accident_claim_register(uuid,text,text,text,numeric,numeric) to authenticated;
grant execute on function public.accident_claim_decision(uuid,text,numeric,text) to authenticated;
grant execute on function public.accident_claim_settlement(uuid,numeric,date,text) to authenticated;

commit;
-- =============================================================================
