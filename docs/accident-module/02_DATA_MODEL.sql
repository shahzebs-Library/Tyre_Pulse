-- MIGRATIONS_V417_ACCIDENT_CASE_MODEL.sql
-- =============================================================================
-- V417 - ACCIDENT CASE MODEL (Phase 3): normalized case + ten workstreams +
--        route-based completeness + configurable SLA engine + three-level
--        closure gate + insurance / repair / finance child records.
--
-- STATUS: NOT APPLIED. This file is a REVIEW ARTIFACT only. Do not run it against
-- the database until it has been reviewed. Companion design doc:
-- docs/accident-module/02_DATA_MODEL.md. Resolution log for the pre-implementation
-- review: docs/accident-module/06_RESOLUTION.md.
--
-- Next-free migration number confirmed V417 (latest applied is V416,
-- MATERIAL_MASTER_BULK_CONFIRM; see PROJECT_MEMORY.md).
--
-- -----------------------------------------------------------------------------
-- REVIEW RESOLUTIONS (rev. 2, 2026-07-28) - the nine must-fix items from
-- 06_DESIGN_REVIEW.md are resolved IN THIS FILE. The single source of truth for
-- every token set below is the committed pure engine src/lib/accidentCase.js
-- (10 WORKSTREAMS, 30 CASE_STATUSES, WORKSTREAM_STATUS, closureLevel tokens); the
-- SQL CHECKs and seeds mirror it verbatim.
--   C1  closure_level / case_status are gated by the BEFORE-UPDATE guard
--       enforce_accident_closure (PART G) - shipped in THIS migration, not later.
--   C2  per-workstream write policies (PART E) let a team role write its OWN
--       workstream table via app_user_can('accidents', <cap>); admin/manager/
--       director keep full write. The flat app_is_elevated()-only write is gone.
--   C3  the 16 accident capabilities are seeded into the V229 app_settings
--       'permission_overrides' envelope (PART F) so the intended roles can act
--       out of the box.
--   H1  workstream_key + status vocabularies reconciled to accidentCase.js
--       (10 keys, waiting_info). Route seeds use the same 10 keys.
--   H2  accidents.case_status added with a 30-value widen-guarded CHECK.
--   H3  closure_level / accident_closure_reviews.level tokens aligned to the
--       engine (financially_open, not financially_pending).
--   H4  accident_* names are canonical; the doc-name reconciliation table lives
--       in 06_RESOLUTION.md. Tables the closure gate / completeness engine need
--       all exist here; SLA-calendar / audit / portal tables are scoped
--       phase-later (see below) because the SLA CLOCK cron is itself phase-later.
--   H5  injury / total-loss / third-party "steps" are modelled as records
--       (accident_authority_reports, accident_corrective_actions,
--       accident_claim_recoveries.source, accident_case_approvals), never as
--       workstream keys - so the 10-key CHECK is complete. See 06_RESOLUTION.md.
--   H6  transient reopened_flag / total_loss_route columns added so
--       deriveCaseStatus does not pin a reopened or total-loss case forever
--       (the permanent audit flags is_reopened / reopen_count stay separate).
--   M4  legacy closed rows backfill to closure_level='legacy_closed' with
--       case_flags.closure_basis='backfilled' - never asserted as a verified full
--       closure. M5 case_no is DERIVED from reference_no (numbers agree).
--       M1 write policies also carry country/site WITH CHECK.
--
-- -----------------------------------------------------------------------------
-- WHY IT EXISTS
--   The brief (ACCIDENT_MODULE_BRIEF.md sections 12 and 17) is explicit: an
--   accident is not one long form owned by one person. It is ONE case that flows
--   through Fleet, Safety, Insurance, Workshop, Store, Procurement, Finance and
--   external workshops, and it must close through ONE controlled gate. That needs
--   related records, not more columns on `accidents`.
--
--   This migration adds that relational spine WITHOUT touching the working
--   accident record. Every existing accident keeps its reference_no, workflow_stage,
--   claim fields, VOR fields and stage-waiver map exactly as they are.
--
-- REUSE STRATEGY (do NOT recreate these; they are the foundation this builds on)
--   * accidents               -> IS the case root. We only ADD columns to it
--                                (case_no, route_key, closure_level, per-route
--                                completion %, reopen/cancel/legal-hold fields).
--                                workflow_stage + its V300 12-value CHECK are left
--                                UNCHANGED so the JS mirror (src/lib/accidentWorkflow.js)
--                                and the V398 stage ledger keep working. Per-team
--                                granularity now lives in accident_case_workstreams;
--                                three-level closure lives in accidents.closure_level.
--   * accident_stage_events   -> V398 stage ledger. Reused as-is for stage timing.
--   * departments             -> V302 department registry. Reused (team ownership
--                                on workstreams / SLAs is a department NAME).
--   * accident_routing_rules  -> V302 notification routing. Reused as-is.
--   * accident_email_templates-> V302/V303 approved templates. Reused as-is.
--   * accident_audit_log      -> existing per-accident audit trail. Reused as the
--                                case audit trail (no new audit_logs table).
--   * accident_remarks        -> existing per-accident comments. Superseded for
--                                external / email threads by accident_case_communications,
--                                but kept; internal comments may still write to it.
--   * accident_parts          -> existing per-accident parts consumed. Kept.
--
--   NAMING: existing generic tables insurance_claims, corrective_actions and
--   sla_records are STANDALONE ledgers NOT linked to accidents.id (verified live:
--   none carry an accident_id). To avoid a silent `create table if not exists`
--   no-op against an incompatible shape, and to keep the module cohesive, ALL new
--   case tables are prefixed `accident_`. The case-scoped insurance / corrective /
--   SLA tables here are therefore accident_insurance_claims,
--   accident_corrective_actions, accident_sla_* - distinct from the generic ones.
--
-- WHAT IS CREATED vs PHASE-LATER
--   CREATED here: the case columns (incl. case_status + the transient
--   reopened_flag / total_loss_route signals), 30 tables covering all ten
--   workstreams, route/type/country config profiles, the SLA definition/instance/
--   pause tables, the closure requirement/review tables, the insurance / repair /
--   finance children, the per-capability write RLS (C2), the capability-envelope
--   seed (C3), and - NEW in rev. 2 - the closure enforcement guard (PART G, C1).
--   PHASE-LATER (documented in 02_DATA_MODEL.md / 06_RESOLUTION.md, NOT in this
--   migration): the full status-derivation trigger accident_derive_case_status
--   (sets case_status + clears the transient reopened_flag / total_loss_route), the
--   route-instantiation trigger (seeds workstream + closure-requirement rows), the
--   completion-% recompute, the FULL capability + SoD + accident_can_close guard
--   enforce_accident_action_capability (03 sec 6.3 - a superset of PART G's minimal
--   closure gate), the SLA clock/escalation cron with its working-calendar +
--   holiday tables (accident_working_calendars / accident_country_holidays), the
--   field-level audit table (accident_audit_logs), the email reply-token ingestion
--   (accident_case_communications is created; the inbound edge fn is later), and the
--   external-portal grant (accident_external_grants). Each lands in a later numbered
--   migration once its JS mirror ships; none is required by the closure gate or the
--   completeness engine that THIS migration must support.
--
-- NON-DESTRUCTIVE
--   Only ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS. No column or row
--   is dropped or altered. workflow_stage/status/closure_status untouched. Backfill
--   only fills the NEW columns and is guarded by IS NULL so re-running is safe. The
--   closure guard (PART G) is BEFORE UPDATE and only fires on a transition INTO a
--   fully-closed state (is-distinct-from guarded), so every existing mobile / import
--   / register writer that does not touch closure_level or case_status is untouched.
--   The guard is created AFTER the Part-A backfill so the migration's own
--   legacy_closed backfill is never blocked by it.
--
-- SECURITY (house pattern, grounded in V300 / V358 / V398)
--   Case-scoped tables carry organisation_id + accident_id + country + site and get:
--     <t>_org_isolation      RESTRICTIVE FOR ALL    (org = app_current_org() OR super)
--     <t>_country_isolation  RESTRICTIVE FOR SELECT  (app_can_see_country(country))
--     <t>_site_isolation     RESTRICTIVE FOR SELECT  (app_can_see_site(site))
--     <t>_select             PERMISSIVE  FOR SELECT  (app_is_active())
--     <t>_write              PERMISSIVE  FOR ALL      (app_is_elevated()
--                                                       OR app_user_can('accidents',<cap>))
--                            WITH CHECK also (app_can_see_country(country)
--                                              AND app_can_see_site(site))   -- C2 + M1
--   <cap> is the owning capability of the table's workstream (the map in PART E),
--   so a non-elevated Insurance Claims Officer granted 'edit_insurance' writes the
--   claim children but not the handover, and a KSA-scoped writer cannot post an
--   Egypt case's money row. Admin/manager/director keep full write via
--   app_is_elevated(). This replaces the flat elevated-only write that both locked
--   every team role out and gave the three elevated roles zero segregation.
--   Config/profile tables carry organisation_id only and get org_isolation +
--   _select(active) + _write(elevated) - no country/site scoping (config is shared).
--   Zero-arg helpers are wrapped in (select ...) so they evaluate once per query
--   (initplan optimisation, per PROJECT_MEMORY V234/V396). anon is revoked on every
--   new table; authenticated is granted and RLS governs.
--
-- ROLLBACK
--   See the ROLLBACK block at the very bottom of this file. It drops every new
--   table (CASCADE handles the FKs and policies) and the added accidents columns,
--   restoring the pre-V417 shape exactly. Backfilled values live only in the new
--   columns, so dropping the columns removes them cleanly.
-- =============================================================================

begin;

-- =============================================================================
-- PART A - Extend `accidents` as the case root (additive only)
-- =============================================================================
alter table public.accidents
  add column if not exists case_no               text,
  add column if not exists case_status           text,        -- H2: the 30-value derived headline
  add column if not exists route_key             text,
  add column if not exists closure_level         text,
  add column if not exists completion_incident   numeric(5,2),
  add column if not exists completion_insurance  numeric(5,2),
  add column if not exists completion_repair     numeric(5,2),
  add column if not exists completion_financial  numeric(5,2),
  add column if not exists completion_overall    numeric(5,2),
  add column if not exists case_flags            jsonb   not null default '{}'::jsonb,
  -- Permanent reopen audit (history - never reset): counts every reopen ever.
  add column if not exists is_reopened           boolean not null default false,
  add column if not exists reopen_count          integer not null default 0,
  add column if not exists reopened_reason       text,
  add column if not exists reopened_by           uuid,
  add column if not exists reopened_at           timestamptz,
  -- H6: TRANSIENT signals the derive trigger sets and CLEARS, distinct from the
  -- permanent audit flags above. reopened_flag is true only while a reopened case
  -- awaits re-triage (cleared once it is re-assigned to a workstream), and
  -- total_loss_route is true only while the total-loss path is being worked
  -- (cleared when its finance / closure workstreams complete). deriveCaseStatus
  -- (accidentCase.js) reads THESE, so a reopened case progresses again and a
  -- total-loss case can reach closure_review / closed instead of being pinned.
  add column if not exists reopened_flag         boolean not null default false,
  add column if not exists total_loss_route      boolean not null default false,
  add column if not exists cancelled_duplicate_of uuid references public.accidents(id),
  add column if not exists legal_hold            boolean not null default false;

-- closure_level is the three-level gate (brief section 3 / 8). H3: tokens mirror
-- accidentCase.closureLevel() EXACTLY - open / operationally_completed /
-- financially_open / fully_closed - plus 'legacy_closed' (M4) for the honest
-- backfill of pre-module closed rows whose closure requirements were never
-- verified. 'financially_pending' is dropped (the engine emits 'financially_open').
-- Constraint guarded so a re-run does not error.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_accident_closure_level') then
    alter table public.accidents
      add constraint chk_accident_closure_level check (
        closure_level is null or closure_level = any (array[
          'open','operationally_completed','financially_open','fully_closed','legacy_closed'])
      );
  end if;
end $$;

-- H2: case_status is the 30-value derived headline (accidentCase.CASE_STATUSES).
-- It is a PROJECTION written only by the phase-later derive trigger; the CHECK is
-- widen-guarded (drop+recreate-if-absent) so a future status can be added without
-- an ALTER error. Mirror rule: change this list and accidentCase.CASE_STATUS_TOKENS
-- together (pinned by a test, exactly like accident_stage_order <-> STAGE_FLOW).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_accident_case_status') then
    alter table public.accidents
      add constraint chk_accident_case_status check (
        case_status is null or case_status = any (array[
          'draft','submitted','evidence_incomplete','under_fleet_validation',
          'liability_assessment','insurance_review','claim_registration_pending',
          'awaiting_insurer_response','technical_assessment','repair_decision_pending',
          'repair_planning','awaiting_fleet_approval','awaiting_parts','awaiting_quotation',
          'awaiting_po','awaiting_external_workshop','repair_in_progress',
          'workshop_quality_inspection','fleet_inspection','rectification_required',
          'operationally_completed','insurance_settlement_pending','financial_closure_pending',
          'corrective_actions_pending','closure_review','closed','reopened',
          'cancelled_duplicate','total_loss_processing','legal_hold'])
      );
  end if;
end $$;

-- One case number per org. Format: TP-ACC-<COUNTRY>-<YYYY>-<NNNNNN>.
create unique index if not exists accidents_org_case_no_uidx
  on public.accidents (organisation_id, case_no) where case_no is not null;

-- Backfill the new columns for the existing ~38 accidents (guarded by IS NULL).
-- Preserves reference_no + workflow_stage untouched; derives a stable case_no and
-- an honest closure_level from the row's current state. No history invented.
--
-- M5: case_no is the country-prefixed DISPLAY form of the EXISTING reference_no
-- (format ACC-YYYY-####) so the two identifiers share ONE sequence number and can
-- never disagree - the country segment is a render concern (05 sec C.1), not a
-- second independent row_number() sequence. Rows with no reference_no fall back to
-- a scoped per-country/year sequence.
-- RE-RUN SAFETY (M5): the only rows numbered here are those still lacking a
-- case_no (`where case_no is null`), so an already-numbered row is never touched.
-- But a naive row_number() restarts at 1 on every apply, which on a re-run would
-- collide with case numbers already persisted on the first run and fail the unique
-- index accidents_org_case_no_uidx. We therefore offset the fallback sequence PAST
-- the highest numeric suffix ALREADY in use in each (org, country, year) partition,
-- so a re-run can only ever assign brand-new, non-colliding numbers (and a first
-- apply, with no existing case_no, offsets by 0 = the original behaviour).
with existing_seq as (
  select organisation_id,
         coalesce(nullif(upper(btrim(country)), ''), 'GEN') as country_key,
         extract(year from coalesce(incident_date, created_at::date))::int as yr,
         max(coalesce((substring(case_no from '(\d+)$'))::bigint, 0)) as max_seq
    from public.accidents
   where case_no is not null
   group by 1, 2, 3
),
ranked as (
  select a.id,
    case
      when nullif(btrim(a.reference_no), '') is not null then
        'TP-ACC-' || coalesce(nullif(upper(btrim(a.country)), ''), 'GEN') || '-' ||
        regexp_replace(btrim(a.reference_no), '^ACC-', '')
      else
        'TP-ACC-' || coalesce(nullif(upper(btrim(a.country)), ''), 'GEN') || '-' ||
        to_char(coalesce(a.incident_date, a.created_at::date), 'YYYY') || '-' ||
        lpad((
          coalesce(es.max_seq, 0) +
          row_number() over (
            partition by a.organisation_id,
                         coalesce(nullif(upper(btrim(a.country)), ''), 'GEN'),
                         extract(year from coalesce(a.incident_date, a.created_at::date))
            order by a.created_at, a.id)
        )::text, 6, '0')
    end as cno
  from public.accidents a
  left join existing_seq es
    on es.organisation_id = a.organisation_id
   and es.country_key = coalesce(nullif(upper(btrim(a.country)), ''), 'GEN')
   and es.yr = extract(year from coalesce(a.incident_date, a.created_at::date))::int
  where a.case_no is null
)
update public.accidents a
   set case_no = r.cno
  from ranked r
 where a.id = r.id;

-- M4: a legacy closed row is 'legacy_closed', NEVER 'fully_closed' - its closure
-- requirements were never verified by this module. The honesty flag
-- case_flags.closure_basis='backfilled' travels with it so closure analytics can
-- exclude / label it and the closure guard (PART G) never treats it as a verified
-- full closure.
update public.accidents
   set closure_level = case
         when closure_status = 'closed' or status = 'closed' or workflow_stage = 'closed'
           then 'legacy_closed'
         when workflow_stage in ('vehicle_release', 'cost_recovery')
           then 'operationally_completed'
         else 'open'
       end,
       case_flags = case
         when closure_status = 'closed' or status = 'closed' or workflow_stage = 'closed'
           then case_flags || jsonb_build_object('closure_basis', 'backfilled')
         else case_flags
       end
 where closure_level is null;

alter table public.accidents alter column closure_level set default 'open';

-- H2: backfill case_status only for the UNAMBIGUOUS terminal rows. Every non-
-- terminal legacy row is left NULL for the phase-later derive trigger to compute
-- from its workstreams - inventing a fine status for a legacy row would be exactly
-- the "history invented" the backfill must avoid.
update public.accidents
   set case_status = case
         when closure_status = 'closed' or status = 'closed' or workflow_stage = 'closed' then 'closed'
         when workflow_stage = 'cancelled'                                                then 'cancelled_duplicate'
         else null
       end
 where case_status is null;

-- =============================================================================
-- PART B - Case-scoped operational tables (Group A)
--   Every table: organisation_id + accident_id + country + site (denormalized from
--   the parent case, exactly like accident_stage_events) so the country/site
--   isolation policies apply uniformly. created_by/created_at/updated_at standard.
-- =============================================================================

-- B1. Workstreams - the six-plus controlled sections of a case (brief section 5).
create table if not exists public.accident_case_workstreams (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  -- H1: the ten canonical workstream keys - mirrors accidentCase.WORKSTREAM_KEYS
  -- EXACTLY. The finer repair sub-steps (decision / planning / execution) are
  -- CASE_STATUSES, not workstreams (03 sec 2.1): repair is ONE workstream with one
  -- "repair route complete" closure test. The route seeds (PART F) and the
  -- completeness engine both use this same 10-key set, so required_workstreams now
  -- intersects the CHECK.
  workstream_key   text not null check (workstream_key = any (array[
                     'incident_evidence','fleet_validation','liability','insurance',
                     'assessment','repair','workshop_qc','handover','finance','corrective'])),
  -- H1: status tokens mirror accidentCase.WORKSTREAM_STATUS (waiting_info, not
  -- waiting_information).
  status           text not null default 'not_started' check (status = any (array[
                     'not_required','not_started','assigned','in_progress','waiting_info',
                     'waiting_approval','waiting_external','on_hold','completed','rejected',
                     'reopened','cancelled'])),
  required         boolean not null default true,
  owner_id         uuid,
  owner_role       text,
  team             text,                         -- department NAME (departments.name)
  progress_pct     numeric(5,2),
  assigned_at      timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  not_applicable   boolean not null default false,
  na_reason        text,
  na_by            uuid,
  na_at            timestamptz,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (accident_id, workstream_key)
);

-- B2. Evidence - uploaded photos / videos / documents against a requirement.
create table if not exists public.accident_evidence (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  workstream_key   text,
  requirement_key  text,                         -- e.g. photo_full_front, police_report
  category         text,
  kind             text not null default 'document' check (kind = any (array['photo','video','document'])),
  storage_ref      text,
  file_name        text,
  mime_type        text,
  byte_size        bigint,
  caption          text,
  document_type    text,
  document_date    date,
  mandatory        boolean not null default false,
  verification_status text not null default 'unverified'
                     check (verification_status = any (array['unverified','verified','rejected'])),
  verified_by      uuid,
  verified_at      timestamptz,
  is_exception     boolean not null default false,  -- authorised missing-evidence override
  exception_reason text,
  exception_approved_by uuid,
  version          integer not null default 1,
  uploaded_by      uuid,
  uploaded_at      timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B3. Authority reports - Najm / Traffic Police / Site Security etc (configurable).
create table if not exists public.accident_authority_reports (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  authority_type   text,                         -- free text; valid set per accident_country_rule_profiles
  report_no        text,
  report_date      date,
  report_status    text not null default 'pending' check (report_status = any (array['available','pending','none'])),
  no_report_reason text,
  liability_available boolean not null default false,
  liability_pct_our   numeric(5,2),
  liability_pct_third numeric(5,2),
  storage_ref      text,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B4. Liability assessment - one per case; approved value is locked (brief 5.3).
create table if not exists public.accident_liability_assessments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  liability_type   text check (liability_type = any (array[
                     'our_driver_full','our_driver_partial','third_party_full','shared',
                     'under_investigation','disputed','hit_and_run','no_third_party','not_applicable'])),
  our_liability_pct   numeric(5,2),
  third_party_pct     numeric(5,2),
  other_party_pct     numeric(5,2),
  preventable      text check (preventable = any (array['preventable','non_preventable','under_review'])),
  severity_classification text,
  immediate_cause  text,
  root_cause       text,
  contributing_factors text,
  driver_violation text,
  unsafe_act       text,
  unsafe_condition text,
  weather_condition text,
  road_condition   text,
  approved         boolean not null default false,
  approved_by      uuid,
  approved_at      timestamptz,
  locked           boolean not null default false,
  change_reason    text,
  supporting_document text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (accident_id)
);

-- B5. Insurance claim (case-scoped; distinct from generic public.insurance_claims).
create table if not exists public.accident_insurance_claims (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  insurance_applicable boolean not null default true,
  policy_id        uuid,
  policy_no        text,
  insurer          text,
  broker           text,
  coverage_type    text,
  policy_valid_on_date boolean,
  claim_no         text,
  claim_registered_date date,
  deductible       numeric,
  coverage_excess  numeric,
  decision         text not null default 'not_required' check (decision = any (array[
                     'not_required','under_review','documents_incomplete','registered',
                     'awaiting_acknowledgement','awaiting_surveyor','survey_completed','awaiting_decision',
                     'fully_approved','partially_approved','rejected','withdrawn','settled',
                     'disputed','legal_escalation'])),
  approved_amount  numeric,
  rejected_amount  numeric,
  exclusions       text,
  rejection_reason text,
  insurer_repair_route text,
  surveyor_name    text,
  surveyor_appointed_at timestamptz,
  surveyor_inspected_at timestamptz,
  acknowledgement_ref text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B6. Claim documents - required vs received checklist.
create table if not exists public.accident_claim_documents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  claim_id         uuid references public.accident_insurance_claims(id) on delete cascade,
  country          text,
  site             text,
  doc_type         text not null,
  doc_name         text,
  storage_ref      text,
  required         boolean not null default true,
  received         boolean not null default false,
  received_at      timestamptz,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B7. Insurance decisions - the ledger of insurer decisions/events on a claim.
create table if not exists public.accident_insurance_decisions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  claim_id         uuid references public.accident_insurance_claims(id) on delete cascade,
  country          text,
  site             text,
  decision         text not null check (decision = any (array[
                     'fully_approved','partially_approved','rejected','withdrawn','documents_requested',
                     'survey_ordered','acknowledged','settled','disputed'])),
  amount           numeric,
  decided_at       timestamptz,
  decided_by_party text,
  remarks          text,
  storage_ref      text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B8. Insurance settlements - money moved on a claim (payment / recovery / refund).
create table if not exists public.accident_insurance_settlements (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  claim_id         uuid references public.accident_insurance_claims(id) on delete cascade,
  country          text,
  site             text,
  settlement_type  text not null default 'claim_payment'
                     check (settlement_type = any (array['claim_payment','recovery','refund','deductible'])),
  amount           numeric,
  currency         text,
  settled_at       date,
  payment_reference text,
  remarks          text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B9. Damage assessment - workshop technical inspection (brief 5.5).
create table if not exists public.accident_damage_assessments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  assessor_id      uuid,
  assessor_name    text,
  assessed_at      timestamptz,
  damage_areas     jsonb not null default '[]'::jsonb,   -- [{area, severity, note}]
  visible_damage   text,
  hidden_damage    text,
  estimated_labour_hours numeric,
  estimated_parts_cost   numeric,
  estimated_total_cost   numeric,
  recommended_route text check (recommended_route is null or recommended_route = any (array[
                     'none','temporary','internal','external','insurer_approved','dealer','specialist',
                     'replacement','total_loss','disposal','under_review'])),
  recommended_offroad    boolean,
  estimated_downtime_days numeric,
  specialist_required    boolean not null default false,
  total_loss_possible    boolean not null default false,
  assessment_status text not null default 'draft'
                     check (assessment_status = any (array['draft','submitted','approved','rejected'])),
  approved_by      uuid,
  approved_at      timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B10. Repair orders - the repair route + workshop + PO + schedule (brief 5.6-5.9).
create table if not exists public.accident_repair_orders (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  repair_route     text check (repair_route is null or repair_route = any (array[
                     'none','temporary','internal','external','insurer_approved','dealer','specialist',
                     'replacement','total_loss','disposal','under_review'])),
  workshop_type    text check (workshop_type is null or workshop_type = any (array[
                     'internal','external','insurer_approved','dealer','specialist'])),
  workshop_name    text,
  vendor_id        uuid,
  external_workshop text,
  po_required      boolean not null default false,
  po_reference     text,
  insurer_approval_required boolean not null default false,
  insurer_approved boolean not null default false,
  quotation_amount numeric,
  approved_amount  numeric,
  planned_start    date,
  planned_completion date,
  actual_start     date,
  actual_completion date,
  offroad_start    date,
  status           text not null default 'planned' check (status = any (array[
                     'planned','awaiting_parts','awaiting_po','awaiting_quotation','in_progress',
                     'qc_pending','qc_passed','qc_failed','completed','cancelled'])),
  recommended_by   uuid,
  approved_by      uuid,
  approved_at      timestamptz,
  approval_remarks text,
  delay_reason     text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B11. Repair tasks - a repair order broken into tasks (brief 5.7).
create table if not exists public.accident_repair_tasks (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  repair_order_id  uuid references public.accident_repair_orders(id) on delete cascade,
  country          text,
  site             text,
  title            text not null,
  description      text,
  estimated_hours  numeric,
  actual_hours     numeric,
  assignee_id      uuid,
  assignee_name    text,
  status           text not null default 'open' check (status = any (array[
                     'open','assigned','in_progress','waiting','blocked','completed','cancelled'])),
  sort_order       integer not null default 100,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B12. Repair quality checks - workshop QC before handover (brief 5.10).
create table if not exists public.accident_repair_quality_checks (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  repair_order_id  uuid references public.accident_repair_orders(id) on delete cascade,
  country          text,
  site             text,
  inspector_id     uuid,
  inspector_name   text,
  inspected_at     timestamptz,
  checklist        jsonb not null default '[]'::jsonb,
  road_test_done   boolean,
  alignment_ok     boolean,
  tyres_ok         boolean,
  no_leaks         boolean,
  warning_lights_clear boolean,
  result           text not null default 'fail' check (result = any (array['pass','fail','conditional'])),
  remarks          text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B13. Parts requests - Store / Procurement requests for a repair (brief 5.7).
create table if not exists public.accident_parts_requests (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  repair_order_id  uuid references public.accident_repair_orders(id) on delete set null,
  country          text,
  site             text,
  request_no       text,
  status           text not null default 'requested' check (status = any (array[
                     'requested','approved','issued','fulfilled','rejected','cancelled'])),
  items            jsonb not null default '[]'::jsonb,   -- [{part_no, name, qty, available, cost}]
  procurement_required boolean not null default false,
  po_reference     text,
  requested_by     uuid,
  requested_at     timestamptz,
  fulfilled_at     timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B14. Vehicle downtime + replacement (brief 5.8).
create table if not exists public.accident_vehicle_downtime (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  offroad_reason   text,
  vehicle_status   text check (vehicle_status is null or vehicle_status = any (array[
                     'operational','restricted','awaiting_recovery','off_road_accident','under_inspection',
                     'under_repair','ready_for_inspection','rejected_after_repair','returned_to_operation',
                     'total_loss','disposed'])),
  offroad_start    date,
  offroad_end      date,
  planned_downtime_days numeric,
  actual_downtime_days  numeric,
  replacement_required  boolean not null default false,
  replacement_asset_no  text,
  replacement_allocated_at date,
  recovery_required     boolean not null default false,
  towing_reference      text,
  delivered_to_workshop_at date,
  expected_return_date  date,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B15. Fleet handover inspection - acceptance is separate from workshop QC (brief 5.11).
create table if not exists public.accident_handover_inspections (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  inspector_id     uuid,
  inspector_name   text,
  inspected_at     timestamptz,
  matches_approved_scope boolean,
  operational_test_done  boolean,
  decision         text not null default 'rejected'
                     check (decision = any (array['accepted','rejected','rectification_required'])),
  rejection_reason text,
  remarks          text,
  return_to_service_date date,
  actual_downtime_days   numeric,
  photos           jsonb not null default '[]'::jsonb,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B16. Financial transactions - each cost/recovery line (brief 5.12).
create table if not exists public.accident_financial_transactions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  txn_type         text not null check (txn_type = any (array[
                     'repair_estimate','internal_labour','internal_parts','external_repair','towing',
                     'storage','third_party_cost','po_amount','invoice_amount','insurer_approved',
                     'deductible','insurance_payment','third_party_recovery','unrecovered','company_loss'])),
  direction        text not null default 'cost' check (direction = any (array['cost','recovery','neutral'])),
  amount           numeric not null default 0,
  currency         text,
  reference        text,
  po_reference     text,
  invoice_reference text,
  description      text,
  posted_by        uuid,
  posted_at        timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B17. Claim recoveries - money to be / actually recovered (brief 5.12 / 13).
create table if not exists public.accident_claim_recoveries (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  source           text not null default 'insurer'
                     check (source = any (array['insurer','third_party','driver','other'])),
  amount           numeric,
  expected_amount  numeric,
  currency         text,
  status           text not null default 'pending' check (status = any (array[
                     'pending','in_progress','partial','recovered','written_off','not_applicable'])),
  recovered_at     date,
  reference        text,
  remarks          text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B18. Corrective / preventive actions raised from a case (brief 5.3). Distinct
--      from the generic public.corrective_actions module (not accident-linked).
create table if not exists public.accident_corrective_actions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  action_type      text not null default 'corrective'
                     check (action_type = any (array['corrective','preventive'])),
  title            text not null,
  description      text,
  source_root_cause text,
  owner_id         uuid,
  owner_name       text,
  due_date         date,
  status           text not null default 'open' check (status = any (array[
                     'open','in_progress','completed','overdue','cancelled'])),
  completed_at     timestamptz,
  evidence_ref     text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B19. Case tasks - the actionable to-dos surfaced in role inboxes (brief 11 / 12.4).
create table if not exists public.accident_case_tasks (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  workstream_key   text,
  sla_instance_id  uuid,                          -- FK added after B22 exists (see below)
  title            text not null,
  description      text,
  assignee_id      uuid,
  assignee_role    text,
  team             text,
  priority         text not null default 'medium'
                     check (priority = any (array['low','medium','high','critical'])),
  due_at           timestamptz,
  status           text not null default 'open' check (status = any (array[
                     'open','assigned','in_progress','waiting','blocked','completed','cancelled'])),
  completed_at     timestamptz,
  completed_by     uuid,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B20. Case approvals - liability, repair route, estimate, PO, NA waiver, reopen, closure.
create table if not exists public.accident_case_approvals (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  approval_type    text not null,                 -- liability | repair_route | estimate | po | na_waiver | scope_change | reopen | closure
  workstream_key   text,
  amount           numeric,
  requested_by     uuid,
  requested_at     timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  decision         text not null default 'pending'
                     check (decision = any (array['pending','approved','rejected','delegated','cancelled'])),
  reason           text,
  reference        text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B21. Case communications - chronological in-app / email / call / external thread.
create table if not exists public.accident_case_communications (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  channel          text not null default 'comment' check (channel = any (array[
                     'in_app','email_out','email_in','comment','call','external_portal'])),
  direction        text not null default 'internal'
                     check (direction = any (array['outbound','inbound','internal'])),
  subject          text,
  body             text,
  from_party       text,
  to_party         text,
  external_party_type text,                       -- insurer | broker | workshop | surveyor | recovery | vendor
  reply_token      text,                          -- unique per outgoing email for inbound capture
  message_id       text,
  attachments      jsonb not null default '[]'::jsonb,
  workstream_key   text,
  related_task_id  uuid,
  occurred_at      timestamptz not null default now(),
  author_id        uuid,
  author_name      text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B22. SLA instances - a live timer on a case activity (brief 10 / 15).
create table if not exists public.accident_sla_instances (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  sla_key          text not null,
  sla_definition_id uuid,
  name             text,
  workstream_key   text,
  owner_id         uuid,
  team             text,
  start_at         timestamptz not null default now(),
  due_at           timestamptz,
  target_minutes   integer,
  warning_at       timestamptz,
  escalation_at    timestamptz,
  escalation_level integer not null default 0,
  state            text not null default 'running' check (state = any (array[
                     'running','paused','met','breached','cancelled'])),
  paused           boolean not null default false,
  total_paused_minutes integer not null default 0,
  completed_at     timestamptz,
  breached         boolean not null default false,
  breach_minutes   integer,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- B23. SLA pause events - reason + expected resume are MANDATORY (brief 10).
create table if not exists public.accident_sla_pause_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  sla_instance_id  uuid not null references public.accident_sla_instances(id) on delete cascade,
  country          text,
  site             text,
  reason           text not null check (reason = any (array[
                     'waiting_authority_report','waiting_driver','waiting_third_party','waiting_insurer',
                     'waiting_surveyor','waiting_management_approval','waiting_quotation','waiting_po',
                     'waiting_parts','waiting_workshop_capacity','vehicle_unavailable','legal_hold',
                     'weather_delay','site_access_restriction','other'])),
  comments         text,
  paused_at        timestamptz not null default now(),
  expected_resume_at timestamptz not null,        -- brief: cannot pause without a follow-up date
  resumed_at       timestamptz,
  paused_by        uuid,
  approved_by      uuid,
  approved_at      timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Deferred FK: case task -> its SLA instance (both tables now exist).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accident_case_tasks_sla_fk') then
    alter table public.accident_case_tasks
      add constraint accident_case_tasks_sla_fk
      foreign key (sla_instance_id) references public.accident_sla_instances(id) on delete set null;
  end if;
end $$;

-- B24. Closure requirements - the per-route mandatory checklist that gates closure.
create table if not exists public.accident_closure_requirements (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  requirement_key  text not null,                 -- incident_evidence | liability | insurance | assessment | repair | qc | handover | financial | corrective_actions | no_overdue | no_pending_approval | no_missing_docs | closure_review
  label            text,
  mandatory        boolean not null default true,
  satisfied        boolean not null default false,
  satisfied_at     timestamptz,
  satisfied_by     uuid,
  not_applicable   boolean not null default false,
  na_reason        text,
  na_by            uuid,
  na_at            timestamptz,
  blocker_note     text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (accident_id, requirement_key)
);

-- B25. Closure reviews - the manager sign-off per closure level (brief 8).
create table if not exists public.accident_closure_reviews (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  -- H3: level tokens aligned to accidentCase.closureLevel() (financially_open).
  level            text not null check (level = any (array[
                     'operationally_completed','financially_open','fully_closed'])),
  reviewer_id      uuid,
  reviewed_at      timestamptz,
  decision         text not null default 'approved'
                     check (decision = any (array['approved','rejected','returned'])),
  blockers         jsonb not null default '[]'::jsonb,
  remarks          text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- =============================================================================
-- PART C - Configuration / profile tables (Group B, org-scoped, no country/site RLS)
-- =============================================================================

-- C1. Evidence requirement profiles - the photo/document checklist per route/type.
create table if not exists public.accident_evidence_requirements (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  route_key        text,
  accident_type    text,
  country          text,
  requirement_key  text not null,
  label            text,
  category         text,
  kind             text not null default 'photo' check (kind = any (array['photo','video','document'])),
  mandatory        boolean not null default true,
  sort_order       integer not null default 100,
  active           boolean not null default true,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- C2. SLA definitions - configurable timers (brief 10 / 15).
create table if not exists public.accident_sla_definitions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  sla_key          text not null,
  name             text not null,
  activity         text,
  workstream_key   text,
  target_minutes   integer not null,
  business_hours   boolean not null default true,
  warning_pct      numeric not null default 80,
  escalation_pct   numeric not null default 100,
  working_calendar text,
  country          text,
  responsible_role text,
  responsible_team text,
  active           boolean not null default true,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, sla_key)
);

-- C3. Route profiles - required workstreams / evidence / docs per case route (brief 4 / 9).
create table if not exists public.accident_route_profiles (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  route_key        text not null,
  name             text,
  description      text,
  match_types      text[] not null default '{}',
  required_workstreams  text[] not null default '{}',
  required_evidence     text[] not null default '{}',
  required_documents    text[] not null default '{}',
  closure_requirements  text[] not null default '{}',
  is_default       boolean not null default false,
  active           boolean not null default true,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, route_key)
);

-- C4. Accident type profiles - default route + teams + SLA overrides per type (brief 4).
create table if not exists public.accident_type_profiles (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_type    text not null,
  default_route_key text,
  required_teams   text[] not null default '{}',
  email_recipient_roles text[] not null default '{}',
  sla_overrides    jsonb not null default '{}'::jsonb,
  reporting_category text,
  active           boolean not null default true,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, accident_type)
);

-- C5. Country rule profiles - authority names, doc requirements, regulatory SLA days,
--     currency, working calendar. Nothing regulatory is hardcoded (brief 3 / 5.4).
create table if not exists public.accident_country_rule_profiles (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  country          text not null,
  currency         text,
  authority_types  text[] not null default '{}',
  required_documents text[] not null default '{}',
  regulatory_missing_docs_days integer,
  regulatory_decision_days     integer,
  regulatory_settlement_days   integer,
  working_days     text[] not null default '{}',
  holidays         jsonb not null default '[]'::jsonb,
  notes            text,
  active           boolean not null default true,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, country)
);

-- =============================================================================
-- PART D - Indexes
-- =============================================================================
do $$
declare t text;
begin
  -- Every case-scoped table gets a (accident_id) lookup index and an org index.
  foreach t in array array[
    'accident_case_workstreams','accident_evidence','accident_authority_reports',
    'accident_liability_assessments','accident_insurance_claims','accident_claim_documents',
    'accident_insurance_decisions','accident_insurance_settlements','accident_damage_assessments',
    'accident_repair_orders','accident_repair_tasks','accident_repair_quality_checks',
    'accident_parts_requests','accident_vehicle_downtime','accident_handover_inspections',
    'accident_financial_transactions','accident_claim_recoveries','accident_corrective_actions',
    'accident_case_tasks','accident_case_approvals','accident_case_communications',
    'accident_sla_instances','accident_sla_pause_events','accident_closure_requirements',
    'accident_closure_reviews'
  ]
  loop
    execute format('create index if not exists %1$s_accident_idx on public.%1$s (accident_id);', t);
    execute format('create index if not exists %1$s_org_idx on public.%1$s (organisation_id);', t);
  end loop;
end $$;

-- A few targeted secondary indexes for the hot inbox / SLA / comms reads.
create index if not exists accident_case_tasks_inbox_idx
  on public.accident_case_tasks (organisation_id, status, due_at);
create index if not exists accident_case_tasks_assignee_idx
  on public.accident_case_tasks (assignee_id, status);
create index if not exists accident_sla_instances_state_idx
  on public.accident_sla_instances (organisation_id, state, due_at);
create index if not exists accident_case_communications_token_idx
  on public.accident_case_communications (reply_token) where reply_token is not null;
create index if not exists accident_case_approvals_pending_idx
  on public.accident_case_approvals (organisation_id, decision) where decision = 'pending';
create index if not exists accident_claim_documents_claim_idx
  on public.accident_claim_documents (claim_id);
create index if not exists accident_repair_tasks_order_idx
  on public.accident_repair_tasks (repair_order_id);
create index if not exists accident_sla_pause_events_instance_idx
  on public.accident_sla_pause_events (sla_instance_id);

-- =============================================================================
-- PART E - RLS + grants + updated_at triggers
--   Group A (case-scoped): org RESTRICTIVE + country + site + active-select + elevated-write
--   Group B (config):      org RESTRICTIVE + active-select + elevated-write
--   Zero-arg helpers wrapped in (select ...) for initplan; app_can_see_* take the
--   row column and stay un-wrapped (row-dependent).
-- =============================================================================
do $$
declare
  t text;
  v_cap text;
  group_a text[] := array[
    'accident_case_workstreams','accident_evidence','accident_authority_reports',
    'accident_liability_assessments','accident_insurance_claims','accident_claim_documents',
    'accident_insurance_decisions','accident_insurance_settlements','accident_damage_assessments',
    'accident_repair_orders','accident_repair_tasks','accident_repair_quality_checks',
    'accident_parts_requests','accident_vehicle_downtime','accident_handover_inspections',
    'accident_financial_transactions','accident_claim_recoveries','accident_corrective_actions',
    'accident_case_tasks','accident_case_approvals','accident_case_communications',
    'accident_sla_instances','accident_sla_pause_events','accident_closure_requirements',
    'accident_closure_reviews'];
  group_b text[] := array[
    'accident_evidence_requirements','accident_sla_definitions','accident_route_profiles',
    'accident_type_profiles','accident_country_rule_profiles'];
  -- C2: table -> the accident capability that owns writes to it (03 sec 6.2/6.3
  -- role x action matrix). A non-elevated team role granted this cap (C3 seed or a
  -- per-user user_access_grants row) can write its OWN workstream table; every
  -- table is ALSO writable by admin/manager/director via app_is_elevated(). The
  -- finer per-row sub-capability + SoD gating is the phase-later
  -- enforce_accident_action_capability guard (03 sec 6.3); this per-table owning
  -- cap is the shipped interim that removes the flat elevated-only bypass.
  cap_map jsonb := jsonb_build_object(
    'accident_case_workstreams',        'validate',
    'accident_evidence',                'submit',
    'accident_authority_reports',       'submit',
    'accident_liability_assessments',   'approve_liability',
    'accident_insurance_claims',        'edit_insurance',
    'accident_claim_documents',         'edit_insurance',
    'accident_insurance_decisions',     'edit_insurance',
    'accident_insurance_settlements',   'edit_insurance',
    'accident_damage_assessments',      'assess',
    'accident_repair_orders',           'approve_repair',
    'accident_repair_tasks',            'execute_repair',
    'accident_repair_quality_checks',   'qc_repair',
    'accident_parts_requests',          'request_parts',
    'accident_vehicle_downtime',        'accept_handover',
    'accident_handover_inspections',    'accept_handover',
    'accident_financial_transactions',  'post_cost',
    'accident_claim_recoveries',        'post_cost',
    'accident_corrective_actions',      'approve_liability',
    'accident_case_tasks',              'submit',
    'accident_case_approvals',          'approve_liability',
    'accident_case_communications',     'submit',
    'accident_sla_instances',           'validate',
    'accident_sla_pause_events',        'validate',
    'accident_closure_requirements',    'close_case',
    'accident_closure_reviews',         'close_case');
begin
  -- ---- Group A ----
  foreach t in array group_a loop
    execute format('alter table public.%I enable row level security;', t);

    execute format($p$drop policy if exists %1$s_org_isolation on public.%1$s;$p$, t);
    execute format($p$create policy %1$s_org_isolation on public.%1$s as restrictive for all to authenticated
                      using  ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
                      with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));$p$, t);

    execute format($p$drop policy if exists %1$s_country_isolation on public.%1$s;$p$, t);
    execute format($p$create policy %1$s_country_isolation on public.%1$s as restrictive for select to authenticated
                      using (public.app_can_see_country(country));$p$, t);

    execute format($p$drop policy if exists %1$s_site_isolation on public.%1$s;$p$, t);
    execute format($p$create policy %1$s_site_isolation on public.%1$s as restrictive for select to authenticated
                      using (public.app_can_see_site(site));$p$, t);

    execute format($p$drop policy if exists %1$s_select on public.%1$s;$p$, t);
    execute format($p$create policy %1$s_select on public.%1$s for select to authenticated
                      using ((select public.app_is_active()));$p$, t);

    -- C2 + M1: write allowed to elevated OR the table's owning-capability holder,
    -- and the WITH CHECK also enforces the case's country/site scope on every
    -- INSERT/UPDATE (the SELECT-only isolation above did not constrain writes, so a
    -- KSA-scoped user could write an Egypt case's money/liability row).
    v_cap := coalesce(cap_map ->> t, 'submit');
    execute format($p$drop policy if exists %1$s_write on public.%1$s;$p$, t);
    execute format($p$create policy %1$s_write on public.%1$s for all to authenticated
                      using ((select public.app_is_elevated())
                             or (select public.app_user_can('accidents', %2$L)))
                      with check (((select public.app_is_elevated())
                                   or (select public.app_user_can('accidents', %2$L)))
                                  and public.app_can_see_country(country)
                                  and public.app_can_see_site(site));$p$, t, v_cap);

    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$s;', t);
    execute format('create trigger set_updated_at_%1$s before update on public.%1$s
                      for each row execute function public.set_updated_at();', t);

    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;

  -- ---- Group B (no country/site scoping - config is org-shared) ----
  foreach t in array group_b loop
    execute format('alter table public.%I enable row level security;', t);

    execute format($p$drop policy if exists %1$s_org_isolation on public.%1$s;$p$, t);
    execute format($p$create policy %1$s_org_isolation on public.%1$s as restrictive for all to authenticated
                      using  ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
                      with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));$p$, t);

    execute format($p$drop policy if exists %1$s_select on public.%1$s;$p$, t);
    execute format($p$create policy %1$s_select on public.%1$s for select to authenticated
                      using ((select public.app_is_active()));$p$, t);

    execute format($p$drop policy if exists %1$s_write on public.%1$s;$p$, t);
    execute format($p$create policy %1$s_write on public.%1$s for all to authenticated
                      using ((select public.app_is_elevated())) with check ((select public.app_is_elevated()));$p$, t);

    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$s;', t);
    execute format('create trigger set_updated_at_%1$s before update on public.%1$s
                      for each row execute function public.set_updated_at();', t);

    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;

-- =============================================================================
-- PART F - Seed default configuration for Company A (org 00000000-...-0001)
--   Idempotent (ON CONFLICT DO NOTHING). These are configurable DEFAULTS, not
--   hardcoded rules - an admin edits them in the console. Concrete values come
--   straight from the brief (SLA targets section 10/15, routes section 4/9,
--   KSA regulatory windows section 5.4).
-- =============================================================================
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001';
begin
  -- SLA definitions (brief internal targets). target_minutes; business_hours true.
  insert into public.accident_sla_definitions
    (organisation_id, sla_key, name, activity, workstream_key, target_minutes, business_hours, responsible_team)
  -- H1: workstream_key here uses the same ten canonical keys (accident_sla_
  -- definitions.workstream_key is free text, but keeping one vocabulary lets the
  -- phase-later SLA clock bind an activity to a real workstream row).
  values
    (v_org,'initial_registration','Initial accident registration','Register accident within 2 hours','incident_evidence',120,false,'Site Management'),
    (v_org,'fleet_validation','Fleet validation','Validate evidence within 4 working hours','fleet_validation',240,true,'Fleet / PMV'),
    (v_org,'insurance_review','Insurance review','Insurance review within 4 working hours','insurance',240,true,'Insurance'),
    (v_org,'claim_submission','Complete claim submission','Submit complete claim within 1 business day','insurance',480,true,'Insurance'),
    (v_org,'workshop_inspection','Workshop inspection','Inspect within 1 business day','assessment',480,true,'Workshop'),
    (v_org,'repair_estimate','Initial repair estimate','Estimate within 2 business days','assessment',960,true,'Workshop'),
    (v_org,'repair_decision','Repair route decision','Decide within 1 business day','repair',480,true,'Fleet / PMV'),
    (v_org,'po_after_approval','PO after approval','Raise PO within 1 business day','repair',480,true,'Procurement'),
    (v_org,'fleet_inspection','Fleet inspection after repair','Inspect within 4 working hours','handover',240,true,'Fleet / PMV'),
    (v_org,'rectification_plan','Rectification plan after rejection','Plan within 1 business day','handover',480,true,'Workshop'),
    (v_org,'closure_review','Final closure review','Review within 2 business days','finance',960,true,'Senior Management')
  on conflict (organisation_id, sla_key) do nothing;

  -- Route profiles (brief section 4 / 9). H1/H5: required_workstreams use the ten
  -- canonical keys and match accidentCase.CASE_ROUTES[route].required EXACTLY, so
  -- the config-driven completeness engine (which reads required_workstreams
  -- verbatim) agrees with the deterministic fallback classifier. Injury / total-
  -- loss specific STEPS (authority report, management review, asset register, total-
  -- loss approval) are records - accident_authority_reports, accident_case_approvals,
  -- accident_corrective_actions, accident_repair_orders/vehicle_downtime - not
  -- workstream keys, so nothing here violates the 10-key CHECK.
  insert into public.accident_route_profiles
    (organisation_id, route_key, name, description, match_types, required_workstreams, is_default)
  values
    (v_org,'minor_no_insurance','Minor accident without insurance claim',
      'Small own-damage event repaired internally, no claim.',
      array['minor_road','glass_only','tyre_wheel','no_damage'],
      array['incident_evidence','fleet_validation','liability','assessment','repair','handover','finance'],
      true),
    (v_org,'external_repair_insurance','External repair with insurance',
      'Insured event repaired at an external / insurer-approved workshop.',
      array['major_road','vehicle_to_vehicle','third_party_damage'],
      array['incident_evidence','fleet_validation','liability','insurance','assessment',
            'repair','workshop_qc','handover','finance'],
      false),
    (v_org,'total_loss','Total loss',
      'Economic or technical total loss - disposal / asset register update.',
      array['total_loss','fire','flood_weather'],
      array['incident_evidence','fleet_validation','liability','insurance','assessment','finance'],
      false),
    (v_org,'injury','Injury accident',
      'Injury / fatality - HSE investigation, management review, legal review where required.',
      array['injury','fatal'],
      array['incident_evidence','fleet_validation','liability','insurance','corrective','finance'],
      false)
  on conflict (organisation_id, route_key) do nothing;

  -- Country rule profiles. KSA windows from brief 5.4 (Unified Compulsory Motor
  -- Policy: 9 / 5 / 45 working days). UAE / Egypt seeded without regulatory windows
  -- until confirmed - authority lists are placeholders an admin edits.
  insert into public.accident_country_rule_profiles
    (organisation_id, country, currency, authority_types, regulatory_missing_docs_days,
     regulatory_decision_days, regulatory_settlement_days, working_days)
  values
    (v_org,'KSA','SAR',   array['Najm','Traffic Police','Civil Defence','Site Security','Other authority'],9,5,45,
      array['Sunday','Monday','Tuesday','Wednesday','Thursday']),
    (v_org,'UAE','AED',   array['Police','Traffic Police','Site Security','Civil Defence','Other authority'],null,null,null,
      array['Monday','Tuesday','Wednesday','Thursday','Friday']),
    (v_org,'Egypt','EGP', array['Traffic Police','Police','Site Security','Other authority'],null,null,null,
      array['Sunday','Monday','Tuesday','Wednesday','Thursday'])
  on conflict (organisation_id, country) do nothing;
end $$;

-- -----------------------------------------------------------------------------
-- C3 - Seed the 16 accident capabilities into the V229 app_user_can envelope.
--   Without this, app_user_can('accidents', <any non-view cap>) returns FALSE for
--   every non-admin (V229: a non-view cap defaults to the app_settings
--   'permission_overrides' envelope, else false), so - combined with the C2 write
--   policies and the PART G closure guard - ONLY Admin/super could act. This writes
--   the 03 sec 6.2 role x action matrix into the envelope app_user_can reads,
--   shaped exactly as it expects: overrides -> <Role> -> 'accidents' -> <cap> = true.
--
--   The envelope is a single GLOBAL app_settings row (V229's design - app_settings
--   is not org-scoped), so this seed is global; it only ever grants ACCIDENT
--   capabilities to ACCIDENT role names, and 'view' is unaffected (view still comes
--   from module_permissions). The merge is idempotent: it preserves any existing
--   overrides for other modules/roles and re-running only re-asserts the same true
--   flags. Admin/super bypass the envelope entirely (app_user_can returns true).
--   Role names are Title Case to match profiles.role (several are custom roles to
--   be seeded via custom_roles before those users exist - the grant is inert until
--   a user carries the role).
do $$
declare
  v_env      jsonb;
  v_role     text;
  v_caps     jsonb;
  v_role_obj jsonb;
  v_acc      jsonb;
  v_map jsonb := jsonb_build_object(
    'Accident Reporter',          jsonb_build_object('create',true,'submit',true),
    'Driver / Operator Reporter', jsonb_build_object('create',true,'submit',true),
    'Fleet Incident Officer',     jsonb_build_object('create',true,'submit',true),
    'Project Manager',            jsonb_build_object('create',true,'submit',true),
    'Fleet Supervisor',           jsonb_build_object('create',true,'submit',true,'validate',true),
    'Fleet Manager',              jsonb_build_object('create',true,'submit',true,'validate',true,
                                    'approve_liability',true,'approve_repair',true,'accept_handover',true,
                                    'close_case',true,'reopen_case',true,'cancel_case',true,'legal_hold',true),
    'HSE Officer',                jsonb_build_object('approve_liability',true),
    'HSE Manager',                jsonb_build_object('approve_liability',true),
    'Insurance Claims Officer',   jsonb_build_object('edit_insurance',true),
    'Insurance Manager',          jsonb_build_object('edit_insurance',true),
    'Workshop Inspector',         jsonb_build_object('assess',true),
    'Workshop Planner',           jsonb_build_object('assess',true,'approve_repair',true,
                                    'request_parts',true,'execute_repair',true),
    'Workshop Supervisor',        jsonb_build_object('approve_repair',true,'request_parts',true,
                                    'execute_repair',true,'qc_repair',true),
    'Workshop Manager',           jsonb_build_object('assess',true,'approve_repair',true,'request_parts',true,
                                    'execute_repair',true,'qc_repair',true),
    'Storekeeper',                jsonb_build_object('request_parts',true),
    'Procurement Officer',        jsonb_build_object('request_parts',true),
    'Procurement Manager',        jsonb_build_object('request_parts',true),
    'Finance Officer',            jsonb_build_object('post_cost',true),
    'Cost Controller',            jsonb_build_object('post_cost',true),
    'Fleet Inspector',            jsonb_build_object('accept_handover',true),
    'Legal Reviewer',             jsonb_build_object('legal_hold',true));
begin
  select coalesce(nullif(btrim(value), '')::jsonb, '{}'::jsonb)
    into v_env
    from public.app_settings
   where key = 'permission_overrides';
  if v_env is null then v_env := '{}'::jsonb; end if;
  if not (v_env ? 'overrides') then
    v_env := v_env || jsonb_build_object('overrides', '{}'::jsonb);
  end if;

  for v_role, v_caps in select * from jsonb_each(v_map) loop
    v_role_obj := coalesce(v_env -> 'overrides' -> v_role, '{}'::jsonb);
    v_acc      := coalesce(v_role_obj -> 'accidents', '{}'::jsonb) || v_caps;  -- idempotent merge
    v_role_obj := v_role_obj || jsonb_build_object('accidents', v_acc);
    v_env      := jsonb_set(v_env, array['overrides', v_role], v_role_obj, true);
  end loop;

  insert into public.app_settings (key, value, description)
  values ('permission_overrides', v_env::text,
          'Per-role capability defaults read by app_user_can (V229). Accident caps seeded by V417.')
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- =============================================================================
-- PART G - Closure enforcement guard (C1) - shipped WITH the closure columns
--   The review's Critical C1: closure_level / case_status were plain writable
--   columns, so any user who can UPDATE accidents could
--   `PATCH /accidents { closure_level: 'fully_closed' }` with zero requirement
--   check - the exact one-write-to-closed defect V398 exists to expose, on a new
--   column. This BEFORE-UPDATE guard closes that hole in the SAME migration that
--   adds the columns: a case may enter a fully-closed state ONLY when an APPROVED
--   fully_closed accident_closure_reviews row exists, and that reviews table is
--   itself write-gated (PART E: elevated OR the 'close_case' capability), so a
--   forged closure requires a manager-level actor.
--
--   SCOPE (deliberately minimal, documented): this guard is the closure-bypass
--   floor. The FULL server twin of accidentCase.canFullyClose - the requirement
--   conjunction (accident_can_close), the per-action capability check, the
--   segregation-of-duties check and the read-only-after-close rule - is the
--   phase-later enforce_accident_action_capability guard (03 sec 6.3). This one
--   guarantees the specific "cannot jump straight to fully closed" property today.
--   It fires only on a transition INTO a closed state (is-distinct-from guarded),
--   so it never touches the legacy status / register write paths, and it is created
--   AFTER the Part-A backfill so 'legacy_closed' rows were written before it exists.
--   No admin bypass on purpose - even an admin fully-closes through the gate.
-- =============================================================================
create or replace function public.enforce_accident_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Gate the three-level closure field: fully_closed needs an approved review.
  if NEW.closure_level = 'fully_closed'
     and OLD.closure_level is distinct from 'fully_closed' then
    if not exists (
      select 1 from public.accident_closure_reviews r
       where r.accident_id = NEW.id
         and r.level       = 'fully_closed'
         and r.decision    = 'approved'
    ) then
      raise exception
        'Cannot set closure_level=fully_closed on case %: no approved fully_closed closure review on record',
        NEW.id using errcode = '42501';
    end if;
  end if;

  -- Gate the derived headline: case_status may not jump to closed without the
  -- same approved review (the headline and the level move together).
  if NEW.case_status = 'closed'
     and OLD.case_status is distinct from 'closed' then
    if not exists (
      select 1 from public.accident_closure_reviews r
       where r.accident_id = NEW.id
         and r.level       = 'fully_closed'
         and r.decision    = 'approved'
    ) then
      raise exception
        'Cannot set case_status=closed on case %: closure gate not satisfied (no approved closure review)',
        NEW.id using errcode = '42501';
    end if;
  end if;

  return NEW;
end
$fn$;

drop trigger if exists trg_enforce_accident_closure on public.accidents;
create trigger trg_enforce_accident_closure
  before update on public.accidents
  for each row
  execute function public.enforce_accident_closure();

commit;

-- =============================================================================
-- ROLLBACK (paste and run to fully reverse V417)
-- =============================================================================
-- begin;
-- drop trigger if exists trg_enforce_accident_closure on public.accidents;
-- drop function if exists public.enforce_accident_closure();
-- -- Optional: remove the accident capability block from the shared envelope. It is
-- -- harmless to leave (it only grants ACCIDENT caps to ACCIDENT role names), so by
-- -- default we do NOT strip it here to avoid clobbering a concurrently-edited
-- -- envelope. To remove it, delete overrides.<Role>.accidents per seeded role.
-- drop table if exists
--   public.accident_sla_pause_events, public.accident_sla_instances,
--   public.accident_closure_reviews, public.accident_closure_requirements,
--   public.accident_case_communications, public.accident_case_approvals, public.accident_case_tasks,
--   public.accident_corrective_actions, public.accident_claim_recoveries,
--   public.accident_financial_transactions, public.accident_handover_inspections,
--   public.accident_vehicle_downtime, public.accident_parts_requests,
--   public.accident_repair_quality_checks, public.accident_repair_tasks, public.accident_repair_orders,
--   public.accident_damage_assessments, public.accident_insurance_settlements,
--   public.accident_insurance_decisions, public.accident_claim_documents,
--   public.accident_insurance_claims, public.accident_liability_assessments,
--   public.accident_authority_reports, public.accident_evidence, public.accident_case_workstreams,
--   public.accident_evidence_requirements, public.accident_sla_definitions,
--   public.accident_route_profiles, public.accident_type_profiles, public.accident_country_rule_profiles
--   cascade;
-- alter table public.accidents
--   drop constraint if exists chk_accident_closure_level,
--   drop constraint if exists chk_accident_case_status;
-- drop index if exists public.accidents_org_case_no_uidx;
-- alter table public.accidents
--   drop column if exists case_no, drop column if exists case_status, drop column if exists route_key,
--   drop column if exists closure_level,
--   drop column if exists completion_incident, drop column if exists completion_insurance,
--   drop column if exists completion_repair, drop column if exists completion_financial,
--   drop column if exists completion_overall, drop column if exists case_flags,
--   drop column if exists is_reopened, drop column if exists reopen_count,
--   drop column if exists reopened_reason, drop column if exists reopened_by, drop column if exists reopened_at,
--   drop column if exists reopened_flag, drop column if exists total_loss_route,
--   drop column if exists cancelled_duplicate_of, drop column if exists legal_hold;
-- commit;
-- =============================================================================
