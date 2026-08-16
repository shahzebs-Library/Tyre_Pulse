-- V549  THE ALL-COUNTRIES PATH: FILTER ROWS BY WHAT THE CALLER MAY SEE
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A) as
-- migration v549_all_scope_country_filter.
--
-- V545 and V546 closed the NAMED-country path on fifteen SECURITY DEFINER
-- functions. Both said in writing that they did NOT close the other half:
-- p_country NULL (and the sentinel 'All') means "no country filter", and on that
-- path these functions applied no row-level country restriction of any kind.
-- They are SECURITY DEFINER, so RLS never ran. That is the DEFAULT path almost
-- every screen uses, so it was the most-used leak in the database, not an edge
-- case.
--
-- MEASURED BEFORE, by impersonating the real approved KSA-only Manager
-- 34793423 (country {KSA}) in rolled-back transactions and hashing the full
-- ordered payload of each function on its all-scope default:
--
--   ON ALL FIFTEEN FUNCTIONS THE KSA-ONLY MANAGER'S md5 WAS BYTE-IDENTICAL TO
--   THE SUPER ADMIN'S. Not similar - identical. These functions were incapable
--   of telling the two callers apart.
--
--     get_parts_expense_snapshot   138,507,286 over 209,381 lines, 3 countries
--     get_maintenance_snapshot     89,628 job cards, 35,060,742 spend
--     report_tyre_summary          11,191 tyre records, 553 assets, 12,450,390.96
--     report_asset_metrics 553 assets   report_asset_overview 553 assets
--     get_cost_cpk_overview        47,691,132, currency (blended)
--     get_fleet_cpk                1,072 vehicles over 3 country rows
--     get_country_kpi              3 rows - KSA and UAE and Egypt
--     get_expense_by_site 39 sites      get_tyre_cost_by_asset 875 assets
--     get_brand_size_cpk 133 rows       get_cpk_drivers 5 segments
--     get_daily_job_cards          790 assets still out
--     list_scrapped_tyres          201 scrapped tyres
--     get_cost_variance            already refuses - see BEHAVIOUR CHANGES
--
-- KSA alone is 8,145 tyre records. And 138,507,286 is SAR + AED + EGP added
-- together, which this codebase holds to be meaningless - so the figure was at
-- once a disclosure of two other countries and a number that is not a quantity
-- of anything.
--
--
-- THE PREDICATE is the RLS idiom this database adopted in V396, copied whole:
--
--   (<col> is null
--    or (select public.is_super_admin())
--    or (select public.app_sees_all_countries())
--    or lower(btrim(<col>)) = any(coalesce((select public.app_country_scope()),
--                                          '{}'::text[])))
--
-- is_super_admin() IS LOAD-BEARING AND IS NOT DECORATION. Measured on the live
-- profiles rows before a line of this was written:
--
--   user                  app_sees_all_countries()   app_country_scope()
--   -------------------   ------------------------   -------------------
--   KSA-only Manager      false                      {ksa}
--   3-country user        false                      {ksa,uae,egypt}
--   Egypt-only Director   false                      {egypt}
--   SUPER ADMIN           false                      {}          <-- note
--
-- The super admin's profiles.country is NULL, so both scope readers are
-- false/empty for them. NOT ONE user on this database has
-- app_sees_all_countries() true; the platform owner passes solely through
-- is_super_admin(). A predicate built from the two scope readers alone - the
-- obvious shape - would have returned ZERO ROWS to the owner on all fifteen
-- reports. Never write this predicate without that term.
--
-- The zero-argument readers are used in preference to the row-argument
-- app_can_see_country(country). Written as (select f()) they are uncorrelated
-- subqueries, evaluated ONCE per query as an InitPlan. app_can_see_country takes
-- the row value so it cannot be hoisted, and is SECURITY DEFINER so it can never
-- be inlined - a per-row profiles lookup over tables of 89k to 209k rows.
-- PROVEN, not assumed: EXPLAIN ANALYZE of the predicate over parts_consumption
-- shows every reader as `InitPlan N -> Result (rows=1 loops=1)` and the row
-- filter as `(InitPlan N).col1` references, exactly like the pre-existing RLS
-- predicate beside it.
--
--
-- WHERE THE PREDICATE WENT - and why four functions outside the named fifteen
-- are rewritten too. get_cost_cpk_overview and get_cost_variance read almost no
-- rows themselves: they delegate to the SECURITY DEFINER helpers _cost_totals,
-- _cost_cpk, _cost_dim and _cost_var_dim, which is where parts_consumption is
-- actually scanned. Guarding only the two entry points would have put the
-- boundary somewhere it does nothing. _cost_cpk additionally sums its km
-- denominator out of fleet_km_by_asset, so leaving that unfiltered would divide
-- one country's cost by three countries' distance.
--
-- get_fleet_cpk and get_cpk_drivers draw distance from fleet_tyre_km_by_asset
-- and fleet_hours_by_asset. Both RETURN country, so the filter is applied at the
-- CALL SITE in the consuming CTE rather than inside those functions -
-- deliberately, because fleet_tyre_km_by_asset belongs to the V548 change
-- landing in parallel and this migration must not edit it. Verified after: V549
-- left fleet_tyre_km_by_asset untouched.
--
-- 31 replacements over 19 functions. Every one is a replace() against the
-- function's own LIVE pg_get_functiondef output - no body is retyped - and every
-- one ABORTS unless its anchor occurs EXACTLY the expected number of times.
-- Three anchors are expected more than once on purpose (get_cost_cpk_overview
-- reads parts_consumption in three places, get_cost_variance in two); replacing
-- all occurrences is the point, and asserting the count means a body that gains
-- or loses a read cannot pass silently. A partial run is the failure that
-- matters: half a boundary reads as a closed one (the V396 lesson).
--
--
-- VERIFIED AFTER, by impersonation, tested first in a rolled-back transaction:
--
--   * SUPER ADMIN: md5 BYTE-IDENTICAL to the pre-change capture on 15 of 15.
--   * 3-COUNTRY USER: md5 BYTE-IDENTICAL on 15 of 15. Their scope covers every
--     country value that exists, so the predicate admits every row - which is
--     the proof it filters by scope rather than by accident.
--   * KSA-ONLY MANAGER: all-scope now returns KSA only - 8,145 tyre records,
--     370 assets, get_country_kpi 1 row, 19 expense sites, 688 costed assets,
--     119 brand rows, get_cost_cpk_overview 6,192,011 in SAR.
--     THE DECISIVE CHECK: that user's ALL-SCOPE result is now byte-identical to
--     their own explicit KSA-SCOPE result on 14 of 15 functions.
--     get_country_kpi is the one exception and the difference is understood: its
--     corrective_actions sub-selects now admit the 2 rows whose country is NULL,
--     which the RLS idiom deliberately makes visible to everyone, while the
--     named-KSA path requires a.country = 'KSA'. Tyre figures identical (8,145
--     records, 17 sites); only open_actions/overdue_actions differ, 1/1 vs 0/0.
--   * EGYPT-ONLY DIRECTOR: still reads their own Egypt data, not nothing -
--     591 tyre records, 47 assets, 5,893,603.79, get_country_kpi 1 row (Egypt).
--     Was 11,191 / 553 / 12,450,390.96, i.e. another organisation's whole fleet.
--   * V545/V546's named-country guard survives intact: the KSA-only Manager
--     asking for UAE still gets forbidden / 0 rows on every probe.
--
-- PERFORMANCE, same user, same query, warm-up discarded, 3 iterations. No
-- regression anywhere, and the heaviest read got materially faster because the
-- scoped user now scans one country instead of three:
--
--   function                     KSA-only Manager before   after
--   --------------------------   -----------------------   -------------------
--   get_parts_expense_snapshot   5160 / 5746 / 5729 ms     1447 / 971 / 975 ms
--   get_maintenance_snapshot     1552 / 1351 / 1330 ms     1640 / 1755 /  974 ms
--   get_cost_cpk_overview        2472 / 1814 / 2553 ms     2082 / 2095 / 2292 ms
--   get_fleet_cpk                 243 /  242 /  245 ms      225 /  225 /  223 ms
--
--   super admin AFTER (reads the full three-country set, so the fair comparison
--   with the "before" column above): 1522 / 1516 / 1507, 1815 / 1566 / 1565,
--   1806 / 1863 / 2590, 251 / 250 / 249 ms. Flat.
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
--    returns the full KSA decomposition, SAR 6,192,011.05. That is MORE data
--    than before, and it is not new disclosure: it is byte-identical to what
--    get_cost_variance('KSA') already returned to that same user through the
--    V545 named path.
--
-- 2. get_country_kpi's open_actions / overdue_actions sub-selects bounded
--    corrective_actions by country ONLY when p_country was given, so on the
--    all-scope they counted every country's actions. They are now scoped too.
--
--
-- NOT DONE, AND NOT BECAUSE IT WAS MISSED - ORG SCOPING
--
-- get_country_kpi, report_tyre_summary, report_asset_metrics and
-- report_asset_overview read tyre_records with NO organisation_id predicate.
-- That is the TENANT wall, a more serious class than country. The claim was
-- verified: before this change the Egypt-only Director - a member of
-- organisation e340fa7a, NOT of Company A - received byte-identical super-admin
-- output from all four.
--
-- Adding `organisation_id = app_current_org()` was evaluated and is NOT a no-op,
-- so it is NOT applied here. Every row in tyre_records belongs to Company A,
-- while that Director's app_current_org() is e340fa7a, which holds ZERO rows.
-- The org filter would take them from 591 Egypt tyre records to nothing at all.
-- That is arguably the correct answer - a direct read of tyre_records already
-- returns 0 to them, so the filter would merely make these four agree with RLS -
-- but it is a visible loss of a working screen for a real person, it stems from
-- a long-recorded org-membership misconfiguration rather than from these
-- functions, and it cannot be proved harmless by md5. It needs the owner's
-- decision, not a silent migration.
--
-- What V549 does do is bound the damage: that Director now reads 591 Egypt rows
-- instead of all 11,191. The country wall holds on those four even though the
-- tenant wall still does not.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v549, which holds the
-- exact prior definition text for all 19. _bak.v549_probe holds the before and
-- after md5 evidence for all four users.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v549;
create table _bak.rpc_defs_v549 (proname text, def text, saved_at timestamptz default now());


-- spec: pname / anchor (must occur exactly `want` times) / country column
--       expression / '' to AND onto an existing WHERE or ' where true' when the
--       anchor is a set-returning call with no WHERE yet / want
do $mig$
declare
  r        record;  oid_ oid;  nfound int;  def text;  newdef text;  occ int;  scope text;
  n        int := 0;  changed text[] := '{}';
begin
  for r in
    select * from (values
      ('get_country_kpi','where (p_country is null or t.country = p_country) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))','t.country','',1),
      -- the two corrective_actions sub-selects bounded by country ONLY when a
      -- country was named, so unbounded on exactly the path this closes
      ('get_country_kpi','where a.status = ''Open''','a.country','',1),
      ('get_country_kpi','where a.status  != ''Closed''','a.country','',1),
      ('report_asset_metrics','WHERE (p_country = ''All'' OR p_country IS NULL OR country = p_country OR country IS NULL) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))','country','',1),
      ('report_asset_overview','WHERE (p_country = ''All'' OR p_country IS NULL OR country = p_country OR country IS NULL) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))','country','',1),
      ('report_tyre_summary','WHERE (p_country = ''All'' OR p_country IS NULL OR r.country = p_country OR r.country IS NULL)','r.country','',1),
      ('get_brand_size_cpk','and (p_country is null or country = p_country) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))','country','',1),
      ('get_expense_by_site','AND (p_country IS NULL OR pc.country = p_country) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))','pc.country','',1),
      ('get_tyre_cost_by_asset','AND (p_country IS NULL OR country = p_country) and (p_country is null or p_country = ''All'' or public.app_can_see_country(p_country))','country','',1),
      ('get_parts_expense_snapshot','AND (p_country IS NULL OR country = p_country)','country','',1),
      -- three parts_consumption reads: the currency-decision count, the monthly
      -- series and by_evidence. Two for get_cost_variance. Counts are asserted so
      -- a body that gains or loses a read cannot pass silently.
      ('get_cost_cpk_overview','(p_country is null or country = p_country)','country','',3),
      ('get_cost_variance','(p_country is null or country = p_country)','country','',2),
      -- work_orders.country is character varying, cast to match the live RLS
      -- policy expression exactly
      ('get_maintenance_snapshot','AND (p_country IS NULL OR w.country = p_country)','w.country::text','',1),
      ('get_maintenance_snapshot','AND (p_country IS NULL OR l.country = p_country)','l.country','',1),
      ('get_daily_job_cards','and (p_country is null or country = p_country)','country::text','',1),
      -- one filter point, on the country the row itself reports:
      -- coalesce(mark country, tyre record country)
      ('list_scrapped_tyres','where (p_country is null or country = p_country)','country','',1),
      ('get_fleet_cpk','(p_country is null or pc.country = p_country)','pc.country','',1),
      ('get_fleet_cpk','(p_country is null or f.country = p_country)','f.country','',1),
      ('get_fleet_cpk','from public.fleet_tyre_km_by_asset(v_org, p_country, v_from, v_to)','country',' where true',1),
      ('get_fleet_cpk','from public.fleet_hours_by_asset(v_org, p_country, v_from, v_to)','country',' where true',1),
      ('get_cpk_drivers','(p_country is null or f.country = p_country)','f.country','',1),
      ('get_cpk_drivers','(p_country is null or t.country = p_country)','t.country','',1),
      ('get_cpk_drivers','from public.fleet_tyre_km_by_asset(v_org, p_country, v_f1, v_t1)','country',' where true',1),
      ('get_cpk_drivers','from public.fleet_tyre_km_by_asset(v_org, p_country, v_f0, v_t0)','country',' where true',1),
      ('get_cpk_drivers','from public.fleet_hours_by_asset(v_org, p_country, v_f1, v_t1)','country',' where true',1),
      ('get_cpk_drivers','from public.fleet_hours_by_asset(v_org, p_country, v_f0, v_t0)','country',' where true',1),
      ('_cost_totals','(p_country is null or country = p_country)','country','',1),
      ('_cost_cpk','(p_country is null or country = p_country)','country','',1),
      -- the km denominator: unfiltered it divides one country's cost by three
      -- countries' distance
      ('_cost_cpk','from public.fleet_km_by_asset(p_org, p_country, p_from, p_to)','country',' where true',1),
      -- these two build dynamic SQL with format(). The inserted text lands inside
      -- $f$...$f$ quoting where single quotes are literal, and contains no % so
      -- format() cannot misread it.
      ('_cost_dim','and ($2 is null or country = $2)','country','',1),
      ('_cost_var_dim','and ($2 is null or country = $2)','country','',1)
    ) v(pname, anchor, col, pre, want)
  loop
    select count(*), min(p.oid) into nfound, oid_ from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname='public' and p.proname = r.pname;
    if nfound <> 1 then raise exception 'V549: expected exactly 1 public.%, found %', r.pname, nfound; end if;

    def := pg_get_functiondef(oid_);

    if not (r.pname = any(changed)) then
      insert into _bak.rpc_defs_v549 (proname, def) values (r.pname, def);
      changed := changed || r.pname;
    end if;

    occ := (length(def) - length(replace(def, r.anchor, ''))) / length(r.anchor);
    if occ <> r.want then
      raise exception 'V549: anchor for % matched % times, expected exactly % [%]', r.pname, occ, r.want, left(r.anchor,60);
    end if;

    scope := r.pre || ' and (' || r.col || ' is null'
      || ' or (select public.is_super_admin())'
      || ' or (select public.app_sees_all_countries())'
      || ' or lower(btrim(' || r.col || ')) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))';

    newdef := replace(def, r.anchor, r.anchor || scope);
    if position('app_country_scope' in newdef) = 0 then raise exception 'V549: predicate not inserted on %', r.pname; end if;

    execute newdef;
    n := n + 1;
  end loop;

  if n <> 31 then raise exception 'V549: expected 31 replacements, applied %', n; end if;
  if array_length(changed,1) <> 19 then raise exception 'V549: expected 19 distinct functions, touched %', array_length(changed,1); end if;
  raise notice 'V549: % replacements over % functions', n, array_length(changed,1);
end $mig$;


-- FINAL ASSERTION - all fifteen named RPCs and all four cost helpers carry the
-- scope predicate AND the super-admin term, V545/V546's named-country guard has
-- survived, and each is still definer / search_path pinned / anon revoked.
-- Aborts the whole migration otherwise: half a boundary reads as a closed one.
do $mig$
declare bad text; cnt int;
begin
  select count(*) into cnt from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname in (
    'get_cost_variance','get_cost_cpk_overview','get_fleet_cpk','get_maintenance_snapshot',
    'get_parts_expense_snapshot','get_cpk_drivers','get_daily_job_cards','list_scrapped_tyres',
    'get_country_kpi','report_tyre_summary','get_expense_by_site','get_tyre_cost_by_asset',
    'report_asset_metrics','report_asset_overview','get_brand_size_cpk',
    '_cost_totals','_cost_cpk','_cost_dim','_cost_var_dim');
  if cnt <> 19 then raise exception 'V549: expected 19 target functions, found %', cnt; end if;

  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname in (
    'get_cost_variance','get_cost_cpk_overview','get_fleet_cpk','get_maintenance_snapshot',
    'get_parts_expense_snapshot','get_cpk_drivers','get_daily_job_cards','list_scrapped_tyres',
    'get_country_kpi','report_tyre_summary','get_expense_by_site','get_tyre_cost_by_asset',
    'report_asset_metrics','report_asset_overview','get_brand_size_cpk',
    '_cost_totals','_cost_cpk','_cost_dim','_cost_var_dim')
    and (   position('app_country_scope' in pg_get_functiondef(p.oid)) = 0
         or position('is_super_admin'    in pg_get_functiondef(p.oid)) = 0
         or (p.proname not like '\_cost\_%'
             and position('app_can_see_country' in pg_get_functiondef(p.oid)) = 0)
         or not p.prosecdef
         or p.proconfig is null
         or has_function_privilege('anon', p.oid, 'EXECUTE'));

  if bad is not null then raise exception 'V549: post-check failed on: %', bad; end if;
  raise notice 'V549: all 19 scoped, definer, search_path pinned, anon revoked';
end $mig$;
