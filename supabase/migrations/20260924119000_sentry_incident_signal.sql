-- =============================================================================
-- 20260924119000_sentry_incident_signal.sql
-- Sentry as an incident signal: a new FATAL Sentry issue opens (or joins) a
-- platform incident automatically.
--
-- STATUS: APPLIED LIVE 2026-09-25 via Supabase MCP (project jhssdmeruxtrlqnwfksc).
--
-- HOW: the existing cron edge fn `sentry-crash-alert` already inserts ONE row
-- into public.sentry_alert_log per new fatal issue (issue_id is the primary
-- key, so an issue is only ever logged once). An AFTER INSERT trigger on that
-- table calls public.sentry_alert_to_incident(), so the edge function needs NO
-- redeploy and the incident is created in the same transaction as the log row.
--
-- RULES
--   * Switch: system_config.sentry_auto_incidents (default 'true'). Any value
--     other than true/1/yes/on turns it off; the log row is still written.
--   * Only level 'fatal' (or a blank level, since the edge fn only fetches
--     fatals) opens anything. Severity fatal -> sev2 (a crash of the app is a
--     core module broken; a whole-platform outage is a human call to sev1).
--   * DEDUPE, so a crash storm is ONE incident, not twenty:
--       1. an OPEN incident already linked to this issue id -> append an update;
--       2. else an OPEN sentry-sourced incident started within the last 6 hours
--          -> append an update naming the new issue (grouped burst);
--       3. else open a new sev2 incident, source_type 'sentry', source_ref =
--          the Sentry issue id.
--     Appending never changes status and never stamps acknowledged_at: MTTA
--     measures a HUMAN acknowledging, so the system must not fake it.
--   * A new incident notifies every unlocked super admin (same shape as
--     admin_open_incident) and writes a console_sessions row with admin_id NULL
--     and details.actor = 'system:sentry'.
--   * Fail-safe: any error inside the handler is swallowed (with a system_logs
--     warning) so the dedupe log row is never lost; losing that row would make
--     the edge fn re-alert every 15 minutes.
--   * platform_incidents.source_type CHECK widened to include 'sentry'. The
--     status machine is UNCHANGED (src/lib/platformIncidents.js NEXT_STATUS still
--     mirrors incident_status_allowed()).
--
-- VERIFIED LIVE 2026-09-25 (DO block raising at the end = rolled back):
--   verify-1 fatal -> 1 incident, sev2, investigating, source_ref verify-1, 1 update,
--   2 notifications (= 2 unlocked super admins); verify-2 fatal -> still 1 incident,
--   2 updates (grouped); verify-3 level 'error' -> nothing; switch 'false' after the
--   incident was resolved -> verify-4 opened nothing; 2 console_sessions rows with
--   actor system:sentry; 0 system_logs warnings (the handler did not swallow an error).
--   authenticated EXECUTE on the trigger function false. After rollback: 0 incidents,
--   switch back to 'true'.
--
-- VERIFY (rolled back; DO block that raises at the end):
--   insert into sentry_alert_log (issue_id,title,level,permalink) values ('verify-1','Crash A','fatal','https://x');
--     -> 1 incident sev2 source_type sentry source_ref verify-1, 1 update, 1 audit row,
--        notifications = unlocked super admins
--   insert ... ('verify-2','Crash B','fatal',...)  -> same incident, 2 updates (grouped)
--   insert ... ('verify-3','Warn','error',...)     -> nothing opened
--   update system_config set value='false' where key='sentry_auto_incidents'; insert verify-4 -> nothing
--   has_function_privilege('authenticated','public.sentry_alert_to_incident()','EXECUTE') -> false
--
-- ROLLBACK:
--   drop trigger if exists trg_sentry_alert_to_incident on public.sentry_alert_log;
--   drop function if exists public.sentry_alert_to_incident();
--   delete from public.system_config where key = 'sentry_auto_incidents';
--   -- only after no row carries source_type 'sentry':
--   alter table public.platform_incidents drop constraint platform_incidents_source_type_check;
--   alter table public.platform_incidents add constraint platform_incidents_source_type_check
--     check (source_type is null or source_type in ('system_log','trust_alert','security_scan','crash','manual'));
-- =============================================================================

alter table public.platform_incidents drop constraint if exists platform_incidents_source_type_check;
alter table public.platform_incidents add constraint platform_incidents_source_type_check
  check (source_type is null or source_type in ('system_log','trust_alert','security_scan','crash','manual','sentry'));

create index if not exists platform_incidents_source_open_idx
  on public.platform_incidents (source_type, source_ref) where status <> 'resolved';

insert into public.system_config (key, value, description, category)
values ('sentry_auto_incidents', 'true',
        'Open or update a platform incident automatically when Sentry reports a new fatal crash.',
        'monitoring')
on conflict (key) do nothing;

-- admin_open_incident validates source_type too; keep it in step.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.admin_open_incident(text,text,text,text[],timestamptz,uuid,text,text,text)'::regprocedure)
    into v_def;
  if position($q$('system_log','trust_alert','security_scan','crash','manual')$q$ in v_def) = 0 then
    raise exception 'admin_open_incident source list anchor not found';
  end if;
  v_def := replace(v_def, $q$('system_log','trust_alert','security_scan','crash','manual')$q$,
                          $q$('system_log','trust_alert','security_scan','crash','manual','sentry')$q$);
  execute v_def;
end $$;

create or replace function public.sentry_alert_to_incident()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on     text;
  v_level  text := lower(btrim(coalesce(new.level, 'fatal')));
  v_title  text := left(btrim(coalesce(nullif(btrim(new.title), ''), 'Fatal crash')), 160);
  v_ref    text := new.issue_id;
  v_label  text := coalesce(nullif(btrim(new.short_id), ''), new.issue_id);
  v_msg    text;
  v_inc    uuid;
  v_status text;
  v_new    boolean := false;
begin
  select lower(btrim(coalesce(value, 'true'))) into v_on from public.system_config where key = 'sentry_auto_incidents';
  if coalesce(v_on, 'true') not in ('true', '1', 'yes', 'on', '"true"') then
    return new;
  end if;
  if v_level not in ('fatal', '') then
    return new;
  end if;

  begin
    v_msg := left('Sentry reported a new fatal crash ' || v_label || ': ' || v_title
               || coalesce(' (' || new.permalink || ')', '') || '.', 4000);

    -- 1. already linked to this issue
    select id, status into v_inc, v_status
      from public.platform_incidents
     where source_type = 'sentry' and source_ref = v_ref and status <> 'resolved'
     order by started_at desc limit 1;

    -- 2. a burst: join the most recent open sentry incident of the last 6 hours
    if v_inc is null then
      select id, status into v_inc, v_status
        from public.platform_incidents
       where source_type = 'sentry' and status <> 'resolved'
         and started_at >= now() - interval '6 hours'
       order by started_at desc limit 1;
    end if;

    if v_inc is not null then
      insert into public.platform_incident_updates (incident_id, status, message, author)
      values (v_inc, v_status, v_msg, null);
    else
      -- 3. open a new incident
      insert into public.platform_incidents
        (title, severity, impact, affected_modules, started_at, source_type, source_ref, created_by)
      values
        (left('Fatal crash: ' || v_title, 200), 'sev2',
         'Opened automatically from Sentry. Check the crash report for the affected screens and devices.',
         '{}', coalesce(least(new.first_seen, now()), now()), 'sentry', v_ref, null)
      returning id into v_inc;
      v_new := true;

      insert into public.platform_incident_updates (incident_id, status, message, author)
      values (v_inc, 'investigating', v_msg, null);

      begin
        insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
        select p.id, 'security',
               'SEV2 incident opened: Fatal crash',
               'Sentry reported ' || v_label || ': ' || v_title || '. Opened automatically at '
                 || to_char(now() at time zone 'Asia/Riyadh', 'DD Mon YYYY HH24:MI') || ' (Riyadh).',
               'platform_incident', v_inc
          from public.profiles p
         where coalesce(p.is_super_admin, false) and not coalesce(p.locked, false);
      exception when others then null;
      end;
    end if;

    insert into public.console_sessions (admin_id, action, target_id, target_type, details)
    values (null, case when v_new then 'incident_open' else 'incident_update' end, v_inc, 'platform_incident',
            jsonb_build_object('actor', 'system:sentry', 'source_type', 'sentry', 'source_ref', v_ref,
                               'short_id', new.short_id, 'grouped', not v_new));
  exception when others then
    begin
      insert into public.system_logs (organisation_id, severity, source, module_id, message, detail)
      values (null, 'warning', 'sentry', 'incident_signal',
              'Could not open an incident for a Sentry crash',
              jsonb_build_object('issue_id', v_ref, 'sqlstate', sqlstate));
    exception when others then null;
    end;
  end;
  return new;
end;
$$;

revoke all on function public.sentry_alert_to_incident() from public;
revoke all on function public.sentry_alert_to_incident() from anon;
revoke all on function public.sentry_alert_to_incident() from authenticated;

drop trigger if exists trg_sentry_alert_to_incident on public.sentry_alert_log;
create trigger trg_sentry_alert_to_incident
  after insert on public.sentry_alert_log
  for each row execute function public.sentry_alert_to_incident();
