-- WO-2: work order policies and guards read the one resolver (work_order_can).
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15 from the LIVE pg_policies and pg_trigger rows
--         of work_orders, wo_tasks, wo_assignments and tech_activity_events (read only). Applied
--         only to a private copy of the local staging database (tp_workorder, synthetic data) by
--         supabase/tests/staging_work_order_permissions.sh. NEEDS THE OWNER'S YES.
--
-- DEPENDS ON (in this order):
--   20261113130000_cur_work_orders_manager_director_default.sql
--   20261115140000_wo_permission_resolver.sql
--
-- NO REMOVAL STATEMENT IS USED. Every existing policy is changed in place with ALTER POLICY; the
--   new triggers are created with CREATE OR REPLACE. Nothing in this file rewrites a stored work
--   order, cost, task, assignment or event: it changes who may write from now on.
--
-- WHAT WAS ALREADY RIGHT ON PRODUCTION (verified, left alone)
--   work_orders has RESTRICTIVE company, country and site WRITE policies (work_orders_org_isolation,
--   work_orders_country_write, work_orders_site_write, each FOR ALL with USING and WITH CHECK), and
--   so do wo_tasks, wo_assignments and tech_activity_events. Deleting is Admin only on all four
--   (admin_only_delete_guard, RESTRICTIVE). Those walls stay exactly as they are.
--
-- WHAT WAS WRONG
--   1. Who may write the job itself was a single yes or no (app_user_can work_orders create / edit)
--      with no notion of assigning, recording progress, quality check, tyre work or "my own job".
--   2. Anyone with that yes could change ANY column of ANY work order in their walls, including a
--      closed one and its costs (97,204 of 97,242 production work orders are closed).
--   3. Assigning technicians, tasks and activity events were tied to the three role names inside
--      app_is_elevated() (admin, manager, director), so a Workshop Supervisor could do none of it.
--   4. tech_activity_events_self_insert let any approved person record an event against ANY job
--      (production: every job event so far is on an assigned job, so nobody loses anything).
--   5. tech_activity_events_own_visibility hides other people's events from everyone but the three
--      elevated roles, so Workshop Live Control would show a supervisor an empty board.
--   6. A work order with no site passes the site wall for a site-limited person.
--
-- THE RULE AFTER THIS MIGRATION (one resolver: public.work_order_can)
--   work_orders INSERT   work_order_can('create', row)
--   work_orders UPDATE   the row is reachable when the caller has edit, progress, assign or qc on
--                        it; trigger wo_write_guard then checks WHAT changed:
--                          closed work order                 Admin only
--                          cost of an approved work order    Admin only
--                          company, id, import reference     Admin only (creator and created
--                                                            time are silently kept as stored)
--                          assigned owner, technician name   assign
--                          quality check result              qc
--                          status, started, completed, notes, hours, odometer, off road, parts used
--                                                            progress (or edit)
--                          setting status Completed, Closed or Cancelled (final closure)   close
--                          setting status Cancelled (as well), or any other column   edit
--   work_orders DELETE   Admin only (unchanged policy) plus trigger wo_delete_guard, so a definer
--                        function run by a non-admin cannot remove one either
--   wo_assignments, wo_tasks (write)   work_order_can_job('assign', job)
--   wo_tasks UPDATE by the assignee    status only (policy wo_tasks_assignee_progress + trigger)
--   tech_activity_events               own event: no job, or a job the person is assigned to or
--                                      may record progress on; other people's events: assign
--   Calls with no signed-in user (service role, staging pipes loaded from the dashboard, cron) are
--   not judged by the triggers, exactly like the existing guards (auth.uid() is null).
--
-- WHO GAINS OR LOSES ON PRODUCTION (approved accounts, read 2026-11-15)
--   Gain create, edit, assign, progress, qc on work orders in their sites:
--     Workshop Supervisor 7, Maintenance Supervisor 1, Workshop Maintenance Area Manager 1.
--     Manager 3 (create and edit arrive with 20261113130000; assign they already had).
--   Gain the same for tyre work only: Tire Planning Engineer 1.
--   Gain "record progress on my assigned job": Tyre Man 17 and 38 workshop trade accounts.
--   Gain "record progress on my assigned job": see above. Technicians cannot set Completed, Closed
--     or Cancelled; they move the job to Quality Inspection and a supervisor closes it.
--   Lose: Tyre Data Collector 7 keep create, edit and progress on open work orders in their walls,
--     and the quality check on work orders assigned to them. They can no longer change a closed
--     work order, the assigned owner or the cost of an approved one, record a quality check on a
--     job that is not theirs, or set a work order to Completed, Closed or Cancelled (owner decision
--     2026-11-15 round 2). Data Monitor Officer 1 keeps create, edit, progress, qc and closing but
--     loses closed work orders, the assigned owner and approved costs. Manager 3 and Director 0 lose nothing they could do (they could not
--     write the job at all). Admin 2: unchanged.
--   Stored rows changed: none.
--
-- VERIFY (rolled back, after applying)
--   begin;
--   select count(*) from pg_trigger where tgrelid = 'public.work_orders'::regclass
--      and tgname in ('wo_write_guard', 'wo_delete_guard') and tgenabled = 'O';              -- 2
--   select position('work_order_can' in with_check) > 0 from pg_policies
--    where tablename = 'work_orders' and policyname = 'work_orders_cap_insert';              -- t
--   -- as a Manager on a closed work order in their site:
--   --   update public.work_orders set notes = 'x' where id = '<closed id>';
--   --   expect: ERROR 42501 This work order is closed. Only an Admin can change a closed work order.
--   -- as a Tyre Man on a job not assigned to them: update ... -> 0 rows.
--   -- with no signed-in user (service role): the same update succeeds.
--   rollback;
--
-- ROLLBACK (restores the live expressions read on 2026-11-15)
--   begin;
--   alter table public.work_orders disable trigger wo_write_guard;
--   alter table public.work_orders disable trigger wo_delete_guard;
--   alter table public.wo_tasks disable trigger wo_tasks_progress_guard;
--   alter policy work_orders_cap_insert on public.work_orders
--     with check (app_user_can('work_orders'::text, 'create'::text));
--   alter policy work_orders_cap_update on public.work_orders
--     using (app_user_can('work_orders'::text, 'edit'::text))
--     with check (app_user_can('work_orders'::text, 'edit'::text));
--   alter policy wo_assignments_elevated_write on public.wo_assignments
--     using (app_is_elevated()) with check (app_is_elevated());
--   alter policy wo_tasks_elevated_write on public.wo_tasks
--     using (app_is_elevated()) with check (app_is_elevated());
--   alter policy wo_tasks_assignee_progress on public.wo_tasks using (false) with check (false);
--   alter policy tech_activity_events_elevated_write on public.tech_activity_events
--     using (app_is_elevated()) with check (app_is_elevated());
--   alter policy tech_activity_events_self_insert on public.tech_activity_events
--     with check (app_is_active() and ((user_id = auth.uid()) or app_is_elevated()));
--   alter policy tech_activity_events_own_visibility on public.tech_activity_events
--     using ((user_id = auth.uid()) or app_is_elevated());
--   commit;

begin;

-- 1. Helpers used by the policies and the guards -------------------------------------------------
create or replace function public.work_order_can_any_write(
  p_org uuid, p_country text, p_site text, p_is_tyre boolean, p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.work_order_can('edit', p_org, p_country, p_site, p_is_tyre, p_job_id)
      or public.work_order_can('progress', p_org, p_country, p_site, p_is_tyre, p_job_id)
      or public.work_order_can('assign', p_org, p_country, p_site, p_is_tyre, p_job_id)
      or public.work_order_can('qc', p_org, p_country, p_site, p_is_tyre, p_job_id);
$function$;

-- An activity event: judged through its job when it names one, else through its own site.
create or replace function public.work_order_can_event(
  p_action text, p_org uuid, p_country text, p_site text, p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when p_job_id is not null then public.work_order_can_job(p_action, p_job_id)
              else public.work_order_can(p_action, p_org, p_country, p_site, true, null) end;
$function$;

revoke all on function public.work_order_can_any_write(uuid, text, text, boolean, uuid) from public;
revoke all on function public.work_order_can_any_write(uuid, text, text, boolean, uuid) from anon;
grant execute on function public.work_order_can_any_write(uuid, text, text, boolean, uuid) to authenticated, service_role;
revoke all on function public.work_order_can_event(text, uuid, text, text, uuid) from public;
revoke all on function public.work_order_can_event(text, uuid, text, text, uuid) from anon;
grant execute on function public.work_order_can_event(text, uuid, text, text, uuid) to authenticated, service_role;

-- 2. work_orders: what changed decides which right is needed ----------------------------------
-- MIRROR of WO_COLUMN_CLASS / requiredActionsForChange in src/lib/workOrderAccess.js. Change both.
create or replace function public.wo_write_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old jsonb; v_new jsonb; v_keys text[]; v_tyre boolean; v_tyre_new boolean;
  c_ignore   constant text[] := array['updated_at', 'total_cost', 'execution_approval_id'];
  c_admin    constant text[] := array['id', 'organisation_id', 'source_row', 'client_uuid'];
  c_cost     constant text[] := array['labour_cost', 'parts_cost', 'tyre_cost', 'lubricant_cost', 'outside_repair_cost', 'labour_rate'];
  c_assign   constant text[] := array['assigned_owner_id', 'technician_name'];
  c_qc       constant text[] := array['qc_status'];
  c_progress constant text[] := array['status', 'started_at', 'completed_at', 'notes', 'labour_hours', 'manpower_hours',
                                      'waiting_parts_hours', 'waiting_manpower_hours', 'odometer', 'vor', 'vor_since', 'parts_used'];
  v_need_edit boolean; v_need_assign boolean; v_need_qc boolean; v_need_progress boolean;
  v_need_close boolean;
  v_status_only_assign boolean := false;
begin
  -- No signed-in user: service role, a staging pipe loaded from the dashboard, cron. Not judged.
  if auth.uid() is null then return NEW; end if;
  -- Admin and super admin (of this company) may change anything.
  if public.work_order_can('override_closed', OLD.organisation_id, OLD.country::text, OLD.site::text, true, OLD.id) then
    return NEW;
  end if;

  -- Who created the work order and when is kept as stored (an edit form may resend them).
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;

  v_old := to_jsonb(OLD) - c_ignore;
  v_new := to_jsonb(NEW) - c_ignore;
  if v_old = v_new then return NEW; end if;
  select array_agg(n.key) into v_keys
    from jsonb_each(v_new) n where n.value is distinct from (v_old -> n.key);

  if public.work_order_is_closed(OLD.status::text) then
    raise exception 'This work order is closed. Only an Admin can change a closed work order.'
      using errcode = '42501';
  end if;
  if v_keys && c_admin then
    raise exception 'Only an Admin can change the company or import reference of a work order.'
      using errcode = '42501';
  end if;
  if v_keys && c_cost and OLD.execution_approval_id is not null then
    raise exception 'The cost of this work order was approved. Only an Admin can change an approved cost.'
      using errcode = '42501';
  end if;

  v_tyre := public.work_order_is_tyre(OLD.work_type::text, OLD.tyre_serial::text, OLD.tyre_position::text);
  v_tyre_new := public.work_order_is_tyre(NEW.work_type::text, NEW.tyre_serial::text, NEW.tyre_position::text);

  v_need_assign := v_keys && c_assign;
  v_need_qc := v_keys && c_qc;
  -- Marking the job Assigned or Awaiting Assignment while changing the owner is part of assigning.
  if v_need_assign and 'status' = any (v_keys)
     and lower(btrim(NEW.status::text)) in ('assigned', 'awaiting assignment') then
    v_status_only_assign := true;
  end if;
  v_need_progress := exists (
    select 1 from unnest(v_keys) k
     where k = any (c_progress) and not (k = 'status' and v_status_only_assign));
  v_need_edit := exists (
    select 1 from unnest(v_keys) k
     where not (k = any (c_progress) or k = any (c_assign) or k = any (c_qc)))
    or ('status' = any (v_keys) and lower(btrim(NEW.status::text)) in ('cancelled', 'canceled'));

  -- Final closure: moving the job to a closed status (Completed, Closed, Cancelled).
  v_need_close := 'status' = any (v_keys) and public.work_order_is_closed(NEW.status::text);

  if v_need_edit and not (
       public.work_order_can('edit', OLD.organisation_id, OLD.country::text, OLD.site::text, v_tyre, OLD.id)
       and public.work_order_can('edit', NEW.organisation_id, NEW.country::text, NEW.site::text, v_tyre_new, NEW.id)) then
    raise exception 'You can record progress on this work order but not change its details. Ask a supervisor or an Admin.'
      using errcode = '42501';
  end if;
  if v_need_assign and not public.work_order_can('assign', OLD.organisation_id, OLD.country::text, OLD.site::text, v_tyre, OLD.id) then
    raise exception 'You are not allowed to assign this work order.' using errcode = '42501';
  end if;
  if v_need_qc and not public.work_order_can('qc', OLD.organisation_id, OLD.country::text, OLD.site::text, v_tyre, OLD.id) then
    raise exception 'You are not allowed to record the quality check for this work order.' using errcode = '42501';
  end if;
  if v_need_close and not public.work_order_can('close', OLD.organisation_id, OLD.country::text, OLD.site::text, v_tyre, OLD.id) then
    raise exception 'You cannot close a work order. Move it to Quality Inspection and a supervisor will close it.'
      using errcode = '42501';
  end if;
  if v_need_progress and not (
       public.work_order_can('progress', OLD.organisation_id, OLD.country::text, OLD.site::text, v_tyre, OLD.id)
       or public.work_order_can('edit', OLD.organisation_id, OLD.country::text, OLD.site::text, v_tyre, OLD.id)) then
    raise exception 'You are not allowed to record progress on this work order.' using errcode = '42501';
  end if;
  return NEW;
end;
$function$;

create or replace function public.wo_delete_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then return OLD; end if;
  if public.work_order_can('delete', OLD.organisation_id, OLD.country::text, OLD.site::text, true, OLD.id) then
    return OLD;
  end if;
  raise exception 'Only an Admin can delete a work order.' using errcode = '42501';
end;
$function$;

-- A task: the assignee may move its status; everything else needs the right to assign.
create or replace function public.wo_tasks_progress_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then return NEW; end if;
  if public.work_order_can_job('assign', OLD.job_id) then return NEW; end if;
  if (to_jsonb(NEW) - array['status', 'updated_at']) is distinct from (to_jsonb(OLD) - array['status', 'updated_at']) then
    raise exception 'You can update the status of your task only. Ask a supervisor to change the task itself.'
      using errcode = '42501';
  end if;
  return NEW;
end;
$function$;

revoke all on function public.wo_write_guard() from public;
revoke all on function public.wo_write_guard() from anon;
revoke all on function public.wo_write_guard() from authenticated;
revoke all on function public.wo_delete_guard() from public;
revoke all on function public.wo_delete_guard() from anon;
revoke all on function public.wo_delete_guard() from authenticated;
revoke all on function public.wo_tasks_progress_guard() from public;
revoke all on function public.wo_tasks_progress_guard() from anon;
revoke all on function public.wo_tasks_progress_guard() from authenticated;

create or replace trigger wo_write_guard
  before update on public.work_orders
  for each row execute function public.wo_write_guard();

create or replace trigger wo_delete_guard
  before delete on public.work_orders
  for each row execute function public.wo_delete_guard();

create or replace trigger wo_tasks_progress_guard
  before update on public.wo_tasks
  for each row execute function public.wo_tasks_progress_guard();

-- 3. work_orders policies -----------------------------------------------------------------------
alter policy work_orders_cap_insert on public.work_orders
  with check (public.work_order_can('create', organisation_id, (country)::text, (site)::text,
                public.work_order_is_tyre((work_type)::text, (tyre_serial)::text, (tyre_position)::text), null));

alter policy work_orders_cap_update on public.work_orders
  using (public.work_order_can_any_write(organisation_id, (country)::text, (site)::text,
           public.work_order_is_tyre((work_type)::text, (tyre_serial)::text, (tyre_position)::text), id))
  with check (public.work_order_can_any_write(organisation_id, (country)::text, (site)::text,
           public.work_order_is_tyre((work_type)::text, (tyre_serial)::text, (tyre_position)::text), id));

-- 4. Assignments and tasks: the right to assign, judged on the job's own company, country, site --
alter policy wo_assignments_elevated_write on public.wo_assignments
  using (public.work_order_can_job('assign', job_id))
  with check (public.work_order_can_job('assign', job_id));

alter policy wo_tasks_elevated_write on public.wo_tasks
  using (public.work_order_can_job('assign', job_id))
  with check (public.work_order_can_job('assign', job_id));

do $do$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wo_tasks'
                   and policyname = 'wo_tasks_assignee_progress') then
    create policy wo_tasks_assignee_progress on public.wo_tasks
      for update to authenticated
      using (public.work_order_can_job('progress', job_id))
      with check (public.work_order_can_job('progress', job_id));
  else
    alter policy wo_tasks_assignee_progress on public.wo_tasks
      using (public.work_order_can_job('progress', job_id))
      with check (public.work_order_can_job('progress', job_id));
  end if;
end
$do$;

-- 5. Activity events ----------------------------------------------------------------------------
-- Other people's events (foreman confirm, mark unavailable): elevated roles as today, or the right
-- to assign on that job or site.
alter policy tech_activity_events_elevated_write on public.tech_activity_events
  using (app_is_elevated() or public.work_order_can_event('assign', organisation_id, country, site, job_id))
  with check (app_is_elevated() or public.work_order_can_event('assign', organisation_id, country, site, job_id));

-- Own event: check in / out and breaks carry no job; a job event needs the job to be mine.
alter policy tech_activity_events_self_insert on public.tech_activity_events
  with check (app_is_active() and (
    app_is_elevated()
    or (user_id = auth.uid() and (
          job_id is null
          or public.work_order_is_assigned(job_id)
          or public.work_order_can_job('progress', job_id)))));

-- Supervisors must see their technicians' events or Workshop Live Control is empty for them. The
-- site and country walls (tech_activity_events_site_isolation, _country_isolation) still apply.
alter policy tech_activity_events_own_visibility on public.tech_activity_events
  using ((user_id = auth.uid())
         or (select app_is_elevated())
         or (select public.work_order_scope('assign')) is not null);

commit;
