-- Security Audit Center: live security posture for the super-admin console,
-- a weekly scan that records history and raises alerts on NEW findings, and
-- break-glass alerts on every super-admin sign-in and every high-risk action.
--
-- Every check reads the live catalog, so the page can never drift from the
-- database the way a checklist in a document does. Checks that SQL genuinely
-- cannot answer (Supabase Auth leaked-password protection is a dashboard switch)
-- are returned with status 'manual' rather than guessed.
--
-- Security: every function is SECURITY DEFINER with a pinned search_path,
-- refuses anyone who is not a super admin (the scan function is cron-only and
-- revoked from every client role), and is revoked from PUBLIC and anon by name
-- (the V500 ordering lesson).

-- ── history ────────────────────────────────────────────────────────────────
create table if not exists public.security_scan_runs (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  trigger     text not null default 'manual' check (trigger in ('manual','scheduled')),
  ran_by      uuid,
  score       int  not null,
  critical    int  not null default 0,
  high        int  not null default 0,
  medium      int  not null default 0,
  low         int  not null default 0,
  failing     text[] not null default '{}',
  result      jsonb not null
);
create index if not exists security_scan_runs_ran_at_idx on public.security_scan_runs (ran_at desc);
alter table public.security_scan_runs enable row level security;
drop policy if exists security_scan_runs_super_read on public.security_scan_runs;
create policy security_scan_runs_super_read on public.security_scan_runs
  for select to authenticated using ((select public.is_super_admin()));
revoke all on public.security_scan_runs from anon, authenticated;
grant select on public.security_scan_runs to authenticated;

-- ── the checks ─────────────────────────────────────────────────────────────
create or replace function public._security_posture_compute()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_checks jsonb := '[]'::jsonb;
  v_items  jsonb;
  v_n      int;
  v_allow  text[] := array[
    'get_email_by_identifier','get_public_config','login_attempt_status',
    'record_login_failure','reset_login_attempts','get_report_snapshot',
    'get_report_tyre_maintenance','get_workshop_snapshot',
    'get_accident_portal_snapshot','get_display_snapshot'];
  v_weights jsonb := '{"critical":25,"high":10,"medium":4,"low":1}';
  v_score  int := 100;
  c jsonb;
begin
  -- 1. RLS disabled on a public table (critical): anything the API can reach
  --    without a row policy is readable by every signed-in user.
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'), count(*)
    into v_items, v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
  v_checks := v_checks || jsonb_build_object('id','rls_disabled','category','Data isolation',
    'title','Tables without row-level security','severity','critical',
    'status', case when v_n = 0 then 'pass' else 'fail' end, 'count', v_n, 'items', v_items,
    'explain','Every table the app can reach must enforce row-level security, or any signed-in user can read all of it.',
    'fix','Enable RLS and add an organisation isolation policy.');

  -- 2. Base tables granted to anon (critical): V281 revoked all of them.
  select coalesce(jsonb_agg(distinct table_name), '[]'), count(distinct table_name)
    into v_items, v_n
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon';
  v_checks := v_checks || jsonb_build_object('id','anon_table_grants','category','Data isolation',
    'title','Tables reachable without signing in','severity','critical',
    'status', case when v_n = 0 then 'pass' else 'fail' end, 'count', v_n, 'items', v_items,
    'explain','Anonymous visitors must reach data only through reviewed token functions, never a table.',
    'fix','Revoke the grant from anon.');

  -- 3. SECURITY DEFINER functions callable without signing in, outside the
  --    reviewed allowlist (high).
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]'), count(*)
    into v_items, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname <> all (v_allow);
  v_checks := v_checks || jsonb_build_object('id','anon_definer_functions','category','Data isolation',
    'title','Privileged functions open to anonymous callers','severity','high',
    'status', case when v_n = 0 then 'pass' else 'fail' end, 'count', v_n, 'items', v_items,
    'explain','Ten functions are open by design (sign-in and public share links). Anything else runs with owner rights for anyone on the internet.',
    'fix','Revoke EXECUTE from PUBLIC, then from anon by name.');

  -- 4. SECURITY DEFINER without a pinned search_path (high).
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]'), count(*)
    into v_items, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  v_checks := v_checks || jsonb_build_object('id','definer_search_path','category','Code hardening',
    'title','Privileged functions without a fixed search path','severity','high',
    'status', case when v_n = 0 then 'pass' else 'fail' end, 'count', v_n, 'items', v_items,
    'explain','A privileged function that resolves names through the caller''s search path can be tricked into running someone else''s object.',
    'fix','ALTER FUNCTION ... SET search_path = public.');

  -- 5. Views that run as their owner (high): they bypass the caller's RLS.
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'), count(*)
    into v_items, v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce(c.reloptions @> array['security_invoker=on'] or c.reloptions @> array['security_invoker=true'], false)
     and has_table_privilege('authenticated', c.oid, 'SELECT');
  v_checks := v_checks || jsonb_build_object('id','owner_views','category','Data isolation',
    'title','Views that bypass row-level security','severity','high',
    'status', case when v_n = 0 then 'pass' else 'fail' end, 'count', v_n, 'items', v_items,
    'explain','A view runs as its owner unless security_invoker is set, so it can show rows the reader could never read directly.',
    'fix','ALTER VIEW ... SET (security_invoker = on).');

  -- 6. TRUNCATE or TRIGGER held by a client role (high): RLS never governs TRUNCATE.
  select coalesce(jsonb_agg(distinct table_name), '[]'), count(distinct table_name)
    into v_items, v_n
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('authenticated','anon')
     and privilege_type in ('TRUNCATE','TRIGGER');
  v_checks := v_checks || jsonb_build_object('id','truncate_grants','category','Data isolation',
    'title','Client roles that can empty a table','severity','high',
    'status', case when v_n = 0 then 'pass' else 'fail' end, 'count', v_n, 'items', v_items,
    'explain','TRUNCATE is not covered by row-level security, so one statement would erase every company''s rows.',
    'fix','REVOKE TRUNCATE, TRIGGER from authenticated, anon.');

  -- 7. Super admins without a verified second factor (high).
  select coalesce(jsonb_agg(coalesce(p.email, p.full_name, p.id::text) order by p.email), '[]'), count(*)
    into v_items, v_n
    from public.profiles p
   where coalesce(p.is_super_admin,false) and not coalesce(p.locked,false)
     and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified');
  v_checks := v_checks || jsonb_build_object('id','super_admin_mfa','category','Identity',
    'title','Super admins without two-factor sign-in','severity','high',
    'status', case when v_n = 0 then 'pass' else 'fail' end, 'count', v_n, 'items', v_items,
    'explain','A super admin controls every company. A password alone is not enough for that account.',
    'fix','Enrol an authenticator app in Console > Security.');

  -- 8. Number of super admins (medium): fewer than 2 risks lock-out, more than 5 is sprawl.
  select count(*) into v_n from public.profiles where coalesce(is_super_admin,false) and not coalesce(locked,false);
  v_checks := v_checks || jsonb_build_object('id','super_admin_count','category','Identity',
    'title','Number of super admins','severity','medium',
    'status', case when v_n between 2 and 5 then 'pass' else 'warn' end, 'count', v_n, 'items', '[]'::jsonb,
    'explain','Keep two to five: one is a single point of failure, more than five is more power than anyone needs.',
    'fix','Promote a second trusted person, or demote extras, in Console > Users.');

  -- 9. Plain Admins (medium): owner policy is that administration stays with super admins.
  select coalesce(jsonb_agg(coalesce(email, full_name) order by email), '[]'), count(*)
    into v_items, v_n
    from public.profiles where role = 'Admin' and not coalesce(is_super_admin,false) and coalesce(approved,false);
  v_checks := v_checks || jsonb_build_object('id','plain_admins','category','Identity',
    'title','Admins who are not super admins','severity','medium',
    'status', case when v_n = 0 then 'pass' else 'warn' end, 'count', v_n, 'items', v_items,
    'explain','An Admin sees every module and all company data. Access changes are super-admin only, but check each one is intended.',
    'fix','Review in Console > Users.');

  -- 10. Accounts locked out right now by repeated failed sign-ins (medium).
  select coalesce(jsonb_agg(identifier order by identifier), '[]'), count(*)
    into v_items, v_n
    from public.login_attempts where locked_until > now();
  v_checks := v_checks || jsonb_build_object('id','locked_logins','category','Identity',
    'title','Sign-ins locked after failed attempts','severity','medium',
    'status', case when v_n = 0 then 'pass' else 'warn' end, 'count', v_n, 'items', v_items,
    'explain','Repeated wrong passwords lock an identifier for 15 minutes. Several at once can mean someone is guessing.',
    'fix','Check the identifiers. Real users unlock automatically.');

  -- 11. Public storage buckets (medium).
  select coalesce(jsonb_agg(name order by name), '[]'), count(*)
    into v_items, v_n
    from storage.buckets where public;
  v_checks := v_checks || jsonb_build_object('id','public_buckets','category','Files',
    'title','File buckets open to the internet','severity','medium',
    'status', case when v_n = 0 then 'pass' else 'warn' end, 'count', v_n, 'items', v_items,
    'explain','A public bucket serves every file to anyone who has the link, with no sign-in.',
    'fix','Make the bucket private and serve signed URLs.');

  -- 12. RLS on with no policy at all (low): deny-all, usually intended for backups.
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'), count(*)
    into v_items, v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid);
  v_checks := v_checks || jsonb_build_object('id','rls_no_policy','category','Data isolation',
    'title','Locked tables with no access rule','severity','low',
    'status', 'info', 'count', v_n, 'items', v_items,
    'explain','Row-level security with no policy denies everyone. That is correct for snapshots and staging, and only a problem if the app needs the table.',
    'fix','None needed unless a screen reads the table.');

  -- 13. Extensions in the public schema (low, known).
  select coalesce(jsonb_agg(e.extname order by e.extname), '[]'), count(*)
    into v_items, v_n
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where n.nspname = 'public';
  v_checks := v_checks || jsonb_build_object('id','extensions_public','category','Code hardening',
    'title','Database extensions in the public schema','severity','low',
    'status', case when v_n = 0 then 'pass' else 'warn' end, 'count', v_n, 'items', v_items,
    'explain','Known and low risk. Moving vector or pg_net breaks existing columns and jobs, so it is left deliberately.',
    'fix','Leave unless a planned maintenance window moves them.');

  -- 14. Leaked-password protection: an Auth dashboard switch SQL cannot read.
  v_checks := v_checks || jsonb_build_object('id','leaked_password','category','Identity',
    'title','Block known leaked passwords','severity','medium',
    'status', 'manual', 'count', null, 'items', '[]'::jsonb,
    'explain','Supabase can refuse passwords that appear in public breach lists. It is a dashboard setting, so this page cannot check it.',
    'fix','Supabase dashboard > Authentication > Passwords > enable leaked password protection.');

  -- score: each failing or warning check costs its severity weight (warn costs half)
  for c in select * from jsonb_array_elements(v_checks) loop
    if c->>'status' = 'fail' then
      v_score := v_score - (v_weights->>(c->>'severity'))::int;
    elsif c->>'status' = 'warn' then
      v_score := v_score - ceil((v_weights->>(c->>'severity'))::numeric / 2)::int;
    end if;
  end loop;

  return jsonb_build_object(
    'generated_at', now(),
    'score', greatest(v_score, 0),
    'checks', v_checks,
    'activity', jsonb_build_object(
      'console_logins_7d', (select count(*) from public.console_sessions where action = 'login' and created_at > now() - interval '7 days'),
      'access_changes_7d', (select count(*) from public.access_audit where at > now() - interval '7 days'),
      'super_admin_changes_30d', (select count(*) from public.access_audit where entity = 'super_admin' and at > now() - interval '30 days'),
      'errors_7d', (select count(*) from public.system_logs where severity in ('error','critical') and created_at > now() - interval '7 days'),
      'locked_accounts', (select count(*) from public.profiles where coalesce(locked,false)),
      'pending_approvals', (select count(*) from public.profiles where not coalesce(approved,false) and not coalesce(locked,false))
    )
  );
end $$;

revoke all on function public._security_posture_compute() from public, anon, authenticated;

-- ── client entry points ───────────────────────────────────────────────────
create or replace function public.admin_security_posture()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can view the security audit.' using errcode = '42501';
  end if;
  return public._security_posture_compute();
end $$;

-- Record a scan. Alerts go to every super admin only for checks that were not
-- already failing on the previous run, so a known finding does not nag weekly.
create or replace function public._security_scan_record(p_trigger text, p_by uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_res jsonb := public._security_posture_compute();
  v_failing text[];
  v_prev text[];
  v_new text[];
  v_counts jsonb;
begin
  select coalesce(array_agg(c->>'id'), '{}') into v_failing
    from jsonb_array_elements(v_res->'checks') c where c->>'status' in ('fail','warn');
  select jsonb_build_object(
      'critical', count(*) filter (where c->>'severity'='critical' and c->>'status' in ('fail','warn')),
      'high',     count(*) filter (where c->>'severity'='high'     and c->>'status' in ('fail','warn')),
      'medium',   count(*) filter (where c->>'severity'='medium'   and c->>'status' in ('fail','warn')),
      'low',      count(*) filter (where c->>'severity'='low'      and c->>'status' in ('fail','warn')))
    into v_counts from jsonb_array_elements(v_res->'checks') c;

  select failing into v_prev from public.security_scan_runs order by ran_at desc limit 1;
  select coalesce(array_agg(x), '{}') into v_new
    from unnest(v_failing) x where x <> all (coalesce(v_prev, '{}'));

  insert into public.security_scan_runs (trigger, ran_by, score, critical, high, medium, low, failing, result)
  values (p_trigger, p_by, (v_res->>'score')::int, (v_counts->>'critical')::int, (v_counts->>'high')::int,
          (v_counts->>'medium')::int, (v_counts->>'low')::int, v_failing, v_res);

  if cardinality(v_new) > 0 then
    insert into public.notifications (user_id, type, title, body, entity_type)
    select p.id, 'security', 'New security finding',
           'Security audit found: ' || array_to_string(v_new, ', ') || '. Open Console > Security Audit.',
           'security_audit'
      from public.profiles p where coalesce(p.is_super_admin,false) and not coalesce(p.locked,false);
    insert into public.system_logs (severity, source, module_id, message, detail)
    values ('warning', 'security_audit', 'security_audit', 'New security finding: ' || array_to_string(v_new, ', '),
            jsonb_build_object('new', v_new, 'score', v_res->'score'));
  end if;

  return v_res || jsonb_build_object('new_findings', to_jsonb(v_new));
end $$;
revoke all on function public._security_scan_record(text, uuid) from public, anon, authenticated;

create or replace function public.admin_run_security_scan()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can run the security audit.' using errcode = '42501';
  end if;
  return public._security_scan_record('manual', auth.uid());
end $$;

create or replace function public.cron_security_scan()
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public._security_scan_record('scheduled', null);
end $$;
revoke all on function public.cron_security_scan() from public, anon, authenticated;

create or replace function public.admin_list_security_scans(p_limit int default 26)
returns table (id uuid, ran_at timestamptz, trigger text, score int, critical int, high int, medium int, low int, failing text[])
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can view the security audit.' using errcode = '42501';
  end if;
  return query
    select r.id, r.ran_at, r.trigger, r.score, r.critical, r.high, r.medium, r.low, r.failing
      from public.security_scan_runs r order by r.ran_at desc limit greatest(1, least(p_limit, 200));
end $$;

revoke all on function public.admin_security_posture() from public, anon;
revoke all on function public.admin_run_security_scan() from public, anon;
revoke all on function public.admin_list_security_scans(int) from public, anon;
grant execute on function public.admin_security_posture() to authenticated;
grant execute on function public.admin_run_security_scan() to authenticated;
grant execute on function public.admin_list_security_scans(int) to authenticated;

-- weekly scan, Sunday 05:00 UTC (08:00 Riyadh)
do $$
begin
  perform cron.unschedule('security-audit-weekly') where exists (select 1 from cron.job where jobname = 'security-audit-weekly');
  perform cron.schedule('security-audit-weekly', '0 5 * * 0', 'select public.cron_security_scan()');
end $$;

-- ── break-glass alerts ────────────────────────────────────────────────────
-- Every super-admin console sign-in and every high-risk console action notifies
-- ALL super admins (including the actor, so a hijacked session is visible to
-- the real owner on their next look) and writes a system log line.
create or replace function public.alert_console_break_glass()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_who text;
  v_title text;
  v_risky text[] := array['bulk_set_role','update_permissions','update_config','duplicate_resolve',
                          'data_cleanup','backup_restore','restore_missing','delete_user','set_super_admin',
                          'enable_2fa','disable_2fa','set_mobile_min_version','support_session_start'];
begin
  if NEW.action <> 'login' and NEW.action <> all (v_risky) then
    return NEW;
  end if;
  select coalesce(full_name, email, NEW.admin_id::text) into v_who from public.profiles where id = NEW.admin_id;
  v_title := case when NEW.action = 'login' then 'Super admin signed in to the console'
                  else 'High-risk console action: ' || replace(NEW.action, '_', ' ') end;
  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    select p.id, 'security', v_title,
           coalesce(v_who, 'Unknown') || ' at ' || to_char(NEW.created_at at time zone 'Asia/Riyadh', 'DD Mon YYYY HH24:MI') || ' (Riyadh).',
           'console_session', NEW.id
      from public.profiles p where coalesce(p.is_super_admin,false) and not coalesce(p.locked,false);
    insert into public.system_logs (severity, source, module_id, message, user_id, detail)
    values (case when NEW.action = 'login' then 'info' else 'warning' end, 'break_glass', 'security_audit',
            v_title || ' by ' || coalesce(v_who, 'unknown'), NEW.admin_id,
            jsonb_build_object('action', NEW.action, 'target_type', NEW.target_type, 'target_id', NEW.target_id));
  exception when others then
    null; -- alerting must never block the action being recorded
  end;
  return NEW;
end $$;
revoke all on function public.alert_console_break_glass() from public, anon, authenticated;

drop trigger if exists trg_console_break_glass on public.console_sessions;
create trigger trg_console_break_glass
  after insert on public.console_sessions
  for each row execute function public.alert_console_break_glass();

-- A change to who is a super admin is the most privileged event in the system;
-- it is alerted whichever path made it (console, SQL, RPC).
create or replace function public.alert_super_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if NEW.entity is distinct from 'super_admin' then
    return NEW;
  end if;
  begin
    insert into public.notifications (user_id, type, title, body, entity_type)
    select p.id, 'security', 'Super admin access changed',
           coalesce(NEW.actor_email, 'System') || ' changed super-admin access for a user. Review in Console > Audit.',
           'access_audit'
      from public.profiles p where coalesce(p.is_super_admin,false) and not coalesce(p.locked,false);
    insert into public.system_logs (severity, source, module_id, message, detail)
    values ('critical', 'break_glass', 'security_audit', 'Super admin access changed',
            jsonb_build_object('actor', NEW.actor_email, 'target', NEW.target_user, 'before', NEW.before, 'after', NEW.after));
  exception when others then
    null;
  end;
  return NEW;
end $$;
revoke all on function public.alert_super_admin_change() from public, anon, authenticated;

drop trigger if exists trg_alert_super_admin_change on public.access_audit;
create trigger trg_alert_super_admin_change
  after insert on public.access_audit
  for each row execute function public.alert_super_admin_change();
