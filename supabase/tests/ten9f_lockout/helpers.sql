-- Test helpers for the TEN-9f staging suite. LOCAL staging only.
create or replace function public.t9f_ok(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'ok - %', p_name;
  else raise notice 'not ok - %', p_name; end if;
end $$;
grant execute on function public.t9f_ok(boolean, text) to authenticated, anon;

-- Run N failures for one spelling, return the last response.
create or replace function public.t9f_fail(p_id text, p_n int) returns jsonb
language plpgsql as $$
declare r jsonb; i int;
begin
  for i in 1..p_n loop r := public.record_login_failure(p_id); end loop;
  return r;
end $$;

create or replace function public.t9f_locked(p_id text) returns boolean
language sql as $$ select coalesce((public.login_attempt_status(p_id)->>'locked')::boolean, false) $$;

create or replace function public.t9f_reset() returns void
language sql as $$ truncate public.login_attempts $$;
