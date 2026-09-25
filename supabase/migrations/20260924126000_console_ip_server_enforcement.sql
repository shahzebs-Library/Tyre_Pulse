-- =============================================================================
-- 20260924126000_console_ip_server_enforcement.sql
-- Console IP allowlist: enforce it SERVER-SIDE on the console write RPCs.
--
-- STATUS: APPLIED LIVE 2026-09-25 (project jhssdmeruxtrlqnwfksc) via Supabase MCP
--         apply_migration 'console_ip_server_enforcement'. Body below is exactly
--         what was applied. console_ip_allowlist_enabled left 'false' (OFF).
--
-- WHY: 20260924117000 stated the gap "the IP allowlist gates the CONSOLE UI only;
--      a super admin's JWT can still reach the RPCs from any IP". This closes it
--      for every console WRITE RPC listed below.
--
-- _console_ip_allowed() returns TRUE (allowed) when ANY of:
--   * the caller is not a super admin (the allowlist is a console policy; the
--     main app and mobile flows of ordinary users are never IP-gated, and each
--     RPC's own role gate still decides),
--   * there is no auth.uid() (cron, service role, SQL editor),
--   * the allowlist flag is off,
--   * the allowlist has no active entry,
--   * there are no request headers at all (not a PostgREST request),
--   * the request IP is covered by an active CIDR,
--   * ANY error happens inside the check (FAIL OPEN, same as the client).
-- It returns FALSE only when a super admin calls through PostgREST with the flag
-- on, at least one active entry, and an IP that is unknown or not covered.
--
-- METHOD: each function's LIVE pg_get_functiondef is read, the guard is inserted
-- right after the first BEGIN of the body. The migration ABORTS unless: the body
-- opens with $function$, the text before that first BEGIN is a pure DECLARE
-- section (no $, balanced quotes, no comment), the anchor matches exactly once, and the
-- result contains the guard exactly once. Already-patched functions are skipped
-- (re-runnable). SECURITY DEFINER, search_path and grants survive CREATE OR REPLACE.
--
-- BREAK-GLASS: the RPCs that manage the allowlist itself are gated too, so a
-- super admin outside the allowlist cannot fix it from the console. Use the
-- break-glass SQL documented in 20260924117000 (turn the flag off from the
-- Supabase SQL editor).
--
-- NOT COVERED (stated): console READ RPCs (admin_list_*, admin_security_posture,
-- admin_db_query, admin_tenant_export_page/manifest, admin_export_audit) and the
-- tenant-export edge function path; plain table reads under RLS are not IP-aware.
--
-- ROLLBACK: for each function, re-run CREATE OR REPLACE with the inserted block
--   "if not public._console_ip_allowed() then raise exception ... end if;" removed
--   (regexp_replace on pg_get_functiondef), then
--   drop function public._console_ip_allowed();
-- =============================================================================

create or replace function public._console_ip_allowed()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_hdr text; v_ip inet;
begin
  begin
    if auth.uid() is null then return true; end if;
    if not coalesce(public.is_super_admin(), false) then return true; end if;
    if not public._ip_allowlist_on() then return true; end if;
    if not exists (select 1 from public.console_ip_allowlist where active) then return true; end if;
    v_hdr := nullif(current_setting('request.headers', true), '');
    if v_hdr is null then return true; end if;
    v_ip := public._request_client_ip();
    if v_ip is null then return false; end if;
    return public._ip_covered(v_ip);
  exception when others then
    return true;  -- fail open: a bug in the check must never lock the owner out
  end;
end $$;
revoke all on function public._console_ip_allowed() from public, anon, authenticated;

do $$
declare
  v_fns text[] := array[
    'admin_apply_access_review','admin_attest_control','admin_bulk_set_grant','admin_bulk_set_role',
    'admin_cancel_approval','admin_clear_push_token','admin_clone_role','admin_data_cleanup_run',
    'admin_db_delete_row','admin_db_revert_change','admin_db_update_row','admin_decide_access_item',
    'admin_decide_approval','admin_decide_elevation','admin_dup_resolve','admin_dup_restore',
    'admin_grant_elevation','admin_ip_allowlist_add','admin_ip_allowlist_delete','admin_ip_allowlist_set_active',
    'admin_mobile_user_action','admin_open_incident','admin_post_incident_update','admin_request_approval',
    'admin_revoke_api_key','admin_revoke_elevation','admin_run_security_scan','admin_set_admin_user',
    'admin_set_api_key_expiry','admin_set_console_ip_allowlist','admin_set_dual_control','admin_set_sso_required',
    'admin_set_user_country','admin_set_user_password','admin_set_user_sites','admin_set_web_access',
    'admin_start_access_review','admin_tenant_export_log','admin_tenant_export_purge_now',
    'admin_tenant_export_set_retention','admin_update_profile','admin_withdraw_attestation',
    'backup_restore_missing','console_forget_device','create_backup_snapshot','incident_reassign_commander',
    'incident_save_postmortem','resolve_system_logs','revoke_user_access_grant','save_access_control_matrix',
    'set_module_permissions','set_sentry_config','set_user_access_grant','start_support_session',
    'end_support_session'];
  v_guard constant text := E'\n  if not public._console_ip_allowed() then\n    raise exception ''Console access is not allowed from this network'' using errcode = ''42501'';\n  end if;\n';
  v_fn text; r record; v_def text; v_pre text; v_new text; v_hits int; v_n int := 0;
  v_pat constant text := '^(.*?\$function\$)([^$]*?)\m(begin)\M';
begin
  foreach v_fn in array v_fns loop
    for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_fn loop
      v_def := pg_get_functiondef(r.oid);
      if position('_console_ip_allowed' in v_def) > 0 then continue; end if;
      select count(*) into v_hits from regexp_matches(v_def, v_pat, 'i');
      if v_hits <> 1 then raise exception 'anchor for % found % times, expected 1', v_fn, v_hits; end if;
      v_pre := (regexp_match(v_def, v_pat, 'i'))[2];
      -- balanced quotes = the first BEGIN is not inside a string default
      if v_pre ~ '[$]' or v_pre ~ '--' or v_pre !~* '^\s*(declare\M.*)?$'
         or (length(v_pre) - length(replace(v_pre, '''', ''))) % 2 <> 0 then
        raise exception 'unexpected text before BEGIN in %: %', v_fn, v_pre;
      end if;
      v_new := regexp_replace(v_def, v_pat, '\1\2\3' || replace(v_guard, '\', '\\'), 'i');
      select count(*) into v_hits from regexp_matches(v_new, '_console_ip_allowed', 'g');
      if v_hits <> 1 then raise exception 'guard count for % is %, expected 1', v_fn, v_hits; end if;
      execute v_new;
      v_n := v_n + 1;
    end loop;
  end loop;
  if v_n <> 55 then raise exception 'expected 55 functions patched, got %', v_n; end if;
end $$;
