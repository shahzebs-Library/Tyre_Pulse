-- Unknown-name flood and retention (after TEN-9f only).
do $$
declare i int; n int; k int := 0; locked_ok boolean;
begin
  perform public.t9f_reset();
  for i in 1..2000 loop perform public.record_login_failure('flood.' || i || '.' || md5(i::text)); end loop;
  select count(*) into n from public.login_attempts;
  perform public.t9f_ok(n = 2000, '12a 2000 made-up names make 2000 hashed rows (n=' || n || ')');
  perform public.t9f_ok(not exists (select 1 from public.login_attempts where identifier like '%flood%'),
    '12b the typed text is never stored');
  -- a live lock on a real account
  perform public.t9f_fail('alpha.manager', 5);
  -- age the flood rows past window + lock (30 min)
  update public.login_attempts set updated_at = now() - interval '31 minutes',
         window_started_at = now() - interval '31 minutes' where identifier like 'x:%';
  for i in 1..1000 loop
    k := k + 1;
    perform public.record_login_failure('later.name.' || k);
    select count(*) into n from public.login_attempts where identifier like 'x:%';
    exit when n < 100;
  end loop;
  perform public.t9f_ok(n < 100, '12c idle rows older than window + lock are purged (left ' || n || ' unknown rows after ' || k || ' calls)');
  locked_ok := public.t9f_locked('alpha.manager');
  perform public.t9f_ok(locked_ok, '12d a live lock survives the purge');
  perform public.t9f_reset();
end $$;
