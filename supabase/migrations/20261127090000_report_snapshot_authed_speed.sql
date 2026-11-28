-- get_report_snapshot_authed: stop reading all history for 12-month trends.
--
-- STATUS: APPLIED LIVE 2026-11-27 (recorded as 20261127153903 report_snapshot_authed_speed).
--
-- Why: the phone Financial report failed with "the server did not answer in
-- time". As the super admin (all countries, last 90 days) the function took
-- 5.4 s warm, against the authenticated statement_timeout of 8 s, so a cold
-- cache goes over. Timed part by part (2026-11-27, live, read only):
--   production_logs monthly trend, all history ......... 3104 ms -> 74 ms
--   work_orders maintenance cost, coalesce() date ...... 1372 ms -> 95 ms
--   (same total both ways: 261469.71)
-- The trends only ever join the last 12 months (v_months), so rows older
-- than the window never reached the output; the new predicates only let
-- the planner skip them. The maintenance prefilter
-- (completed_at>=X or opened_at>=X or created_at>=X) is a superset of
-- coalesce(completed_at,opened_at,created_at)>=X and the exact predicate is
-- kept, so the result cannot change.
--
-- Method: anchored text replacement of the LIVE definition; aborts unless
-- every anchor matches exactly once. Org, country and site checks untouched.
--
-- Rollback: re-run the previous definition (pg_get_functiondef saved by
-- this migration in _bak.report_snapshot_authed_v20261127).

begin;

create schema if not exists _bak;
create table if not exists _bak.report_snapshot_authed_v20261127 as
  select now() as saved_at, pg_get_functiondef('public.get_report_snapshot_authed(text,text,text,text)'::regprocedure) as def;

do $mig$
declare
  v_def text := pg_get_functiondef('public.get_report_snapshot_authed(text,text,text,text)'::regprocedure);
  a1 text := 'AND coalesce(completed_at,opened_at,created_at)::date>=v_cfrom';
  a2 text := 'FROM public.work_orders WHERE organisation_id=v_org AND (v_site';
  a3 text := 'FROM public.production_logs WHERE organisation_id=v_org AND (v_site';
  w  text := '(date_trunc(''month'', now()) - interval ''11 months'')';
  n int;
begin
  n := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'anchor 1 (maintenance cost) matched % times', n; end if;
  n := (length(v_def) - length(replace(v_def, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'anchor 2 (work order trend) matched % times', n; end if;
  n := (length(v_def) - length(replace(v_def, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'anchor 3 (production trend) matched % times', n; end if;

  v_def := replace(v_def, a1,
    'AND (completed_at>=v_cfrom OR opened_at>=v_cfrom OR created_at>=v_cfrom) ' || a1);
  v_def := replace(v_def, a2,
    'FROM public.work_orders WHERE organisation_id=v_org AND (completed_at>=' || w
    || ' OR opened_at>=' || w || ' OR created_at>=' || w || ') AND (v_site');
  v_def := replace(v_def, a3,
    'FROM public.production_logs WHERE organisation_id=v_org AND period_date>='
    || w || '::date AND (v_site');

  execute v_def;
end
$mig$;

commit;
