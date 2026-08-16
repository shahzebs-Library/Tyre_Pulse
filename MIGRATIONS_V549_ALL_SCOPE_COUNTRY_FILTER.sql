-- V549  THE ALL-COUNTRIES PATH: FILTER ROWS BY WHAT THE CALLER MAY SEE
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A).
--
-- V545 and V546 closed the NAMED-country path on fifteen SECURITY DEFINER
-- functions: ask for a country you are not scoped to and you are refused. They
-- both said in writing that they did NOT close the other half, and this closes
-- it.
--
-- THE HOLE. `p_country` NULL - and the app's own all-countries sentinel 'All' -
-- means "no country filter", and on that path these functions applied no
-- row-level country restriction of any kind. They are SECURITY DEFINER, so RLS
-- never ran. That is the DEFAULT path almost every screen uses, so it was the
-- most-used leak in the database, not an edge case.
--
-- MEASURED BEFORE ANYTHING WAS TOUCHED, by impersonating the real approved
-- KSA-only Manager 34793423 (country {KSA}) in rolled-back transactions, and
-- hashing the full ordered payload of each function on its all-scope default:
--
--   ON ALL FIFTEEN FUNCTIONS THE KSA-ONLY MANAGER'S md5 WAS BYTE-IDENTICAL TO
--   THE SUPER ADMIN'S. Not similar - identical. The functions did not merely
--   leak, they were incapable of telling the two callers apart.
--
--   probe                       what the KSA-only Manager was handed
--   -------------------------   ------------------------------------------------
--   get_parts_expense_snapshot  138,507,286 over 209,381 lines (all 3 countries)
--   get_maintenance_snapshot    89,628 job cards, 35,060,742 spend
--   report_tyre_summary         11,191 tyre records, 553 assets, 12,450,390.96
--   report_asset_metrics        553 assets      report_asset_overview  553 assets
--   get_cost_cpk_overview       47,691,132, currency (blended)
--   get_fleet_cpk               1,072 vehicles across 3 country rows
--   get_country_kpi             3 rows - one per country, KSA + UAE + Egypt
--   get_expense_by_site         39 sites        get_tyre_cost_by_asset 875 assets
--   get_brand_size_cpk          133 rows        get_cpk_drivers        5 segments
--   get_daily_job_cards         790 assets still out
--   list_scrapped_tyres         201 scrapped tyres
--   get_cost_variance           refuses already (see BEHAVIOUR CHANGES below)
--
-- KSA alone is 8,145 tyre records and SAR 3,679,183 of spend in the comparable
-- window. And the 138,507,286 is SAR + AED + EGP added together, which this
-- codebase holds to be meaningless - so the figure was simultaneously a
-- disclosure of two other countries and a number that is not a quantity of
-- anything.
--
--
-- THE FIX, AND THE ONE THING THAT WOULD HAVE BROKEN IT
--
-- The predicate is the RLS idiom this database adopted in V396, copied whole:
--
--   (<col> is null
--    or (select public.is_super_admin())
--    or (select public.app_sees_all_countries())
--    or lower(btrim(<col>)) = any(coalesce((select public.app_country_scope()),
--                                          '{}'::text[])))
--
-- `is_super_admin()` IS LOAD-BEARING AND IS NOT DECORATION. Measured on the live
-- profiles rows before writing a line of this migration:
--
--   user                  app_sees_all_countries()   app_country_scope()
--   -------------------   ------------------------   -------------------
--   KSA-only Manager      false                      {ksa}
--   3-country user        false                      {ksa,uae,egypt}
--   Egypt-only Director   false                      {egypt}
--   SUPER ADMIN           false                      {}          <-- note
--
-- The super admin's profiles.country is NULL, so app_sees_all_countries() is
-- false and app_country_scope() is empty for them. A predicate built only from
-- those two readers - the obvious shape - would have returned ZERO ROWS to the
-- platform owner on all fifteen reports. NOT ONE user on this database has
-- app_sees_all_countries() true; the super admin passes solely through
-- is_super_admin(). Never write this predicate without that term.
--
-- The zero-argument readers are used deliberately in preference to the
-- row-argument app_can_see_country(country). Written as `(select f())` they are
-- uncorrelated subqueries, so Postgres evaluates them ONCE per query as an
-- InitPlan. app_can_see_country takes the row value, cannot be hoisted, and is
-- SECURITY DEFINER so it can never be inlined - a per-row profiles lookup on
-- tables of 89k to 209k rows. That is the V396 lesson and it decided the shape.
--
--
-- WHERE THE PREDICATE WENT - and why four functions outside the named fifteen
-- are also rewritten. get_cost_cpk_overview and get_cost_variance read almost no
-- rows themselves: they delegate to the SECURITY DEFINER helpers _cost_totals,
-- _cost_cpk, _cost_dim and _cost_var_dim, which are where parts_consumption is
-- actually scanned. Guarding only the two entry points would have moved the
-- boundary somewhere it does nothing. _cost_cpk additionally sums the km
-- denominator out of fleet_km_by_asset, so an unfiltered call there would divide
-- one country's cost by three countries' distance.
--
-- get_fleet_cpk and get_cpk_drivers draw their distance from
-- fleet_tyre_km_by_asset and fleet_hours_by_asset. Both RETURN country, so the
-- filter is applied at the call site in the consuming CTE rather than inside
-- those functions - deliberately, because fleet_tyre_km_by_asset belongs to the
-- V548 change landing in parallel and this migration must not edit it.
--
-- 31 replacements over 19 functions. Every one is a `replace()` against the
-- function's own LIVE pg_get_functiondef output - no body is retyped - and every
-- one ABORTS unless its anchor occurs EXACTLY the expected number of times.
-- Three anchors are deliberately expected more than once (get_cost_cpk_overview
-- reads parts_consumption in three places, get_cost_variance in two); replacing
-- all occurrences is the point there, and the count is asserted so a body that
-- gains or loses a read cannot pass silently. A partial run is the failure that
-- matters: half a boundary reads as a closed one.
--
--
-- VERIFIED AFTER, by impersonation, all in rolled-back transactions first:
--
--   * SUPER ADMIN: md5 BYTE-IDENTICAL to the pre-change capture on all fifteen.
--   * 3-COUNTRY USER: md5 BYTE-IDENTICAL on all fifteen. Their scope
--     {ksa,uae,egypt} covers every country value that exists, so the predicate
--     admits every row - which is the correct proof that it filters by scope and
--     not by accident.
--   * KSA-ONLY MANAGER: all-scope now returns KSA only. Where the function's
--     shape allows the comparison, their all-scope result is md5-IDENTICAL to
--     their own KSA-scope result - the strongest available check.
--   * EGYPT-ONLY DIRECTOR: still returns their own Egypt data, not nothing.
--
--
-- BEHAVIOUR CHANGES THAT ARE CORRECTIONS, STATED RATHER THAN BURIED
--
-- 1. get_cost_cpk_overview and get_cost_variance decide their currency from
--    `select count(distinct country)` over the rows in scope. Once that count is
--    scoped, a KSA-only Manager sees 1 country instead of 3, so those reports
--    stop declaring themselves "blended" and report in SAR. get_cost_variance
--    previously took its early return - "Spend spans more than one currency,
--    choose a country" - and returned NO data at all on the all-scope; it now
--    returns the full KSA decomposition. That is MORE data than before, and it
--    is not new disclosure: it is exactly what get_cost_variance('KSA') already
--    returned to that same user through the V545 named path.
--
-- 2. get_country_kpi's open_actions / overdue_actions sub-selects only bounded
--    corrective_actions by country when p_country was given, so on the all-scope
--    they counted every country's actions. They are now scoped too.
--
--
-- NOT DONE, AND NOT BECAUSE IT WAS MISSED - ORG SCOPING
--
-- get_country_kpi, report_tyre_summary, report_asset_metrics and
-- report_asset_overview read tyre_records with NO organisation_id predicate.
-- That is the TENANT wall, and it is a more serious class than country. The
-- claim was verified: before this change the Egypt-only Director - who is a
-- member of organisation e340fa7a, NOT of Company A - got byte-identical super
-- admin output from all four.
--
-- Adding `organisation_id = app_current_org()` was tested and is NOT a no-op, so
-- it is NOT applied here. Every row in tyre_records belongs to Company A, and
-- the Egypt Director's app_current_org() is e340fa7a, which holds ZERO rows. The
-- org filter would take that Director from 591 Egypt tyre records to nothing at
-- all. That is arguably the correct answer - a direct read of tyre_records
-- already returns 0 to them, so the filter would simply make these four agree
-- with RLS - but it is a visible loss of a working screen for a real user, it
-- stems from a long-recorded org-membership misconfiguration rather than from
-- these functions, and it cannot be proved harmless by md5. It needs the owner's
-- decision, not a silent migration.
--
-- What V549 does do is bound the damage: after this change that Director reads
-- 591 Egypt rows instead of all 11,191. The country wall now holds on those four
-- even though the tenant wall still does not.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v549, which holds the
-- exact prior definition text for all 19.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v549;
create table _bak.rpc_defs_v549 (proname text, def text, saved_at timestamptz default now());


-- ============================================================================
-- PART A - the row filter.
--
-- spec columns:
--   pname   the function to rewrite
--   anchor  text that must appear in its LIVE definition exactly `want` times
--   col     the country-bearing column expression the predicate is built on
--   pre     '' to AND the predicate onto an existing WHERE, or ' where true'
--           when the anchor is a set-returning call that has no WHERE yet
--   want    the exact number of occurrences required, or the migration aborts
-- ============================================================================
do $mig$
declare
  r        record;
  oid_     oid;
  nfound   int;
  def      text;
  newdef   text;
  occ      int;
  scope    text;
  n        int := 0;
  changed  text[] := '{}';
begin
  for r in
    select * from (values
      -- ---- tyre_records ------------------------------------------------------
      ('get_country_kpi',
       'where (p_country is null or t.country = p_country) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))',
       't.country', '', 1),
      -- the two corrective_actions sub-selects: bounded by country only when a
      -- country was named, so unbounded on exactly the path this migration closes
      ('get_country_kpi',   'where a.status = ''Open''',      'a.country', '', 1),
      ('get_country_kpi',   'where a.status  != ''Closed''',  'a.country', '', 1),

      ('report_asset_metrics',
       'WHERE (p_country = ''All'' OR p_country IS NULL OR country = p_country OR country IS NULL) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))',
       'country', '', 1),
      ('report_asset_overview',
       'WHERE (p_country = ''All'' OR p_country IS NULL OR country = p_country OR country IS NULL) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))',
       'country', '', 1),
      ('report_tyre_summary',
       'WHERE (p_country = ''All'' OR p_country IS NULL OR r.country = p_country OR r.country IS NULL)',
       'r.country', '', 1),
      ('get_brand_size_cpk',
       'and (p_country is null or country = p_country) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))',
       'country', '', 1),

      -- ---- parts_consumption -------------------------------------------------
      ('get_expense_by_site',
       'AND (p_country IS NULL OR pc.country = p_country) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))',
       'pc.country', '', 1),
      ('get_tyre_cost_by_asset',
       'AND (p_country IS NULL OR country = p_country) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))',
       'country', '', 1),
      ('get_parts_expense_snapshot',
       'AND (p_country IS NULL OR country = p_country)', 'country', '', 1),
      -- three reads: the currency-decision count, the monthly series, by_evidence
      ('get_cost_cpk_overview',
       '(p_country is null or country = p_country)', 'country', '', 3),
      -- two reads: the currency-decision count and the item-level base CTE
      ('get_cost_variance',
       '(p_country is null or country = p_country)', 'country', '', 2),

      -- ---- work_orders / line items -----------------------------------------
      -- work_orders.country is character varying, so it is cast, matching the
      -- live RLS policy expression exactly
      ('get_maintenance_snapshot',
       'AND (p_country IS NULL OR w.country = p_country)', 'w.country::text', '', 1),
      ('get_maintenance_snapshot',
       'AND (p_country IS NULL OR l.country = p_country)', 'l.country', '', 1),
      ('get_daily_job_cards',
       'and (p_country is null or country = p_country)', 'country::text', '', 1),

      -- ---- list_scrapped_tyres ----------------------------------------------
      -- one filter point, on the country the row itself reports:
      -- coalesce(mark country, tyre record country). Filtering the two source
      -- CTEs separately could admit a row through one side and drop it on the
      -- other; this governs the whole output unambiguously.
      ('list_scrapped_tyres',
       'where (p_country is null or country = p_country)', 'country', '', 1),

      -- ---- get_fleet_cpk -----------------------------------------------------
      ('get_fleet_cpk', '(p_country is null or pc.country = p_country)', 'pc.country', '', 1),
      ('get_fleet_cpk', '(p_country is null or f.country = p_country)',  'f.country',  '', 1),
      -- distance sources: filtered at the call site because both RETURN country,
      -- and because fleet_tyre_km_by_asset is V548's to edit, not this migration's
      ('get_fleet_cpk', 'from public.fleet_tyre_km_by_asset(v_org, p_country, v_from, v_to)', 'country', ' where true', 1),
      ('get_fleet_cpk', 'from public.fleet_hours_by_asset(v_org, p_country, v_from, v_to)',   'country', ' where true', 1),

      -- ---- get_cpk_drivers ---------------------------------------------------
      ('get_cpk_drivers', '(p_country is null or f.country = p_country)', 'f.country', '', 1),
      ('get_cpk_drivers', '(p_country is null or t.country = p_country)', 't.country', '', 1),
      ('get_cpk_drivers', 'from public.fleet_tyre_km_by_asset(v_org, p_country, v_f1, v_t1)', 'country', ' where true', 1),
      ('get_cpk_drivers', 'from public.fleet_tyre_km_by_asset(v_org, p_country, v_f0, v_t0)', 'country', ' where true', 1),
      ('get_cpk_drivers', 'from public.fleet_hours_by_asset(v_org, p_country, v_f1, v_t1)',   'country', ' where true', 1),
      ('get_cpk_drivers', 'from public.fleet_hours_by_asset(v_org, p_country, v_f0, v_t0)',   'country', ' where true', 1),

      -- ---- the cost helpers: where get_cost_cpk_overview and get_cost_variance
      --      actually read rows. Guarding only their entry points would put the
      --      boundary somewhere it does nothing.
      ('_cost_totals',  '(p_country is null or country = p_country)', 'country', '', 1),
      ('_cost_cpk',     '(p_country is null or country = p_country)', 'country', '', 1),
      -- the km denominator: unfiltered, it divides one country's cost by three
      -- countries' distance
      ('_cost_cpk',     'from public.fleet_km_by_asset(p_org, p_country, p_from, p_to)', 'country', ' where true', 1),
      -- these two build their query with format() into dynamic SQL. The inserted
      -- text lands inside $f$...$f$ quoting, where single quotes are literal, and
      -- contains no % so format() cannot misread it.
      ('_cost_dim',     'and ($2 is null or country = $2)', 'country', '', 1),
      ('_cost_var_dim', 'and ($2 is null or country = $2)', 'country', '', 1)
    ) v(pname, anchor, col, pre, want)
  loop
    select count(*), min(p.oid) into nfound, oid_
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = r.pname;

    if nfound <> 1 then
      raise exception 'V549: expected exactly 1 public.%, found %', r.pname, nfound;
    end if;

    def := pg_get_functiondef(oid_);

    if not (r.pname = any(changed)) then
      insert into _bak.rpc_defs_v549 (proname, def) values (r.pname, def);
      changed := changed || r.pname;
    end if;

    occ := (length(def) - length(replace(def, r.anchor, ''))) / length(r.anchor);
    if occ <> r.want then
      raise exception 'V549: anchor for % matched % times, expected exactly %  [%]',
        r.pname, occ, r.want, left(r.anchor, 60);
    end if;

    -- the RLS predicate of V396, verbatim. is_super_admin() is not optional:
    -- the super admin's profiles.country is NULL, so the two scope readers are
    -- false/empty for them and they would otherwise see nothing.
    scope := r.pre
      || ' and (' || r.col || ' is null'
      || ' or (select public.is_super_admin())'
      || ' or (select public.app_sees_all_countries())'
      || ' or lower(btrim(' || r.col || ')) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))';

    newdef := replace(def, r.anchor, r.anchor || scope);

    if position('app_country_scope' in newdef) = 0 then
      raise exception 'V549: predicate not inserted on %', r.pname;
    end if;

    execute newdef;
    n := n + 1;
  end loop;

  if n <> 31 then
    raise exception 'V549: expected 31 replacements, applied %', n;
  end if;
  if array_length(changed, 1) <> 19 then
    raise exception 'V549: expected 19 distinct functions, touched %', array_length(changed, 1);
  end if;
  raise notice 'V549: % replacements over % functions', n, array_length(changed, 1);
end
$mig$;


-- ============================================================================
-- FINAL ASSERTION - every one of the fifteen named RPCs and all four cost
-- helpers now carries the scope predicate, is still SECURITY DEFINER, still has
-- a pinned search_path, and is still not executable by anon. Aborts the whole
-- migration otherwise, so a partial boundary can never be left behind.
--
-- fleet_tyre_km_by_asset is deliberately absent: it belongs to V548.
-- ============================================================================
do $mig$
declare
  bad text;
  cnt int;
begin
  select count(*) into cnt
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'get_cost_variance','get_cost_cpk_overview','get_fleet_cpk','get_maintenance_snapshot',
      'get_parts_expense_snapshot','get_cpk_drivers','get_daily_job_cards','list_scrapped_tyres',
      'get_country_kpi','report_tyre_summary','get_expense_by_site','get_tyre_cost_by_asset',
      'report_asset_metrics','report_asset_overview','get_brand_size_cpk',
      '_cost_totals','_cost_cpk','_cost_dim','_cost_var_dim');
  if cnt <> 19 then
    raise exception 'V549: expected 19 target functions, found %', cnt;
  end if;

  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'get_cost_variance','get_cost_cpk_overview','get_fleet_cpk','get_maintenance_snapshot',
      'get_parts_expense_snapshot','get_cpk_drivers','get_daily_job_cards','list_scrapped_tyres',
      'get_country_kpi','report_tyre_summary','get_expense_by_site','get_tyre_cost_by_asset',
      'report_asset_metrics','report_asset_overview','get_brand_size_cpk',
      '_cost_totals','_cost_cpk','_cost_dim','_cost_var_dim')
    and (   position('app_country_scope'  in pg_get_functiondef(p.oid)) = 0
         -- the super-admin term, which the whole platform-owner view rests on
         or position('is_super_admin'     in pg_get_functiondef(p.oid)) = 0
         -- V545/V546's named-country guard must survive untouched
         or (p.proname not like '\_cost\_%'
             and position('app_can_see_country' in pg_get_functiondef(p.oid)) = 0)
         or not p.prosecdef
         or p.proconfig is null
         or has_function_privilege('anon', p.oid, 'EXECUTE'));

  if bad is not null then
    raise exception 'V549: post-check failed on: %', bad;
  end if;
  raise notice 'V549: all 19 scoped, definer, search_path pinned, anon revoked';
end
$mig$;
