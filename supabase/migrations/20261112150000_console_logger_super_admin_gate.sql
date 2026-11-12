-- log_console_action: only a super admin can write the console audit trail.
--
-- FINDING: CON-1 (P2)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live as a Driver, rolled back):
--   select log_console_action('login')  -> accepted
--   console_sessions 278 -> 279, notifications 16562 -> 16564 (the break-glass
--   trigger alerts every super admin for each forged row).
--   The pre-V275 logger was SECURITY DEFINER, granted to authenticated, and had
--   no caller check. Its replacement log_console_event is gated.
--
-- WHAT THIS DOES
--   Same signature, same insert, plus the gate log_console_event already has:
--   a signed-in caller who is not a super admin gets 42501. A session with no
--   user (service role / cron) is unchanged.
--   Every other function that inserts into console_sessions was checked: all are
--   either super-admin gated in the body or not executable by authenticated.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none. No table change.
-- Callers: grep log_console_action over src/, mobile/, tyre_pulse_flutter/,
--   supabase/functions/ = 0. The console calls log_console_event
--   (src/console/ConsoleAuthContext.jsx), which is untouched.
-- SECURITY DEFINER: search_path stays pinned to public; EXECUTE unchanged
--   (authenticated + service_role; anon has none).
-- PostgREST: raises 42501 only.
-- Client behaviour that changes: none (no client calls it).
-- Rollback: at the foot.

create or replace function public.log_console_action(
  p_action text,
  p_target_id uuid default null::uuid,
  p_target_type text default null::text,
  p_details jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  insert into console_sessions(admin_id,action,target_id,target_type,details)
  values(auth.uid(),p_action,p_target_id,p_target_type,p_details) returning id into v_id;
  return v_id;
end;
$function$;

revoke execute on function public.log_console_action(text,uuid,text,jsonb) from public, anon;

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12, each in begin ... rollback, one user per transaction)
--   Driver:      log_console_action('login') -> 42501; console_sessions and
--                notifications counts identical before / after.
--   Super admin: log_console_action('verify_probe') -> row id; count +1.
--   Super admin: log_console_event('verify_probe')  -> ok (unchanged).
--
-- ---------------------------------------------------------------------- ROLLBACK
-- Re-create the function without the first IF block (three lines).
