-- =============================================================================
-- Report PDF retention: the daily job never ran. Re-register it and add a dry run.
-- STATUS: APPLIED 2026-11-21 (see docs/runbooks/REPORT_PDF_RETENTION.md for evidence).
--
-- FINDING (read only, 2026-11-21)
--   pg_cron job 31 'report-pdf-retention' (23 1 * * *, active, postgres@postgres,
--   localhost:5432, command select public.pdf_cache_retention_run(500)) was created by
--   rollout_report_pdf_storage on 2026-11-15 20:54 UTC. cron.job_run_details holds ZERO
--   rows for it, and the Postgres log shows no 'cron job 31 starting' line at 01:23 on any
--   day since, while job 11 (01:15) and job 26 (01:47) start and complete every night.
--   The job row is identical in shape to the working jobs, the function exists and works
--   (a rolled-back call returns {"ok":true,...}), and the scheduler launcher has been up
--   since 2026-11-09 09:54 (no restart). So the scheduler never loaded the job into its
--   in-memory job list: the cache invalidation that cron.schedule() sends when the row is
--   written was not picked up for this insert. Nothing about the job itself is wrong.
--
-- FIX (smallest safe change)
--   1. Write the job row again through cron.alter_job() (same schedule, same command,
--      active). That is a fresh write to cron.job, which fires cron_job_cache_invalidate
--      and makes the launcher reload every job (job 30 'backup-restore-test', created
--      2026-11-10 after the last launcher start, is reloaded by the same event).
--      If the job is missing it is created with cron.schedule().
--   2. Add public.pdf_cache_retention_preview(n): the same selection the job uses, read
--      only, so anyone running it by hand can see exactly what WOULD be marked first.
--
-- WHAT THE JOB DOES (unchanged): it only MARKS superseded or failed working copies older
-- than max(90, retention_days) with purge_due_at and logs one 'purge_due' event per file
-- in report_pdf_events. It never selects an immutable or approved copy and never removes
-- a storage object (SQL cannot). Removal happens through the Storage API by an
-- administrator session and is recorded by pdf_cache_purge_confirm().
--
-- VERIFY
--   select jobname, schedule, active from cron.job where jobname = 'report-pdf-retention';
--   select public.pdf_cache_retention_preview(500);   -- as postgres / service role
--   select status, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'report-pdf-retention')
--    order by runid desc limit 5;                     -- rows appear from the next 01:23 UTC
--
-- ROLLBACK: supabase/rollbacks/20261121120000_report_pdf_retention_schedule_reload_ROLLBACK.sql
-- =============================================================================

create or replace function public.pdf_cache_retention_preview(p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lim integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_rows jsonb;
  v_total integer;
begin
  -- same rule as pdf_cache_retention_run: cron and the service role only
  if auth.uid() is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  with due as (
    select f.organisation_id, f.id, f.status, f.report_type,
           coalesce(f.superseded_at, f.updated_at) as since,
           greatest(90, e.retention_days) as keep_days
      from public.report_pdf_files f,
           lateral public.pdf_cache_effective_settings(f.organisation_id) e
     where f.purge_due_at is null and f.purged_at is null
       and not f.immutable and not f.source_approved
       and ((f.status = 'ready' and f.superseded_at is not null
             and f.superseded_at < now() - make_interval(days => greatest(90, e.retention_days)))
         or (f.status = 'failed'
             and f.updated_at < now() - make_interval(days => greatest(90, e.retention_days))))
  ), per_org as (
    select organisation_id,
           count(*)                                   as would_mark,
           least(count(*), v_lim)                     as would_mark_this_run,
           min(since)                                 as oldest,
           max(keep_days)                             as keep_days,
           count(*) filter (where status = 'failed')  as failed
      from due group by organisation_id
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.would_mark desc), '[]'::jsonb),
         coalesce(sum(p.would_mark), 0)
    into v_rows, v_total
    from per_org p;

  return jsonb_build_object(
    'ok', true,
    'dry_run', true,
    'limit_per_company', v_lim,
    'would_mark', v_total,
    'companies', v_rows,
    'stored_files', (select count(*) from public.report_pdf_files where purged_at is null),
    'protected_files', (select count(*) from public.report_pdf_files
                         where purged_at is null and (immutable or source_approved)));
end $function$;

revoke all on function public.pdf_cache_retention_preview(integer) from public, anon, authenticated;
grant execute on function public.pdf_cache_retention_preview(integer) to service_role;

comment on function public.pdf_cache_retention_preview(integer) is
  'Dry run of pdf_cache_retention_run: what the daily job would mark (per company), without writing. Cron / service role only.';

-- Re-register the daily job so the pg_cron launcher reloads it.
do $$
declare
  v_job bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; nothing to schedule.';
    return;
  end if;
  select jobid into v_job from cron.job where jobname = 'report-pdf-retention';
  if v_job is null then
    perform cron.schedule('report-pdf-retention', '23 1 * * *', 'select public.pdf_cache_retention_run(500)');
  else
    perform cron.alter_job(job_id   => v_job,
                           schedule => '23 1 * * *',
                           command  => 'select public.pdf_cache_retention_run(500)',
                           active   => true);
  end if;
end $$;
