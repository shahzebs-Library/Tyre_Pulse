-- Rollback test for migrations 20261109160000 + 20261109170000 (Phase 1 lifetime CPK).
-- ONE statement = ONE transaction, always ends in RAISE EXCEPTION, so nothing is saved.
-- Run in the Supabase SQL editor; the result is in the error text ("ROLLBACK_TEST_RESULT").
-- Checks: the rollback removes exactly the new objects, no other function or any data changes,
-- and re-creating the objects from their live definitions gives the same answer as before.
do $t$
declare
  other_fns_sql text := $q$select md5(string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid)),'|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and p.proname <> 'get_tyre_lifetime_cpk'$q$;
  data_sql text := $q$select (select count(*)||':'||md5(string_agg(id::text||coalesce(serial_no,'')||coalesce(status,'')||coalesce(removal_date::text,'')||coalesce(cost_per_tyre::text,'')||coalesce(km_at_removal::text,'')||coalesce(total_km::text,''),'|' order by id)) from tyre_records)
    ||'#'||(select count(*)||':'||round(sum(line_cost),2) from parts_consumption)
    ||'#'||(select count(*) from tyre_price_backfill_log)||'#'||(select count(*) from tyre_cost_corrections)$q$;
  answer_sql text := $q$select md5(public.get_tyre_lifetime_cpk()::text)$q$;
  f0 text; f1 text; d0 text; d1 text; d2 text; a0 text; a2 text;
  def_fit text; def_life text; def_fn text; left_objects int;
begin
  execute other_fns_sql into f0; execute data_sql into d0; execute answer_sql into a0;
  def_fit := pg_get_viewdef('public.v_tyre_lifetime_fitments'::regclass);
  def_life := pg_get_viewdef('public.v_tyre_lifetime'::regclass);
  def_fn := pg_get_functiondef('public.get_tyre_lifetime_cpk(text,date,date,text)'::regprocedure);

  -- ROLLBACK as written in the migration headers
  drop function if exists public.get_tyre_lifetime_cpk(text, date, date, text);
  drop view if exists public.v_tyre_lifetime;
  drop view if exists public.v_tyre_lifetime_fitments;
  drop table if exists public.tyre_price_provenance;

  execute other_fns_sql into f1; execute data_sql into d1;
  select count(*) into left_objects from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('v_tyre_lifetime','v_tyre_lifetime_fitments','tyre_price_provenance');
  left_objects := left_objects + (select count(*) from pg_proc where proname = 'get_tyre_lifetime_cpk');

  -- RESTORE from the live definitions (provenance table not needed for the views to compile:
  -- re-create it empty with the same columns so v_tyre_lifetime resolves)
  create table public.tyre_price_provenance (tyre_id uuid primary key, organisation_id uuid not null, country text,
    source text not null, amount numeric not null, origin_tyre_id uuid, reason text not null, created_at timestamptz default now());
  execute 'create view public.v_tyre_lifetime_fitments with (security_invoker = on) as ' || def_fit;
  execute 'create view public.v_tyre_lifetime with (security_invoker = on) as ' || def_life;
  execute def_fn;
  execute data_sql into d2;

  raise exception 'ROLLBACK_TEST_RESULT %', jsonb_build_object(
    'PASS', left_objects = 0 and f1 = f0 and d1 = d0 and d2 = d0,
    'objects_left_after_rollback', left_objects,
    'other_functions_unchanged', f1 = f0,
    'data_unchanged_after_rollback', d1 = d0,
    'data_unchanged_after_restore', d2 = d0,
    'answer_before', a0,
    'data_fp', d0)::text;
end $t$;
