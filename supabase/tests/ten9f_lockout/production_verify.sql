-- TEN-9f production verification. Safe to run on production: the whole block ends in
-- RAISE EXCEPTION, so every counter row it writes is rolled back. Uses ONLY the demo
-- account (demo.manager, org "Tyre Pulse Demo Fleet", sign-in slug "demo").
-- Read the result from the error text: "RESULT: ...".
--
-- BEFORE applying: expect locked_username=true and the four other spellings false
--                  (this is the bypass).
-- AFTER applying:  expect every spelling true, unknown_shape_equal=true,
--                  remaining_key=false.
do $$
declare out text := ''; a jsonb; b jsonb; i int;
begin
  for i in 1..5 loop perform public.record_login_failure('demo.manager'); end loop;
  out := 'locked_username=' || (public.login_attempt_status('demo.manager')->>'locked');
  out := out || ' empid=' || (public.login_attempt_status('PLAY-DEMO-MGR')->>'locked');
  out := out || ' email=' || (public.login_attempt_status('demo.manager@users.tyrepulse.app')->>'locked');
  out := out || ' code_name=' || (public.login_attempt_status('demo/demo.manager')->>'locked');
  out := out || ' spaced=' || (public.login_attempt_status('demo /  demo.manager')->>'locked');
  a := public.record_login_failure('demo.manager.typo.zz');
  b := public.login_attempt_status('demo.manager.typo.zz');
  out := out || ' unknown_failure=' || a::text || ' unknown_status=' || b::text;
  out := out || ' remaining_key=' || ((a ? 'remaining') or (b ? 'remaining'))::text;
  raise exception 'RESULT: %', out;
end $$;

-- Grants and bodies after applying (read only):
-- select p.proname, md5(pg_get_functiondef(p.oid)),
--        has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('_login_attempt_key','login_attempt_status','record_login_failure',
--                      'reset_login_attempts','_login_lock_admin_ok',
--                      'admin_login_lock_status','admin_clear_login_lock')
--  order by 1;
