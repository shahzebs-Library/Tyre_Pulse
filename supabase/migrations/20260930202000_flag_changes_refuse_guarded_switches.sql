-- ============================================================================
-- 20260930202000_flag_changes_refuse_guarded_switches.sql
--
-- Feature Flags "Schedule a change" must not become a side door around the
-- three switches that have their own guarded flow:
--   dual_control_enabled          (admin_set_dual_control, second approval)
--   console_ip_allowlist_enabled  (Access Policies, anti-lockout guard)
--   maintenance_mode              (Quick actions, typed confirm)
-- admin_schedule_flag_change now refuses them. Body otherwise identical to
-- 20260930201000 (one anchored insertion, count checked).
--
-- Pre-flight: no data change, no table touched, no lock beyond the function
-- replace. Grants re-stated (revoke public, revoke anon, grant authenticated).
-- Verify: schedule a config change for dual_control_enabled as a super admin
-- in a rolled-back txn -> 22023; a normal switch -> ok.
-- Rollback: re-run the function body from 20260930201000.
-- ============================================================================

create or replace function public.admin_schedule_flag_change(
  p_target_type text, p_target_key text, p_new_state text, p_run_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_status text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can schedule a flag change' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  if not public._flag_state_valid(p_target_type, p_new_state) then
    raise exception 'That state is not valid for this item.' using errcode = '22023';
  end if;
  if p_target_type = 'module' and not exists (select 1 from public.modules where module_id = p_target_key) then
    raise exception 'That module does not exist.' using errcode = '22023';
  end if;
  if p_target_type = 'config' and not exists (select 1 from public.system_config where key = p_target_key) then
    raise exception 'That platform switch does not exist.' using errcode = '22023';
  end if;
  if p_target_type = 'config' and p_target_key in ('dual_control_enabled', 'console_ip_allowlist_enabled', 'maintenance_mode') then
    raise exception 'This switch has its own guarded screen and cannot be scheduled here.' using errcode = '22023';
  end if;
  if p_run_at is null or p_run_at < now() - interval '1 minute' then
    raise exception 'Pick a time that is now or later.' using errcode = '22023';
  end if;
  v_status := case when public._dual_control_on() then 'awaiting_approval' else 'scheduled' end;
  insert into public.flag_changes (target_type, target_key, new_state, run_at, status, reason, requested_by)
  values (p_target_type, p_target_key, p_new_state, p_run_at, v_status, btrim(p_reason), auth.uid())
  returning id into v_id;
  perform public.log_console_event('flag_change_scheduled', null, 'flag_change',
    jsonb_build_object('id', v_id, 'target_type', p_target_type, 'target', p_target_key, 'state', p_new_state,
                       'run_at', p_run_at, 'status', v_status, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status);
end $$;
revoke all on function public.admin_schedule_flag_change(text, text, text, timestamptz, text) from public;
revoke all on function public.admin_schedule_flag_change(text, text, text, timestamptz, text) from anon;
grant execute on function public.admin_schedule_flag_change(text, text, text, timestamptz, text) to authenticated;
