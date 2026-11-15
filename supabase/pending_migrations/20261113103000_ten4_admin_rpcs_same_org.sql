-- TEN-4: admin_set_user_sites and admin_set_web_access act only inside the caller's organisation.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definitions
--         (md5(prosrc): admin_set_user_sites ea3b45ce5a55ccaf3d47fa9e27c85180,
--          admin_set_web_access bbb210fd526c31eb9fdaa7519f9680d1). Not applied to any database.
--         Tested on PGlite only (supabase/tests/tenant_isolation_ten4.test.mjs).
--
-- WHAT IT FIXES
--   Both RPCs are SECURITY DEFINER, gate on `is_super_admin() OR get_my_role() = 'Admin'`, then
--   `update profiles ... where id = p_user_id` with no organisation comparison.
--   * admin_set_user_sites switches trg_guard_profile_privileged OFF around its update, so the
--     same-organisation rule in guard_profile_privileged_cols() does not run. A plain Admin of
--     organisation B who holds a Company A user id can clear or widen that user's site scope.
--     REPRODUCED on PGlite against the faithful copy.
--   * admin_set_web_access does NOT switch the trigger off. On the faithful copy the live
--     trigger already refuses the cross-organisation change (42501 "Not authorized to manage a
--     user in another organisation."), so the audit report's claim for this RPC was NOT
--     reproduced. The explicit check is added anyway so the RPC does not depend on a trigger
--     that its sibling switches off table-wide.
--
--   After this migration a caller who is not a super admin must share org_id with the target.
--   A missing target and a foreign target raise the same 42501 text, so the RPC cannot be used
--   to test whether a user id exists in another company.
--
-- WHAT IT DOES NOT FIX
--   get_user_module_permissions(p_user_id) still answers for any id (RLS-14): closed separately by
--   TEN-4b (20261113114000_ten4b_module_permissions_same_org.sql). A plain Admin can
--   still change the site scope or web access of a SUPER ADMIN in the same organisation (a super
--   admin ignores site scope, and web access off would lock the owner out of the web app: worth
--   a separate decision). admin_set_user_sites still switches the profile guard trigger off and
--   on inside the call, which takes an ACCESS EXCLUSIVE lock on profiles; unchanged here.
--
-- RISK TO THE CURRENT COMPANY (Company A; 2 super admins, 0 plain Admins): NONE EXPECTED.
--   Both live callers (src/lib/api/adminAccess.js, console Users page) run as a super admin, who
--   passes the new check for any target, including the demo organisation. A future plain
--   Company A Admin still manages Company A users.
--
-- METHOD: anchored replacement on pg_get_functiondef; each anchor must be found exactly once or
--   the migration aborts. CREATE OR REPLACE keeps SECURITY DEFINER, search_path and the ACL
--   (authenticated and service_role may execute; anon may not).
--
-- VERIFY (rolled back, after applying):
--   begin;
--   select proname, position('TEN-4' in prosrc) > 0 as guarded,
--          has_function_privilege('anon', oid, 'EXECUTE') as anon_exec           -- expect t, f
--     from pg_proc where pronamespace = 'public'::regnamespace
--      and proname in ('admin_set_user_sites','admin_set_web_access');
--   -- impersonate a Company A super admin; call both RPCs on one Company A user and on the demo
--   --   Manager; reset role and confirm sites / web_access changed. Then rollback.
--   -- the refusal needs a plain Admin of a second organisation, which production does not have:
--   --   confirm it on a branch database (expect SQLSTATE 42501 and the target row unchanged,
--   --   read as a privileged reader, and trg_guard_profile_privileged back to tgenabled = 'O').
--   rollback;
--
-- ROLLBACK: re-create both functions from the text captured before applying
--   (select pg_get_functiondef(...)), or reverse the three replacements below.
-- ---------------------------------------------------------------------------------------------

do $mig$
declare
  v_def  text;
  v_hits integer;
  -- admin_set_user_sites
  a1 constant text := E'  ALTER TABLE public.profiles DISABLE TRIGGER trg_guard_profile_privileged;\n';
  n1 constant text :=
       E'  -- TEN-4: outside a super admin, the target must be in the caller''s organisation.\n'
    || E'  IF NOT public.is_super_admin() AND NOT EXISTS (\n'
    || E'       SELECT 1 FROM public.profiles t\n'
    || E'        WHERE t.id = p_user_id\n'
    || E'          AND public.app_current_org() IS NOT NULL\n'
    || E'          AND t.org_id = public.app_current_org()) THEN\n'
    || E'    RAISE EXCEPTION ''not authorized'' USING ERRCODE = ''42501'';\n'
    || E'  END IF;\n'
    || a1;
  a2 constant text := E'  UPDATE public.profiles SET sites = v_clean WHERE id = p_user_id;\n';
  n2 constant text :=
       E'  UPDATE public.profiles SET sites = v_clean\n'
    || E'   WHERE id = p_user_id\n'
    || E'     AND (public.is_super_admin() OR org_id = public.app_current_org());\n';
  -- admin_set_web_access
  a3 constant text := E'  UPDATE public.profiles SET web_access = COALESCE(p_web, true) WHERE id = p_user_id;\n';
  n3 constant text :=
       E'  -- TEN-4: outside a super admin, the target must be in the caller''s organisation.\n'
    || E'  IF NOT public.is_super_admin() AND NOT EXISTS (\n'
    || E'       SELECT 1 FROM public.profiles t\n'
    || E'        WHERE t.id = p_user_id\n'
    || E'          AND public.app_current_org() IS NOT NULL\n'
    || E'          AND t.org_id = public.app_current_org()) THEN\n'
    || E'    RAISE EXCEPTION ''Not authorized to change web access.'' USING ERRCODE = ''42501'';\n'
    || E'  END IF;\n'
    || E'  UPDATE public.profiles SET web_access = COALESCE(p_web, true)\n'
    || E'   WHERE id = p_user_id\n'
    || E'     AND (public.is_super_admin() OR org_id = public.app_current_org());\n';
begin
  -- admin_set_user_sites -------------------------------------------------------------------
  select replace(pg_get_functiondef('public.admin_set_user_sites(uuid, text[], text)'::regprocedure), E'\r\n', E'\n')
    into v_def;
  if position('TEN-4' in v_def) > 0 then
    raise notice 'TEN-4: admin_set_user_sites already guarded, skipped';
  else
    v_hits := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
    if v_hits <> 1 then
      raise exception 'TEN-4 aborted: trigger switch-off anchor found % time(s) in admin_set_user_sites, expected 1', v_hits;
    end if;
    v_hits := (length(v_def) - length(replace(v_def, a2, ''))) / length(a2);
    if v_hits <> 1 then
      raise exception 'TEN-4 aborted: update anchor found % time(s) in admin_set_user_sites, expected 1', v_hits;
    end if;
    execute replace(replace(v_def, a2, n2), a1, n1);
  end if;

  -- admin_set_web_access -------------------------------------------------------------------
  select replace(pg_get_functiondef('public.admin_set_web_access(uuid, boolean)'::regprocedure), E'\r\n', E'\n')
    into v_def;
  if position('TEN-4' in v_def) > 0 then
    raise notice 'TEN-4: admin_set_web_access already guarded, skipped';
  else
    v_hits := (length(v_def) - length(replace(v_def, a3, ''))) / length(a3);
    if v_hits <> 1 then
      raise exception 'TEN-4 aborted: update anchor found % time(s) in admin_set_web_access, expected 1', v_hits;
    end if;
    execute replace(v_def, a3, n3);
  end if;

  -- Grants are kept by CREATE OR REPLACE; assert rather than assume.
  if has_function_privilege('anon', 'public.admin_set_user_sites(uuid, text[], text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_set_web_access(uuid, boolean)', 'EXECUTE') then
    raise exception 'TEN-4 aborted: anon can execute an admin RPC';
  end if;
end
$mig$;
