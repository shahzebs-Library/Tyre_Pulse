-- MIGRATIONS_V500_REVOKE_ANON_DEFINER_EXECUTE.sql
-- STATUS: APPLIED LIVE 2026-08-10, verified as anon AND as a signed-in user.
--
-- WHY
-- 126 SECURITY DEFINER functions were executable by an unauthenticated caller.
-- A definer function runs as its OWNER and BYPASSES row-level security, so this
-- is the one surface where RLS is not the backstop. Nothing leaked today, but
-- only by defence in depth: app_current_org() is NULL for anon, so the
-- org-scoped ones return "no_org" and refuse. That is a coincidence of how each
-- function happens to be written, not a boundary - the day one new definer
-- function forgets that check it is an unauthenticated breach with nothing
-- underneath to catch it.
--
-- RESULT: 126 -> 10 anon-executable. 116 revoked.
--
-- ============================================================================
-- THE TRAP THIS HIT ON THE FIRST ATTEMPT - re-learning V480 the hard way
-- ============================================================================
-- `REVOKE EXECUTE ... FROM anon` is a NO-OP against a PUBLIC grant. The first
-- run revoked from anon and **100 functions were still anon-executable**,
-- because their EXECUTE came from PUBLIC. The migration's own guard caught it
-- and rolled the whole thing back rather than leaving the job half done and
-- reporting success.
--
-- But revoking PUBLIC *alone* would also strip `authenticated` - most of these
-- have no explicit authenticated grant and reach the function THROUGH PUBLIC.
-- That would have broken half the product for every signed-in user. So the
-- order is load-bearing:
--     1. GRANT EXECUTE to authenticated + service_role   (make it explicit)
--     2. REVOKE EXECUTE from PUBLIC                      (the implicit route)
--     3. REVOKE EXECUTE from anon                        (any explicit grant)
-- Skipping step 1 logs everyone out of half the app.
--
-- ============================================================================
-- THE ALLOWLIST WAS ENUMERATED FROM CALL SITES, NOT FROM FUNCTION NAMES
-- ============================================================================
--   LOGIN / PRE-AUTH        get_email_by_identifier  (signIn resolves a username)
--                           get_public_config        (registration + maintenance flags)
--                           login_attempt_status     (lockout probe before sign-in)
--                           record_login_failure     (counts a failed attempt)
--                           reset_login_attempts     (self-scoped; harmless to keep)
--   PUBLIC TOKEN ROUTES     get_report_snapshot          (/report/:token)
--                           get_report_tyre_maintenance  (its extra board pages)
--                           get_workshop_snapshot        (/workshop-tv/:token)
--                           get_accident_portal_snapshot (/accident-portal/:token)
--                           get_display_snapshot         (legacy /display/:token)
--
-- `get_report_tyre_maintenance` is the one a name-pattern sweep WOULD have
-- missed and a live public board would have broken on. That single near-miss is
-- the argument for reading the pre-auth surfaces (Login, ReportShare, WorkshopTv,
-- AccidentPortalView, mobile login/register, and the services they call) instead
-- of regexing over function names.
--
-- Trigger functions do NOT need an EXECUTE grant - the trigger mechanism invokes
-- them - so this cannot break a trigger.
--
-- VERIFIED LIVE:
--   anon definer functions remaining      : 10 (the allowlist, exactly)
--   revoked                               : 116
--   as anon: get_email_by_identifier      -> still resolves (login works)
--            login_attempt_status         -> still responds
--            get_public_config            -> still responds
--            get_report_snapshot('bogus') -> {"ok": false}  (reachable, rejects)
--            get_fleet_cpk(...)           -> permission denied for function
--   as a signed-in KSA Manager:
--            get_fleet_cpk(...)           -> still works
--
-- ROLLBACK: _anon_execute_revoked_v500 holds every signature touched.
--   grant execute on function <signature> to anon;

create table if not exists public._anon_execute_revoked_v500 (
  fn_signature text primary key, revoked_at timestamptz default now()
);

do $mig$
declare
  r record; v_kept int; v_left int;
  keep constant text[] := array[
    'get_email_by_identifier', 'get_public_config',
    'login_attempt_status', 'record_login_failure', 'reset_login_attempts',
    'get_report_snapshot', 'get_report_tyre_maintenance',
    'get_workshop_snapshot', 'get_accident_portal_snapshot',
    'get_display_snapshot'
  ];
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not (p.proname = any (keep))
  loop
    -- 1. make the legitimate callers explicit BEFORE removing the implicit route
    execute format('grant execute on function %s to authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    -- 2. the implicit route (this is the step a plain "revoke from anon" misses)
    execute format('revoke execute on function %s from public', r.sig);
    -- 3. any explicit anon grant
    execute format('revoke execute on function %s from anon', r.sig);

    insert into public._anon_execute_revoked_v500 (fn_signature)
    values (r.sig) on conflict do nothing;
  end loop;

  select count(*) into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not (p.proname = any (keep));

  select count(*) into v_kept
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  -- Fail loudly rather than half-applying: the first attempt was caught here.
  if v_left > 0 then
    raise exception 'V500 aborted: % definer functions still anon-executable', v_left;
  end if;
  if v_kept < 10 then
    raise exception 'V500 aborted: only % of the 10 allowlisted functions remain anon-executable - login or a public board would break', v_kept;
  end if;
end $mig$;

-- RULE (V480, and re-proved here): after creating any public function, check
--   has_function_privilege('anon', oid, 'EXECUTE')
-- Revoking from anon alone does NOT clear a PUBLIC grant, and revoking PUBLIC
-- alone strips authenticated unless it was granted explicitly first.
