-- =====================================================================================
-- ERP observation reconciliation (rework of PR #514 on the shared tyre position service)
--
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner review. Tested on the local staging
--         database (tp_position, synthetic companies) only. Nothing here ran on production.
-- NEEDS:  20261115110000_tyre_position_service.sql applied first.
--
-- WHAT: lets an authorised reviewer record that an imported ERP job card is the work that
--       dealt with a tyre observation raised from an inspection. Two tables (the confirmed
--       link and an append-only decision history) and three functions.
--
-- WHAT CHANGED FROM #514:
--   1. POSITION. #514 compared corrective_actions.source_detail (an inspection slot id such
--      as R1Ro) with tyre_records.position (an ERP code such as RHCO) as text, so no action
--      could ever match. Both sides are now resolved to one canonical wheel on the ASSET'S
--      OWN layout (public.tyre_asset_layout / tyre_position_compare). A position that is
--      ambiguous, missing, inconsistent, or on a machine whose layout is unknown is never a
--      match: it stays pending manual review and Confirm is refused.
--   2. SERIAL. #514 required every matching ERP row to carry the observed serial, which a
--      replacement tyre never does. A real (strong) serial is now EVIDENCE: the observed tyre
--      leaving on that job card supports the match, and the observed serial sitting on a
--      DIFFERENT wheel blocks it as inconsistent.
--   3. SITE. The reviewer must be able to see the action's, the inspection's and the job
--      card's site (app_can_see_site), as well as the organisation and the country.
--   4. No "drop policy" lines: policies and the trigger are created only when absent.
--   5. Ends with anum_integration.apply_reader_policies() (rule for any new table).
--
-- WHAT IT NEVER DOES: confirm anything by itself (a person calls confirm with a written
--       reason); change a tyre cost, a tyre record, a work order or an inspection; close a
--       corrective action or change its status. Confirm writes one link row, one history row,
--       and sets corrective_actions.work_order_id ONLY when it is empty.
--
-- WORDING NOTE: this file cannot avoid the words "delete" and "drop" entirely. They appear in
--       "on delete restrict" (foreign keys), in the append-only trigger ("before update or
--       delete") and in the ROLLBACK comment below. Nothing in it removes a row or an object,
--       but the Supabase MCP confirm prompt will fire: apply it when the owner can approve.
--
-- VERIFY (rolled back; run as an elevated user of the action's organisation and country):
--   begin;
--   select public.observation_erp_evaluate('<action>', '<work order>');      -- evidence, no write
--   select public.confirm_observation_erp_link('<action>', '<work order>', 'Reviewed job card');
--   select status, closed_at, work_order_id from public.corrective_actions where id = '<action>'; -- status unchanged
--   select count(*) from public.observation_erp_link_events where action_id = '<action>';     -- 1
--   select has_function_privilege('anon', 'public.observation_erp_decide(uuid,uuid,text,text)', 'execute'); -- f
--   rollback;
--
-- ROLLBACK (the only place this file names a removal; export the two tables first if any
-- decision was recorded, they are the audit trail):
--   drop function if exists public.reject_observation_erp_link(uuid,uuid,text);
--   drop function if exists public.confirm_observation_erp_link(uuid,uuid,text);
--   drop function if exists public.observation_erp_decide(uuid,uuid,text,text);
--   drop function if exists public.observation_erp_evaluate(uuid,uuid);
--   drop table if exists public.observation_erp_link_events;
--   drop table if exists public.observation_erp_links;
--   drop function if exists public.observation_erp_events_immutable();
--   corrective_actions.work_order_id values set by a confirm are listed in observation_erp_links.
-- =====================================================================================

create table if not exists public.observation_erp_links (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text not null,
  action_id uuid not null unique references public.corrective_actions(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  source_job_card text not null,
  work_order_snapshot jsonb not null default '{}'::jsonb,
  position_evidence jsonb not null default '{}'::jsonb,
  status text not null default 'confirmed' check (status = 'confirmed'),
  decision_note text not null check (length(btrim(decision_note)) between 5 and 2000),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now()
);
create index if not exists observation_erp_links_org_country
  on public.observation_erp_links(organisation_id, country, work_order_id);
alter table public.observation_erp_links enable row level security;

create table if not exists public.observation_erp_link_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  country text not null,
  action_id uuid not null,
  work_order_id uuid not null,
  source_job_card text not null,
  work_order_snapshot jsonb not null default '{}'::jsonb,
  position_evidence jsonb not null default '{}'::jsonb,
  decision text not null check (decision in ('confirmed', 'rejected')),
  reason text not null,
  reviewer uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists observation_erp_link_events_action
  on public.observation_erp_link_events(organisation_id, action_id, created_at desc);
alter table public.observation_erp_link_events enable row level security;

-- Policies are created only when absent (re-runnable without removing anything).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observation_erp_links' and policyname = 'observation_erp_links_org') then
    create policy observation_erp_links_org on public.observation_erp_links as restrictive
      for all to authenticated
      using (organisation_id = (select public.app_current_org()))
      with check (organisation_id = (select public.app_current_org()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observation_erp_links' and policyname = 'observation_erp_links_country') then
    create policy observation_erp_links_country on public.observation_erp_links as restrictive
      for select to authenticated
      using ((select public.is_super_admin()) or (select public.app_sees_all_countries())
        or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observation_erp_links' and policyname = 'observation_erp_links_read') then
    create policy observation_erp_links_read on public.observation_erp_links
      for select to authenticated using ((select public.app_is_active()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observation_erp_link_events' and policyname = 'observation_erp_events_org') then
    create policy observation_erp_events_org on public.observation_erp_link_events as restrictive
      for select to authenticated using (organisation_id = (select public.app_current_org()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observation_erp_link_events' and policyname = 'observation_erp_events_country') then
    create policy observation_erp_events_country on public.observation_erp_link_events as restrictive
      for select to authenticated
      using ((select public.is_super_admin()) or (select public.app_sees_all_countries())
        or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observation_erp_link_events' and policyname = 'observation_erp_events_read') then
    create policy observation_erp_events_read on public.observation_erp_link_events
      for select to authenticated using ((select public.app_is_active()));
  end if;
end $$;

-- Read only for app roles. Every write goes through observation_erp_decide.
revoke all on public.observation_erp_links from public, anon, authenticated;
revoke all on public.observation_erp_link_events from public, anon, authenticated;
grant select on public.observation_erp_links to authenticated;
grant select on public.observation_erp_link_events to authenticated;

create or replace function public.observation_erp_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ERP decision history is append-only' using errcode = 'PT409';
end $$;
revoke all on function public.observation_erp_events_immutable() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'observation_erp_events_immutable'
                 and tgrelid = 'public.observation_erp_link_events'::regclass) then
    create trigger observation_erp_events_immutable
      before update or delete on public.observation_erp_link_events
      for each row execute function public.observation_erp_events_immutable();
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- observation_erp_evaluate: READ ONLY. Checks the caller, then reports what the ERP tyre
-- records on one job card say about the wheel an observation is about.
--   state  offered_for_review     a dated tyre movement on the SAME canonical wheel (or the
--                                 observed real serial leaving on this job card while the
--                                 wheel could not be established). A person may confirm.
--          pending_manual_review  the wheel could not be established on this machine
--          inconsistent           the observed serial is on a different wheel, or the
--                                 inspection was recorded against another wheel plan
--          different_wheel        the job card moved other wheels only
--          no_dated_movement      same wheel, but no movement on or after the inspection day
--          no_tyre_movement       no tyre record names this job card
-- Mirror of evaluateErpCandidate in src/lib/erpObservationMatch.js.
-- -------------------------------------------------------------------------------------
create or replace function public.observation_erp_evaluate(p_action_id uuid, p_work_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_action public.corrective_actions%rowtype;
  v_inspection public.inspections%rowtype;
  v_work public.work_orders%rowtype;
  v_country text;
  v_day date;
  v_token text;
  v_layout jsonb;
  v_recorded jsonb;
  v_serial text;
  v_strong boolean;
  r record;
  c jsonb;
  v_rows int := 0;
  v_same int := 0;
  v_same_dated int := 0;
  v_pending int := 0;
  v_pending_dated int := 0;
  v_different int := 0;
  v_serial_rows int := 0;
  v_serial_pending_dated int := 0;
  v_serial_other_wheel int := 0;
  v_reasons jsonb := '{}'::jsonb;
  v_dated boolean;
  v_is_serial boolean;
  v_state text;
  v_canonical text;
  v_layout_conflict boolean := false;
begin
  if auth.uid() is null or v_org is null or not public.app_is_active() or not public.app_is_elevated() then
    raise exception 'Not authorised to review ERP evidence' using errcode = '42501';
  end if;
  select * into v_action from public.corrective_actions
    where id = p_action_id and organisation_id = v_org;
  if not found or v_action.source_type <> 'inspection' or v_action.source_id is null then
    raise exception 'Only own inspection tyre actions may be linked' using errcode = '42501';
  end if;
  select * into v_inspection from public.inspections
    where id = v_action.source_id and organisation_id = v_org;
  select * into v_work from public.work_orders
    where id = p_work_order_id and organisation_id = v_org;
  if v_inspection.id is null or v_work.id is null
     or v_action.country is null
     or v_action.country is distinct from v_work.country
     or v_work.country is distinct from v_inspection.country
     or upper(btrim(v_work.asset_no)) is distinct from upper(btrim(v_inspection.asset_no))
     or upper(btrim(v_action.asset_no)) is distinct from upper(btrim(v_work.asset_no)) then
    raise exception 'ERP job card must match inspection tenant, country and asset' using errcode = 'PT409';
  end if;
  v_country := v_work.country;
  if not public.app_can_see_country(v_country) then
    raise exception 'Country is outside permitted scope' using errcode = '42501';
  end if;
  if not (public.app_can_see_site(v_action.site) and public.app_can_see_site(v_inspection.site)
          and public.app_can_see_site(v_work.site)) then
    raise exception 'Site is outside permitted scope' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(v_work.work_order_no, '')), '') is null then
    raise exception 'Job card number missing' using errcode = 'PT409';
  end if;

  v_day := coalesce(v_inspection.inspection_date, v_inspection.created_at::date);
  -- damage:R1Ro, overdue:R2Li:SERIAL or a bare R1Ro (mirror of positionFromSourceDetail).
  v_token := btrim(coalesce(v_action.source_detail, ''));
  if position(':' in v_token) > 0 then v_token := btrim(split_part(v_token, ':', 2)); end if;
  if v_token = 'unknown position' then v_token := ''; end if;

  -- ONE layout for both sides: the asset's own, as registered.
  v_layout := public.tyre_asset_layout(v_org, v_country, v_work.asset_no, v_inspection.vehicle_type, v_day);
  if v_layout->>'status' = 'resolved' and nullif(btrim(coalesce(v_inspection.vehicle_type, '')), '') is not null then
    v_recorded := public.tyre_type_layout(v_org, v_inspection.vehicle_type, v_work.asset_no,
      (v_layout->>'axle_count')::integer, v_day);
    v_layout_conflict := v_recorded->>'status' = 'resolved' and v_recorded->>'key' is distinct from v_layout->>'key';
  end if;

  v_serial := upper(btrim(coalesce(v_action.tyre_serial, '')));
  v_strong := public.tyre_serial_is_strong(v_serial);

  for r in
    select coalesce(nullif(btrim(t.tyre_position), ''), nullif(btrim(t.position), ''), '') as pos,
           t.serial_no, t.issue_date, t.removal_date
    from public.tyre_records t
    where t.organisation_id = v_org and t.country = v_country
      and upper(btrim(t.asset_no)) = upper(btrim(v_work.asset_no))
      and upper(btrim(t.job_card)) = upper(btrim(v_work.work_order_no))
  loop
    v_rows := v_rows + 1;
    v_dated := coalesce(r.removal_date >= v_day, false) or coalesce(r.issue_date >= v_day, false);
    v_is_serial := v_strong and upper(btrim(coalesce(r.serial_no, ''))) = v_serial;
    if v_is_serial then v_serial_rows := v_serial_rows + 1; end if;
    if v_layout_conflict then
      c := jsonb_build_object('match', null, 'status', 'inconsistent', 'reason', 'inspection_layout_differs_from_asset');
    else
      c := public.tyre_position_compare(v_layout, v_token, r.pos);
    end if;
    if (c->>'match')::boolean is true then
      v_same := v_same + 1;
      v_canonical := c->>'canonical';
      if v_dated then v_same_dated := v_same_dated + 1; end if;
    elsif (c->>'match')::boolean is false then
      v_different := v_different + 1;
      if v_is_serial then v_serial_other_wheel := v_serial_other_wheel + 1; end if;
    else
      v_pending := v_pending + 1;
      if v_dated then v_pending_dated := v_pending_dated + 1; end if;
      if v_is_serial and v_dated then v_serial_pending_dated := v_serial_pending_dated + 1; end if;
      v_reasons := v_reasons || jsonb_build_object(c->>'reason',
        coalesce((v_reasons->>(c->>'reason'))::int, 0) + 1);
    end if;
  end loop;

  v_state := case
    when v_rows = 0 then 'no_tyre_movement'
    when v_layout_conflict or v_serial_other_wheel > 0 then 'inconsistent'
    when v_same_dated > 0 or v_serial_pending_dated > 0 then 'offered_for_review'
    when v_pending > 0 then 'pending_manual_review'
    when v_same > 0 then 'no_dated_movement'
    else 'different_wheel' end;

  return jsonb_build_object(
    'ok', true, 'state', v_state, 'eligible_to_confirm', v_state = 'offered_for_review',
    'canonical', v_canonical, 'layout_key', v_layout->>'key', 'layout_status', v_layout->>'status',
    'layout_reason', v_layout->>'reason',
    'observation', public.tyre_position_resolve(v_layout, v_token, 'slot'),
    'tyre_rows', v_rows, 'same_wheel', v_same, 'same_wheel_dated', v_same_dated,
    'pending', v_pending, 'different_wheel', v_different, 'pending_reasons', v_reasons,
    'serial_is_strong', v_strong, 'serial_rows', v_serial_rows, 'serial_other_wheel', v_serial_other_wheel,
    'work_order_no', v_work.work_order_no, 'country', v_country,
    'work_opened_before_inspection', (v_work.opened_at is null or v_work.opened_at::date < v_day),
    'snapshot', jsonb_build_object(
      'work_order_no', v_work.work_order_no, 'asset_no', v_work.asset_no,
      'country', v_work.country, 'status', v_work.status, 'description', v_work.description,
      'notes', v_work.notes, 'opened_at', v_work.opened_at, 'completed_at', v_work.completed_at));
end $$;

-- -------------------------------------------------------------------------------------
-- observation_erp_decide: a person records Confirm or Reject, with a reason.
-- Confirm is refused unless observation_erp_evaluate says offered_for_review.
-- -------------------------------------------------------------------------------------
create or replace function public.observation_erp_decide(
  p_action_id uuid, p_work_order_id uuid, p_reason text, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_eval jsonb;
  v_action public.corrective_actions%rowtype;
  v_existing public.observation_erp_links%rowtype;
  v_evidence jsonb;
begin
  if p_decision is null or p_decision not in ('confirmed', 'rejected')
     or length(btrim(coalesce(p_reason, ''))) not between 5 and 2000 then
    raise exception 'Decision and reason are required' using errcode = '22023';
  end if;
  -- Caller, organisation, country, site, asset and job card are all checked here.
  v_eval := public.observation_erp_evaluate(p_action_id, p_work_order_id);

  select * into v_action from public.corrective_actions
    where id = p_action_id and organisation_id = v_org for update;
  if not found then
    raise exception 'Only own inspection tyre actions may be linked' using errcode = '42501';
  end if;
  v_evidence := v_eval - 'snapshot';

  if p_decision = 'confirmed' then
    if (v_eval->>'work_opened_before_inspection')::boolean then
      raise exception 'Job card predates the inspection. Manual investigation required' using errcode = 'PT409';
    end if;
    if not (v_eval->>'eligible_to_confirm')::boolean then
      raise exception 'ERP tyre movement could not be matched to the observed wheel (%). Pending manual review',
        v_eval->>'state' using errcode = 'PT409';
    end if;
  end if;

  select * into v_existing from public.observation_erp_links where action_id = p_action_id for update;
  if p_decision = 'confirmed' then
    if v_existing.id is not null and v_existing.work_order_id <> p_work_order_id then
      raise exception 'Action already linked to another confirmed job card' using errcode = 'PT409';
    end if;
    if v_action.work_order_id is not null and v_action.work_order_id <> p_work_order_id then
      raise exception 'Corrective action already linked to a different work order' using errcode = 'PT409';
    end if;
    if v_existing.id is null then
      insert into public.observation_erp_links
        (organisation_id, country, action_id, work_order_id, source_job_card, work_order_snapshot,
         position_evidence, decision_note, reviewed_by)
      values (v_org, v_eval->>'country', p_action_id, p_work_order_id, v_eval->>'work_order_no',
              v_eval->'snapshot', v_evidence, btrim(p_reason), auth.uid());
      -- Link only. Status, dates and every other field of the action are left as they are.
      update public.corrective_actions set work_order_id = p_work_order_id
        where id = p_action_id and work_order_id is null;
    end if;
  end if;
  insert into public.observation_erp_link_events
    (organisation_id, country, action_id, work_order_id, source_job_card, work_order_snapshot,
     position_evidence, decision, reason, reviewer)
  values (v_org, v_eval->>'country', p_action_id, p_work_order_id, v_eval->>'work_order_no',
          v_eval->'snapshot', v_evidence, p_decision, btrim(p_reason), auth.uid());
  return jsonb_build_object('ok', true, 'decision', p_decision,
    'action_id', p_action_id, 'work_order_id', p_work_order_id,
    'state', v_eval->>'state', 'canonical', v_eval->>'canonical',
    'already_linked', (v_existing.id is not null));
end $$;

create or replace function public.confirm_observation_erp_link(
  p_action_id uuid, p_work_order_id uuid, p_reason text)
returns jsonb language sql security invoker set search_path = '' as $$
  select public.observation_erp_decide(p_action_id, p_work_order_id, p_reason, 'confirmed')
$$;
create or replace function public.reject_observation_erp_link(
  p_action_id uuid, p_work_order_id uuid, p_reason text)
returns jsonb language sql security invoker set search_path = '' as $$
  select public.observation_erp_decide(p_action_id, p_work_order_id, p_reason, 'rejected')
$$;

revoke all on function public.observation_erp_evaluate(uuid, uuid) from public, anon;
revoke all on function public.observation_erp_decide(uuid, uuid, text, text) from public, anon;
revoke all on function public.confirm_observation_erp_link(uuid, uuid, text) from public, anon;
revoke all on function public.reject_observation_erp_link(uuid, uuid, text) from public, anon;
grant execute on function public.observation_erp_evaluate(uuid, uuid) to authenticated;
grant execute on function public.observation_erp_decide(uuid, uuid, text, text) to authenticated;
grant execute on function public.confirm_observation_erp_link(uuid, uuid, text) to authenticated;
grant execute on function public.reject_observation_erp_link(uuid, uuid, text) to authenticated;

-- Rule for any migration that creates a table: the read-only reporting role gets its policies.
select anum_integration.apply_reader_policies();
