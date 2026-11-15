-- =====================================================================================
-- observation_erp_decide on the shared tyre position service (FOLLOW-UP)
--
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner review. Tested on the local staging copy
--         (tp_position: main's applied migration first, then the two follow-up files).
--         Nothing here ran on production.
-- AFTER:  20261115120000_observation_erp_reconciliation.sql (applied to production as
--         version 20261115090615) and 20261116090000_tyre_position_service.sql.
--
-- LIVE STATE THIS BUILDS ON (read from production, SELECT only, 2026-11-15):
--   tables observation_erp_links, observation_erp_link_events (RLS on, 3 policies each, 0 rows,
--   authenticated SELECT only, NO reader policies); observation_erp_decide(uuid,uuid,text,text)
--   definer, empty search_path; confirm_ / reject_observation_erp_link wrappers; the events
--   append-only trigger. None of those objects is created, removed or altered here except the
--   BODY of observation_erp_decide.
--
-- WHAT CHANGES:
--   1. observation_erp_decide: SAME name, SAME arguments, SAME five-key result
--      (ok, decision, action_id, work_order_id, already_linked), same error codes and wording
--      for every live guard (caller, reason, own inspection damage action, tenant + country +
--      asset, country scope, job card number, chronology, already linked). The wheel is no
--      longer found with the hard-coded CASE table. Both the inspection slot and the ERP code
--      are resolved on the ASSET'S OWN layout by the position service; anything not resolved
--      (ambiguous, missing, inconsistent, unknown layout) is refused with PT409 and stays
--      pending manual review. The CASE table keyed the layout on the words in the inspection's
--      vehicle type, treated every non mixer as "R1 is rear axle 1", and let an unknown slot
--      fall through as raw text.
--   2. Serial is evidence, not a filter. Live requires the ERP row to carry the observed serial,
--      which a replacement tyre never does. Now: a real (strong) observed serial leaving on the
--      job card supports the match; the observed serial on a DIFFERENT wheel blocks it.
--   3. Site: the reviewer must be able to see the action's, inspection's and job card's site.
--   4. New read-only helper observation_erp_evaluate(action, job card): the same checks, returns
--      the evidence and writes nothing. decide calls it, so the two cannot disagree.
--   5. Reader policies for the two live tables (rule for any new table, missed by the applied
--      migration): anum_integration.apply_reader_policies().
--
-- WHAT IT NEVER DOES: create or alter a table, remove anything, touch an existing link or
--       history row (tested: byte-identical before and after), change a tyre cost, a tyre
--       record, a work order or an inspection, close an action or change its status.
--
-- WORDING NOTE: no statement here removes a row or an object. The words "delete" / "drop"
--       appear only in this header.
--
-- VERIFY (rolled back; as an elevated user of the action's organisation and country):
--   begin;
--   select public.observation_erp_evaluate('<action>', '<work order>');          -- evidence, no write
--   select public.confirm_observation_erp_link('<action>', '<work order>', 'Reviewed job card');
--   select status, closed_at, work_order_id from public.corrective_actions where id = '<action>'; -- status unchanged
--   select has_function_privilege('anon', 'public.observation_erp_evaluate(uuid,uuid)', 'execute'); -- f
--   select count(*) from pg_policies where tablename like 'observation_erp_link%' and policyname like 'anum_reader%'; -- 8
--   rollback;
--
-- ROLLBACK: run 20261116091000_observation_erp_decide_ROLLBACK.sql (the exact live function).
--       The reader policies and the position service functions may stay; they grant nothing new.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- observation_erp_evaluate: READ ONLY. Every guard of the live decide function, then what
-- the ERP tyre records on one job card say about the observed wheel.
--   state  offered_for_review     dated movement on the SAME canonical wheel, or the observed
--                                 real serial leaving on this job card while the wheel could
--                                 not be established. A person may confirm.
--          pending_manual_review  the wheel could not be established on this machine
--          inconsistent           observed serial on a different wheel, or the inspection was
--                                 recorded against another wheel plan than the asset has
--          different_wheel        the job card moved other wheels only
--          no_dated_movement      same wheel, no movement on or after the inspection day
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
  if auth.uid() is null or v_org is null or not public.app_is_active()
     or not public.app_is_elevated() then
    raise exception 'Not authorised to confirm ERP evidence' using errcode = '42501';
  end if;
  select * into v_action from public.corrective_actions
    where id = p_action_id and organisation_id = v_org;
  if not found or v_action.source_type <> 'inspection' or v_action.source_detail not like 'damage:%' then
    raise exception 'Only own inspection tyre actions may be linked' using errcode = '42501';
  end if;
  select * into v_inspection from public.inspections
    where id = v_action.source_id and organisation_id = v_org;
  select * into v_work from public.work_orders
    where id = p_work_order_id and organisation_id = v_org;
  if v_inspection.id is null or v_work.id is null
     or v_action.country is distinct from v_work.country
     or v_work.country is distinct from v_inspection.country
     or upper(btrim(v_work.asset_no)) is distinct from upper(btrim(v_inspection.asset_no))
     or upper(btrim(v_action.asset_no)) is distinct from upper(btrim(v_work.asset_no)) then
    raise exception 'ERP job card must match inspection tenant, country and asset' using errcode = 'PT409';
  end if;
  v_country := v_work.country;
  if not (public.is_super_admin() or public.app_sees_all_countries()
          or lower(btrim(v_country)) = any(coalesce(public.app_country_scope(),'{}'::text[]))) then
    raise exception 'Country is outside permitted scope' using errcode = '42501';
  end if;
  if not (public.app_can_see_site(v_action.site) and public.app_can_see_site(v_inspection.site)
          and public.app_can_see_site(v_work.site)) then
    raise exception 'Site is outside permitted scope' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(v_work.work_order_no,'')), '') is null then
    raise exception 'Job card number missing' using errcode = 'PT409';
  end if;

  v_day := coalesce(v_inspection.inspection_date, v_inspection.created_at::date);
  -- damage:R1Ro -> R1Ro (mirror of positionFromSourceDetail).
  v_token := btrim(split_part(v_action.source_detail, ':', 2));
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
      'notes', v_work.notes, 'opened_at', v_work.opened_at,
      'completed_at', v_work.completed_at));
end $$;

-- -------------------------------------------------------------------------------------
-- observation_erp_decide: same signature and result as live. Only the way the wheel is
-- established changes (see header).
-- -------------------------------------------------------------------------------------
create or replace function public.observation_erp_decide(
  p_action_id uuid, p_work_order_id uuid, p_reason text, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_eval jsonb;
  v_action public.corrective_actions%rowtype;
  v_existing public.observation_erp_links%rowtype;
begin
  if auth.uid() is null or v_org is null or not public.app_is_active()
     or not public.app_is_elevated() then
    raise exception 'Not authorised to confirm ERP evidence' using errcode = '42501';
  end if;
  if p_decision not in ('confirmed','rejected') or length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Decision and reason are required' using errcode = '22023';
  end if;

  select * into v_action from public.corrective_actions
    where id = p_action_id and organisation_id = v_org for update;
  if not found or v_action.source_type <> 'inspection' or v_action.source_detail not like 'damage:%' then
    raise exception 'Only own inspection tyre actions may be linked' using errcode = '42501';
  end if;

  -- Tenant, country, site, asset and job card guards, and the wheel evidence.
  v_eval := public.observation_erp_evaluate(p_action_id, p_work_order_id);

  if p_decision = 'confirmed' and (v_eval->>'work_opened_before_inspection')::boolean then
    raise exception 'Job card predates the inspection. Manual investigation required' using errcode = 'PT409';
  end if;
  if p_decision = 'confirmed' and not (v_eval->>'eligible_to_confirm')::boolean then
    if v_eval->>'state' in ('pending_manual_review', 'inconsistent') then
      raise exception 'The inspected wheel could not be matched on this vehicle (%). Pending manual review',
        v_eval->>'state' using errcode = 'PT409';
    end if;
    raise exception 'No ERP tyre movement matches the action position or serial' using errcode = 'PT409';
  end if;

  select * into v_existing from public.observation_erp_links where action_id=p_action_id for update;
  if p_decision='confirmed' then
    if v_existing.id is not null and v_existing.work_order_id <> p_work_order_id then
      raise exception 'Action already linked to another confirmed job card' using errcode='PT409';
    end if;
    if v_action.work_order_id is not null and v_action.work_order_id <> p_work_order_id then
      raise exception 'Corrective action already linked to a different work order' using errcode='PT409';
    end if;
    if v_existing.id is null then
      insert into public.observation_erp_links
        (organisation_id,country,action_id,work_order_id,source_job_card,work_order_snapshot,decision_note,reviewed_by)
      values (v_org,v_eval->>'country',p_action_id,p_work_order_id,v_eval->>'work_order_no',v_eval->'snapshot',p_reason,auth.uid());
      update public.corrective_actions set work_order_id=p_work_order_id where id=p_action_id;
    end if;
  end if;
  insert into public.observation_erp_link_events
    (organisation_id,country,action_id,work_order_id,source_job_card,work_order_snapshot,decision,reason,reviewer)
  values(v_org,v_eval->>'country',p_action_id,p_work_order_id,v_eval->>'work_order_no',v_eval->'snapshot',p_decision,p_reason,auth.uid());
  return jsonb_build_object('ok',true,'decision',p_decision,
    'action_id',p_action_id,'work_order_id',p_work_order_id,
    'already_linked',(v_existing.id is not null));
end $$;

revoke all on function public.observation_erp_evaluate(uuid, uuid) from public, anon;
grant execute on function public.observation_erp_evaluate(uuid, uuid) to authenticated;
-- Grants on observation_erp_decide are unchanged by create or replace; restated so a fresh
-- environment ends in the same state as production.
revoke all on function public.observation_erp_decide(uuid, uuid, text, text) from public, anon;
grant execute on function public.observation_erp_decide(uuid, uuid, text, text) to authenticated;

-- The two live tables were created without the read-only reporting role's policies.
select anum_integration.apply_reader_policies();
