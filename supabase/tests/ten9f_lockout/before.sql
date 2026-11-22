-- Production shape (before TEN-9f): reproduce the bypass. Each "BYPASS" line is the defect.
select public.t9f_reset();
select public.t9f_ok((public.t9f_fail('alpha.manager', 5)->>'locked')::boolean, 'B1 5 failures lock the typed username');
select public.t9f_ok(not public.t9f_locked('EMP-0002'),          'B2 BYPASS employee id still open after lock');
select public.t9f_ok(not public.t9f_locked('alpha.manager@staging.tyrepulse.invalid'), 'B3 BYPASS email still open after lock');
select public.t9f_ok(not public.t9f_locked('alpha-readymix/alpha.manager'),   'B4 BYPASS code/name still open after lock');
select public.t9f_ok(not public.t9f_locked('alpha-readymix / alpha.manager'), 'B5 BYPASS spaced code/name still open after lock');
select public.t9f_ok(public._resolve_sign_in_profile('alpha-readymix  /alpha.manager') = '63e831d7-f511-5432-976d-439af4ccaf18',
                     'B6 spacing variants resolve to the same account (unlimited counters)');
select public.t9f_reset();
select public.t9f_ok(public.record_login_failure('no.such.person') ? 'remaining' = false
                     and public.record_login_failure('alpha.driver') ? 'remaining',
                     'B7 ORACLE unknown name answers without remaining, real name with remaining');
select public.t9f_ok(not (public.t9f_fail('no.such.person', 6)->>'locked')::boolean,
                     'B8 ORACLE unknown name never locks, real names do');
select public.t9f_reset();
