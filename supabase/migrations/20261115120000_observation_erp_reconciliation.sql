-- DRAFT ONLY. Do not apply to production until CI, RLS impersonation
-- tests, and ERP sample-data reconciliation are approved.
-- No source ERP, inspection or cost records are rewritten by this migration.
create table if not exists public.observation_erp_links (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text not null,
  action_id uuid not null unique references public.corrective_actions(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  source_job_card text not null,
  work_order_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'confirmed' check (status = 'confirmed'),
  decision_note text not null check (length(btrim(decision_note)) between 5 and 2000),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now()
);
create index if not exists observation_erp_links_org_country
  on public.observation_erp_links(organisation_id,country,work_order_id);
alter table public.observation_erp_links enable row level security;
drop policy if exists observation_erp_links_org on public.observation_erp_links;
create policy observation_erp_links_org on public.observation_erp_links as restrictive
  for all to authenticated
  using (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));
drop policy if exists observation_erp_links_country on public.observation_erp_links;
create policy observation_erp_links_country on public.observation_erp_links as restrictive
  for select to authenticated
  using ((select public.is_super_admin()) or (select public.app_sees_all_countries())
     or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])));
drop policy if exists observation_erp_links_read on public.observation_erp_links;
create policy observation_erp_links_read on public.observation_erp_links for select to authenticated
  using ((select public.app_is_active()));
revoke all on public.observation_erp_links from anon;
revoke all on public.observation_erp_links from authenticated;
grant select on public.observation_erp_links to authenticated;

create table if not exists public.observation_erp_link_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  country text not null,
  action_id uuid not null,
  work_order_id uuid not null,
  source_job_card text not null,
  work_order_snapshot jsonb not null default '{}'::jsonb,
  decision text not null check (decision in ('confirmed','rejected')),
  reason text not null,
  reviewer uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists observation_erp_link_events_action
  on public.observation_erp_link_events(organisation_id,action_id,created_at desc);
alter table public.observation_erp_link_events enable row level security;
create policy observation_erp_events_org on public.observation_erp_link_events as restrictive
  for select to authenticated using (organisation_id = (select public.app_current_org()));
create policy observation_erp_events_country on public.observation_erp_link_events as restrictive
  for select to authenticated using ((select public.is_super_admin()) or (select public.app_sees_all_countries())
  or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])));
create policy observation_erp_events_read on public.observation_erp_link_events
  for select to authenticated using ((select public.app_is_active()));
revoke all on public.observation_erp_link_events from anon,authenticated;
grant select on public.observation_erp_link_events to authenticated;

create or replace function public.observation_erp_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ERP decision history is append-only';
end; $$;
create trigger observation_erp_events_immutable
  before update or delete on public.observation_erp_link_events
  for each row execute function public.observation_erp_events_immutable();

create or replace function public.observation_erp_decide(
  p_action_id uuid, p_work_order_id uuid, p_reason text, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_action public.corrective_actions%rowtype;
  v_inspection public.inspections%rowtype;
  v_work public.work_orders%rowtype;
  v_existing public.observation_erp_links%rowtype;
  v_country text;
  v_position text;
  v_verified_tyre boolean;
  v_snapshot jsonb;
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
  if nullif(btrim(coalesce(v_work.work_order_no,'')), '') is null then
    raise exception 'Job card number missing' using errcode = 'PT409';
  end if;
  if p_decision = 'confirmed' and (v_work.opened_at is null
      or v_work.opened_at::date < coalesce(v_inspection.inspection_date,v_inspection.created_at::date)) then
    raise exception 'Job card predates the inspection. Manual investigation required' using errcode = 'PT409';
  end if;
  -- Inspection slots are not ERP wheel names. Resolve using the exact
  -- vehicle layout, not a direct string comparison (R1Li != LHR1-I).
  -- Mixer first-rear slots denote the centre axle; pump slots denote rear axle 1.
  v_position := upper(regexp_replace(
    case
      when upper(coalesce(v_inspection.vehicle_type,'')) like '%MIXER%' then
        case substr(v_action.source_detail,8)
          when 'R1Lo' then 'LHCO' when 'R1Li' then 'LHCI'
          when 'R1Ri' then 'RHCI' when 'R1Ro' then 'RHCO'
          when 'R2Lo' then 'LHRO' when 'R2Li' then 'LHRI'
          when 'R2Ri' then 'RHRI' when 'R2Ro' then 'RHRO'
          when 'F1L' then 'LHF1' when 'F1R' then 'RHF1'
          when 'F2L' then 'LHF2' when 'F2R' then 'RHF2'
          else substr(v_action.source_detail,8)
        end
      else
        case substr(v_action.source_detail,8)
          when 'R1Lo' then 'LHR1-O' when 'R1Li' then 'LHR1-I'
          when 'R1Ri' then 'RHR1-I' when 'R1Ro' then 'RHR1-O'
          when 'R2Lo' then 'LHR2-O' when 'R2Li' then 'LHR2-I'
          when 'R2Ri' then 'RHR2-I' when 'R2Ro' then 'RHR2-O'
          when 'R3Lo' then 'LHR3-O' when 'R3Li' then 'LHR3-I'
          when 'R3Ri' then 'RHR3-I' when 'R3Ro' then 'RHR3-O'
          when 'FL' then 'LHF1' when 'FR' then 'RHF1'
          when 'F1L' then 'LHF1' when 'F1R' then 'RHF1'
          when 'F2L' then 'LHF2' when 'F2R' then 'RHF2'
          when 'F3L' then 'LHF3' when 'F3R' then 'RHF3'
          when 'RL' then 'LHR1' when 'RR' then 'RHR1'
          else substr(v_action.source_detail,8)
        end
    end, '[^A-Za-z0-9]', '', 'g'));
  if v_position is null or v_position = '' then
    raise exception 'Unknown inspection tyre position' using errcode = 'PT409';
  end if;
  select exists (
    select 1 from public.tyre_records t
    where t.organisation_id = v_org and t.country = v_country
      and upper(btrim(t.asset_no)) = upper(btrim(v_work.asset_no))
      and upper(btrim(t.job_card)) = upper(btrim(v_work.work_order_no))
      and upper(regexp_replace(coalesce(t.tyre_position,t.position,''),'[^A-Za-z0-9]','','g')) = v_position
      and (t.removal_date::date >= coalesce(v_inspection.inspection_date,v_inspection.created_at::date)
        or t.issue_date::date >= coalesce(v_inspection.inspection_date,v_inspection.created_at::date))
      and (nullif(btrim(coalesce(v_action.tyre_serial,'')),'') is null
           or upper(btrim(t.serial_no)) = upper(btrim(v_action.tyre_serial)))
  ) into v_verified_tyre;
  if p_decision = 'confirmed' and not v_verified_tyre then
    raise exception 'No ERP tyre movement matches the action position or serial' using errcode = 'PT409';
  end if;
  v_snapshot := jsonb_build_object(
    'work_order_no', v_work.work_order_no, 'asset_no', v_work.asset_no,
    'country', v_work.country, 'status', v_work.status, 'description', v_work.description,
    'notes', v_work.notes, 'opened_at', v_work.opened_at,
    'completed_at', v_work.completed_at);
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
      values (v_org,v_country,p_action_id,p_work_order_id,v_work.work_order_no,v_snapshot,p_reason,auth.uid());
      update public.corrective_actions set work_order_id=p_work_order_id where id=p_action_id;
    end if;
  end if;
  insert into public.observation_erp_link_events
    (organisation_id,country,action_id,work_order_id,source_job_card,work_order_snapshot,decision,reason,reviewer)
  values(v_org,v_country,p_action_id,p_work_order_id,v_work.work_order_no,v_snapshot,p_decision,p_reason,auth.uid());
  return jsonb_build_object('ok',true,'decision',p_decision,
    'action_id',p_action_id,'work_order_id',p_work_order_id,
    'already_linked',(v_existing.id is not null));
end $$;
revoke all on function public.observation_erp_decide(uuid,uuid,text,text) from public,anon;
grant execute on function public.observation_erp_decide(uuid,uuid,text,text) to authenticated;
create or replace function public.confirm_observation_erp_link(
  p_action_id uuid,p_work_order_id uuid,p_reason text)
returns jsonb language sql security invoker set search_path = '' as $$
  select public.observation_erp_decide(p_action_id,p_work_order_id,p_reason,'confirmed')
$$;
create or replace function public.reject_observation_erp_link(
  p_action_id uuid,p_work_order_id uuid,p_reason text)
returns jsonb language sql security invoker set search_path = '' as $$
  select public.observation_erp_decide(p_action_id,p_work_order_id,p_reason,'rejected')
$$;
revoke all on function public.confirm_observation_erp_link(uuid,uuid,text) from public,anon;
revoke all on function public.reject_observation_erp_link(uuid,uuid,text) from public,anon;
grant execute on function public.confirm_observation_erp_link(uuid,uuid,text) to authenticated;
grant execute on function public.reject_observation_erp_link(uuid,uuid,text) to authenticated;
-- Mandatory staging checks before applying: cross-org, cross-country,
-- wrong asset/position/serial, job date before inspection, duplicate confirmation,
-- conflicting existing work order, failed/partial imports, non-elevated user,
-- and event immutability. Confirm does NOT close an action or alter ERP costs.
