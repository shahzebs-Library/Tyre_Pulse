-- TEN-4b: get_user_module_permissions(p_user_id) answers only for the caller, a user of the
--         caller's own organisation, a super admin, or a server-side caller.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12. Not applied to production.
--         Tested on PGlite (supabase/tests/tenant_isolation_ten4b.test.mjs) and on the local
--         PostgreSQL 16 staging copy (supabase/staging, TEN-4 reproduction).
--
-- WHAT IT FIXES
--   The RPC is SECURITY DEFINER and resolves `COALESCE(p_user_id, auth.uid())` with no check, so
--   any signed-in user of any organisation can pass a foreign user id and read that user's
--   effective module map (which reveals the role the foreign user holds and, once per-tenant
--   matrix rows exist, that tenant's own access configuration). TEN-4 (20261113103000) closed
--   the two admin writers and listed this reader as not fixed.
--
--   After this migration a call that names ANOTHER user is answered only when one of these holds:
--     * the caller is a super admin;
--     * the target shares org_id with the caller (any role, exactly as today inside one company);
--     * the call is server side: no auth.uid() and a JWT role that is neither anon nor
--       authenticated (service_role key, cron, a direct database session).
--   Anything else raises SQLSTATE 42501 "not authorized". A missing id and a foreign id get the
--   same answer, so the RPC cannot be used to test whether a user id exists elsewhere.
--   A call with no argument, or with the caller's own id, takes the unchanged path.
--
-- WHAT IT DOES NOT FIX
--   module_permissions rows with org_id NULL (the global role matrix) stay readable by every
--   signed-in user through the table itself. That is how every tenant, including the current
--   company, resolves the built-in roles today (TEN-7 decision D1) and is documented, not closed.
--
-- RISK TO THE CURRENT COMPANY: NONE EXPECTED.
--   Every client caller passes no argument (web AuthContext.jsx, mobile AuthContext.tsx, Flutter
--   access_permissions_repository.dart; checked 2026-11-12). No database function calls this RPC
--   with an argument (pg_proc scan on the staging baseline). Same-organisation lookups and super
--   admin lookups keep working. The result for an allowed call is byte-identical: only one IF
--   block is inserted after the first statement.
--
-- METHOD: anchored replacement on pg_get_functiondef. The anchor line exists in the live body
--   and in the body TEN-7 (20261113111000) leaves behind, so this file applies before or after
--   TEN-7. The anchor must be found exactly once or the migration aborts. CREATE OR REPLACE keeps
--   SECURITY DEFINER, search_path and the ACL (authenticated and service_role; not anon).
--
-- VERIFY (rolled back, after applying):
--   begin;
--   select position('TEN-4b' in prosrc) > 0 as guarded, prosecdef,
--          has_function_privilege('anon', oid, 'EXECUTE') as anon_exec           -- expect t, t, f
--     from pg_proc where oid = 'public.get_user_module_permissions(uuid)'::regprocedure;
--   -- impersonate a Company A Manager:
--   --   select md5(public.get_user_module_permissions()::text);            same value as before applying
--   --   select public.get_user_module_permissions('<another Company A user id>');   answers
--   --   select public.get_user_module_permissions('<a demo organisation user id>'); 42501
--   -- impersonate a super admin: the demo organisation user id answers.
--   rollback;
--
-- ROLLBACK: re-create the function from the text captured before applying
--   (select pg_get_functiondef('public.get_user_module_permissions(uuid)'::regprocedure)),
--   or reverse the single replacement below.
-- ---------------------------------------------------------------------------------------------

do $mig$
declare
  v_def  text;
  v_hits integer;
  a1 constant text := E'  v_uid := COALESCE(p_user_id, auth.uid());\n';
  n1 constant text := a1
    || E'  -- TEN-4b: another user''s map is answered only inside the caller''s organisation,\n'
    || E'  -- for a super admin, or for a server-side caller.\n'
    || E'  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid()\n'
    || E'     AND NOT (auth.uid() IS NULL AND COALESCE(auth.role(), '''') NOT IN (''anon'', ''authenticated''))\n'
    || E'     AND NOT COALESCE(public.is_super_admin(), false)\n'
    || E'     AND NOT EXISTS (\n'
    || E'       SELECT 1 FROM public.profiles t\n'
    || E'        WHERE t.id = p_user_id\n'
    || E'          AND public.app_current_org() IS NOT NULL\n'
    || E'          AND t.org_id = public.app_current_org()) THEN\n'
    || E'    RAISE EXCEPTION ''not authorized'' USING ERRCODE = ''42501'';\n'
    || E'  END IF;\n';
begin
  if to_regprocedure('public.get_user_module_permissions(uuid)') is null then
    raise exception 'TEN-4b aborted: public.get_user_module_permissions(uuid) does not exist';
  end if;
  select replace(pg_get_functiondef('public.get_user_module_permissions(uuid)'::regprocedure), E'\r\n', E'\n')
    into v_def;
  if position('TEN-4b' in v_def) > 0 then
    raise notice 'TEN-4b: get_user_module_permissions already guarded, skipped';
  else
    if position('SECURITY DEFINER' in v_def) = 0 then
      raise exception 'TEN-4b aborted: get_user_module_permissions is no longer SECURITY DEFINER. Re-author this migration.';
    end if;
    v_hits := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
    if v_hits <> 1 then
      raise exception 'TEN-4b aborted: anchor found % time(s) in get_user_module_permissions, expected 1. Re-author this migration.', v_hits;
    end if;
    execute replace(v_def, a1, n1);
  end if;

  -- Grants are kept by CREATE OR REPLACE; assert rather than assume.
  if has_function_privilege('anon', 'public.get_user_module_permissions(uuid)', 'EXECUTE') then
    raise exception 'TEN-4b aborted: anon can execute get_user_module_permissions';
  end if;
end
$mig$;
