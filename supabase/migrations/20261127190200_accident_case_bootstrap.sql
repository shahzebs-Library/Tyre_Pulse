-- =============================================================================
-- Accident case bootstrap: every new accident gets its steps, owners and timers.
--
-- STATUS: AUTHORED, NOT APPLIED. Needs 20261127190100 first.
--
-- A1  AFTER INSERT on accidents creates the required workstreams from the route
--     profile (accident_route_profiles, else the default profile, else the engine's
--     accident_required_workstreams), each with its owner from accident_team_roles,
--     and starts a timer only when the owner has set an SLA target for that step and
--     severity (NULL target = "not set", no timer).
-- A3  BEFORE INSERT fills responsible_owner_id from the fleet step owner
--     (fleet_validation, else incident_evidence) and route_key from the profile.
-- A5  case_status, workflow_stage and status can no longer diverge. One rule:
--       * case_status changed by the case engine -> stage follows it;
--       * otherwise case_status follows the stage (accident_case_status_for_stage).
--     It never writes case_status = 'closed' (that still needs an approved closure
--     review, enforced by trg_enforce_accident_closure); a closed stage maps to
--     'closure_review'. reopened / legal_hold are left alone.
--     The JS mirror is caseStatusForStage() in src/lib/accidentCase.js.
-- Workstream satisfied (completed / not_required / cancelled) closes its timer.
-- Backfill: case_status for every row that has none; workstreams + owner for open
-- cases, except 'reported' cases older than 30 days (those are closed as legacy by
-- the separate data migration 20261127190250). The 2 recent reported cases
-- (ACC-2026-0041, ACC-2026-0043) get their steps and owners here.
--
-- VERIFY RESULT (run live 2026-11-27, rolled back): new test case got 7 steps
--   (route minor_no_insurance) with owners (reporter = Fleet Supervisor owns the 4
--   fleet steps, VINAY owns assessment, PMV Manager / Admin role-owned),
--   responsible_owner_id = reporter, case_status 'submitted'; a 240 min target gave
--   one running timer with a warning time; status -> insurance_claim gave case_status
--   insurance_review; case_status -> technical_assessment moved the stage to
--   workshop_assessment; completing the step set the timer to 'met'. Backfill: 0
--   rows without case_status, 0 diverged, 12 open cases with steps (79 rows,
--   33 with a named person), 3 cases with a responsible owner.
-- VERIFY (rolled back): insert a test accident -> workstreams created with owners,
--   responsible_owner_id set, case_status = 'submitted'; set an SLA target and
--   re-bootstrap -> one running timer; update status to 'insurance_claim' ->
--   case_status 'insurance_review'.
--
-- ROLLBACK:
--   drop trigger if exists trg_accident_zz_bootstrap_after on public.accidents;
--   drop trigger if exists trg_zz_accident_case_sync on public.accidents;
--   drop trigger if exists trg_accident_ws_close_sla on public.accident_case_workstreams;
--   drop function if exists public._accident_bootstrap_after();
--   drop function if exists public._accident_case_sync();
--   drop function if exists public._accident_ws_close_sla();
--   drop function if exists public._accident_bootstrap_workstreams(uuid);
--   drop function if exists public._accident_ws_sla_start(uuid,text);
--   drop function if exists public._accident_route_for(uuid,text);
--   drop function if exists public.accident_case_status_for_stage(text);
--   (backfilled rows: workstreams carry notes = 'auto: bootstrap'.)
-- =============================================================================

begin;

create or replace function public.accident_case_status_for_stage(p_stage text)
returns text language sql immutable set search_path = public as $$
  select case p_stage
    when 'reported'            then 'submitted'
    when 'initial_review'      then 'under_fleet_validation'
    when 'hse_investigation'   then 'liability_assessment'
    when 'insurance_claim'     then 'insurance_review'
    when 'workshop_assessment' then 'technical_assessment'
    when 'repair_approval'     then 'repair_decision_pending'
    when 'repair_in_progress'  then 'repair_in_progress'
    when 'final_inspection'    then 'fleet_inspection'
    when 'vehicle_release'     then 'operationally_completed'
    when 'cost_recovery'       then 'financial_closure_pending'
    when 'closed'              then 'closure_review'
    when 'cancelled'           then 'cancelled_duplicate'
    else null end;
$$;

-- Route profile for an org + accident type.
create or replace function public._accident_route_for(p_org uuid, p_type text)
returns table (route_key text, required text[])
language sql stable security definer set search_path = public as $$
  select rp.route_key,
         array(select k from unnest(rp.required_workstreams) k
                where k = any (public.accident_workstream_keys()))
    from public.accident_route_profiles rp
   where rp.organisation_id = p_org and rp.active
     and (p_type = any (rp.match_types) or rp.is_default)
   order by (p_type = any (rp.match_types)) desc, rp.is_default desc
   limit 1;
$$;

-- Start the owner-set timer for one workstream (no target = no timer).
create or replace function public._accident_ws_sla_start(p_accident uuid, p_ws text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a public.accidents%rowtype;
  w public.accident_case_workstreams%rowtype;
  tr record;
  v_min integer;
  v_start timestamptz := now();
begin
  select * into a from public.accidents where id = p_accident;
  select * into w from public.accident_case_workstreams
   where accident_id = p_accident and workstream_key = p_ws;
  if a.id is null or w.id is null then return 0; end if;
  if exists (select 1 from public.accident_sla_instances si
              where si.accident_id = p_accident and si.sla_key = 'owner:' || p_ws
                and si.state in ('running','paused')) then
    return 0;
  end if;
  select t.* into tr from public.accident_team_roles t
   where t.organisation_id = a.organisation_id and t.active and t.workstream_key = p_ws
     and (t.country is null or t.country = a.country)
     and (t.site is null or upper(t.site) = upper(coalesce(a.site, '')))
   order by (t.site is not null) desc, (t.country is not null) desc, t.updated_at desc
   limit 1;
  if tr.id is null then return 0; end if;
  v_min := case
    when a.severity in ('severe','fatal','major') then tr.sla_minutes_major
    when a.severity = 'minor' then tr.sla_minutes_minor
    else tr.sla_minutes_moderate end;
  if v_min is null or v_min <= 0 then return 0; end if;

  insert into public.accident_sla_instances (
    organisation_id, accident_id, country, site, sla_key, sla_definition_id, name,
    workstream_key, owner_id, team, start_at, target_minutes, due_at, warning_at,
    escalation_at, state, paused)
  values (
    a.organisation_id, a.id, a.country, a.site, 'owner:' || p_ws, null,
    public.accident_workstream_name(p_ws), p_ws, w.owner_id, w.owner_role, v_start, v_min,
    v_start + make_interval(mins => v_min),
    v_start + make_interval(mins => greatest(1, round(v_min * coalesce(tr.warning_pct, 80) / 100.0))::int),
    v_start + make_interval(mins => v_min),
    'running', false);
  return 1;
end;
$$;

-- Create the required workstreams for a case, with owners, and start timers.
create or replace function public._accident_bootstrap_workstreams(p_accident uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a public.accidents%rowtype;
  v_req text[];
  k text;
  o record;
  v_new integer := 0;
  v_ins boolean;
begin
  select * into a from public.accidents where id = p_accident;
  if a.id is null or a.organisation_id is null then return 0; end if;

  select r.required into v_req from public._accident_route_for(a.organisation_id, a.accident_type) r;
  if v_req is null or cardinality(v_req) = 0 then
    v_req := public.accident_required_workstreams(a.route_key, to_jsonb(a), null);
  end if;

  foreach k in array coalesce(v_req, '{}'::text[]) loop
    select * into o from public.accident_resolve_ws_owner(
      a.organisation_id, k, a.country, a.site, a.reported_by);
    insert into public.accident_case_workstreams (
      organisation_id, accident_id, country, site, workstream_key, status, required,
      owner_id, owner_role, team, notes)
    values (
      a.organisation_id, a.id, a.country, a.site, k,
      case when o.owner_id is not null or o.owner_role is not null then 'assigned' else 'not_started' end,
      true, o.owner_id, o.owner_role, o.owner_role, 'auto: bootstrap')
    on conflict (accident_id, workstream_key) do nothing;
    v_ins := found;
    if o.unstaffed_role is not null and exists (
         select 1 from public.accident_case_workstreams w
          where w.accident_id = a.id and w.workstream_key = k
            and w.owner_id is null and w.owner_role is null
            and w.status not in ('completed','not_required','cancelled')) then
      -- Admin/Manager hear once per step (the notice dedupe key has no time part)
      perform public.emit_domain_event('accident.step_unstaffed', 'accident', a.id::text,
        jsonb_build_object('accident_id', a.id, 'workstream_key', k, 'role', o.unstaffed_role),
        a.organisation_id, null);
    end if;
    if v_ins then
      v_new := v_new + 1;
    else
      -- an existing step with nobody on it takes the configured owner
      update public.accident_case_workstreams w
         set owner_id = o.owner_id, owner_role = o.owner_role,
             team = coalesce(w.team, o.owner_role),
             status = case when w.status = 'not_started' then 'assigned' else w.status end
       where w.accident_id = a.id and w.workstream_key = k
         and w.owner_id is null and w.owner_role is null
         and (o.owner_id is not null or o.owner_role is not null);
    end if;
    perform public._accident_ws_sla_start(a.id, k);
  end loop;
  return v_new;
end;
$$;

-- BEFORE INSERT OR UPDATE: route, responsible owner, case_status <-> stage sync.
-- Named trg_zz_* so it runs after every other BEFORE trigger (derive, org stamp,
-- normalizers). It never writes case_status = 'closed', so running after the
-- closure gate cannot open a way round it.
create or replace function public._accident_case_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_case_stage text;
  o record;
begin
  if TG_OP = 'INSERT' then
    if NEW.route_key is null and NEW.organisation_id is not null then
      select r.route_key into NEW.route_key
        from public._accident_route_for(NEW.organisation_id, NEW.accident_type) r;
    end if;
    if NEW.responsible_owner_id is null and NEW.organisation_id is not null then
      select * into o from public.accident_resolve_ws_owner(
        NEW.organisation_id, 'fleet_validation', NEW.country, NEW.site, NEW.reported_by);
      if o.owner_id is null then
        select * into o from public.accident_resolve_ws_owner(
          NEW.organisation_id, 'incident_evidence', NEW.country, NEW.site, NEW.reported_by);
      end if;
      NEW.responsible_owner_id := o.owner_id;
    end if;
  end if;

  if NEW.case_status in ('reopened', 'legal_hold') then
    return NEW;
  end if;
  v_case_stage := public.accident_case_status_stage(NEW.case_status);

  if TG_OP = 'UPDATE'
     and NEW.case_status is distinct from OLD.case_status
     and v_case_stage is not null
     and v_case_stage is distinct from NEW.workflow_stage then
    -- the case engine moved the case: the stage follows it
    NEW.workflow_stage := v_case_stage;
    NEW.status := public.accident_status_from_stage(v_case_stage);
  elsif NEW.case_status is null or v_case_stage is distinct from NEW.workflow_stage then
    NEW.case_status := coalesce(public.accident_case_status_for_stage(NEW.workflow_stage), NEW.case_status);
  end if;
  return NEW;
end;
$$;

create or replace function public._accident_bootstrap_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public._accident_bootstrap_workstreams(NEW.id);
  exception when others then
    -- never block an accident report because of the case layer
    raise warning 'accident bootstrap failed for %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;

-- A satisfied workstream closes its running timer.
create or replace function public._accident_ws_close_sla()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status in ('completed','not_required','cancelled')
     and OLD.status is distinct from NEW.status then
    update public.accident_sla_instances si
       set state = case when NEW.status = 'completed' then 'met' else 'cancelled' end,
           completed_at = coalesce(si.completed_at, now()),
           updated_at = now()
     where si.accident_id = NEW.accident_id
       and si.workstream_key = NEW.workstream_key
       and si.state in ('running','paused');
  elsif NEW.owner_id is distinct from OLD.owner_id then
    update public.accident_sla_instances si
       set owner_id = NEW.owner_id, updated_at = now()
     where si.accident_id = NEW.accident_id
       and si.workstream_key = NEW.workstream_key
       and si.state in ('running','paused');
  end if;
  return NEW;
end;
$$;

create or replace trigger trg_zz_accident_case_sync
  before insert or update on public.accidents
  for each row execute function public._accident_case_sync();

create or replace trigger trg_accident_zz_bootstrap_after
  after insert on public.accidents
  for each row execute function public._accident_bootstrap_after();

create or replace trigger trg_accident_ws_close_sla
  after update on public.accident_case_workstreams
  for each row execute function public._accident_ws_close_sla();

revoke all on function public._accident_route_for(uuid,text) from public, anon, authenticated;
revoke all on function public._accident_ws_sla_start(uuid,text) from public, anon, authenticated;
revoke all on function public._accident_bootstrap_workstreams(uuid) from public, anon, authenticated;
revoke all on function public._accident_case_sync() from public, anon, authenticated;
revoke all on function public._accident_bootstrap_after() from public, anon, authenticated;
revoke all on function public._accident_ws_close_sla() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- A5: every row gets a case_status that matches its stage (the sync trigger does
-- the mapping; touching the column is enough).
update public.accidents
   set case_status = public.accident_case_status_for_stage(workflow_stage)
 where case_status is null
   and public.accident_case_status_for_stage(workflow_stage) is not null;

-- A1 + A3 for open cases already past 'reported'.
update public.accidents a
   set route_key = coalesce(a.route_key,
         (select r.route_key from public._accident_route_for(a.organisation_id, a.accident_type) r)),
       responsible_owner_id = coalesce(a.responsible_owner_id,
         (select o.owner_id from public.accident_resolve_ws_owner(
            a.organisation_id, 'fleet_validation', a.country, a.site, a.reported_by) o),
         (select o.owner_id from public.accident_resolve_ws_owner(
            a.organisation_id, 'incident_evidence', a.country, a.site, a.reported_by) o))
 where coalesce(a.closure_level, 'open') = 'open'
   and a.workflow_stage not in ('closed','cancelled')
   and (a.workflow_stage <> 'reported' or a.created_at >= now() - interval '30 days')
   and (a.route_key is null or a.responsible_owner_id is null);

select public._accident_bootstrap_workstreams(a.id)
  from public.accidents a
 where coalesce(a.closure_level, 'open') = 'open'
   and a.workflow_stage not in ('closed','cancelled')
   and (a.workflow_stage <> 'reported' or a.created_at >= now() - interval '30 days');

commit;
