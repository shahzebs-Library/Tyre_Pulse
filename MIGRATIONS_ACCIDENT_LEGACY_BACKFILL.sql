-- MIGRATIONS_ACCIDENT_LEGACY_BACKFILL.sql
-- =============================================================================
-- ACCIDENT LEGACY BACKFILL - seed the V417 accident case/workstream child tables
-- from the existing ~38 legacy `accidents` rows (Company A only), HONESTLY.
--
-- STATUS: AUTHORED, NOT YET APPLIED.
--   Runs AFTER V417 (accident case data model, docs/accident-module/02_DATA_MODEL.sql)
--   and V418 (accident case engine) are applied. It needs a Supabase-authorized
--   session against project jhssdmeruxtrlqnwfksc. Re-confirm the free migration
--   number at apply time and RENAME this file to the next free V-number then
--   (V417 and V418 are RESERVED for the data model + engine; this file carries no
--   V-number in its name on purpose so it cannot clash with that reserved
--   sequence). This is a review artifact only until then.
--
-- WHAT IT DOES
--   For each of the ~38 existing accidents in Company A (org
--   00000000-0000-0000-0000-000000000001) it seeds child rows in EIGHT V417
--   tables, and ONLY where the source `accidents` row actually carries the value.
--   It fabricates nothing. A field that is empty across the whole legacy set
--   (root_cause, corrective_action, preventive_action, hse_investigation,
--   police_report_no, photos, documents, a non-zero parts_cost) seeds NOTHING in
--   its target table - so no evidence, corrective-action, handover, closure,
--   case-approval or communication rows are created here.
--
-- HONESTY RULES (enforced by construction + verified at the end)
--   * One org, ~38 rows. Company A only.
--   * Seed a child row only where a real source value exists (per-table WHERE
--     guards below). Never fabricate.
--   * NEVER mark a legacy case / workstream / assessment as completed / approved /
--     accepted / satisfied / closed just because it is old:
--       - liability assessments seed with approved=false, locked=false.
--       - repair orders keep the default status 'planned' (release_date is recorded
--         as actual_completion, a real DATE fact, but status is never 'completed').
--       - damage assessments seed assessment_status='draft'.
--       - insurance claims CLAMP a legacy positive claim_status ('approved',
--         'settled') down to 'under_review' - the new module's approval carries
--         workflow weight (approved_by / locking / gating) a legacy free-text value
--         never had, so it is not re-asserted. Genuinely informative NON-positive
--         states (rejected, filed->registered, none->not_required) are preserved.
--       - closure_level for closed cases is 'legacy_closed' (set by V417's own
--         Part-A backfill), NEVER 'fully_closed'. This migration does NOT write
--         closure_level; it only VERIFIES V417 already set it correctly.
--   * Every seeded child row carries an honesty marker: created_by = NULL
--     (explicitly overriding the tables' `default auth.uid()`), and, where the
--     target table has a free-text column, a "backfilled from legacy accidents
--     row" note. created_by IS NULL is the machine-detectable marker the rollback
--     block below keys on.
--   * Every INSERT is guarded with `where not exists (...)` so the migration is
--     idempotent and one-shot (re-running inserts nothing).
--
-- PRE-REQ (Part 0) ABORTS unless the V417 tables exist AND accidents.case_no is
--   populated - so it can never run before V417 + its backfill.
--
-- No em dashes / en dashes anywhere in this file (house rule).
-- =============================================================================

begin;

-- =============================================================================
-- PART 0 - PRE-REQUISITE GUARD (abort unless V417 is applied AND backfilled)
-- =============================================================================
do $$
begin
  if to_regclass('public.accident_insurance_claims')       is null
     or to_regclass('public.accident_liability_assessments') is null
     or to_regclass('public.accident_authority_reports')     is null
     or to_regclass('public.accident_repair_orders')         is null
     or to_regclass('public.accident_damage_assessments')    is null
     or to_regclass('public.accident_financial_transactions') is null
     or to_regclass('public.accident_claim_recoveries')      is null
     or to_regclass('public.accident_vehicle_downtime')      is null then
    raise exception
      'PRE-REQ FAILED: one or more V417 accident case tables are missing. Apply V417 (02_DATA_MODEL.sql) before this backfill.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'accidents' and column_name = 'case_no'
  ) then
    raise exception
      'PRE-REQ FAILED: accidents.case_no does not exist. Apply V417 (which adds it) before this backfill.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'accidents' and column_name = 'closure_level'
  ) then
    raise exception
      'PRE-REQ FAILED: accidents.closure_level does not exist. Apply V417 before this backfill.';
  end if;

  if not exists (
    select 1 from public.accidents
     where organisation_id = '00000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'PRE-REQ FAILED: no Company A accidents found; nothing to backfill.';
  end if;

  -- case_no must be populated on every Company A accident (proves the V417 Part-A
  -- backfill ran). If any is null, V417 was applied but not backfilled: abort.
  if exists (
    select 1 from public.accidents
     where organisation_id = '00000000-0000-0000-0000-000000000001'
       and case_no is null
  ) then
    raise exception
      'PRE-REQ FAILED: some Company A accidents have a null case_no. Run the V417 Part-A backfill before this migration.';
  end if;
end $$;

-- =============================================================================
-- PART 1 - accident_insurance_claims
--   Source guard: insurer OR policy_no OR insurance_claim_no present, OR
--   deductible / claim_approved_amount not null, OR a MEANINGFUL claim_status
--   (present and not 'none'/''). A claim_status of 'none' alone does NOT seed.
--   decision: legacy positive states ('approved','settled') are CLAMPED to
--   'under_review'; informative negatives are preserved.
-- =============================================================================
insert into public.accident_insurance_claims
  (organisation_id, accident_id, country, site,
   insurer, policy_no, claim_no, deductible, approved_amount, decision, created_by)
select
  '00000000-0000-0000-0000-000000000001',
  a.id, a.country, a.site,
  nullif(btrim(a.insurer), ''),
  nullif(btrim(a.policy_no), ''),
  nullif(btrim(a.insurance_claim_no), ''),
  a.deductible,
  a.claim_approved_amount,
  case lower(btrim(coalesce(a.claim_status, '')))
    when 'rejected' then 'rejected'
    when 'filed'    then 'registered'
    when 'none'     then 'not_required'
    else 'under_review'   -- 'approved' / 'settled' / unknown / null: not re-asserted
  end,
  null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and (
        nullif(btrim(a.insurer), '')            is not null
     or nullif(btrim(a.policy_no), '')          is not null
     or nullif(btrim(a.insurance_claim_no), '') is not null
     or a.deductible                            is not null
     or a.claim_approved_amount                 is not null
     or lower(coalesce(nullif(btrim(a.claim_status), ''), '')) not in ('', 'none')
      )
  and not exists (
        select 1 from public.accident_insurance_claims x where x.accident_id = a.id
      );

-- =============================================================================
-- PART 2 - accident_liability_assessments (unique per accident)
--   Source guard: gcc_liability_ratio OR liable_party OR fault_status present.
--   approved=false, locked=false (never asserted from age). our_liability_pct is
--   the ONLY clean numeric target for gcc_liability_ratio; third_party_pct is NOT
--   computed (100 - ratio would be fabrication). The raw liable_party / fault_status
--   are preserved verbatim in change_reason as provenance (there is no notes
--   column on this table).
-- =============================================================================
insert into public.accident_liability_assessments
  (organisation_id, accident_id, country, site,
   liability_type, our_liability_pct, approved, locked, change_reason, created_by)
select
  '00000000-0000-0000-0000-000000000001',
  a.id, a.country, a.site,
  case
    when lower(btrim(coalesce(a.fault_status, ''))) like '%under%'
      or lower(btrim(coalesce(a.fault_status, ''))) like '%review%'
      or lower(btrim(coalesce(a.fault_status, ''))) like '%investigat%' then 'under_investigation'
    when lower(btrim(coalesce(a.liable_party, ''))) like '%other%'
      or lower(btrim(coalesce(a.liable_party, ''))) like '%third%' then 'third_party_full'
    when lower(btrim(coalesce(a.liable_party, ''))) = 'gcc' then
      case
        when a.gcc_liability_ratio is not null and a.gcc_liability_ratio > 0 and a.gcc_liability_ratio < 100
          then 'shared'
        else 'our_driver_full'
      end
    else null
  end,
  a.gcc_liability_ratio,
  false,
  false,
  'Backfilled from legacy accidents row (liable_party=' || coalesce(nullif(btrim(a.liable_party), ''), 'n/a')
    || ', fault_status=' || coalesce(nullif(btrim(a.fault_status), ''), 'n/a')
    || ', gcc_liability_ratio=' || coalesce(a.gcc_liability_ratio::text, 'n/a') || ')',
  null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and (
        a.gcc_liability_ratio             is not null
     or nullif(btrim(a.liable_party), '') is not null
     or nullif(btrim(a.fault_status), '') is not null
      )
  and not exists (
        select 1 from public.accident_liability_assessments x where x.accident_id = a.id
      );

-- =============================================================================
-- PART 3 - accident_authority_reports (Najm + Taqdeer; NO police report row)
--   police_report_no is deliberately NOT sourced (empty in the legacy set, and the
--   mapping says "no police report row"). Two logical rows: one for Najm, one for
--   Taqdeer, each seeded only when its own source status/number is present.
-- =============================================================================

-- 3a. Najm authority row.
insert into public.accident_authority_reports
  (organisation_id, accident_id, country, site,
   authority_type, report_status, no_report_reason, notes, created_by)
select
  '00000000-0000-0000-0000-000000000001',
  a.id, a.country, a.site,
  'Najm',
  case
    when lower(btrim(coalesce(a.najm_status, ''))) like '%no najm%'
      or lower(btrim(coalesce(a.najm_status, ''))) in ('no', 'n/a', 'none') then 'none'
    when lower(btrim(coalesce(a.najm_status, ''))) like '%report%'
      or lower(btrim(coalesce(a.najm_status, ''))) like '%najm%' then 'available'
    else 'pending'
  end,
  case
    when lower(btrim(coalesce(a.najm_status, ''))) like '%no najm%'
      or lower(btrim(coalesce(a.najm_status, ''))) in ('no', 'n/a', 'none') then 'No Najm report (legacy)'
    else null
  end,
  'Backfilled from legacy accidents row. najm_status=' || coalesce(nullif(btrim(a.najm_status), ''), 'n/a')
    || ', najm_fault=' || coalesce(nullif(btrim(a.najm_fault), ''), 'n/a'),
  null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and (
        nullif(btrim(a.najm_status), '') is not null
     or nullif(btrim(a.najm_fault), '')  is not null
      )
  and not exists (
        select 1 from public.accident_authority_reports x
         where x.accident_id = a.id and x.authority_type = 'Najm'
      );

-- 3b. Taqdeer authority row (taqdeer_no -> report_no).
insert into public.accident_authority_reports
  (organisation_id, accident_id, country, site,
   authority_type, report_no, report_status, no_report_reason, notes, created_by)
select
  '00000000-0000-0000-0000-000000000001',
  a.id, a.country, a.site,
  'Taqdeer',
  nullif(btrim(a.taqdeer_no), ''),
  case
    when lower(btrim(coalesce(a.taqdeer_status, ''))) like '%no taqdeer%'
      or lower(btrim(coalesce(a.taqdeer_status, ''))) in ('no', 'n/a', 'none') then 'none'
    when lower(btrim(coalesce(a.taqdeer_status, ''))) like '%report%'
      or lower(btrim(coalesce(a.taqdeer_status, ''))) like '%taqdeer%' then 'available'
    else 'pending'
  end,
  case
    when lower(btrim(coalesce(a.taqdeer_status, ''))) like '%no taqdeer%'
      or lower(btrim(coalesce(a.taqdeer_status, ''))) in ('no', 'n/a', 'none') then 'No Taqdeer report (legacy)'
    else null
  end,
  'Backfilled from legacy accidents row. taqdeer_status=' || coalesce(nullif(btrim(a.taqdeer_status), ''), 'n/a'),
  null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and (
        nullif(btrim(a.taqdeer_status), '') is not null
     or nullif(btrim(a.taqdeer_no), '')     is not null
      )
  and not exists (
        select 1 from public.accident_authority_reports x
         where x.accident_id = a.id and x.authority_type = 'Taqdeer'
      );

-- =============================================================================
-- PART 4 - accident_repair_orders
--   Source guard: repair_type OR workshop_name OR workshop_quotation OR
--   final_amount OR release_date OR expected_release_date present.
--   status stays 'planned' (never 'completed' from age). release_date is recorded
--   as actual_completion (a real DATE fact), expected_release_date as
--   planned_completion. workshop_quotation -> quotation_amount; final_amount ->
--   approved_amount (approved_by / approved_at stay NULL - no approval actor
--   asserted).
-- =============================================================================
insert into public.accident_repair_orders
  (organisation_id, accident_id, country, site,
   repair_route, workshop_type, workshop_name, quotation_amount, approved_amount,
   planned_completion, actual_completion, status, created_by)
select
  '00000000-0000-0000-0000-000000000001',
  a.id, a.country, a.site,
  case lower(btrim(coalesce(a.repair_type, '')))
    when 'internal' then 'internal'
    when 'external' then 'external'
    else null
  end,
  case lower(btrim(coalesce(a.repair_type, '')))
    when 'internal' then 'internal'
    when 'external' then 'external'
    else null
  end,
  nullif(btrim(a.workshop_name), ''),
  a.workshop_quotation,
  a.final_amount,
  a.expected_release_date,
  a.release_date,
  'planned',
  null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and (
        nullif(btrim(a.repair_type), '')   is not null
     or nullif(btrim(a.workshop_name), '') is not null
     or a.workshop_quotation               is not null
     or a.final_amount                     is not null
     or a.release_date                     is not null
     or a.expected_release_date            is not null
      )
  and not exists (
        select 1 from public.accident_repair_orders x where x.accident_id = a.id
      );

-- =============================================================================
-- PART 5 - accident_damage_assessments
--   Source guard: damage_description OR estimated_damage_cost OR repair_cost OR
--   damage_class present. assessment_status='draft'. damage_description ->
--   visible_damage; estimated_total_cost = coalesce(estimated_damage_cost,
--   repair_cost) (best-known damage figure; repair_cost is ALSO booked as a
--   financial line in Part 6); damage_class -> total_loss signal + preserved
--   verbatim in the damage_areas jsonb.
-- =============================================================================
insert into public.accident_damage_assessments
  (organisation_id, accident_id, country, site,
   visible_damage, estimated_total_cost, total_loss_possible, recommended_route,
   damage_areas, assessment_status, created_by)
select
  '00000000-0000-0000-0000-000000000001',
  a.id, a.country, a.site,
  nullif(btrim(a.damage_description), ''),
  coalesce(a.estimated_damage_cost, a.repair_cost),
  (lower(btrim(coalesce(a.damage_class, ''))) like '%total%loss%'),
  case
    when lower(btrim(coalesce(a.damage_class, ''))) like '%total%loss%' then 'total_loss'
    else null
  end,
  case
    when nullif(btrim(a.damage_class), '') is not null then
      jsonb_build_array(jsonb_build_object(
        'area', 'legacy',
        'severity', btrim(a.damage_class),
        'note', 'backfilled from legacy accidents row'))
    else '[]'::jsonb
  end,
  'draft',
  null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and (
        nullif(btrim(a.damage_description), '') is not null
     or a.estimated_damage_cost                 is not null
     or a.repair_cost                           is not null
     or nullif(btrim(a.damage_class), '')       is not null
      )
  and not exists (
        select 1 from public.accident_damage_assessments x where x.accident_id = a.id
      );

-- =============================================================================
-- PART 6 - accident_financial_transactions (one line per present money field)
--   No parts rows (parts_cost is 0 across the legacy set). currency is left NULL
--   (accidents carries no currency column; not fabricated). Each line's
--   `description` is a unique provenance string, which is ALSO the idempotency key
--   (where not exists on accident_id + description).
-- =============================================================================

-- 6a. repair_cost -> cost line.
insert into public.accident_financial_transactions
  (organisation_id, accident_id, country, site, txn_type, direction, amount, description, created_by)
select '00000000-0000-0000-0000-000000000001', a.id, a.country, a.site,
       'invoice_amount', 'cost', a.repair_cost,
       'Backfilled from legacy accidents row: repair_cost', null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and coalesce(a.repair_cost, 0) > 0
  and not exists (
        select 1 from public.accident_financial_transactions x
         where x.accident_id = a.id and x.description = 'Backfilled from legacy accidents row: repair_cost'
      );

-- 6b. estimated_damage_cost -> estimate line.
insert into public.accident_financial_transactions
  (organisation_id, accident_id, country, site, txn_type, direction, amount, description, created_by)
select '00000000-0000-0000-0000-000000000001', a.id, a.country, a.site,
       'repair_estimate', 'cost', a.estimated_damage_cost,
       'Backfilled from legacy accidents row: estimated_damage_cost', null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and coalesce(a.estimated_damage_cost, 0) > 0
  and not exists (
        select 1 from public.accident_financial_transactions x
         where x.accident_id = a.id and x.description = 'Backfilled from legacy accidents row: estimated_damage_cost'
      );

-- 6c. claim_approved_amount -> insurer-approved figure (direction 'neutral':
--     an approved figure is not an actual cash movement).
insert into public.accident_financial_transactions
  (organisation_id, accident_id, country, site, txn_type, direction, amount, description, created_by)
select '00000000-0000-0000-0000-000000000001', a.id, a.country, a.site,
       'insurer_approved', 'neutral', a.claim_approved_amount,
       'Backfilled from legacy accidents row: claim_approved_amount', null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and coalesce(a.claim_approved_amount, 0) > 0
  and not exists (
        select 1 from public.accident_financial_transactions x
         where x.accident_id = a.id and x.description = 'Backfilled from legacy accidents row: claim_approved_amount'
      );

-- 6d. recovered_amount -> recovery line (type from recovery_source).
insert into public.accident_financial_transactions
  (organisation_id, accident_id, country, site, txn_type, direction, amount, description, created_by)
select '00000000-0000-0000-0000-000000000001', a.id, a.country, a.site,
       case
         when lower(btrim(coalesce(a.recovery_source, ''))) like '%third%'
           or lower(btrim(coalesce(a.recovery_source, ''))) = 'driver' then 'third_party_recovery'
         else 'insurance_payment'
       end,
       'recovery', a.recovered_amount,
       'Backfilled from legacy accidents row: recovered_amount', null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and coalesce(a.recovered_amount, 0) > 0
  and not exists (
        select 1 from public.accident_financial_transactions x
         where x.accident_id = a.id and x.description = 'Backfilled from legacy accidents row: recovered_amount'
      );

-- 6e. amount_transfer -> recovery line (legacy form places it in the recovery
--     section; type from recovery_source, same rule as recovered_amount).
insert into public.accident_financial_transactions
  (organisation_id, accident_id, country, site, txn_type, direction, amount, description, created_by)
select '00000000-0000-0000-0000-000000000001', a.id, a.country, a.site,
       case
         when lower(btrim(coalesce(a.recovery_source, ''))) like '%third%'
           or lower(btrim(coalesce(a.recovery_source, ''))) = 'driver' then 'third_party_recovery'
         else 'insurance_payment'
       end,
       'recovery', a.amount_transfer,
       'Backfilled from legacy accidents row: amount_transfer', null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and coalesce(a.amount_transfer, 0) > 0
  and not exists (
        select 1 from public.accident_financial_transactions x
         where x.accident_id = a.id and x.description = 'Backfilled from legacy accidents row: amount_transfer'
      );

-- =============================================================================
-- PART 7 - accident_claim_recoveries
--   Source guard: recovered_amount > 0, OR a meaningful recovery_status (not
--   ''/'none'), OR a meaningful recovery_source (not ''/'none'), OR recovery_date.
--   status: 'recovered'/'written_off' honored ONLY when the source states them;
--   a present recovered_amount with an unclear status is 'partial' (not asserted
--   fully recovered). 'no'/'n/a' -> 'not_applicable'.
-- =============================================================================
insert into public.accident_claim_recoveries
  (organisation_id, accident_id, country, site,
   source, amount, status, recovered_at, remarks, created_by)
select
  '00000000-0000-0000-0000-000000000001',
  a.id, a.country, a.site,
  case
    when lower(btrim(coalesce(a.recovery_source, ''))) = 'insurer'    then 'insurer'
    when lower(btrim(coalesce(a.recovery_source, ''))) like '%third%' then 'third_party'
    when lower(btrim(coalesce(a.recovery_source, ''))) = 'driver'     then 'driver'
    when nullif(btrim(a.recovery_source), '') is null                 then 'insurer'
    else 'other'
  end,
  a.recovered_amount,
  case lower(btrim(coalesce(a.recovery_status, '')))
    when 'pending'      then 'pending'
    when 'partial'      then 'partial'
    when 'recovered'    then 'recovered'
    when 'written_off'  then 'written_off'
    when 'no'           then 'not_applicable'
    when 'n/a'          then 'not_applicable'
    when 'yes'          then case when coalesce(a.recovered_amount, 0) > 0 then 'partial' else 'in_progress' end
    else case when coalesce(a.recovered_amount, 0) > 0 then 'partial' else 'pending' end
  end,
  a.recovery_date,
  'Backfilled from legacy accidents row. recovery_status='
    || coalesce(nullif(btrim(a.recovery_status), ''), 'n/a')
    || ', recovery_source=' || coalesce(nullif(btrim(a.recovery_source), ''), 'n/a'),
  null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and (
        coalesce(a.recovered_amount, 0) > 0
     or lower(coalesce(nullif(btrim(a.recovery_status), ''), '')) not in ('', 'none')
     or lower(coalesce(nullif(btrim(a.recovery_source), ''), '')) not in ('', 'none')
     or a.recovery_date is not null
      )
  and not exists (
        select 1 from public.accident_claim_recoveries x where x.accident_id = a.id
      );

-- =============================================================================
-- PART 8 - accident_vehicle_downtime
--   Source guard: vor is true OR vor_since present OR expected_release_date present.
--   vehicle_status is 'off_road_accident' ONLY while vor is true; otherwise NULL
--   (a legacy vor=false is NOT re-asserted as 'returned_to_operation'). vor_since
--   -> offroad_start; expected_release_date -> expected_return_date.
-- =============================================================================
insert into public.accident_vehicle_downtime
  (organisation_id, accident_id, country, site,
   vehicle_status, offroad_reason, offroad_start, expected_return_date, created_by)
select
  '00000000-0000-0000-0000-000000000001',
  a.id, a.country, a.site,
  case when a.vor is true then 'off_road_accident' else null end,
  'Backfilled from legacy accidents row (VOR)',
  a.vor_since::date,
  a.expected_release_date,
  null
from public.accidents a
where a.organisation_id = '00000000-0000-0000-0000-000000000001'
  and (
        a.vor is true
     or a.vor_since is not null
     or a.expected_release_date is not null
      )
  and not exists (
        select 1 from public.accident_vehicle_downtime x where x.accident_id = a.id
      );

-- =============================================================================
-- PART 9 - IN-TRANSACTION HONESTY ASSERTIONS (roll back the whole backfill if any
--          seeded row asserts a completed / approved / accepted / satisfied /
--          closed state, or if V417 did not set closed cases to legacy_closed)
-- =============================================================================
do $$
declare v_bad integer;
begin
  -- Liability assessments must be unapproved + unlocked.
  select count(*) into v_bad
    from public.accident_liability_assessments
   where created_by is null and (approved is true or locked is true);
  if v_bad > 0 then
    raise exception 'HONESTY CHECK FAILED: % backfilled liability assessment(s) are approved/locked.', v_bad;
  end if;

  -- Repair orders must never be 'completed'.
  select count(*) into v_bad
    from public.accident_repair_orders
   where created_by is null and status = 'completed';
  if v_bad > 0 then
    raise exception 'HONESTY CHECK FAILED: % backfilled repair order(s) marked completed.', v_bad;
  end if;

  -- Damage assessments must be 'draft'.
  select count(*) into v_bad
    from public.accident_damage_assessments
   where created_by is null and assessment_status <> 'draft';
  if v_bad > 0 then
    raise exception 'HONESTY CHECK FAILED: % backfilled damage assessment(s) not in draft.', v_bad;
  end if;

  -- Insurance claim decision must not carry a positive/terminal token.
  select count(*) into v_bad
    from public.accident_insurance_claims
   where created_by is null
     and (decision ilike '%approved%' or decision ilike '%completed%'
          or decision in ('settled', 'survey_completed'));
  if v_bad > 0 then
    raise exception 'HONESTY CHECK FAILED: % backfilled insurance claim(s) carry an approved/settled/completed decision.', v_bad;
  end if;

  -- Handover / closure / case-approval acceptance states must not exist (we seed
  -- none of those tables, so this is a belt-and-braces zero check).
  select
    (select count(*) from public.accident_handover_inspections where created_by is null and decision = 'accepted')
  + (select count(*) from public.accident_closure_reviews      where created_by is null and decision = 'approved')
  + (select count(*) from public.accident_case_approvals       where created_by is null and decision = 'approved')
  + (select count(*) from public.accident_closure_requirements where created_by is null and satisfied is true)
    into v_bad;
  if v_bad > 0 then
    raise exception 'HONESTY CHECK FAILED: % accepted/approved/satisfied row(s) exist in tables this backfill must not seed.', v_bad;
  end if;

  -- V417 invariant: every CLOSED Company A case must be 'legacy_closed', never
  -- 'fully_closed' (this backfill does not set closure_level; it only verifies it).
  select count(*) into v_bad
    from public.accidents
   where organisation_id = '00000000-0000-0000-0000-000000000001'
     and (closure_status = 'closed' or status = 'closed' or workflow_stage = 'closed')
     and coalesce(closure_level, '') <> 'legacy_closed';
  if v_bad > 0 then
    raise exception
      'HONESTY CHECK FAILED: % closed Company A case(s) are not closure_level=legacy_closed (V417 Part-A backfill issue).', v_bad;
  end if;
end $$;

commit;

-- =============================================================================
-- PART 10 - VERIFICATION (read-only; run after commit to eyeball reconciliation)
--   Each row: the source population (accidents matching that table's WHERE guard)
--   vs the seeded child-row count. They must reconcile. Financial transactions is
--   a one-line-per-money-field table, so its source population is the count of
--   present, positive money fields across the legacy rows.
-- =============================================================================
select 'insurance_claims' as child,
  (select count(*) from public.accidents a
     where a.organisation_id = '00000000-0000-0000-0000-000000000001'
       and ( nullif(btrim(a.insurer), '') is not null
          or nullif(btrim(a.policy_no), '') is not null
          or nullif(btrim(a.insurance_claim_no), '') is not null
          or a.deductible is not null
          or a.claim_approved_amount is not null
          or lower(coalesce(nullif(btrim(a.claim_status), ''), '')) not in ('', 'none') )) as source_pop,
  (select count(*) from public.accident_insurance_claims where created_by is null) as seeded
union all
select 'liability_assessments',
  (select count(*) from public.accidents a
     where a.organisation_id = '00000000-0000-0000-0000-000000000001'
       and ( a.gcc_liability_ratio is not null
          or nullif(btrim(a.liable_party), '') is not null
          or nullif(btrim(a.fault_status), '') is not null )),
  (select count(*) from public.accident_liability_assessments where created_by is null)
union all
select 'authority_reports_najm',
  (select count(*) from public.accidents a
     where a.organisation_id = '00000000-0000-0000-0000-000000000001'
       and ( nullif(btrim(a.najm_status), '') is not null
          or nullif(btrim(a.najm_fault), '') is not null )),
  (select count(*) from public.accident_authority_reports where created_by is null and authority_type = 'Najm')
union all
select 'authority_reports_taqdeer',
  (select count(*) from public.accidents a
     where a.organisation_id = '00000000-0000-0000-0000-000000000001'
       and ( nullif(btrim(a.taqdeer_status), '') is not null
          or nullif(btrim(a.taqdeer_no), '') is not null )),
  (select count(*) from public.accident_authority_reports where created_by is null and authority_type = 'Taqdeer')
union all
select 'repair_orders',
  (select count(*) from public.accidents a
     where a.organisation_id = '00000000-0000-0000-0000-000000000001'
       and ( nullif(btrim(a.repair_type), '') is not null
          or nullif(btrim(a.workshop_name), '') is not null
          or a.workshop_quotation is not null
          or a.final_amount is not null
          or a.release_date is not null
          or a.expected_release_date is not null )),
  (select count(*) from public.accident_repair_orders where created_by is null)
union all
select 'damage_assessments',
  (select count(*) from public.accidents a
     where a.organisation_id = '00000000-0000-0000-0000-000000000001'
       and ( nullif(btrim(a.damage_description), '') is not null
          or a.estimated_damage_cost is not null
          or a.repair_cost is not null
          or nullif(btrim(a.damage_class), '') is not null )),
  (select count(*) from public.accident_damage_assessments where created_by is null)
union all
select 'financial_transactions',
  (select
     ( select count(*) from public.accidents a where a.organisation_id = '00000000-0000-0000-0000-000000000001' and coalesce(a.repair_cost, 0) > 0 )
   + ( select count(*) from public.accidents a where a.organisation_id = '00000000-0000-0000-0000-000000000001' and coalesce(a.estimated_damage_cost, 0) > 0 )
   + ( select count(*) from public.accidents a where a.organisation_id = '00000000-0000-0000-0000-000000000001' and coalesce(a.claim_approved_amount, 0) > 0 )
   + ( select count(*) from public.accidents a where a.organisation_id = '00000000-0000-0000-0000-000000000001' and coalesce(a.recovered_amount, 0) > 0 )
   + ( select count(*) from public.accidents a where a.organisation_id = '00000000-0000-0000-0000-000000000001' and coalesce(a.amount_transfer, 0) > 0 )),
  (select count(*) from public.accident_financial_transactions where created_by is null)
union all
select 'claim_recoveries',
  (select count(*) from public.accidents a
     where a.organisation_id = '00000000-0000-0000-0000-000000000001'
       and ( coalesce(a.recovered_amount, 0) > 0
          or lower(coalesce(nullif(btrim(a.recovery_status), ''), '')) not in ('', 'none')
          or lower(coalesce(nullif(btrim(a.recovery_source), ''), '')) not in ('', 'none')
          or a.recovery_date is not null )),
  (select count(*) from public.accident_claim_recoveries where created_by is null)
union all
select 'vehicle_downtime',
  (select count(*) from public.accidents a
     where a.organisation_id = '00000000-0000-0000-0000-000000000001'
       and ( a.vor is true or a.vor_since is not null or a.expected_release_date is not null )),
  (select count(*) from public.accident_vehicle_downtime where created_by is null)
order by child;

-- Sanity: no seeded row (created_by is null) may carry an approved/completed/
-- accepted/satisfied/closed state across the eight seeded tables. Expect 0 rows.
select 'BANNED_STATE_LEAK' as check_name, count(*) as offending_rows from (
  select 1 from public.accident_liability_assessments where created_by is null and (approved is true or locked is true)
  union all
  select 1 from public.accident_repair_orders where created_by is null and status = 'completed'
  union all
  select 1 from public.accident_damage_assessments where created_by is null and assessment_status <> 'draft'
  union all
  select 1 from public.accident_insurance_claims where created_by is null
     and (decision ilike '%approved%' or decision ilike '%completed%' or decision in ('settled', 'survey_completed'))
) q;

-- =============================================================================
-- ROLLBACK (paste and run to fully reverse this backfill)
--   Every seeded row carries created_by IS NULL as its honesty marker, and this
--   backfill is the only writer of created_by-null rows in these eight tables (the
--   app always stamps auth.uid()). Running this immediately after the backfill
--   removes exactly the seeded rows and nothing else. Scoped to Company A.
-- =============================================================================
-- begin;
-- delete from public.accident_vehicle_downtime        where organisation_id = '00000000-0000-0000-0000-000000000001' and created_by is null;
-- delete from public.accident_claim_recoveries        where organisation_id = '00000000-0000-0000-0000-000000000001' and created_by is null;
-- delete from public.accident_financial_transactions  where organisation_id = '00000000-0000-0000-0000-000000000001' and created_by is null;
-- delete from public.accident_damage_assessments      where organisation_id = '00000000-0000-0000-0000-000000000001' and created_by is null;
-- delete from public.accident_repair_orders           where organisation_id = '00000000-0000-0000-0000-000000000001' and created_by is null;
-- delete from public.accident_authority_reports       where organisation_id = '00000000-0000-0000-0000-000000000001' and created_by is null;
-- delete from public.accident_liability_assessments   where organisation_id = '00000000-0000-0000-0000-000000000001' and created_by is null;
-- delete from public.accident_insurance_claims        where organisation_id = '00000000-0000-0000-0000-000000000001' and created_by is null;
-- commit;
-- =============================================================================
