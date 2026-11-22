-- After TEN-9f. Every line must read "ok".
-- Staging fixture ids (synthetic): alpha.manager 63e831d7..., alpha.driver 3fb6796c...,
-- alpha.admin af52a86f..., beta.admin 9c149942..., platform.superadmin 5eacf3d3...

-- 1. Spellings share one counter ---------------------------------------------
select public.t9f_reset();
select public.t9f_ok((public.t9f_fail('alpha.manager', 5)->>'locked')::boolean, '1a 5 failures lock the account');
select public.t9f_ok(public.t9f_locked('alpha.manager'),  '1b username locked');
select public.t9f_ok(public.t9f_locked('ALPHA.MANAGER '), '1c case/space variant locked');
select public.t9f_ok(public.t9f_locked('EMP-0002'),       '1d employee id locked');
select public.t9f_ok(public.t9f_locked('alpha.manager@staging.tyrepulse.invalid'), '1e email locked');
select public.t9f_ok(public.t9f_locked('alpha-readymix/alpha.manager'),   '1f code/name locked');
select public.t9f_ok(public.t9f_locked('alpha-readymix / alpha.manager'), '1g spaced code/name locked');
select public.t9f_ok(public.t9f_locked(E'alpha-readymix\\alpha.manager'), '1h backslash form locked');
select public.t9f_ok((select count(*) from public.login_attempts) = 1,    '1i one row for the account');
select public.t9f_ok((select identifier from public.login_attempts) = 'u:63e831d7-f511-5432-976d-439af4ccaf18',
                     '1j row keyed by account id, no typed text stored');

select public.t9f_reset();
select public.record_login_failure('alpha.manager');
select public.record_login_failure('EMP-0002');
select public.record_login_failure('alpha.manager@staging.tyrepulse.invalid');
select public.record_login_failure('alpha-readymix/alpha.manager');
select public.t9f_ok((public.record_login_failure('alpha-readymix / alpha.manager')->>'locked')::boolean,
                     '1k rotating spellings: 5th failure locks');

-- 2. Same experience for a person typing one spelling --------------------------
select public.t9f_reset();
select public.t9f_ok(public.t9f_fail('alpha.driver', 4) = '{"enabled": true, "locked": false}'::jsonb, '2a failures 1-4 not locked');
select public.t9f_ok((public.record_login_failure('alpha.driver')->>'retry_after_seconds')::int = 900, '2b 5th locks for 15 minutes');
select public.t9f_ok((public.login_attempt_status('alpha.driver')->>'retry_after_seconds')::int between 890 and 900, '2c status reports time left');
select public.t9f_ok((public.record_login_failure('alpha.driver')->>'locked')::boolean, '2d further failures keep the lock');
update public.login_attempts set locked_until = now() - interval '1 second',
       window_started_at = now() - interval '16 minutes';
select public.t9f_ok(not public.t9f_locked('alpha.driver'), '2e lock expires after 15 minutes');
select public.t9f_ok(public.record_login_failure('alpha.driver') = '{"enabled": true, "locked": false}'::jsonb, '2f first failure after expiry not locked');
-- separate statement: a function's write is not visible to the statement that called it
select public.t9f_ok((select attempt_count from public.login_attempts) = 1
                     and (select locked_until from public.login_attempts) is null, '2g fresh window after expiry');

-- 3. Account enumeration -------------------------------------------------------
select public.t9f_reset();
select public.t9f_ok(public.login_attempt_status('alpha.tyreman') = public.login_attempt_status('nobody.here'),
                     '3a status identical for real and unknown names');
select public.t9f_ok(public.record_login_failure('alpha.tyreman') = public.record_login_failure('nobody.here'),
                     '3b failure response identical for real and unknown names');
select public.t9f_ok(public.t9f_fail('alpha.tyreman', 4) = public.t9f_fail('nobody.here', 4),
                     '3c both lock on the same attempt with the same response');
select public.t9f_ok(not exists (select 1 from public.login_attempts where identifier like '%nobody%'),
                     '3d unknown text not stored in clear');
select public.t9f_ok(not (public.record_login_failure('x') ? 'remaining') and not (public.login_attempt_status('x') ? 'remaining'),
                     '3e no remaining-attempts key returned');

-- 4. Account switching ---------------------------------------------------------
select public.t9f_reset();
select public.t9f_fail('alpha.manager', 5);
select public.t9f_ok(not public.t9f_locked('alpha.inspector'), '4a another account on the same device is not locked');
select public.t9f_ok(not public.t9f_locked('beta.manager'),    '4b another company account not locked');

-- 5. Successful sign-in clears the account counter (and legacy text rows) -----
select public.t9f_reset();
select public.t9f_fail('alpha.engineer', 3);
insert into public.login_attempts(identifier, attempt_count, window_started_at, updated_at)
values ('emp-0004', 2, now(), now()), ('alpha.engineer@staging.tyrepulse.invalid', 2, now(), now());
begin;
select set_config('request.jwt.claims', '{"sub":"2092b3bc-43f1-5167-b49d-b1fd7dc47fd8","role":"authenticated"}', true);
set local role authenticated;
select public.reset_login_attempts();
commit;
select public.t9f_ok((select count(*) from public.login_attempts) = 0, '5a reset clears account row and legacy text rows');

-- 6. Administrator recovery ----------------------------------------------------
select public.t9f_reset();
select public.t9f_fail('alpha.manager', 5);
-- 6a anon cannot call it
begin; set local role anon;
select public.t9f_ok(not has_function_privilege('anon', 'public.admin_clear_login_lock(uuid,text)', 'EXECUTE'), '6a anon has no execute');
rollback;
-- 6b a Driver is refused
begin;
select set_config('request.jwt.claims', '{"sub":"3fb6796c-609c-5a94-9933-9bc02d7fc9b8","role":"authenticated"}', true);
set local role authenticated;
select public.t9f_ok(public.admin_clear_login_lock('63e831d7-f511-5432-976d-439af4ccaf18','driver tries') ->> 'reason' = 'forbidden', '6b driver refused');
rollback;
-- 6c Admin of ANOTHER company is refused
begin;
select set_config('request.jwt.claims', '{"sub":"9c149942-c3b2-54c6-a6e8-c34b2933bb3c","role":"authenticated"}', true);
set local role authenticated;
select public.t9f_ok(public.admin_clear_login_lock('63e831d7-f511-5432-976d-439af4ccaf18','other company') ->> 'reason' = 'forbidden', '6c admin of another company refused');
select public.t9f_ok(public.admin_login_lock_status('63e831d7-f511-5432-976d-439af4ccaf18') ->> 'reason' = 'forbidden', '6d status refused for other company');
rollback;
select public.t9f_ok(public.t9f_locked('alpha.manager'), '6e still locked after refused attempts');
-- 6f same-company Admin: reason required, then clears, audited
begin;
select set_config('request.jwt.claims', '{"sub":"af52a86f-2c24-5ce2-a00d-7ac6ca5d715f","role":"authenticated"}', true);
set local role authenticated;
select public.t9f_ok((public.admin_login_lock_status('63e831d7-f511-5432-976d-439af4ccaf18') ->> 'locked')::boolean, '6f admin sees the lock');
select public.t9f_ok(public.admin_clear_login_lock('63e831d7-f511-5432-976d-439af4ccaf18','  ') ->> 'reason' = 'reason_required', '6g blank reason refused');
select public.t9f_ok((public.admin_clear_login_lock('63e831d7-f511-5432-976d-439af4ccaf18','Verified by phone with the user') ->> 'cleared')::int = 1, '6h admin clears the lock');
commit;
select public.t9f_ok(not public.t9f_locked('alpha.manager'), '6i account usable again');
select public.t9f_ok(exists (select 1 from public.access_audit
                              where action = 'login_lock_cleared'
                                and target_user = '63e831d7-f511-5432-976d-439af4ccaf18'
                                and actor = 'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'
                                and reason = 'Verified by phone with the user'
                                and before is not null), '6j clear written to access_audit with before state');
-- 6k platform super admin can clear any company
select public.t9f_fail('beta.manager', 5);
begin;
select set_config('request.jwt.claims', '{"sub":"5eacf3d3-29af-5995-bc52-bcef51b82c38","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.t9f_ok((public.admin_clear_login_lock('cb2ee8ae-520a-5a55-818e-7786a74bfda8','Super admin support ticket') ->> 'ok')::boolean, '6k super admin clears another company');
commit;
select public.t9f_ok(not public.t9f_locked('beta.manager'), '6l beta.manager usable again');

-- 7. Lockout switched off ------------------------------------------------------
select public.t9f_reset();
update public.system_config set value = '0' where key = 'max_login_attempts';
select public.t9f_ok(public.t9f_fail('alpha.manager', 8) = '{"enabled": false, "locked": false}'::jsonb, '7a max_login_attempts=0 never locks');
update public.system_config set value = '5' where key = 'max_login_attempts';

-- 8. Grants --------------------------------------------------------------------
select public.t9f_ok(not has_function_privilege('anon','public._login_attempt_key(text)','EXECUTE')
                 and not has_function_privilege('authenticated','public._login_attempt_key(text)','EXECUTE'), '8a key helper not callable');
select public.t9f_ok(has_function_privilege('anon','public.login_attempt_status(text)','EXECUTE')
                 and has_function_privilege('anon','public.record_login_failure(text)','EXECUTE'), '8b pre-sign-in RPCs still callable by anon');
select public.t9f_ok(not has_function_privilege('anon','public.reset_login_attempts()','EXECUTE'), '8c reset not callable by anon');
select public.t9f_ok(not has_function_privilege('anon','public.admin_login_lock_status(uuid)','EXECUTE'), '8d admin status not callable by anon');
select public.t9f_reset();
