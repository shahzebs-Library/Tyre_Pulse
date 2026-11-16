-- Timing of the two anonymous sign-in RPCs: real account vs unknown name.
-- Prints "timing - <case> <ms per call>". Lockout raised so nothing locks mid-run.
update public.system_config set value='1000000' where key='max_login_attempts';
do $$
declare t0 timestamptz; i int; n int := 400; c text; ids text[] := array[
  'alpha.manager','no.such.user','alpha.manager@users.tyrepulse.app','nobody@nowhere.example'];
begin
  perform public.t9f_reset();
  foreach c in array ids loop perform public.login_attempt_status(c); perform public.record_login_failure(c); end loop;
  foreach c in array ids loop
    t0 := clock_timestamp();
    for i in 1..n loop perform public.login_attempt_status(c); end loop;
    raise notice 'timing - status  % % ms', rpad(c,36), round((extract(epoch from clock_timestamp()-t0)*1000/n)::numeric,3);
    t0 := clock_timestamp();
    for i in 1..n loop perform public.record_login_failure(c); end loop;
    raise notice 'timing - failure % % ms', rpad(c,36), round((extract(epoch from clock_timestamp()-t0)*1000/n)::numeric,3);
  end loop;
  perform public.t9f_reset();
end $$;
update public.system_config set value='5' where key='max_login_attempts';
