-- V554  THE ALL-SITES PATH: FILTER ROWS BY WHAT THE CALLER MAY SEE
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A) as
-- migration v554_all_site_scope_filter.
--
-- V553 closed the NAMED-site path on nine SECURITY DEFINER functions and said in
-- writing that it did NOT close the other half: p_site NULL or '' means "all
-- sites", and on that path those functions applied no row-level site restriction
-- of any kind. They are SECURITY DEFINER, so RLS never ran. That is the DEFAULT
-- path every screen uses. It is exactly where country sat between V545 and V549,
-- and V549 is the treatment: filter the ROWS by the caller's own scope.
--
-- Unreachable today only because all 38 profiles carry sites = {ALL}. It arms the
-- moment anyone is given a real site scope, which is the whole point of V269.
--
--
-- THE NINE WERE RE-DERIVED FROM THE LIVE CATALOG, not copied from V553's prose:
-- every public function whose identity arguments contain p_site, that is
-- SECURITY DEFINER plpgsql returning jsonb and not anon-executable, already
-- carries app_can_see_site. That query returns exactly the nine V553 named, so
-- the two agree.
--
--
-- WHERE THE ROWS ARE ACTUALLY SCANNED - and why 10 functions are rewritten, not 9
--
--   * The three _multi variants (get_cost_cpk_overview_multi,
--     get_cost_variance_multi, get_parts_expense_snapshot_multi) read NOTHING of
--     their own. Measured: zero occurrences of any site anchor in all three; each
--     is a per-country loop that delegates to its singular sibling. Fixing the
--     sibling fixes them. They are asserted, not edited.
--
--   * get_cost_cpk_overview and get_cost_variance delegate most of their scanning
--     to the SECURITY DEFINER helpers _cost_totals, _cost_cpk, _cost_dim and
--     _cost_var_dim, which is where parts_consumption is actually read. Guarding
--     only the two entry points would have put the boundary somewhere it does
--     nothing - the same trap V549 recorded for country. All four helpers are
--     rewritten. They take a p_org and are already revoked from authenticated and
--     anon, so this does not widen their surface.
--
-- 41 replacements over 10 functions. Every one is a replace() against the
-- function's own LIVE pg_get_functiondef output - no body is retyped - and every
-- one ABORTS unless its anchor occurs EXACTLY the expected number of times. The
-- definition is re-read from the catalog on every iteration, so the three passes
-- over get_report_snapshot_authed compound correctly. A partial run is the
-- failure that matters: half a boundary reads as a closed one (the V396 lesson).
--
--
-- THE PREDICATE IS THE LIVE V396 SITE POLICY, COPIED RATHER THAN RETYPED.
-- Read back with pg_get_expr from tyre_records_site_isolation and its siblings:
--
--   (site IS NULL
--    OR btrim(site) = ''
--    OR (SELECT app_sees_all_sites())
--    OR upper(btrim(site)) = ANY (COALESCE((SELECT app_site_scope()), '{}'::text[])))
--
-- THREE DIFFERENCES FROM THE COUNTRY IDIOM, EACH MEASURED, NOT ASSUMED:
--
-- 1. SITE IS COMPARED UPPER, COUNTRY IS COMPARED LOWER. Site values are canonical
--    UPPER on this database (V246), app_site_scope() returns
--    array_agg(upper(btrim(s))), and the live policy compares upper(btrim(site)).
--    Writing lower() here - the country reflex - would match nothing and blank
--    every screen for a narrowed user.
--
-- 2. THERE IS AN EXTRA btrim(...) = '' TERM. The country policy has no such term;
--    the site policy does, because app_can_see_site treats '' as "no site". An
--    empty-string site is visible to everyone, exactly like NULL. Omitting it
--    would hide blank-site rows from every narrowed user.
--
-- 3. THE COUNTRY TRAP DOES NOT APPLY, AND THIS WAS CHECKED BEFORE A LINE WAS
--    WRITTEN. V549 records that app_sees_all_countries() is true for NOBODY,
--    including the platform owner, so a predicate built from the scope readers
--    alone returned zero rows to the super admin. The site readers are built
--    differently - app_sees_all_sites() has is_super_admin and role = 'Admin' in
--    its OWN body, which app_sees_all_countries() does not. Measured live by
--    impersonation:
--
--      user                    app_sees_all_sites()   app_site_scope()  is_super
--      ---------------------   --------------------   ---------------   --------
--      SUPER ADMIN                    true                {ALL}           true
--      KSA-only Manager               true                {ALL}           false
--      3-country user                 true                {ALL}           false
--      Egypt-only Director            true                {ALL}           false
--
--    So the owner passes on the second term, not on a special case, and every
--    user today short-circuits there. is_super_admin() is nonetheless carried in
--    the predicate: it is logically a subset of app_sees_all_sites() so it can
--    never widen anything, it costs one InitPlan, and it keeps the owner reading
--    the whole fleet even if app_sees_all_sites() is ever narrowed.
--
-- The zero-argument readers are used in preference to the row-argument
-- app_can_see_site(site). Written as (select f()) they are uncorrelated
-- subqueries, evaluated ONCE per query as an InitPlan. app_can_see_site takes the
-- row value so it cannot be hoisted, and is SECURITY DEFINER so it can never be
-- inlined - a per-row profiles lookup over 209,381 expense lines.
--
-- (site)::text is used uniformly. Only work_orders.site is character varying;
-- every other site column is text, where the cast is a no-op. This matches the
-- live work_orders_site_isolation policy, which casts for the same reason.
--
--
-- TWO READS THAT ARE DELIBERATELY TREATED AS SPECIAL CASES
--
--   * get_report_snapshot_authed's accidents_by_site and tyres_by_site
--     breakdowns carry NO (v_site IS NULL OR site=v_site) filter, on purpose:
--     they GROUP BY site, and filtering them to one site would draw a chart with
--     one bar. They are therefore also the two reads where a narrowed user would
--     see every other site by name, so they get the scope predicate under their
--     own anchors even though they must never get a v_site equality filter. The
--     chart correctly narrows to the sites the caller may see.
--
--   * get_cost_cpk_overview's currency decision - select count(distinct country)
--     over parts_consumption - is NOT site-scoped, and that is a decision rather
--     than an oversight. It returns a single integer already bounded by country
--     scope (V549), so it discloses no site data. The NAMED-site path does not
--     scope it either, and leaving it alone is what keeps the all-sites result
--     byte-identical to the named-site result - the decisive check V549 used.
--
--
-- A PRE-EXISTING ASYMMETRY THIS INHERITS AND DOES NOT INTRODUCE
--
-- _cost_cpk divides site-scoped spend by a km denominator drawn from
-- fleet_km_by_asset, which returns (country, asset_no, km_run) and NO site
-- column, so the denominator cannot be site-filtered the way V549 filtered it by
-- country. Under a narrowed user CPK is therefore understated. This is exactly
-- what the NAMED-site path already did - _cost_cpk has filtered its spend by
-- p_site since it was written while its km stayed fleet-wide - so V554 makes the
-- default path agree with the named path rather than creating a new asymmetry.
-- Fixing it properly means teaching those three helpers a site dimension, which
-- is a migration of its own.
--
--
-- parts_consumption HAS NO SITE RLS POLICY, AND THIS MIGRATION DOES NOT ADD ONE.
-- See the verdict recorded at the foot of this file. In short: it is an omission
-- of chronology rather than a V269 decision, but the column means the ISSUING
-- STORE and not where the machine worked, so scoping the table by it would be
-- wrong in a different way. The function-level predicate below is still correct
-- and still narrowing, because the named-site path already filters that same
-- column - V554 only makes the default path agree with it.
--
--
-- VERIFIED - THE NO-OP, FIRST. Everyone is on {ALL}, so nothing may move. All
-- nine entry points were called on their ALL-SCOPE default by impersonation, for
-- all four reference users, before and after.
--
--   36 of 36 signatures BYTE-IDENTICAL.
--     super admin d2d43a5f  9/9      KSA-only Manager 34793423  9/9
--     3-country   e864b410  9/9      Egypt Director   a4fd5401   9/9
--
-- THE COMPARATOR HAD TO BE BUILT BEFORE IT COULD BE TRUSTED. A plain md5 of the
-- payload reported get_report_snapshot_authed as changed on two consecutive
-- identical calls: its breakdowns use ORDER BY count DESC LIMIT 8, so ties come
-- back in arbitrary order. Signatures are therefore taken over a recursively
-- array-sorted canonical form with ISO timestamps (generated_at) masked, and the
-- comparator was proven STABLE on 9/9 by hashing the same user twice before any
-- change was applied. Without that step this migration would have reported a
-- false regression.
--
-- VERIFIED - THAT IT BITES. The real approved KSA-only Manager 34793423 (role
-- Manager, not Admin, not super) was narrowed to ARRAY['NHC'] inside a
-- transaction forced to ROLL BACK by raising on the result. The profile UPDATE
-- was authorised by setting request.jwt.claims to a super admin so that
-- trg_guard_profile_privileged passes; NO trigger was disabled. Same user, same
-- ALL-SITES calls, nothing but profiles.sites changed:
--
--                              sites={ALL}      sites={NHC}
--   app_sees_all_sites()       true             false
--   app_site_scope()           {ALL}            {NHC}
--   tyre_records  (direct RLS) 8,145            3,846      (1,805 NHC + 2,041 blank)
--   work_orders   (direct RLS) 62,127           16,391
--   snapshot kpis.tyres        11,191           5,410
--   snapshot kpis.fleet        1,617            238
--   maint_tyre_split total     7,425,874.15     1,587,222.54
--   parts_expense lines        108,891          29,712
--   parts_expense total        41,127,794       7,417,017
--   tyres_by_site              NHC, DIRIYAH,    NHC and Unassigned ONLY
--                              RED SEA, QIDDIYA,
--                              RIY-MET, KSP-TP,
--                              AMAALA, Unassigned
--
-- tyres_by_site is the one to read: that breakdown carries no v_site filter by
-- design, and six other sites stopped being named. The direct-table figures are
-- unchanged from V553's measurement of the same narrowing, so RLS still behaves
-- exactly as it did.
--
-- AFTERWARDS: all 38 profiles still carry sites = {ALL}; narrowed to real sites =
-- 0. Nothing was left modified.
--
-- V553's NAMED-site guard survives: as that narrowed user,
-- get_maint_tyre_split(null,'DIRIYAH') and get_parts_expense_snapshot('DIRIYAH')
-- both still return {"ok": false, "reason": "forbidden"}.
--
-- ONE UNDERSTOOD DIFFERENCE, of exactly the kind V549 recorded for
-- get_country_kpi. The narrowed user's ALL-SCOPE result is NOT byte-identical to
-- their own explicit NAMED-NHC result: 1,587,222.54 vs 1,576,026.54. The gap was
-- measured rather than explained away - blank/null-site tyre rows in that window
-- total exactly 11,196.00, and 1,576,026.54 + 11,196.00 = 1,587,222.54 to the
-- cent. The all-scope path admits rows with no site, which the RLS idiom
-- deliberately makes visible to everyone; the named path requires site = 'NHC'
-- and so excludes them. The scoped path is the more correct of the two.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v554, which holds the
-- exact prior definition text for all 10. _bak.v554_probe holds the before and
-- after signature evidence for all four users.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v554;
create table _bak.rpc_defs_v554 (proname text, def text, saved_at timestamptz default now());


-- One-shot guard. Every anchor below is still present after this migration runs,
-- so a second run would append the predicate twice. Abort instead.
do $mig$
declare bad text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'get_cost_cpk_overview','get_cost_variance','get_maint_tyre_split',
      'get_maintenance_snapshot','get_parts_expense_snapshot','get_report_snapshot_authed',
      '_cost_totals','_cost_cpk','_cost_dim','_cost_var_dim')
    and position('app_site_scope' in pg_get_functiondef(p.oid)) > 0;
  if bad is not null then
    raise exception 'V554: already applied - these already carry app_site_scope: %', bad;
  end if;
end $mig$;


-- spec: pname / anchor (must occur exactly `want` times) / site column expression / want
do $mig$
declare
  r        record;  oid_ oid;  nfound int;  def text;  newdef text;  occ int;  scope text;
  n        int := 0;  reps int := 0;  changed text[] := '{}';
begin
  for r in
    select * from (values
      -- parts_consumption, read directly by the two cost entry points
      ('get_cost_cpk_overview','and (p_site is null or site = p_site)','(site)::text',2),
      ('get_cost_variance','and (p_site is null or site = p_site)','(site)::text',1),
      -- ... and by the four helpers they delegate their scanning to
      ('_cost_totals','and (p_site is null or site = p_site)','(site)::text',1),
      ('_cost_cpk','and (p_site is null or site = p_site)','(site)::text',1),
      -- these two build dynamic SQL with format(). The inserted text lands inside
      -- $f$...$f$ quoting where single quotes are literal, and contains no % so
      -- format() cannot misread it, and no $n so it cannot collide with a param.
      ('_cost_dim','and ($3 is null or site = $3)','(site)::text',1),
      ('_cost_var_dim','and ($3 is null or site = $3)','(site)::text',1),
      -- three separate CTEs over three different tables
      ('get_maint_tyre_split','and (p_site is null or t.site = p_site)','(t.site)::text',1),
      ('get_maint_tyre_split','and (p_site is null or s.site = p_site)','(s.site)::text',1),
      ('get_maint_tyre_split','and (p_site is null or w.site = p_site)','(w.site)::text',1),
      -- work_orders.site is character varying, cast to match the live RLS policy
      ('get_maintenance_snapshot','AND (p_site IS NULL OR w.site = p_site)','(w.site)::text',1),
      ('get_maintenance_snapshot','AND (p_site IS NULL OR l.site = p_site)','(l.site)::text',1),
      -- NOTE: this function's p_site filters store_code, not site - a pre-existing
      -- quirk left exactly as it is. The SCOPE predicate must bound by the column
      -- that holds site names, which is site.
      ('get_parts_expense_snapshot','AND (p_site IS NULL OR store_code = p_site)','(site)::text',1),
      -- 26 uniform reads across odometer_logs, engine_hours_logs, production_logs,
      -- tyre_records, work_orders, pm_service_records, vehicle_fleet, accidents
      -- and inspections; every one references the column unqualified as `site`.
      ('get_report_snapshot_authed','(v_site IS NULL OR site=v_site)','(site)::text',26),
      -- the two GROUP BY site breakdowns, which carry no v_site filter by design
      ('get_report_snapshot_authed','count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_country IS NULL OR country=v_country)','(site)::text',1),
      ('get_report_snapshot_authed','count(*) c FROM public.tyre_records WHERE organisation_id=v_org AND (v_country IS NULL OR country=v_country)','(site)::text',1)
    ) v(pname, anchor, col, want)
  loop
    select count(*), min(p.oid) into nfound, oid_ from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname='public' and p.proname = r.pname;
    if nfound <> 1 then raise exception 'V554: expected exactly 1 public.%, found %', r.pname, nfound; end if;

    -- re-read live each pass so successive edits on one function compound
    def := pg_get_functiondef(oid_);

    if not (r.pname = any(changed)) then
      insert into _bak.rpc_defs_v554 (proname, def) values (r.pname, def);
      changed := changed || r.pname;
    end if;

    occ := (length(def) - length(replace(def, r.anchor, ''))) / length(r.anchor);
    if occ <> r.want then
      raise exception 'V554: anchor for % matched % times, expected exactly % [%]', r.pname, occ, r.want, left(r.anchor,60);
    end if;

    scope := ' and (' || r.col || ' is null'
      || ' or btrim(' || r.col || ') = ' || quote_literal('')
      || ' or (select public.is_super_admin())'
      || ' or (select public.app_sees_all_sites())'
      || ' or upper(btrim(' || r.col || ')) = any(coalesce((select public.app_site_scope()), ''{}''::text[])))';

    newdef := replace(def, r.anchor, r.anchor || scope);
    if position('app_site_scope' in newdef) = 0 then raise exception 'V554: predicate not inserted on %', r.pname; end if;

    execute newdef;
    n := n + 1;
    reps := reps + occ;
  end loop;

  if n <> 15 then raise exception 'V554: expected 15 spec rows, applied %', n; end if;
  if reps <> 41 then raise exception 'V554: expected 41 replacements, applied %', reps; end if;
  if array_length(changed,1) <> 10 then raise exception 'V554: expected 10 distinct functions, touched %', array_length(changed,1); end if;
  raise notice 'V554: % replacements over % functions', reps, array_length(changed,1);
end $mig$;


-- FINAL ASSERTION - all ten rewritten functions carry the scope predicate AND the
-- super-admin term; all nine V553-named RPCs still carry the named-site guard, so
-- V553 has survived; the three delegating _multi variants were correctly left
-- unedited; and every one is still definer / search_path pinned / anon revoked,
-- with the four cost helpers still revoked from authenticated too.
-- Aborts the whole migration otherwise: half a boundary reads as a closed one.
do $mig$
declare bad text; cnt int;
begin
  -- the ten that were rewritten must all carry the row predicate
  select count(*) into cnt from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname in (
    'get_cost_cpk_overview','get_cost_variance','get_maint_tyre_split',
    'get_maintenance_snapshot','get_parts_expense_snapshot','get_report_snapshot_authed',
    '_cost_totals','_cost_cpk','_cost_dim','_cost_var_dim')
    and position('app_site_scope'     in pg_get_functiondef(p.oid)) > 0
    and position('app_sees_all_sites' in pg_get_functiondef(p.oid)) > 0
    and position('is_super_admin'     in pg_get_functiondef(p.oid)) > 0;
  if cnt <> 10 then raise exception 'V554: expected 10 scoped functions, found %', cnt; end if;

  -- V553's named-site guard must have survived on all nine entry points
  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname in (
    'get_cost_cpk_overview','get_cost_cpk_overview_multi','get_cost_variance','get_cost_variance_multi',
    'get_maint_tyre_split','get_maintenance_snapshot','get_parts_expense_snapshot',
    'get_parts_expense_snapshot_multi','get_report_snapshot_authed')
    and position('app_can_see_site' in pg_get_functiondef(p.oid)) = 0;
  if bad is not null then raise exception 'V554: V553 named-site guard lost on: %', bad; end if;

  -- security posture unchanged on everything touched or relied upon
  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname in (
    'get_cost_cpk_overview','get_cost_cpk_overview_multi','get_cost_variance','get_cost_variance_multi',
    'get_maint_tyre_split','get_maintenance_snapshot','get_parts_expense_snapshot',
    'get_parts_expense_snapshot_multi','get_report_snapshot_authed',
    '_cost_totals','_cost_cpk','_cost_dim','_cost_var_dim')
    and (   not p.prosecdef
         or p.proconfig is null
         or has_function_privilege('anon', p.oid, 'EXECUTE')
         or (p.proname like '\_cost\_%' and has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  if bad is not null then raise exception 'V554: security posture check failed on: %', bad; end if;

  raise notice 'V554: 10 scoped, 9 named-guards intact, definer, search_path pinned, anon revoked';
end $mig$;


-- ============================================================================
-- parts_consumption - THE VERDICT, REPORTED RATHER THAN SILENTLY ACTED ON
-- ============================================================================
-- V553 recorded that parts_consumption is not among the site-scoped tables, so
-- its expense lines stay visible to a site-narrowed user reading the table
-- directly. Whether that was a V269 decision or an omission was measured:
--
-- IT IS AN OMISSION OF CHRONOLOGY, NOT A DECISION. V269 (2026-07-18) added
-- <t>_site_isolation to the 21 operational tables that HAD a site column at the
-- time. parts_consumption was not one of them because it had no site column:
-- V366 (2026-07-27, nine days later) is the migration that added site to it. It
-- could not have been in V269's list, and nothing has revisited the list since.
-- production_logs, which also postdates V269, DID get a site policy - so the
-- gap is specific, not a blanket policy against expense data.
--
-- BUT ADDING A SITE POLICY TO IT WOULD BE WRONG IN A DIFFERENT WAY, and this is
-- why V554 does not add one. V366 derives parts_consumption.site from store_code
-- through store_site_map: it is the ISSUING STORE, not where the machine worked -
-- the same finding V512 recorded when it built get_site_operating_cost to read
-- per-site operating cost THROUGH THE ASSET instead. Measured live:
--
--   parts_consumption distinct site values                43
--   vehicle_fleet     distinct site values                57
--   shared between them                                   19
--   expense lines whose site names no site the fleet uses  96,047
--   value on those lines                                   96,199,422
--
-- So a user scoped to a real fleet site would lose roughly half the expense
-- ledger outright, and what remained would be attributed by which store issued
-- the part rather than by where the work happened. That is not isolation, it is
-- mis-attribution wearing isolation's clothes. Closing it properly means either
-- completing store_site_map so the two vocabularies agree, or scoping expense
-- through the asset the way V512 already does - both of which need the owner's
-- decision and a migration of their own.
--
-- WHAT V554 DOES DO is bound the function surface: the six entry points and four
-- helpers above now apply the caller's site scope to their parts_consumption
-- reads, on the same column the NAMED-site path has always filtered. That is
-- strictly narrowing and cannot expose anything. THE TABLE-LEVEL HOLE REMAINS
-- OPEN and is stated here rather than buried: a site-narrowed user selecting
-- from parts_consumption directly still reads every site's lines.
