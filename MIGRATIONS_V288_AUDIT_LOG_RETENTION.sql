-- V288 — SAFE, logs-only retention purge (System Configuration: audit_retention_days).
-- Deletes ONLY high-volume audit / error LOG rows older than the configured number
-- of days. NEVER touches operational business data (accidents, tyres, fleet, work
-- orders, inspections, ...). data_retention_months is deliberately NOT acted on
-- here — destroying business records is out of scope and stays saved-only.
--
-- Fail-safe: audit_retention_days = 0 / unset / invalid => keep forever (no delete).
-- Each table is purged independently so one error cannot abort the others. A short
-- summary is written to system_logs so the purge is visible in Console System Health.
--
-- Next free migration V289.

create or replace function public.cron_purge_audit_logs()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_raw text;
  v_days int;
  v_cutoff timestamptz;
  v_a bigint := 0; v_s bigint := 0; v_c bigint := 0;
begin
  select value into v_raw from public.system_config where key = 'audit_retention_days';
  if v_raw is null then return; end if;
  begin v_days := trunc(v_raw::numeric)::int; exception when others then return; end;
  if v_days is null or v_days < 1 then return; end if;   -- 0 = keep forever

  v_cutoff := now() - make_interval(days => v_days);

  begin delete from public.audit_log_v2 where created_at < v_cutoff; get diagnostics v_a = row_count; exception when others then v_a := -1; end;
  begin delete from public.system_logs  where created_at < v_cutoff; get diagnostics v_s = row_count; exception when others then v_s := -1; end;
  begin delete from public.access_audit where at         < v_cutoff; get diagnostics v_c = row_count; exception when others then v_c := -1; end;

  begin
    insert into public.system_logs(severity, source, message, detail, created_at)
    values ('info', 'retention',
      'Audit log retention purge (keep '||v_days||' days)',
      jsonb_build_object('audit_log_v2', v_a, 'system_logs', v_s, 'access_audit', v_c, 'cutoff', v_cutoff),
      now());
  exception when others then null; end;
end $$;

revoke all on function public.cron_purge_audit_logs() from public;

-- Daily at 01:15 UTC (offset from the 00:30 nightly backup so a snapshot exists first).
select cron.schedule('audit-log-retention', '15 1 * * *', $$ select public.cron_purge_audit_logs(); $$);

-- Rollback:
--   select cron.unschedule('audit-log-retention');
--   drop function if exists public.cron_purge_audit_logs();
