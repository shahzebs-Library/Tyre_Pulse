-- Anonymous callers cannot advance business number sequences; new public
-- functions are no longer born anon-executable.
--
-- FINDINGS: API-10 (P3), RLS-13 (P3)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12 (statements below,
--   unchanged). Pre-apply checks run first; results:
--   (a) anon-executable functions in public that write: every one is SECURITY
--       DEFINER (log_client_error, record_login_failure, request_password_reset,
--       qr_login_start, qr_login_status, the five token snapshot functions).
--       The only INVOKER writers were the two generators and two trigger
--       functions (workforce_assignment_classify / _guard, never called over
--       the API). anon holds no table grants, so it cannot reach a sequence
--       through an insert either. Section 2 kept.
--   (b) 44 sequences: authenticated USAGE 44 / anon USAGE 0 after apply.
--   Verified after apply, as anon, rolled back: get_public_config,
--   login_attempt_status, record_login_failure, get_email_by_identifier,
--   get_login_showcase, request_password_reset, qr_login_start, qr_login_status,
--   log_client_error, get_report_snapshot (bad token and a real token),
--   get_report_tyre_maintenance (real token), get_workshop_snapshot,
--   get_accident_portal_snapshot, get_display_snapshot all answer as before;
--   generate_work_order_no and a direct nextval -> 42501. As a Manager
--   generate_work_order_no still returns a number.
--   pg_default_acl (postgres): functions, all schemas = owner only; functions
--   and sequences in public = authenticated + service_role, no anon.
--   Note: the first default-privilege statement is not schema-bound, so a
--   function postgres creates in ANY schema is no longer executable by PUBLIC;
--   grant explicitly when a non-public-schema function must be callable.
--
-- WHAT IS WRONG (catalog, read live 2026-11-12; the calls were not made because
-- nextval is not rolled back)
--   generate_work_order_no() and generate_po_number() are SECURITY INVOKER,
--   VOLATILE, and their ACL is {=X, anon=X, authenticated=X, service_role=X}:
--   an unauthenticated POST /rest/v1/rpc/generate_work_order_no burns a number.
--   pg_default_acl (role postgres, schema public, functions) grants EXECUTE to
--   anon, which is why every new function needs a manual revoke.
--
-- WHAT THIS DOES
--   1. EXECUTE on the two generators: revoked from PUBLIC and anon; granted
--      explicitly to authenticated and service_role FIRST (a revoke from PUBLIC
--      also strips a role that only held the right through PUBLIC - V500 lesson).
--   2. Sequences in public: USAGE granted explicitly to authenticated and
--      service_role, then revoked from PUBLIC and anon.
--   3. Default privileges for objects postgres creates from now on: functions
--      are not executable by PUBLIC or anon (authenticated / service_role keep
--      their existing default); sequences give anon nothing.
--
-- -------------------------------------------------------------- PRE-APPLY CHECKS
-- (a) Does any anon-facing function need a sequence? Only a SECURITY INVOKER
--     function that inserts into a serial / identity table as anon would. List
--     the anon-executable functions and their security mode:
--       select p.proname, p.prosecdef
--         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public'
--          and has_function_privilege('anon', p.oid, 'EXECUTE');
--     Expected: the allowlist (get_public_config, get_email_by_identifier,
--     login_attempt_status, record_login_failure, reset_login_attempts,
--     request_password_reset, qr_login_start, qr_login_status,
--     get_login_showcase, log_client_error, the five token snapshot functions)
--     plus the two generators. Every allowlisted function that writes must be
--     SECURITY DEFINER (then it runs as its owner and needs no anon USAGE).
--     If one is INVOKER and writes, leave section 2 out.
-- (b) Which sequences back a table that authenticated inserts into directly?
--     Section 2 grants authenticated USAGE on all of them first, so this is
--     covered; confirm afterwards with
--       select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
--        where n.nspname = 'public' and c.relkind = 'S'
--          and not has_sequence_privilege('authenticated', c.oid, 'USAGE');   -- expect 0
-- Data loss: none. Locks: catalog only.
-- Client behaviour that changes: none for signed-in users.
-- Rollback: at the foot.

-- 1. the two number generators
grant execute on function public.generate_work_order_no() to authenticated, service_role;
grant execute on function public.generate_po_number()     to authenticated, service_role;
revoke execute on function public.generate_work_order_no() from public, anon;
revoke execute on function public.generate_po_number()     from public, anon;

-- 2. sequences
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on all sequences in schema public from public, anon;

-- 3. defaults for future objects created by postgres
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public grant usage, select on sequences to authenticated, service_role;

-- ------------------------------------------------------------------------ VERIFY
-- (to run after applying)
--   select has_function_privilege('anon','public.generate_work_order_no()','EXECUTE');  -- false
--   select has_function_privilege('anon','public.generate_po_number()','EXECUTE');      -- false
--   select has_function_privilege('authenticated','public.generate_work_order_no()','EXECUTE'); -- true
--   as anon (rolled back): get_public_config(), login_attempt_status('x'),
--     get_report_snapshot('<bad token>'), log_client_error(...)  -> same replies as before
--   as an authenticated Manager (rolled back): insert a work order / PO through
--     the normal RPC path -> number generated
--   create a throw-away function, then
--     has_function_privilege('anon', <it>, 'EXECUTE') -> false; remove it.
--   Not covered by this file: functions created by supabase_admin, and the
--     net / private schema grants named in RLS-13.
--
-- ---------------------------------------------------------------------- ROLLBACK
--   grant execute on function public.generate_work_order_no(), public.generate_po_number() to anon;
--   grant usage on all sequences in schema public to anon;
--   alter default privileges for role postgres in schema public grant execute on functions to anon;
--   alter default privileges for role postgres grant execute on functions to public;
