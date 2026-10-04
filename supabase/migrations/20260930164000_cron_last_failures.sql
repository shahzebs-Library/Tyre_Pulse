-- 20260930164000_cron_last_failures.sql
-- Operations: the "Last failure" column of the scheduled jobs table.
--
-- admin_cron_health() (Developer Center migration) already returns runs, failures and missed runs
-- for a 1 to 30 day window, so it is reused, not duplicated. It does not say WHEN a job last failed
-- outside that window (for example process-domain-events on 30 Aug). This adds one read-only lookup.
--
-- WHAT IT ADDS
--   admin_cron_last_failures()  super admin only: per job id, the start time of its most recent failed
--   run in the whole kept run history, and how many failed runs are kept. Returns no command text.
--
-- PRE-FLIGHT
--   Data loss: none; read only. DEFINER with search_path pinned to public, cron; is_super_admin() in
--   body; revoke PUBLIC then anon; grant authenticated. Takes no arguments.
--   Rollback: drop function public.admin_cron_last_failures();

create or replace function public.admin_cron_last_failures()
returns jsonb language plpgsql stable security definer set search_path = public, cron as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read scheduled job history' using errcode = '42501';
  end if;
  if to_regclass('cron.job_run_details') is null then
    return jsonb_build_object('ok', false, 'reason', 'pg_cron is not installed');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('jobid', jobid, 'last_failure_at', last_fail, 'failed_kept', n)), '[]'::jsonb)
    into v
    from (select d.jobid, max(d.start_time) as last_fail, count(*) as n
            from cron.job_run_details d
           where d.status::text = 'failed'
           group by d.jobid) s;
  return jsonb_build_object('ok', true, 'items', v);
end;
$$;

revoke all on function public.admin_cron_last_failures() from public;
revoke all on function public.admin_cron_last_failures() from anon;
grant execute on function public.admin_cron_last_failures() to authenticated;
