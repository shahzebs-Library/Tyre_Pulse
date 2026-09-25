-- =============================================================================
-- Console IP allowlist: extend server enforcement to the console READ RPCs.
-- 20260924126000 gated the 55 console writers; this adds the same guard
-- (_console_ip_allowed(), fail-open, gates only super admins via PostgREST when
-- the flag is on with >=1 active entry) to 26 console-only read RPCs, using the
-- identical anchored-insert method with the same abort guards.
--
-- DELIBERATELY NOT GATED:
--   * admin_tenant_export_server_start / admin_tenant_export_download_log: called
--     by the tenant-export edge function with the user's JWT, so the request IP
--     seen here is the edge runtime's, not the admin's; gating would refuse the
--     owner whenever the flag is on.
--   * admin_revoke_user_sessions: called by the admin-revoke-sessions edge fn
--     with the service role (auth.uid() null, always allowed anyway).
--   * admin_check_import_fingerprint: also used by main-app import screens.
--   * console_check_access: the client-side probe that decides the gate.
-- Flag is OFF today, so nothing changes until an admin enables it.
-- BREAK-GLASS: see 20260924117000 (turn the flag off in the SQL editor).
-- ROLLBACK: regexp_replace the inserted guard block out of each function.
-- =============================================================================

do $$
declare
  v_fns text[] := array[
    'admin_data_cleanup_preview','admin_data_cleanup_targets','admin_db_columns','admin_db_query',
    'admin_db_tables','admin_dup_preview','admin_dup_scan','admin_dup_targets','admin_export_audit',
    'admin_export_audit_count','admin_get_access_policies','admin_get_effective_access',
    'admin_import_history','admin_list_access_audit','admin_list_api_keys','admin_list_approvals',
    'admin_list_elevations','admin_list_incidents','admin_list_security_scans','admin_security_posture',
    'admin_tenant_export_manifest','admin_tenant_export_page','admin_tenant_export_retention_status',
    'admin_unlogged_imports','admin_verify_audit_seals','console_list_known_devices'];
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
  if v_n <> 26 then raise exception 'expected 26 functions patched, got %', v_n; end if;
end $$;
