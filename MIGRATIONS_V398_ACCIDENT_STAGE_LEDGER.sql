-- =============================================================================
-- V398 / V398b — ACCIDENT STAGE LEDGER: who is holding a claim, and who skipped
-- =============================================================================
-- APPLIED LIVE 2026-07-28 (project jhssdmeruxtrlqnwfksc). Verified by rolled-back
-- live tests, all recorded below.
--
-- WHY IT EXISTS
--   The stage ladder (V300/V301) already moves, and the stages already name the
--   owning team (Site Management / Operations / HSE / Workshop / Insurance /
--   Fleet-PMV / Finance). What was missing was TIME and OWNERSHIP: nothing
--   recorded when a case entered or left a stage, so "which team is holding this
--   claim" and "who delayed it" had no answer at all.
--
--   MEASURED FIRST, on the live 35 incidents:
--     - workflow_stage IS populated and spread across the pipeline
--       (reported 14, closed 12, repair_in_progress 5, repair_approval 1,
--        final_inspection 1, insurance_claim 1, initial_review 1)
--     - but EVERY per-stage field is empty: root_cause 0/35,
--       responsible_owner_id 0/35, approved_repair_amount 0/35,
--       hse_investigation 0/35, closure_evidence 0/35, target_date 0/35
--     - and only 11 of 35 cases carry ANY transition in accident_audit_log,
--       which records status old/new - never the stage, duration or team.
--   So no team was ever recorded doing anything, and the pipeline was decorative.
--
-- THE "IT GOES TO CLOSED ON ITS OWN" REPORT WAS EXACT
--   accident_stage_from_status maps status 'closed' -> stage 'closed', so the
--   register's Status dropdown moves a case from anywhere to closed in ONE write.
--   Proven live from insurance_claim: repair_approval, repair_in_progress,
--   final_inspection, vehicle_release and cost_recovery were all passed through
--   with no trace. From 'reported' it skips NINE stages.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO
--   It RECORDS. Every stage occupancy becomes a row with entered_at, exited_at,
--   who, and the owning department; every stage jumped over becomes a row marked
--   skipped, so a case can never look completed when five teams never touched it.
--   It does NOT block the jump. Refusing it would break the register's Status
--   dropdown and every legacy, mobile and import writer. Making the skip visible
--   is the honest fix and needs no behaviour change from anyone.
--
-- TWO THINGS THAT WOULD BE EASY TO GET WRONG LATER
--   1. THE TRIGGER MUST BE `AFTER UPDATE`, NOT `AFTER UPDATE OF workflow_stage`.
--      `UPDATE OF <col>` fires on the column appearing in the statement's SET
--      list. The case this table exists for never mentions workflow_stage: the
--      register writes `status` and the BEFORE trigger derives the stage, and a
--      column changed by a BEFORE trigger is not in the statement's column list.
--      V398 shipped with `UPDATE OF` and recorded NOTHING for the skip-to-closed
--      jump - caught by a rolled-back live test, fixed in V398b. The
--      `is not distinct from` guard inside the function makes firing on every
--      update cheap and correct.
--   2. `basis` IS LOAD-BEARING. The backfill opens one event per case for the
--      stage it genuinely sits at, but entered_at is the row's updated_at - the
--      earliest defensible moment, NOT a measured transition. basis='backfilled'
--      says so. Never render a backfilled duration as an observed one, and never
--      invent the earlier history: 24 of the 35 cases have no transition record
--      anywhere, so their past is genuinely unknown.
--
-- MIRRORS IN JS - CHANGE TOGETHER
--   accident_stage_order      <-> STAGE_FLOW      (src/lib/accidentWorkflow.js)
--   accident_stage_department <-> WORKFLOW_STAGES[].dept
--
-- VERIFIED LIVE (each rolled back)
--   - backfill: 35 events / 35 cases / 35 open / all basis='backfilled' /
--     0 skipped / 0 without a department
--   - closing a 'reported' case records NINE skipped stages (Operations, HSE,
--     Workshop, Insurance, Fleet-PMV, Workshop, Workshop, Operations, Finance)
--     and leaves 'closed' as the single open event
--   - a step-by-step advance reported -> initial_review -> hse_investigation
--     records 0 skips and leaves HSE / Safety holding the case
--   - a BACKWARD move (rework) records 0 skips - a case sent back is not a case
--     that jumped
--
-- ROLLBACK
--   drop trigger if exists trg_accident_log_stage_event on public.accidents;
--   drop function if exists public.accident_log_stage_event();
--   drop table if exists public.accident_stage_events;
--   drop function if exists public.accident_stage_order(text);
--   drop function if exists public.accident_stage_department(text);
-- =============================================================================

-- ── V398 ─────────────────────────────────────────────────────────────────────
create table if not exists public.accident_stage_events (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  accident_id    uuid not null references public.accidents(id) on delete cascade,
  country        text,
  site           text,
  stage          text not null,
  department     text,
  entered_at     timestamptz not null default now(),
  exited_at      timestamptz,
  entered_by     uuid,
  exited_by      uuid,
  -- A stage the case passed THROUGH without stopping. entered_at = exited_at.
  skipped        boolean not null default false,
  -- 'observed'   = this transition was watched happening.
  -- 'backfilled' = derived from the row's updated_at when the ledger was created.
  basis          text not null default 'observed' check (basis in ('observed', 'backfilled')),
  note           text,
  created_at     timestamptz not null default now()
);

create index if not exists accident_stage_events_accident_idx on public.accident_stage_events (accident_id, entered_at);
create index if not exists accident_stage_events_open_idx     on public.accident_stage_events (accident_id) where exited_at is null;
create index if not exists accident_stage_events_stage_idx    on public.accident_stage_events (organisation_id, stage, entered_at desc);
create index if not exists accident_stage_events_dept_idx     on public.accident_stage_events (organisation_id, department, entered_at desc);

alter table public.accident_stage_events enable row level security;

-- Same boundary as accidents itself: RESTRICTIVE org + country, member read, and
-- NO client write path (only the DEFINER trigger inserts).
drop policy if exists accident_stage_events_org_isolation on public.accident_stage_events;
create policy accident_stage_events_org_isolation on public.accident_stage_events
  as restrictive for all to authenticated
  using  ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

drop policy if exists accident_stage_events_country_isolation on public.accident_stage_events;
create policy accident_stage_events_country_isolation on public.accident_stage_events
  as restrictive for select to authenticated
  using (public.app_can_see_country(country));

drop policy if exists accident_stage_events_read on public.accident_stage_events;
create policy accident_stage_events_read on public.accident_stage_events
  for select to authenticated using (public.app_is_active());

revoke all on public.accident_stage_events from anon;
grant select on public.accident_stage_events to authenticated;

-- Stage order. Mirrors STAGE_FLOW in src/lib/accidentWorkflow.js. 'cancelled' is
-- deliberately absent: it is an exit, not a position, so nothing is ever
-- "skipped over" to reach it.
create or replace function public.accident_stage_order(p_stage text)
returns int language sql immutable set search_path to 'public' as $$
  select case p_stage
    when 'reported'            then 1
    when 'initial_review'      then 2
    when 'hse_investigation'   then 3
    when 'workshop_assessment' then 4
    when 'insurance_claim'     then 5
    when 'repair_approval'     then 6
    when 'repair_in_progress'  then 7
    when 'final_inspection'    then 8
    when 'vehicle_release'     then 9
    when 'cost_recovery'       then 10
    when 'closed'              then 11
    else null end;
$$;

-- Owning team per stage. Mirrors WORKFLOW_STAGES[].dept - change BOTH together.
create or replace function public.accident_stage_department(p_stage text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_stage
    when 'reported'            then 'Site Management'
    when 'initial_review'      then 'Operations'
    when 'hse_investigation'   then 'HSE / Safety'
    when 'workshop_assessment' then 'Workshop'
    when 'insurance_claim'     then 'Insurance'
    when 'repair_approval'     then 'Fleet / PMV'
    when 'repair_in_progress'  then 'Workshop'
    when 'final_inspection'    then 'Workshop'
    when 'vehicle_release'     then 'Operations'
    when 'cost_recovery'       then 'Finance'
    when 'closed'              then 'Site Management'
    when 'cancelled'           then 'Operations'
    else null end;
$$;

create or replace function public.accident_log_stage_event()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_from  int;
  v_to    int;
  v_stage text;
  i       int;
begin
  if TG_OP = 'INSERT' then
    insert into public.accident_stage_events
      (organisation_id, accident_id, country, site, stage, department, entered_by)
    values (NEW.organisation_id, NEW.id, NEW.country, NEW.site,
            NEW.workflow_stage, public.accident_stage_department(NEW.workflow_stage), v_actor);
    return null;
  end if;

  if NEW.workflow_stage is not distinct from OLD.workflow_stage then
    return null;
  end if;

  -- Close whatever was open. There should be exactly one; closing all of them is
  -- the safe shape if an earlier write ever left two.
  update public.accident_stage_events
     set exited_at = now(), exited_by = v_actor
   where accident_id = NEW.id and exited_at is null;

  -- Record the stages that were passed over. A forward jump of more than one step
  -- means every stage in between was never worked.
  v_from := public.accident_stage_order(OLD.workflow_stage);
  v_to   := public.accident_stage_order(NEW.workflow_stage);
  if v_from is not null and v_to is not null and v_to > v_from + 1 then
    for i in (v_from + 1)..(v_to - 1) loop
      select s into v_stage from (
        select unnest(array['reported','initial_review','hse_investigation','workshop_assessment',
                            'insurance_claim','repair_approval','repair_in_progress','final_inspection',
                            'vehicle_release','cost_recovery','closed']) as s,
               generate_series(1, 11) as n
      ) t where t.n = i;
      insert into public.accident_stage_events
        (organisation_id, accident_id, country, site, stage, department,
         entered_at, exited_at, entered_by, exited_by, skipped, note)
      values (NEW.organisation_id, NEW.id, NEW.country, NEW.site,
              v_stage, public.accident_stage_department(v_stage),
              now(), now(), v_actor, v_actor, true,
              'Passed over when the case moved from ' || OLD.workflow_stage || ' to ' || NEW.workflow_stage);
    end loop;
  end if;

  insert into public.accident_stage_events
    (organisation_id, accident_id, country, site, stage, department, entered_by)
  values (NEW.organisation_id, NEW.id, NEW.country, NEW.site,
          NEW.workflow_stage, public.accident_stage_department(NEW.workflow_stage), v_actor);
  return null;
end;
$$;

-- Backfill the CURRENT stage only, flagged 'backfilled'. No history is invented.
insert into public.accident_stage_events
  (organisation_id, accident_id, country, site, stage, department, entered_at, basis, note)
select a.organisation_id, a.id, a.country, a.site, a.workflow_stage,
       public.accident_stage_department(a.workflow_stage),
       coalesce(a.updated_at, a.created_at, now()), 'backfilled',
       'Opened when the stage ledger was created. The stage is real; the entry time is the row''s last-modified time, not an observed transition.'
from public.accidents a
where a.workflow_stage is not null
  and not exists (select 1 from public.accident_stage_events e where e.accident_id = a.id);

comment on table public.accident_stage_events is
  'One row per stage occupancy of an accident case. Answers which team is holding a case, how long each held it, and which stages were skipped. Written only by trg_accident_log_stage_event.';

-- ── V398b — the trigger fix. See the header: this is the load-bearing part. ───
drop trigger if exists trg_accident_log_stage_event on public.accidents;
create trigger trg_accident_log_stage_event
  after insert or update on public.accidents
  for each row execute function public.accident_log_stage_event();

-- ── V398c — read-only at the GRANT level too, not only by policy ──────────────
-- Verified by impersonation that a normal user's INSERT is refused by RLS and
-- their UPDATE/DELETE match zero rows. So the boundary already held - but it held
-- on the POLICY alone: Supabase's default privileges had handed `authenticated`
-- INSERT/UPDATE/DELETE on the new table. An append-only trail written exclusively
-- by a DEFINER trigger should have two independent reasons it cannot be forged.
revoke insert, update, delete, truncate, references, trigger
  on public.accident_stage_events from authenticated;
grant select on public.accident_stage_events to authenticated;
