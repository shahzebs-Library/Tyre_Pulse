-- V546  COUNTRY GUARD ON THE SEVEN `LANGUAGE sql` RPCs V545 COULD NOT REACH
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A).
--
-- V545 closed the plpgsql half of this leak and stated plainly that seven
-- functions in the same family were still open, because a LANGUAGE sql body
-- cannot carry an `if` guard. This closes those seven.
--
-- THE LEAK, REPRODUCED BEFORE ANYTHING WAS CHANGED. Impersonating the real
-- approved KSA-only Manager 34793423-43df-4b6f-9270-9d1e8be6fa30, for whom
-- app_can_see_country('UAE') is false and a direct read of UAE tyre_records and
-- UAE parts_consumption both return 0 rows - so RLS itself is intact:
--
--   get_country_kpi('UAE')          -> 1 row: 2,455 tyre records, AED 424,468, 3 sites
--   get_expense_by_site('UAE')      -> 5 sites, AED 15,631,823 total, AED 3,931,751 tyre, 59,810 lines
--   get_tyre_cost_by_asset('UAE')   -> 246 assets, AED 3,931,756, 3,008 lines
--   get_brand_size_cpk('UAE')       -> 8 rows (Longmarch 315/80 R 22.5, 801 tyres, AED 738.12, cpk 0.01565)
--   report_asset_metrics('UAE')     -> 170 assets (TM204: 47 records, AED 9,896.47)
--   report_asset_overview('UAE')    -> 170 assets (TM204: health 24, ytd AED 2,170)
--   report_tyre_summary('UAE')      -> 2,455 records, AED 424,467.79, 170 distinct assets
--
-- Every one of the seven leaked. None already returned empty.
--
-- THE GUARD, and why it carries an 'All' exemption. Measured on the same user:
-- app_can_see_country('All') is FALSE - 'All' is the app's own all-countries
-- SENTINEL, not a country anyone is scoped to. report_asset_metrics,
-- report_asset_overview and report_tyre_summary default p_country to 'All' and
-- treat it exactly as they treat NULL. A guard without the exemption would have
-- refused the all-countries view to every country-scoped user in the app. So:
--
--   (p_country is null or p_country = 'All' or public.app_can_see_country(p_country))
--
-- TWO SHAPES, chosen per function rather than one blanket rewrite:
--
--  (b) PREDICATE, staying LANGUAGE sql - six functions. The guard is ANDed onto
--      the single WHERE that already filters on p_country, so a forbidden
--      country yields no rows at all. For the three TABLE-returning functions
--      that is ZERO ROWS; for the three that aggregate to a jsonb ARRAY it is
--      `[]` through their own existing coalesce. Both are the honest refusal for
--      their shape, and neither changes the payload contract their clients read.
--      Nothing is invented: no row, no zeroed figure.
--
--  (a) PLPGSQL CONVERSION - report_tyre_summary only. It returns a jsonb OBJECT
--      built from an aggregate with no GROUP BY, so an empty input still yields
--      one row: {"total_records":0,"total_cost":0,...}. That is not a refusal, it
--      is a false measurement - it asserts UAE has no tyres and no spend. So this
--      one becomes plpgsql and returns {"ok":false,"reason":"forbidden"}, the same
--      shape the 18 already-guarded functions and V545's eight use. Verified
--      client-safe: every consumer reads it as Number(s.x) || 0 and (s.y || [])
--      (Dashboard.jsx, Analytics.jsx, ReportCenter.jsx), so a marker degrades to
--      the same empty render a zeroed object would have produced, while staying
--      distinguishable from real emptiness.
--
-- NOTHING IS RETYPED. Each function is rebuilt from its own LIVE definition:
-- PART A does a single anchored replace and ABORTS unless the anchor occurs
-- EXACTLY ONCE; PART B lifts the body text between the $function$ delimiters and
-- takes its signature from pg_get_function_arguments/pg_get_function_result, so
-- no argument, default or line of SQL passes through a human. Both parts abort
-- if a target already mentions app_can_see_country - that would mean another
-- change landed underneath this one, and clobbering it blind is how half a
-- boundary ships (the V396 lesson).
--
-- VERIFIED AFTER, by impersonation, in rolled-back transactions:
--   * KSA-only Manager asking for UAE: 0 rows / [] / forbidden on all seven.
--   * The SAME user asking for KSA: md5 of the full ordered payload is
--     BYTE-IDENTICAL to the pre-change capture on all seven.
--   * p_country NULL, and 'All' on the three sentinel functions: byte-identical.
--   * Super admin still reads UAE; the 3-country user still reads KSA/UAE/Egypt,
--     both byte-identical to before.
--
-- STILL OPEN, STATED RATHER THAN HIDDEN - this migration does NOT close either:
--   1. THE ALL-COUNTRIES PATH. p_country NULL or 'All' still returns every
--      country to a country-scoped caller, because these functions carry no
--      row-level country filter at all: the KSA-only Manager reads 11,191 tyre
--      records and 553 assets from report_tyre_summary('All') while KSA alone is
--      8,145 / 370. Closing it means filtering rows by app_can_see_country(country)
--      on the all-scope, which CHANGES what every existing all-countries caller
--      sees. That is a product decision, not a guard, and is deliberately left.
--   2. NO ORG SCOPING on get_country_kpi, report_tyre_summary, report_asset_metrics
--      and report_asset_overview - they read tyre_records with no organisation_id
--      predicate, so the super admin and the 3-country user return the identical
--      md5 for UAE. Bounded today because effectively one org holds data, but it
--      is a real cross-tenant hole. Adding an org filter would change results for
--      a permitted country, which this migration is required not to do.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v546, which holds the
-- exact prior definition text.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v546;
create table _bak.rpc_defs_v546 (proname text, def text, saved_at timestamptz default now());


-- ============================================================================
-- PART A - six LANGUAGE sql functions get the guard as a WHERE predicate.
-- ============================================================================
do $mig$
declare
  r       record;
  oid_    oid;
  nfound  int;
  def     text;
  newdef  text;
  occ     int;
  n       int := 0;
  guard   text := ' and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))';
begin
  for r in
    select * from (values
      ('get_country_kpi',        'where (p_country is null or t.country = p_country)'),
      ('get_expense_by_site',    'AND (p_country IS NULL OR pc.country = p_country)'),
      ('get_tyre_cost_by_asset', 'AND (p_country IS NULL OR country = p_country)'),
      ('get_brand_size_cpk',     'and (p_country is null or country = p_country)'),
      ('report_asset_metrics',   'WHERE (p_country = ''All'' OR p_country IS NULL OR country = p_country OR country IS NULL)'),
      ('report_asset_overview',  'WHERE (p_country = ''All'' OR p_country IS NULL OR country = p_country OR country IS NULL)')
    ) v(pname, anchor)
  loop
    select count(*), min(p.oid) into nfound, oid_
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = r.pname;

    if nfound <> 1 then
      raise exception 'V546: expected exactly 1 public.% , found %', r.pname, nfound;
    end if;

    def := pg_get_functiondef(oid_);

    if position('app_can_see_country' in def) > 0 then
      raise exception 'V546: public.% already references app_can_see_country - refusing to overwrite', r.pname;
    end if;
    if position('LANGUAGE sql' in def) = 0 then
      raise exception 'V546: public.% is no longer LANGUAGE sql', r.pname;
    end if;

    -- The anchor must be unique, or the guard could land in the wrong clause.
    occ := (length(def) - length(replace(def, r.anchor, ''))) / length(r.anchor);
    if occ <> 1 then
      raise exception 'V546: anchor for % matched % times, expected exactly 1', r.pname, occ;
    end if;

    insert into _bak.rpc_defs_v546 (proname, def) values (r.pname, def);

    newdef := replace(def, r.anchor, r.anchor || guard);
    if position('app_can_see_country' in newdef) = 0 then
      raise exception 'V546: guard not inserted on %', r.pname;
    end if;

    execute newdef;
    n := n + 1;
  end loop;

  if n <> 6 then
    raise exception 'V546 PART A: expected to guard 6 functions, guarded %', n;
  end if;
  raise notice 'V546 PART A: guarded % functions by predicate', n;
end
$mig$;


-- ============================================================================
-- PART B - report_tyre_summary converts to plpgsql so it can REFUSE rather than
-- report a zeroed summary. Body and signature are lifted from the live
-- definition; nothing is retyped.
-- ============================================================================
do $mig$
declare
  oid_    oid;
  nfound  int;
  def     text;
  body    text;
  newdef  text;
  b0      int;
  gplpg   text := E'  if p_country is not null and p_country <> ''All'' and not public.app_can_see_country(p_country) then\n    return jsonb_build_object(''ok'', false, ''reason'', ''forbidden'');\n  end if;';
begin
  select count(*), min(p.oid) into nfound, oid_
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'report_tyre_summary';

  if nfound <> 1 then
    raise exception 'V546: expected exactly 1 public.report_tyre_summary, found %', nfound;
  end if;

  def := pg_get_functiondef(oid_);

  if position('app_can_see_country' in def) > 0 then
    raise exception 'V546: report_tyre_summary already references app_can_see_country - refusing to overwrite';
  end if;
  if position('LANGUAGE sql' in def) = 0 then
    raise exception 'V546: report_tyre_summary is no longer LANGUAGE sql';
  end if;
  if pg_get_function_result(oid_) <> 'jsonb' then
    raise exception 'V546: report_tyre_summary no longer returns jsonb';
  end if;

  insert into _bak.rpc_defs_v546 (proname, def) values ('report_tyre_summary', def);

  -- Lift the body from between the $function$ delimiters.
  b0 := position('AS $function$' in def);
  if b0 = 0 then
    raise exception 'V546: no AS $function$ delimiter on report_tyre_summary';
  end if;
  body := substring(def from b0 + length('AS $function$'));
  body := rtrim(body, E' \t\r\n');
  if right(body, 10) <> '$function$' then
    raise exception 'V546: body does not end at the closing $function$ delimiter';
  end if;
  body := rtrim(left(body, length(body) - 10), E' \t\r\n');
  -- The body is one SELECT; drop its terminating semicolon so it can be wrapped
  -- as the scalar expression of a plpgsql RETURN.
  if right(body, 1) = ';' then
    body := rtrim(left(body, length(body) - 1), E' \t\r\n');
  end if;
  if position('jsonb_build_object' in body) = 0 then
    raise exception 'V546: extracted body does not look like the summary query';
  end if;

  -- Every fragment MUST carry the E prefix (in a plain literal `\n` is a
  -- backslash and an n, and the generated CREATE would not parse) and they MUST
  -- be joined with || - an E'' literal cannot be continued by adjacency.
  newdef := format(
    E'CREATE OR REPLACE FUNCTION public.report_tyre_summary(%s)\n'
    || E' RETURNS %s\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''public''\n'
    || E'AS $function$\nbegin\n%s\n  return (\n%s\n  );\nend\n$function$',
    pg_get_function_arguments(oid_), pg_get_function_result(oid_), gplpg, body);

  execute newdef;

  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
      where ns.nspname = 'public' and p.proname = 'report_tyre_summary'
        and l.lanname = 'plpgsql' and p.prosecdef
        and position('app_can_see_country' in pg_get_functiondef(p.oid)) > 0) <> 1 then
    raise exception 'V546 PART B: report_tyre_summary did not come back guarded plpgsql SECURITY DEFINER';
  end if;

  raise notice 'V546 PART B: report_tyre_summary converted to guarded plpgsql';
end
$mig$;


-- ============================================================================
-- PART C - make the execute grants explicit on all seven. Order is load-bearing
-- (the V500 lesson): grant the real callers FIRST, then revoke PUBLIC, then
-- revoke anon BY NAME - a revoke from anon alone does not clear a PUBLIC grant,
-- and revoking PUBLIC first would strip authenticated where it had no grant of
-- its own.
-- ============================================================================
do $mig$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in ('get_country_kpi','report_tyre_summary','get_expense_by_site',
                        'get_tyre_cost_by_asset','report_asset_metrics','report_asset_overview',
                        'get_brand_size_cpk')
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    n := n + 1;
  end loop;

  if n <> 7 then
    raise exception 'V546 PART C: expected 7 functions, adjusted %', n;
  end if;
  raise notice 'V546 PART C: grants pinned on % functions', n;
end
$mig$;


-- ============================================================================
-- FINAL ASSERTION - all seven guarded, still SECURITY DEFINER, search_path still
-- pinned, anon still unable to execute. Aborts the whole migration otherwise.
-- ============================================================================
do $mig$
declare
  bad text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('get_country_kpi','report_tyre_summary','get_expense_by_site',
                      'get_tyre_cost_by_asset','report_asset_metrics','report_asset_overview',
                      'get_brand_size_cpk')
    -- '''All''' proves the all-countries sentinel is still exempted: PART A
    -- writes `p_country = 'All'`, PART B writes `p_country <> 'All'`.
    and (position('app_can_see_country' in pg_get_functiondef(p.oid)) = 0
         or position('''All''' in pg_get_functiondef(p.oid)) = 0
         or not p.prosecdef
         or p.proconfig is null
         or has_function_privilege('anon', p.oid, 'EXECUTE')
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if bad is not null then
    raise exception 'V546: post-check failed on: %', bad;
  end if;
  raise notice 'V546: all seven guarded, definer, search_path pinned, anon revoked';
end
$mig$;
