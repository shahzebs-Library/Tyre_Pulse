-- =============================================================================
-- 20260924122000_tenant_export_retention.sql
-- Tenant Data Export: RETENTION for the server-path files in the PRIVATE
-- Storage bucket `tenant-exports`.
--
-- STATUS: APPLIED LIVE 2026-09-25 via Supabase MCP (project jhssdmeruxtrlqnwfksc).
--
-- WHY: the server export (20260924118000) writes a full, untruncated copy of a
-- tenant's data into Storage and nothing ever removed it. A full dump sitting
-- there forever is a standing data-protection liability.
--
-- HOW (and why the delete happens in the edge function, not here):
--   Supabase guards storage.objects with trigger protect_objects_delete
--   (storage.protect_delete): a direct SQL DELETE is refused, and even if it
--   were not, deleting the row would orphan the bytes in the object store.
--   So SQL decides WHAT is due and RECORDS the outcome; the `tenant-export`
--   edge function (action 'cleanup', authorised by the cron secret in
--   cron_config) lists each due job's prefix and removes the objects through
--   the Storage API, then calls _tenant_export_mark_expired. A job is marked
--   'expired' ONLY after its files are gone; a failed removal leaves it due and
--   writes a warning to system_logs, so the next run retries it.
--
-- WHAT IT ADDS
--   * system_config key tenant_export_retention_days (default 7). Readers clamp
--     to 1..90; the setter refuses anything outside 1..90.
--   * tenant_export_jobs.expired_at + status 'expired'. A browser-mode job has
--     no files and is never touched. A running job is never touched.
--   * _tenant_export_retention_days()           reader, clamped
--   * _tenant_export_due_for_purge(p_limit)     service_role only
--   * _tenant_export_mark_expired(...)          service_role only; writes the
--       console_sessions 'tenant_export_purge' row and a system_logs row
--   * _tenant_export_request_purge(p_trigger, p_actor)  pg_net POST to the
--       edge function with the cron secret (service/cron only)
--   * cron_tenant_export_retention()            called by pg_cron daily
--   * admin_tenant_export_retention_status()    super admin: days + due list
--   * admin_tenant_export_set_retention(p_days) super admin, audited
--   * admin_tenant_export_purge_now()           super admin, audited; queues
--       the same cleanup the cron runs
--   * admin_tenant_export_download_log refuses an expired job (22023).
--   * pg_cron job `tenant-export-retention` daily 02:40 UTC.
--   All admin RPCs: SECURITY DEFINER, search_path=public, 42501 for non super
--   admins, EXECUTE revoked from PUBLIC then anon, granted to authenticated.
--
-- VERIFIED LIVE 2026-09-25:
--   * As the real super admin (rolled back): status -> days 7, due 0, stored 2; set 30 -> {30, previous 7},
--     reader 30, one console_sessions 'tenant_export_retention_set'; set 0 / set 91 -> 22023.
--     _tenant_export_due_for_purge / _mark_expired as authenticated -> 42501.
--   * An approved non super admin: status / set / purge_now all 42501. anon EXECUTE false on every
--     new function; authenticated cannot execute _tenant_export_request_purge.
--   * Edge fn tenant-export v3 (verify_jwt=false): cleanup with a wrong cron secret 401, with no
--     secret 401.
--   * End to end: verification job 0de3e893 (a leftover 'System verification' export) was
--     backdated 8 days, admin_tenant_export_purge_now() -> {queued, due 1}; the edge function
--     removed its 4 objects (6,531 bytes: sites/budgets/sany_invoices parts + manifest), the job
--     became 'expired' with progress.purge, console_sessions 'tenant_export_purge_request' +
--     'tenant_export_purge' and one system_logs info row were written. Bucket 12 -> 8 objects.
--     admin_tenant_export_download_log on it -> 22023 "expired". cron_tenant_export_retention()
--     with nothing due returns without calling the function.
--
-- ROLLBACK:
--   select cron.unschedule('tenant-export-retention');
--   drop function if exists public.admin_tenant_export_purge_now();
--   drop function if exists public.admin_tenant_export_set_retention(int);
--   drop function if exists public.admin_tenant_export_retention_status();
--   drop function if exists public.cron_tenant_export_retention();
--   drop function if exists public._tenant_export_request_purge(text, uuid);
--   drop function if exists public._tenant_export_mark_expired(uuid, int, bigint, text, uuid, text);
--   drop function if exists public._tenant_export_due_for_purge(int);
--   drop function if exists public._tenant_export_retention_days();
--   delete from public.system_config where key = 'tenant_export_retention_days';
--   -- re-apply admin_tenant_export_download_log from 20260924118000
--   -- (after moving 'expired' rows back to 'completed') restore the status CHECK and
--   alter table public.tenant_export_jobs drop column if exists expired_at;
-- =============================================================================

alter table public.tenant_export_jobs add column if not exists expired_at timestamptz;

alter table public.tenant_export_jobs drop constraint if exists tenant_export_jobs_status_check;
alter table public.tenant_export_jobs add constraint tenant_export_jobs_status_check
  check (status in ('running','completed','partial','failed','expired'));

grant select (expired_at) on public.tenant_export_jobs to authenticated;

insert into public.system_config (key, value, description, category)
values ('tenant_export_retention_days', '7',
        'Days a server tenant export stays in Storage before its files are deleted (1 to 90).',
        'security')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Reader (clamped). Junk or missing -> 7.
-- ---------------------------------------------------------------------------
create or replace function public._tenant_export_retention_days()
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text; n int;
begin
  select trim(both '"' from btrim(value)) into v from public.system_config
   where key = 'tenant_export_retention_days';
  if v is null or v !~ '^\d{1,6}$' then return 7; end if;
  n := v::int;
  return least(greatest(n, 1), 90);
end;
$$;
revoke all on function public._tenant_export_retention_days() from public;
revoke all on function public._tenant_export_retention_days() from anon;
grant execute on function public._tenant_export_retention_days() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What is due (service role only: it lists storage prefixes of every tenant).
-- ---------------------------------------------------------------------------
create or replace function public._tenant_export_due_for_purge(p_limit int default 50)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', j.id, 'org_id', j.org_id, 'status', j.status,
           'finished_at', coalesce(j.completed_at, j.updated_at, j.created_at),
           'prefix', j.org_id::text || '/' || j.id::text,
           'files', jsonb_array_length(coalesce(j.files, '[]'::jsonb)))
         order by coalesce(j.completed_at, j.updated_at, j.created_at)), '[]'::jsonb)
    from (select * from public.tenant_export_jobs j
           where j.mode = 'server'
             and j.status in ('completed','partial','failed')
             and j.expired_at is null
             and coalesce(j.completed_at, j.updated_at, j.created_at)
                 < now() - make_interval(days => public._tenant_export_retention_days())
           order by coalesce(j.completed_at, j.updated_at, j.created_at)
           limit least(greatest(coalesce(p_limit, 50), 1), 200)) j;
$$;
revoke all on function public._tenant_export_due_for_purge(int) from public;
revoke all on function public._tenant_export_due_for_purge(int) from anon;
revoke all on function public._tenant_export_due_for_purge(int) from authenticated;
grant execute on function public._tenant_export_due_for_purge(int) to service_role;

-- ---------------------------------------------------------------------------
-- Record the outcome (service role only). p_error set = removal failed: the job
-- stays due and a warning is logged; otherwise the job becomes 'expired'.
-- ---------------------------------------------------------------------------
create or replace function public._tenant_export_mark_expired(
  p_job uuid, p_objects int, p_bytes bigint, p_trigger text, p_actor uuid, p_error text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.tenant_export_jobs%rowtype;
  v_trigger text := case when p_trigger in ('cron','manual') then p_trigger else 'cron' end;
  v_days int := public._tenant_export_retention_days();
begin
  select * into v_job from public.tenant_export_jobs where id = p_job for update;
  if not found or v_job.mode <> 'server' then
    raise exception 'Export job not found' using errcode = 'P0002';
  end if;

  if p_error is not null then
    insert into public.system_logs (organisation_id, module_id, severity, source, message, detail)
    values (v_job.org_id, 'tenant_export', 'warning', 'tenant-export-retention',
            'Tenant export files could not be deleted; will retry',
            jsonb_build_object('job_id', p_job, 'error', left(p_error, 300),
                               'removed_objects', coalesce(p_objects, 0), 'trigger', v_trigger));
    return jsonb_build_object('ok', false, 'job_id', p_job);
  end if;

  if v_job.status = 'expired' then
    return jsonb_build_object('ok', true, 'job_id', p_job, 'already', true);
  end if;
  if v_job.status = 'running' then
    raise exception 'That export is still running' using errcode = '55P03';
  end if;

  update public.tenant_export_jobs
     set status = 'expired', expired_at = now(), updated_at = now(),
         progress = coalesce(progress, '{}'::jsonb) || jsonb_build_object(
           'purge', jsonb_build_object('at', now(), 'objects', coalesce(p_objects, 0),
                                       'bytes', coalesce(p_bytes, 0), 'trigger', v_trigger,
                                       'status_before', v_job.status))
   where id = p_job;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (p_actor, 'tenant_export_purge', v_job.org_id, 'organisation',
          jsonb_build_object('job_id', p_job, 'objects', coalesce(p_objects, 0),
                             'bytes', coalesce(p_bytes, 0), 'trigger', v_trigger,
                             'retention_days', v_days, 'status_before', v_job.status));

  insert into public.system_logs (organisation_id, module_id, severity, source, message, detail, user_id)
  values (v_job.org_id, 'tenant_export', 'info', 'tenant-export-retention',
          'Expired tenant export files deleted',
          jsonb_build_object('job_id', p_job, 'objects', coalesce(p_objects, 0),
                             'bytes', coalesce(p_bytes, 0), 'trigger', v_trigger,
                             'retention_days', v_days),
          p_actor);

  return jsonb_build_object('ok', true, 'job_id', p_job);
end;
$$;
revoke all on function public._tenant_export_mark_expired(uuid,int,bigint,text,uuid,text) from public;
revoke all on function public._tenant_export_mark_expired(uuid,int,bigint,text,uuid,text) from anon;
revoke all on function public._tenant_export_mark_expired(uuid,int,bigint,text,uuid,text) from authenticated;
grant execute on function public._tenant_export_mark_expired(uuid,int,bigint,text,uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- Ask the edge function to run the cleanup (pg_net, cron secret).
-- ---------------------------------------------------------------------------
create or replace function public._tenant_export_request_purge(p_trigger text, p_actor uuid)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_id bigint;
begin
  select value into v_secret from public.cron_config where name = 'cron_secret';
  if v_secret is null or v_secret = '' then
    raise exception 'Cleanup is not configured (no cron secret)' using errcode = '55000';
  end if;
  select net.http_post(
    url := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/tenant-export',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('action', 'cleanup',
                               'trigger', case when p_trigger = 'manual' then 'manual' else 'cron' end,
                               'actor', p_actor),
    timeout_milliseconds := 60000
  ) into v_id;
  return v_id;
end;
$$;
revoke all on function public._tenant_export_request_purge(text, uuid) from public;
revoke all on function public._tenant_export_request_purge(text, uuid) from anon;
revoke all on function public._tenant_export_request_purge(text, uuid) from authenticated;
grant execute on function public._tenant_export_request_purge(text, uuid) to service_role;

create or replace function public.cron_tenant_export_retention()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- Nothing due: do not wake the edge function.
  if jsonb_array_length(public._tenant_export_due_for_purge(1)) = 0 then return; end if;
  perform public._tenant_export_request_purge('cron', null);
end;
$$;
revoke all on function public.cron_tenant_export_retention() from public;
revoke all on function public.cron_tenant_export_retention() from anon;
revoke all on function public.cron_tenant_export_retention() from authenticated;

-- ---------------------------------------------------------------------------
-- Super-admin RPCs
-- ---------------------------------------------------------------------------
create or replace function public.admin_tenant_export_retention_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_days int; v_due jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can manage tenant exports' using errcode = '42501';
  end if;
  v_days := public._tenant_export_retention_days();
  v_due := public._tenant_export_due_for_purge(200);
  return jsonb_build_object(
    'days', v_days,
    'due_count', jsonb_array_length(v_due),
    'due', v_due,
    'stored_jobs', (select count(*) from public.tenant_export_jobs
                     where mode = 'server' and status in ('completed','partial','failed')),
    'expired_jobs', (select count(*) from public.tenant_export_jobs where status = 'expired'),
    'last_purge_at', (select max(created_at) from public.console_sessions where action = 'tenant_export_purge'),
    'next_run', 'daily 02:40 UTC');
end;
$$;

create or replace function public.admin_tenant_export_set_retention(p_days int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_old int;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can manage tenant exports' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Retention must be between 1 and 90 days' using errcode = '22023';
  end if;
  v_old := public._tenant_export_retention_days();
  insert into public.system_config (key, value, description, category, updated_by, updated_at)
  values ('tenant_export_retention_days', p_days::text,
          'Days a server tenant export stays in Storage before its files are deleted (1 to 90).',
          'security', auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();

  insert into public.console_sessions (admin_id, action, target_type, details)
  values (auth.uid(), 'tenant_export_retention_set', 'system_config',
          jsonb_build_object('key', 'tenant_export_retention_days', 'from', v_old, 'to', p_days));
  return jsonb_build_object('days', p_days, 'previous', v_old);
end;
$$;

create or replace function public.admin_tenant_export_purge_now()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_due jsonb; v_req bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can manage tenant exports' using errcode = '42501';
  end if;
  v_due := public._tenant_export_due_for_purge(200);
  insert into public.console_sessions (admin_id, action, target_type, details)
  values (auth.uid(), 'tenant_export_purge_request', 'tenant_export_job',
          jsonb_build_object('due', jsonb_array_length(v_due),
                             'retention_days', public._tenant_export_retention_days()));
  if jsonb_array_length(v_due) = 0 then
    return jsonb_build_object('queued', false, 'due', 0);
  end if;
  v_req := public._tenant_export_request_purge('manual', auth.uid());
  return jsonb_build_object('queued', true, 'due', jsonb_array_length(v_due), 'request_id', v_req);
end;
$$;

grant execute on function public.admin_tenant_export_retention_status() to authenticated;
grant execute on function public.admin_tenant_export_set_retention(int) to authenticated;
grant execute on function public.admin_tenant_export_purge_now() to authenticated;
revoke execute on function public.admin_tenant_export_retention_status() from public;
revoke execute on function public.admin_tenant_export_set_retention(int) from public;
revoke execute on function public.admin_tenant_export_purge_now() from public;
revoke execute on function public.admin_tenant_export_retention_status() from anon;
revoke execute on function public.admin_tenant_export_set_retention(int) from anon;
revoke execute on function public.admin_tenant_export_purge_now() from anon;

-- ---------------------------------------------------------------------------
-- Download refuses an expired job.
-- ---------------------------------------------------------------------------
create or replace function public.admin_tenant_export_download_log(p_job uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.tenant_export_jobs%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can download tenant data' using errcode = '42501';
  end if;
  select * into v_job from public.tenant_export_jobs where id = p_job;
  if not found or v_job.mode <> 'server' then
    raise exception 'Export job not found' using errcode = 'P0002';
  end if;
  if v_job.status = 'running' then
    raise exception 'That export is still running' using errcode = '55P03';
  end if;
  if v_job.status = 'expired' then
    raise exception 'That export has expired and its files were deleted' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(v_job.files, '[]'::jsonb)) = 0 then
    raise exception 'That export produced no files' using errcode = '22023';
  end if;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (v_uid, 'tenant_export_download', v_job.org_id, 'organisation',
          jsonb_build_object('job_id', v_job.id, 'files', jsonb_array_length(v_job.files),
                             'status', v_job.status));

  return jsonb_build_object('job_id', v_job.id, 'org_id', v_job.org_id, 'status', v_job.status,
                            'files', v_job.files);
end;
$$;
grant execute on function public.admin_tenant_export_download_log(uuid) to authenticated;
revoke execute on function public.admin_tenant_export_download_log(uuid) from public;
revoke execute on function public.admin_tenant_export_download_log(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Daily schedule
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('tenant-export-retention')
   where exists (select 1 from cron.job where jobname = 'tenant-export-retention');
end $$;
select cron.schedule('tenant-export-retention', '40 2 * * *',
                     'select public.cron_tenant_export_retention()');
