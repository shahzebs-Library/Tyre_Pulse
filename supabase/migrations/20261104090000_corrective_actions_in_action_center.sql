-- Corrective actions appear in the Action Center, and their status stays in step.
--
-- WHY: actions raised from inspections, imports, accidents and the Corrective
-- Actions page are stored in `corrective_actions`, while the Action Center
-- (/action-center) only reads `action_items`. Measured live 2026-11-04:
-- corrective_actions 5 rows, action_items 0 rows. So a raised action showed on
-- the inspection it came from and never in the Action Center, which read as
-- "it shows and then disappears".
--
-- FIX (one data model, two views): every corrective action owns exactly one
-- action item, keyed source = 'corrective:<id>' (unique per org). The link is
-- maintained by triggers in BOTH directions, guarded by pg_trigger_depth so the
-- two triggers never ping-pong:
--   corrective Open        -> action open
--   corrective In Progress -> action in_progress
--   corrective Closed      -> action resolved
--   action resolved/dismissed            -> corrective Closed
--   action acknowledged/in_progress/
--          blocked/escalated/pending     -> corrective In Progress
--   action open                          -> corrective Open
-- A sync failure NEVER blocks the business write: it is logged to system_logs.
--
-- action_item_before_write: organisation_id now falls back to the row's own org
-- only when there is no signed-in user (backfill / service role). A signed-in
-- user still always gets their own org, so nothing is loosened for clients.
--
-- Rollback:
--   drop trigger if exists trg_corrective_to_action_item on public.corrective_actions;
--   drop trigger if exists trg_action_item_to_corrective on public.action_items;
--   drop function if exists public.sync_corrective_to_action_item();
--   drop function if exists public.sync_action_item_to_corrective();
--   drop index if exists public.action_items_org_corrective_source_uidx;
--   delete from public.action_items where source like 'corrective:%';
--   (and restore action_item_before_write: new.organisation_id := public.app_current_org();)

create or replace function public.action_item_before_write()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  v_allowed boolean;
  v_role text;
begin
  if tg_op = 'UPDATE' and new.organisation_id is distinct from old.organisation_id then
    raise exception 'organisation_id is immutable' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    -- A signed-in user always writes into their own org. Only a session with no
    -- user (service role, backfill) may keep the org it supplied.
    if auth.uid() is not null then
      new.organisation_id := public.app_current_org();
    else
      new.organisation_id := coalesce(public.app_current_org(), new.organisation_id);
    end if;
    if new.organisation_id is null then
      raise exception 'An organisation membership is required' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status and
     (new.approval_status is distinct from old.approval_status or
      new.approval_requested_at is distinct from old.approval_requested_at or
      new.approval_requested_by is distinct from old.approval_requested_by or
      new.approved_at is distinct from old.approved_at or
      new.approved_by is distinct from old.approved_by or
      new.completed_at is distinct from old.completed_at or
      new.escalated_at is distinct from old.escalated_at or
      new.escalated_by is distinct from old.escalated_by) then
    raise exception 'Lifecycle audit fields may only change through a status transition'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    v_allowed := case old.status
      when 'open' then new.status in ('acknowledged','in_progress','blocked','escalated','dismissed')
      when 'acknowledged' then new.status in ('open','in_progress','blocked','escalated','dismissed')
      when 'in_progress' then new.status in ('blocked','escalated','pending_approval','resolved','dismissed')
      when 'blocked' then new.status in ('in_progress','escalated','dismissed')
      when 'escalated' then new.status in ('in_progress','blocked','pending_approval','resolved','dismissed')
      when 'pending_approval' then new.status in ('in_progress','resolved','dismissed')
      when 'resolved' then new.status in ('open','in_progress')
      when 'dismissed' then new.status = 'open'
      else false end;
    if not v_allowed then
      raise exception 'Invalid action item transition: % -> %', old.status, new.status
        using errcode = '23514';
    end if;

    if old.status = 'pending_approval' then
      v_role := public.get_my_role();
      if v_role not in ('Admin','Manager','Director') then
        raise exception 'Supervisor approval requires Admin, Manager, or Director role'
          using errcode = '42501';
      end if;
      if new.status in ('in_progress','dismissed') then
        new.approval_status := 'rejected';
      end if;
    end if;

    if new.status = 'escalated' then
      new.escalated_at := coalesce(new.escalated_at, now());
      new.escalated_by := coalesce(new.escalated_by, auth.uid());
    elsif new.status = 'pending_approval' then
      new.approval_status := 'pending';
      new.approval_requested_at := coalesce(new.approval_requested_at, now());
      new.approval_requested_by := coalesce(new.approval_requested_by, auth.uid());
    elsif new.status = 'resolved' then
      if old.status = 'pending_approval' then
        new.approval_status := 'approved';
        new.approved_at := coalesce(new.approved_at, now());
        new.approved_by := coalesce(new.approved_by, auth.uid());
      end if;
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status in ('resolved','dismissed') then
      new.completed_at := null;
      new.approval_status := 'not_required';
      new.approved_at := null;
      new.approved_by := null;
    end if;
  end if;
  return new;
end $function$;

create unique index if not exists action_items_org_corrective_source_uidx
  on public.action_items (organisation_id, source)
  where source like 'corrective:%';

-- corrective_actions -> action_items
create or replace function public.sync_corrective_to_action_item()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_source text := 'corrective:' || new.id::text;
  v_item public.action_items%rowtype;
  v_target text;
  v_severity text;
  v_category text;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  v_target := case new.status when 'In Progress' then 'in_progress'
                              when 'Closed' then 'resolved' else 'open' end;
  v_severity := case new.priority when 'High' then 'high' when 'Low' then 'low' else 'medium' end;
  v_category := case new.source_type when 'inspection' then 'inspection'
                                     when 'checklist' then 'inspection'
                                     when 'accident' then 'safety' else 'maintenance' end;

  begin
    select * into v_item from public.action_items
     where source = v_source
       and organisation_id is not distinct from new.organisation_id
     limit 1;

    if not found then
      insert into public.action_items
        (organisation_id, title, category, source, asset_no, severity, assigned_to,
         site, country, due_date, status, impact, notes, resolution)
      values
        (new.organisation_id, left(coalesce(nullif(btrim(new.title), ''), 'Corrective action'), 300),
         v_category, v_source, new.asset_no, v_severity, new.assigned_to,
         new.site, new.country, new.due_date::date, v_target,
         left(split_part(coalesce(new.description, ''), E'\n', 1), 4000),
         left(new.root_cause, 8000),
         case when v_target = 'resolved' then 'Closed in Corrective Actions' end);
      return new;
    end if;

    -- Descriptive fields follow the corrective action.
    update public.action_items
       set title = left(coalesce(nullif(btrim(new.title), ''), title), 300),
           severity = v_severity,
           asset_no = new.asset_no,
           assigned_to = coalesce(new.assigned_to, assigned_to),
           site = new.site,
           due_date = new.due_date::date
     where id = v_item.id;

    -- Status: step through the transitions the action-item guard allows.
    if v_target = 'resolved' and v_item.status not in ('resolved', 'dismissed') then
      if v_item.status in ('open', 'acknowledged', 'blocked') then
        update public.action_items set status = 'in_progress' where id = v_item.id;
      end if;
      update public.action_items
         set status = 'resolved',
             resolution = coalesce(nullif(btrim(resolution), ''), 'Closed in Corrective Actions')
       where id = v_item.id;
    elsif v_target = 'in_progress' and v_item.status in ('open', 'acknowledged', 'resolved') then
      update public.action_items set status = 'in_progress' where id = v_item.id;
    elsif v_target = 'open' and v_item.status in ('resolved', 'dismissed') then
      update public.action_items set status = 'open' where id = v_item.id;
    end if;
  exception when others then
    insert into public.system_logs (organisation_id, module_id, severity, source, message, detail)
    values (new.organisation_id, 'action_center', 'error', 'sync_corrective_to_action_item',
            'Corrective action could not be mirrored into the Action Center',
            jsonb_build_object('corrective_action_id', new.id, 'sqlstate', sqlstate, 'error', sqlerrm));
  end;
  return new;
end $function$;

-- action_items -> corrective_actions
create or replace function public.sync_action_item_to_corrective()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
  v_target text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.source is null or new.source not like 'corrective:%' then return new; end if;
  if new.status is not distinct from old.status then return new; end if;

  begin
    v_id := substr(new.source, length('corrective:') + 1)::uuid;
    v_target := case
      when new.status in ('resolved', 'dismissed') then 'Closed'
      when new.status = 'open' then 'Open'
      else 'In Progress' end;

    update public.corrective_actions
       set status = v_target,
           closed_at = case when v_target = 'Closed' then coalesce(closed_at, now()) else null end,
           closed_by = case when v_target = 'Closed' then coalesce(closed_by, auth.uid()) else null end
     where id = v_id
       and organisation_id is not distinct from new.organisation_id
       and status is distinct from v_target;
  exception when others then
    insert into public.system_logs (organisation_id, module_id, severity, source, message, detail)
    values (new.organisation_id, 'action_center', 'error', 'sync_action_item_to_corrective',
            'Action Center status could not be copied to the corrective action',
            jsonb_build_object('action_item_id', new.id, 'sqlstate', sqlstate, 'error', sqlerrm));
  end;
  return new;
end $function$;

revoke all on function public.sync_corrective_to_action_item() from public, anon, authenticated;
revoke all on function public.sync_action_item_to_corrective() from public, anon, authenticated;

create trigger trg_corrective_to_action_item
  after insert or update on public.corrective_actions
  for each row execute function public.sync_corrective_to_action_item();

create trigger trg_action_item_to_corrective
  after update of status on public.action_items
  for each row execute function public.sync_action_item_to_corrective();

-- Backfill: every existing corrective action gets its Action Center item.
insert into public.action_items
  (organisation_id, title, category, source, asset_no, severity, assigned_to,
   site, country, due_date, status, impact, notes, resolution, created_at, completed_at)
select ca.organisation_id,
       left(coalesce(nullif(btrim(ca.title), ''), 'Corrective action'), 300),
       case ca.source_type when 'inspection' then 'inspection' when 'checklist' then 'inspection'
                           when 'accident' then 'safety' else 'maintenance' end,
       'corrective:' || ca.id::text,
       ca.asset_no,
       case ca.priority when 'High' then 'high' when 'Low' then 'low' else 'medium' end,
       ca.assigned_to, ca.site, ca.country, ca.due_date::date,
       case ca.status when 'In Progress' then 'in_progress' when 'Closed' then 'resolved' else 'open' end,
       left(split_part(coalesce(ca.description, ''), E'\n', 1), 4000),
       left(ca.root_cause, 8000),
       case when ca.status = 'Closed' then 'Closed in Corrective Actions' end,
       ca.created_at,
       case when ca.status = 'Closed' then coalesce(ca.closed_at, ca.resolved_at, ca.created_at) end
  from public.corrective_actions ca
 where ca.organisation_id is not null
   and not exists (select 1 from public.action_items ai
                    where ai.source = 'corrective:' || ca.id::text);
