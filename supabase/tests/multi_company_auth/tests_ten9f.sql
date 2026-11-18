-- TEN-9f (lockout per account). LOCAL staging copy with TEN-9f applied. Rolled back.
-- Without TEN-9f, check 9b fails: each spelling has its own counter.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set BETA_ADMIN '9c149942-c3b2-54c6-a6e8-c34b2933bb3c'

begin;
update public.system_config set value = '5' where key = 'max_login_attempts';
delete from public.login_attempts;
select public.record_login_failure('beta-haulage/beta.admin') \g /dev/null
select public.record_login_failure(' BETA-HAULAGE / beta.admin ') \g /dev/null
select public.record_login_failure('beta-haulage\beta.admin') \g /dev/null
select public.record_login_failure('beta.admin') \g /dev/null
select tt.ok('9a four spellings of one account are four failures of that account',
  (select attempt_count from public.login_attempts where identifier = 'u:' || :'BETA_ADMIN') = 4
  and not (public.login_attempt_status('emp-0008') ? 'remaining'), public.login_attempt_status('emp-0008')::text);
select public.record_login_failure('BETA.ADMIN@staging.tyrepulse.invalid') \g /dev/null
select tt.ok('9b the fifth failure (by email) locks every spelling',
  (public.login_attempt_status('beta-haulage /beta.admin') ->> 'locked')::boolean
  and (public.login_attempt_status('beta.admin') ->> 'locked')::boolean
  and (public.login_attempt_status('EMP-0008') ->> 'locked')::boolean);
select tt.ok('9c one row, keyed on the account, no typed text stored',
  (select count(*) from public.login_attempts) = 1
  and exists (select 1 from public.login_attempts where identifier = 'u:' || :'BETA_ADMIN'));
select tt.ok('9d another account is untouched', not (public.login_attempt_status('alpha.admin') ->> 'locked')::boolean);
create temp table t9e on commit drop as select public.record_login_failure('nobody.x') r;
-- separate statement: a function's write is not visible to the statement that called it
select tt.ok('9e an unknown name gets its own hashed counter, not locked on its first failure',
  (select (r ->> 'locked')::boolean = false from t9e)
  and (select count(*) from public.login_attempts) = 2
  and not exists (select 1 from public.login_attempts where identifier like '%nobody%'));
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'BETA_ADMIN', 'role', 'authenticated', 'aal', 'aal1')::text, true) \g /dev/null
select public.reset_login_attempts() \g /dev/null
reset role;
select tt.ok('9f a successful sign-in (reset_login_attempts) clears the account counter',
  not exists (select 1 from public.login_attempts where identifier = 'u:' || :'BETA_ADMIN'));
select tt.ok('9g the key helper is not callable by clients',
  not has_function_privilege('anon', 'public._login_attempt_key(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public._login_attempt_key(text)', 'EXECUTE'));
select tt.ok('9h the lockout RPCs stay callable by anon (pre-sign-in)',
  has_function_privilege('anon', 'public.login_attempt_status(text)', 'EXECUTE')
  and has_function_privilege('anon', 'public.record_login_failure(text)', 'EXECUTE'));
rollback;
