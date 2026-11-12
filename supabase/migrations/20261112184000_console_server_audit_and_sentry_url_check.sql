-- Four privileged console actions now write their own audit row; the Sentry
-- region address must be a sentry.io host.
--
-- FINDINGS: CON-2 partial (P2), API-12 database half (P3)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (catalog): backup_restore_missing (re-inserts business rows),
--   set_sentry_config (stores a third-party token), admin_set_admin_user and
--   admin_clear_push_token touched no audit table, and their target tables have
--   no audit trigger. The only record was the row the browser writes afterwards,
--   which a direct API call skips. set_sentry_config stored any region address,
--   and the sentry-issues edge function sends the stored token to that address.
--
-- WHAT THIS DOES
--   1. _console_audit(action, target uuid, target_type, details): SECURITY
--      DEFINER, empty search_path, inserts one console_sessions row for
--      auth.uid() with the request IP and details.source = 'server'. Not
--      executable by PUBLIC, anon or authenticated - only the privileged RPCs
--      (same owner) call it. The audit row is part of the action's transaction:
--      if it cannot be written the action does not happen.
--   2. One anchored insertion into each LIVE definition (each anchor must match
--      exactly once, and the function must not already be audited):
--        backup_restore_missing   'backup_restore_missing', target = snapshot id,
--                                 details table + rows restored
--        set_sentry_config        'set_sentry_config', details org, region,
--                                 project, token_changed / alert_email_changed
--                                 flags - never the token or the address itself
--        admin_set_admin_user     'admin_set_admin_user', target = user id,
--                                 details role, regions, active
--        admin_clear_push_token   'clear_push_token', target = user id
--      Action names differ from the browser's own log entries, so the
--      break-glass notification trigger does not fire twice.
--   3. set_sentry_config refuses (22023) a region address that is not
--      https://sentry.io or https://<sub>.sentry.io (no port, path or http).
--      A blank address still falls back to the default, as before.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- console_sessions: target_id is uuid (log_console_event takes text and casts);
--   _console_audit takes a uuid directly, null where there is no target.
-- Stored region address today matches the new pattern.
-- Gates unchanged: each function keeps its own IP-allowlist and super-admin
--   checks; a refused call writes no row. No other database function calls these four.
-- Data loss: none. Signatures, owners and grants of the four RPCs unchanged.
-- Client behaviour that changes: the console shows one extra audit line per
--   action (source "server") next to the browser-written one.
-- Left open (CON-2): the other client-logged writers, read auditing of tenant
--   exports / data browser, and outcome / correlation columns.
--   set_sentry_config still checks the profile flag directly rather than
--   is_super_admin(), so it does not require an MFA session.
-- Rollback: re-create each of the four functions without the inserted lines
--   (the PERFORM public._console_audit(...) statement and, for
--   set_sentry_config, the region IF block). _console_audit can stay.

create or replace function public._console_audit(
  p_action text, p_target uuid default null, p_target_type text default null, p_details jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ip inet;
begin
  begin
    v_ip := public._request_client_ip();
  exception when others then
    v_ip := null;
  end;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details, ip_address)
  values (auth.uid(), p_action, p_target, p_target_type,
          coalesce(p_details, '{}'::jsonb) || jsonb_build_object('source', 'server'), v_ip);
end;
$fn$;

comment on function public._console_audit(text, uuid, text, jsonb) is
  'Server-side console audit row, written from inside privileged RPCs so the record does not depend on the browser. Not callable by clients.';

revoke execute on function public._console_audit(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public._console_audit(text, uuid, text, jsonb) to service_role;

do $mig$
declare
  v_def text;
  v_a text;
  v_new text;

  -- exactly-once anchored insertion helper is inlined per function below
begin
  -- 1. backup_restore_missing: audit after the insert count is known
  select replace(pg_get_functiondef(p.oid), E'\r', '') into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'backup_restore_missing';
  v_a := E'  GET DIAGNOSTICS v_n = ROW_COUNT;\n';
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 or v_def like '%_console_audit%' then
    raise exception 'backup_restore_missing: anchor not found exactly once, or already audited';
  end if;
  v_new := replace(v_def, v_a, v_a ||
    E'  PERFORM public._console_audit(''backup_restore_missing'', p_snapshot_id, ''backup_snapshot'',\n' ||
    E'    jsonb_build_object(''table'', p_table, ''restored'', v_n));\n');
  execute v_new;

  -- 2. set_sentry_config: region host check + audit (never the token itself)
  select replace(pg_get_functiondef(p.oid), E'\r', '') into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'set_sentry_config';
  if v_def like '%_console_audit%' then
    raise exception 'set_sentry_config already audited';
  end if;
  v_a := E'USING errcode=''42501''; END IF;\n';
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 then
    raise exception 'set_sentry_config: gate anchor not found exactly once';
  end if;
  v_new := replace(v_def, v_a, v_a ||
    E'\n  IF NULLIF(btrim(p_region_url), '''') IS NOT NULL\n' ||
    E'     AND lower(btrim(p_region_url)) !~ ''^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)*sentry\\.io/?$'' THEN\n' ||
    E'    RAISE EXCEPTION ''The Sentry region address must be https://sentry.io or a sentry.io subdomain'' USING errcode = ''22023'';\n' ||
    E'  END IF;\n');
  v_a := E'  RETURN jsonb_build_object(''ok'', true);';
  if (length(v_new) - length(replace(v_new, v_a, ''))) / length(v_a) <> 1 then
    raise exception 'set_sentry_config: return anchor not found exactly once';
  end if;
  v_new := replace(v_new, v_a,
    E'  PERFORM public._console_audit(''set_sentry_config'', NULL, ''sentry'', jsonb_build_object(\n' ||
    E'    ''token_changed'', (p_token IS NOT NULL AND length(btrim(p_token)) > 0),\n' ||
    E'    ''org'', COALESCE(NULLIF(btrim(p_org),''''),''shah-profile''),\n' ||
    E'    ''region_url'', COALESCE(NULLIF(btrim(p_region_url),''''),''https://de.sentry.io''),\n' ||
    E'    ''project'', COALESCE(btrim(p_project),''''),\n' ||
    E'    ''alert_email_changed'', (p_alert_email IS NOT NULL),\n' ||
    E'    ''alerts_enabled'', p_alerts_enabled));\n' || v_a);
  execute v_new;

  -- 3. admin_set_admin_user
  select replace(pg_get_functiondef(p.oid), E'\r', '') into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_set_admin_user';
  v_a := E'  RETURN to_jsonb(v_row);';
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 or v_def like '%_console_audit%' then
    raise exception 'admin_set_admin_user: anchor not found exactly once, or already audited';
  end if;
  v_new := replace(v_def, v_a,
    E'  PERFORM public._console_audit(''admin_set_admin_user'', p_user_id, ''admin_user'',\n' ||
    E'    jsonb_build_object(''admin_role'', p_role, ''regions'', to_jsonb(COALESCE(p_regions,''{}'')), ''active'', COALESCE(p_active,true)));\n' || v_a);
  execute v_new;

  -- 4. admin_clear_push_token
  select replace(pg_get_functiondef(p.oid), E'\r', '') into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_clear_push_token';
  v_a := E'   WHERE user_id = p_user_id AND NOT coalesce(revoked, false);\n';
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 or v_def like '%_console_audit%' then
    raise exception 'admin_clear_push_token: anchor not found exactly once, or already audited';
  end if;
  v_new := replace(v_def, v_a, v_a ||
    E'  PERFORM public._console_audit(''clear_push_token'', p_user_id, ''user'', NULL);\n');
  execute v_new;
end
$mig$;

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12, one rolled-back transaction)
--   Manager: admin_clear_push_token -> refused; set_sentry_config -> 42501;
--            console_sessions rows added by the refusals: 0
--   super admin with an MFA session:
--     set_sentry_config(region https://example.com)              -> 22023
--     set_sentry_config(region https://sentry.io.evil.example)   -> 22023
--     set_sentry_config(region http://de.sentry.io)              -> 22023
--     set_sentry_config(region https://de.sentry.io)             -> ok + audit row
--     set_sentry_config(region https://sentry.io)                -> ok + audit row
--     admin_set_admin_user(viewer)                               -> ok + audit row (target = user)
--     admin_clear_push_token                                     -> ok + audit row (target = user)
--     backup_restore_missing(latest snapshot, stock_records)     -> restored 0 + audit row
--   Every audit row: admin_id set, details.source = 'server', no token value.
--   has_function_privilege(anon / authenticated, _console_audit) = false.
