-- V557  FINISH THE SITE DIMENSION: THE REST OF THE READ SURFACE
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A) as
-- migration v557_finish_site_scope.
--
-- V553 closed the NAMED-site path on nine functions. V554 closed the ALL-SITES
-- path on ten. Neither claimed to have finished, and neither had: they were
-- scoped by ARGUMENT NAME - "every function taking a p_site" - and that is
-- exactly the enumeration that keeps missing holes. A function does not need a
-- p_site argument to hand a site-narrowed user another site's rows. It only
-- needs to READ a site-bearing table while running as its owner, which is what
-- SECURITY DEFINER means and why RLS never runs inside it.
--
-- V554 IS NOT AT FAULT FOR ITS OWN TEN - THAT WAS RE-MEASURED BEFORE BLAMING IT.
-- An adversarial audit reported get_parts_expense_snapshot returning 108,891
-- lines unchanged and get_maintenance_snapshot 34,131 job cards unchanged under
-- a narrowed user. Re-run here as controls, both now MOVE
-- (11dae5a8a8 -> 95e35f4ef8 and f616f14f8a -> 68b397aeda), as does
-- get_maint_tyre_split. Those audit figures predate v554_all_site_scope_filter,
-- which was applied at 19:23:40 UTC. V554 was partial in POPULATION, not in
-- effect: report_tyre_summary and get_site_operating_cost - the other two the
-- audit named - were never in its list of ten at all.
--
--
-- THE POPULATION, ENUMERATED BY WHAT EACH FUNCTION TOUCHES
--
-- Every SECURITY DEFINER function in public, in plpgsql or sql, that is not a
-- trigger, whose body reads (FROM/JOIN/UPDATE) one of the 115 base tables
-- carrying a `site` column. Not "whose arguments contain p_site".
--
--   executable by authenticated, body reads a site-bearing table   220
--     of which already carried app_site_scope after V554              8
--     of which did not                                             212
--   not executable by authenticated (helpers, service-role only)     28
--
-- 212 is a deliberately wide net and most of it is correctly out of scope. It
-- was narrowed by hand, not by another regex:
--
--   * ~70 read only `profiles` (app_role, is_super_admin, app_current_org,
--     app_can_see_site itself, admin_* user administration). profiles.site is
--     the USER'S OWN site, not a data-row site. Scoping these would be circular
--     - app_site_scope() reads profiles - and would disclose nothing anyway.
--   * ~60 are WRITE RPCs (accident_* workflow, tyre_move, scrap_tyre_by_serial,
--     post_stock_movement, import_*, promote_erp_*). Write scoping is V542/V550's
--     dimension, not this one. Recorded below as still open.
--   * ~30 read a site-bearing table that is EMPTY (pm_service_records 0,
--     stock_records 0, gate_passes 0, drivers 0, ...). Correct to guard
--     eventually, nothing to disclose today.
--   * 4 are anon token boards - get_report_snapshot, get_report_tyre_maintenance,
--     get_display_snapshot, get_accident_portal_snapshot. DELIBERATELY EXCLUDED
--     for the reason V553 recorded: inside a definer function invoked by anon,
--     auth.uid() is NULL, so every scope reader is false and the predicate would
--     return nothing. The token is the authorisation there, not the caller's
--     scope. Adding this predicate would break every public board.
--
-- That leaves the read-reporting surface. EVERY ONE WAS THEN CHECKED BY
-- IMPERSONATION rather than by reading its source - the real Manager 34793423
-- (role Manager, not Admin, not super) narrowed to ARRAY['NHC'] in a rolled-back
-- transaction, each function called on its ALL-SITES default before and after,
-- full ordered payload hashed. 21 came back BYTE-IDENTICAL. Not similar -
-- identical. They cannot tell a narrowed caller from an unrestricted one:
--
--   report_tyre_summary          get_site_operating_cost    report_asset_metrics
--   report_asset_overview        get_country_kpi            reference_site_options
--   report_country_metrics       report_country_trends      get_expense_by_site
--   get_expense_by_country       get_tyre_cost_by_asset     reference_asset_options
--   get_fleet_area_map           tyre_price_coverage        get_daily_job_cards
--   get_tyre_consumption         get_cpk_km_source          get_cpk_unit_audit
--   get_sany_delay_candidates    get_asset_disposal_register  get_subscription_overview
--
-- 20 of those 21 are rewritten here. get_subscription_overview is the one
-- DISMISSED, with evidence, at the foot of this file.
--
-- THE STATIC SIGNAL WAS VALIDATED AGAINST THE EMPIRICAL ONE BEFORE BEING TRUSTED
-- for the heavier functions that time out under a full payload hash: on all 24
-- functions measured both ways, "body contains app_site_scope" agreed with
-- "result moves when the caller is narrowed" in every single case, 24 of 24.
--
--
-- THE PREDICATE IS COPIED BACK FROM A LIVE SITE POLICY WITH pg_get_expr,
-- not adapted from the country one. Read from tyre_records_site_isolation,
-- vehicle_fleet_site_isolation, production_logs_site_isolation and
-- work_orders_site_isolation, which are byte-identical apart from the cast:
--
--   ((site IS NULL)
--    OR (btrim(site) = ''::text)
--    OR (SELECT app_sees_all_sites())
--    OR (upper(btrim(site)) = ANY (COALESCE((SELECT app_site_scope()), '{}'::text[]))))
--
-- THREE THINGS RETYPING GETS WRONG, ALL RE-CONFIRMED LIVE HERE:
--
-- 1. SITE COMPARES **UPPER**. Site values are canonical UPPER (V246) and
--    app_site_scope() aggregates upper(btrim(...)). The country reflex is
--    lower(), and lower() here matches NOTHING - it would blank every screen for
--    a narrowed user rather than scope it, which reads as a broken app, not as a
--    boundary.
--
-- 2. THERE IS AN EXTRA btrim(...) = '' TERM that the country predicate has no
--    equivalent of, because app_can_see_site treats '' as "no site". Blank-site
--    rows are load-bearing and must stay visible to everyone; dropping the term
--    hides them from every narrowed user.
--
-- 3. work_orders.site IS character varying, so the live policy CASTS. (site)::text
--    is used uniformly below - a no-op on the text columns, required on
--    work_orders and purchase_orders.
--
-- is_super_admin() is carried even though it is redundant TODAY.
-- app_sees_all_sites() has is_super_admin and role='Admin' in its own body and
-- is true for all 38 current profiles, so everyone short-circuits on term three.
-- That is the OPPOSITE of the country reader - V549 records app_sees_all_countries()
-- being true for nobody, including the platform owner, so a country predicate
-- built without is_super_admin() returned zero rows to the owner. Keeping the
-- term here costs one InitPlan, is a strict subset of app_sees_all_sites() so it
-- can never widen anything, and keeps the owner whole if app_sees_all_sites() is
-- ever narrowed.
--
-- The zero-argument readers are used rather than the row-argument
-- app_can_see_site(site): written as (select f()) they are uncorrelated
-- subqueries evaluated ONCE per query as an InitPlan, whereas app_can_see_site
-- takes the row value so it cannot be hoisted and is SECURITY DEFINER so it can
-- never be inlined - a per-row profiles lookup over 209,381 expense lines and
-- 212,567 production rows.
--
--
-- WHICH COLUMN EACH FUNCTION IS SCOPED ON - three are judgement calls, not
-- mechanical
--
--   * get_site_operating_cost is scoped on **f.site**, the vehicle_fleet site
--     reached through the lateral, NOT on pc.site. This function exists precisely
--     because V512 established that per-site OPERATING cost must be read THROUGH
--     THE ASSET - pc.site is the issuing STORE. Scoping it by the store would
--     re-introduce the mis-attribution the function was written to avoid. Lines
--     with no resolved asset keep asset_site NULL and stay visible to everyone,
--     which is the idiom's own rule for unknown site.
--
--   * get_expense_by_site is scoped on **m.site**, the store_site_map's mapped
--     site - which is what the function actually REPORTS
--     (COALESCE(m.site, 'Unmapped: ' || pc.store_code)) - not on pc.site. An
--     unmapped store maps to NULL and still shows as "Unmapped: <store>", which
--     is honest: an unmapped store has no known site.
--
--   * reference_site_options is scoped on all SEVEN business-table branches AND
--     on the `sites` REGISTRY branch (by name). Guarding only the seven would
--     have been theatre - the eighth branch alone returns every site name in the
--     company, which is the whole dimension. This is the single highest-value
--     row in the spec: it is the function that hands a narrowed user the list of
--     every site that exists.
--
--
-- 34 replacements over 20 functions, 23 spec rows. Every one is a replace()
-- against the function's own LIVE pg_get_functiondef output - no body is retyped
-- - and every one ABORTS unless its anchor occurs EXACTLY the expected number of
-- times. All 23 counts were verified against the live catalog BEFORE this file
-- was written, so an abort here means something changed underneath, not that the
-- spec was guessed.
--
-- CONCURRENCY. V555 and V556 belong to other sessions which may be rewriting
-- some of these same functions right now. Three defences, and all three abort
-- the WHOLE migration rather than half-applying (the V396 lesson - half a
-- boundary reads as a closed one): the definition is re-read from the catalog
-- immediately before each replacement so successive edits to one function
-- compound correctly; the exact anchor count must still hold at that moment; and
-- any function that already carries app_site_scope is refused outright, so a
-- concurrent session that got there first cannot be overwritten.
--
--
-- VERIFIED - THE COMPARATOR, BEFORE IT WAS TRUSTED. Signatures are taken over a
-- canonically ordered payload with ISO timestamps masked. Hashing the SAME user
-- twice before any change was applied reported get_daily_job_cards as CHANGED,
-- twice over, for two different reasons - and both would have been read as a
-- regression caused by this migration:
--   (a) it carries generated_at, a wall-clock timestamp;
--   (b) it carries kpis.longest_out_hours, which is hours since the OLDEST
--       still-out job card measured against now(). It ticks with the clock. A
--       3-second re-run showed nothing; only a 40-second gap exposed it.
-- The first mask also silently failed because a set-returning row renders as
-- text with DOUBLED quotes (""longest_out_hours""), so a "-anchored pattern
-- matched nothing while appearing to work. Masking is quote-agnostic now, and
-- ONLY those two fields are masked - every count, list and money figure still
-- participates in the hash. Proven STABLE 20 of 20 before applying anything.
--
-- VERIFIED - THE NO-OP. All four reference users, all 20 functions on their
-- ALL-SITES default: super admin d2d43a5f, KSA Manager 34793423, three-country
-- e864b410, Egypt Director a4fd5401.
--
--   THE FIRST COMPARISON WAS NOT CLEAN, AND CHASING IT DOWN MATTERED. 7 of the
--   KSA Manager's 20 calls moved. The cause was NOT this migration:
--   v556_remaining_all_scope was applied at 19:59:11, THIRTY SECONDS after
--   v557_finish_site_scope at 19:58:41, and added COUNTRY scoping to exactly
--   those functions (tyre_price_coverage went from Egypt+KSA+UAE to KSA only for
--   a KSA-only Manager - a country effect, and this migration adds no country
--   predicate). V556 built ON TOP of V557 and preserved its predicate: all 20
--   still carry app_site_scope, so nothing was clobbered in either direction.
--
--   THE NO-OP WAS THEREFORE PROVEN BY ISOLATION rather than by a before/after
--   hash that a parallel migration had contaminated. For each of the 23 spec
--   rows the CURRENT definition (V557 + V556) was taken, ONLY the exact predicate
--   text V557 inserted was stripped out, and the two payloads compared as the KSA
--   Manager: **23 of 23 IDENTICAL**. Any difference would have been attributable
--   to V557 alone. This is the stronger proof, and it is the one that survives
--   concurrent work landing mid-session.
--
--   It also agrees with the logic: app_sees_all_sites() was measured true for all
--   four users (and app_site_scope() = {ALL} for all four), so the predicate's
--   third disjunct is TRUE for every row and it cannot filter anything today.
--
-- VERIFIED - THAT IT BITES. The same real KSA Manager narrowed to ARRAY['NHC']
-- inside a transaction forced to ROLL BACK. The profile UPDATE was authorised by
-- setting request.jwt.claims to a super admin so trg_guard_profile_privileged
-- passes; NO trigger was disabled. Same user, same ALL-SITES calls, nothing but
-- profiles.sites changed: **20 of 20 narrowed**, and concretely -
--
--   reference_site_options   40+ sites (AMAALA, DHAHBAN, DIRIYAH, DIRIYAH-G1/G2,
--                            JED, JEDDAH, JIZAN, KSP, KSP-T1/T3/TP, LAHEQ, MALHAM,
--                            METRO, MISK, NEOM, NHC, QIDDIYA, ...)  ->  NHC
--   get_expense_by_site      NHC 1,340,416 / DIRIYAH 743,484 / RIY-MET 365,579 /
--                            QIDDIYA 313,314 / RED SEA 250,870 / METRO 243,896 /
--                            DIRIYAH-ST2 141,148 / AMAALA 133,834 / KSP 108,641 /
--                            LAHEQ 29,472 / QIDDIYA-UP 8,017 / MALHAM 512
--                            ->  NHC 1,340,416 ONLY
--   tyre_price_coverage      KSA 8,145 tyres / 5,860 priced -> 3,846 / 1,779
--   get_site_operating_cost  28 by_site rows -> 2
--
-- 3,846 is 1,805 NHC + 2,041 site-less rows, which reproduces V553's and V554's
-- independent measurement of the same narrowing to the row - the scoping agrees
-- with what RLS already does on the tables that have a policy.
--
-- AFTERWARDS: all 38 profiles still carry sites = {ALL}; narrowed to a real site
-- = 0. Nothing on this database was left modified. V553's nine named-site guards
-- and V554's ten all-sites predicates both re-verified intact after the fact.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v557, which holds the
-- exact prior definition text and its md5 for all 20. _bak.v557_probe holds the
-- signature evidence.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v557;
create table _bak.rpc_defs_v557 (proname text, def text, def_md5 text, saved_at timestamptz default now());


-- One-shot / concurrency guard. Every anchor below survives this migration, so a
-- second run would append the predicate twice. Abort instead. This also catches a
-- parallel session having already scoped one of these.
do $mig$
declare bad text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'report_tyre_summary','report_asset_metrics','report_asset_overview','get_country_kpi',
      'get_expense_by_site','get_tyre_cost_by_asset','get_site_operating_cost','reference_site_options',
      'reference_asset_options','report_country_metrics','report_country_trends','get_expense_by_country',
      'get_fleet_area_map','tyre_price_coverage','get_daily_job_cards','get_tyre_consumption',
      'get_cpk_km_source','get_cpk_unit_audit','get_sany_delay_candidates','get_asset_disposal_register')
    and position('app_site_scope' in pg_get_functiondef(p.oid)) > 0;
  if bad is not null then
    raise exception 'V557: already applied, or a parallel session scoped these first: %', bad;
  end if;
end $mig$;


-- spec: pname / anchor (must occur exactly `want` times) / site column / want
do $mig$
declare
  r        record;  oid_ oid;  nfound int;  def text;  newdef text;  occ int;  scope text;  col text;
  n        int := 0;  reps int := 0;  changed text[] := '{}';
begin
  for r in
    select * from (values
      -- ---- reads anchored on the V549 country predicate (its exact tail) ----
      ('report_tyre_summary',        $$lower(btrim(r.country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))$$, 'r.site', 1),
      ('report_asset_metrics',       $$lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))$$,   'site',   1),
      ('report_asset_overview',      $$lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))$$,   'site',   1),
      -- get_country_kpi: two corrective_actions sub-selects (a) + one tyre_records read (t)
      ('get_country_kpi',            $$lower(btrim(a.country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))$$, 'a.site', 2),
      ('get_country_kpi',            $$lower(btrim(t.country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))$$, 't.site', 1),

      -- ---- reads anchored on their own org predicate ----
      -- scoped on the MAPPED site the function reports, not on the raw store
      ('get_expense_by_site',        $$WHERE pc.organisation_id = (SELECT oid FROM org)$$, 'm.site', 1),
      ('get_tyre_cost_by_asset',     $$WHERE organisation_id = public.app_current_org()$$, 'site',   1),
      -- scoped THROUGH THE ASSET (V512), never on the issuing store
      ('get_site_operating_cost',    $$where pc.organisation_id = v_org$$, 'f.site', 1),

      -- reference_site_options: 7 business-table UNION branches ...
      ('reference_site_options',     $$WHERE btrim(coalesce(site,'')) <> '' AND organisation_id = public.app_current_org()$$, 'site', 7),
      -- ... AND the sites REGISTRY branch, or the function still lists every site
      ('reference_site_options',     $$WHERE btrim(coalesce(name,'')) <> '' AND coalesce(active,true) AND organisation_id = public.app_current_org()$$, 'name', 1),
      -- 3 UNION branches over vehicle_fleet / tyre_records / inspections
      ('reference_asset_options',    $$WHERE btrim(coalesce(asset_no,'')) <> '' AND organisation_id = public.app_current_org()$$, 'site', 3),

      ('report_country_metrics',     $$AND (organisation_id IS NULL OR organisation_id = public.app_current_org() OR public.app_is_org_admin())$$, 'site', 1),
      ('report_country_trends',      $$and (r.organisation_id is null or r.organisation_id = public.app_current_org() or public.app_is_org_admin())$$, 'r.site', 1),
      ('get_expense_by_country',     $$where organisation_id = public.app_current_org()$$, 'site',   1),
      ('get_fleet_area_map',         $$where f.organisation_id = v_org$$,                  'f.site', 1),
      ('tyre_price_coverage',        $$where t.organisation_id = public.app_current_org()$$,'t.site', 1),
      -- work_orders.site is character varying - the (col)::text cast matters here
      ('get_daily_job_cards',        $$where organisation_id = v_org$$,                     'site',   1),
      ('get_tyre_consumption',       $$where t.organisation_id = v_org$$,                   't.site', 2),
      ('get_cpk_km_source',          $$where t.organisation_id = v_org$$,                   't.site', 2),
      ('get_cpk_unit_audit',         $$where t.organisation_id = v_org and (p_country is null or t.country = p_country)$$, 't.site', 1),
      ('get_cpk_unit_audit',         $$where e.organisation_id = v_org and (p_country is null or e.country = p_country)$$, 'e.site', 1),
      ('get_sany_delay_candidates',  $$where wo.organisation_id = v_org$$,                  'wo.site',1),
      -- scoping the base disposal read bounds every per-asset enrichment below it
      ('get_asset_disposal_register',$$where organisation_id = v_org$$,                     'site',   1)
    ) v(pname, anchor, col, want)
  loop
    select count(*), min(p.oid) into nfound, oid_ from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname='public' and p.proname = r.pname and p.prosecdef;
    if nfound <> 1 then raise exception 'V557: expected exactly 1 public.%, found %', r.pname, nfound; end if;

    -- re-read LIVE on every pass: successive edits to one function compound, and a
    -- concurrent rewrite is caught by the anchor count below rather than clobbered
    def := pg_get_functiondef(oid_);

    if not (r.pname = any(changed)) then
      insert into _bak.rpc_defs_v557 (proname, def, def_md5) values (r.pname, def, md5(def));
      changed := changed || r.pname;
    end if;

    occ := (length(def) - length(replace(def, r.anchor, ''))) / length(r.anchor);
    if occ <> r.want then
      raise exception 'V557: anchor for % matched % times, expected exactly % [%]', r.pname, occ, r.want, left(r.anchor,70);
    end if;

    col := '(' || r.col || ')::text';
    scope := ' and (' || col || ' is null'
      || ' or btrim(' || col || ') = ' || quote_literal('')
      || ' or (select public.is_super_admin())'
      || ' or (select public.app_sees_all_sites())'
      || ' or upper(btrim(' || col || ')) = any(coalesce((select public.app_site_scope()), ''{}''::text[])))';

    newdef := replace(def, r.anchor, r.anchor || scope);
    if position('app_site_scope' in newdef) = 0 then raise exception 'V557: predicate not inserted on %', r.pname; end if;

    execute newdef;
    n := n + 1;
    reps := reps + occ;
  end loop;

  if n <> 23 then raise exception 'V557: expected 23 spec rows, applied %', n; end if;
  if reps <> 34 then raise exception 'V557: expected 34 replacements, applied %', reps; end if;
  if array_length(changed,1) <> 20 then raise exception 'V557: expected 20 distinct functions, touched %', array_length(changed,1); end if;
  raise notice 'V557: % replacements over % functions', reps, array_length(changed,1);
end $mig$;


-- FINAL ASSERTION. All 20 carry the row predicate AND both short-circuit terms;
-- V553's named-site guard and V554's ten are untouched; and every one of the 20
-- is still definer / search_path pinned / not anon-executable. Aborts the whole
-- migration otherwise.
do $mig$
declare bad text; cnt int;
begin
  select count(*) into cnt from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname in (
    'report_tyre_summary','report_asset_metrics','report_asset_overview','get_country_kpi',
    'get_expense_by_site','get_tyre_cost_by_asset','get_site_operating_cost','reference_site_options',
    'reference_asset_options','report_country_metrics','report_country_trends','get_expense_by_country',
    'get_fleet_area_map','tyre_price_coverage','get_daily_job_cards','get_tyre_consumption',
    'get_cpk_km_source','get_cpk_unit_audit','get_sany_delay_candidates','get_asset_disposal_register')
    and position('app_site_scope'     in pg_get_functiondef(p.oid)) > 0
    and position('app_sees_all_sites' in pg_get_functiondef(p.oid)) > 0
    and position('is_super_admin'     in pg_get_functiondef(p.oid)) > 0;
  if cnt <> 20 then raise exception 'V557: expected 20 scoped functions, found %', cnt; end if;

  -- V554's ten must still carry theirs
  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname in (
    'get_cost_cpk_overview','get_cost_variance','get_maint_tyre_split','get_maintenance_snapshot',
    'get_parts_expense_snapshot','get_report_snapshot_authed','_cost_totals','_cost_cpk','_cost_dim','_cost_var_dim')
    and position('app_site_scope' in pg_get_functiondef(p.oid)) = 0;
  if bad is not null then raise exception 'V557: V554 all-sites predicate lost on: %', bad; end if;

  -- V553's named-site guard must still be on its nine
  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname in (
    'get_cost_cpk_overview','get_cost_cpk_overview_multi','get_cost_variance','get_cost_variance_multi',
    'get_maint_tyre_split','get_maintenance_snapshot','get_parts_expense_snapshot',
    'get_parts_expense_snapshot_multi','get_report_snapshot_authed')
    and position('app_can_see_site' in pg_get_functiondef(p.oid)) = 0;
  if bad is not null then raise exception 'V557: V553 named-site guard lost on: %', bad; end if;

  -- security posture unchanged on all 20
  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname in (
    'report_tyre_summary','report_asset_metrics','report_asset_overview','get_country_kpi',
    'get_expense_by_site','get_tyre_cost_by_asset','get_site_operating_cost','reference_site_options',
    'reference_asset_options','report_country_metrics','report_country_trends','get_expense_by_country',
    'get_fleet_area_map','tyre_price_coverage','get_daily_job_cards','get_tyre_consumption',
    'get_cpk_km_source','get_cpk_unit_audit','get_sany_delay_candidates','get_asset_disposal_register')
    and (not p.prosecdef or p.proconfig is null or has_function_privilege('anon', p.oid, 'EXECUTE'));
  if bad is not null then raise exception 'V557: security posture check failed on: %', bad; end if;

  raise notice 'V557: 20 scoped, V553 + V554 intact, definer, search_path pinned, anon revoked';
end $mig$;


-- ============================================================================
-- WHAT IS DELIBERATELY NOT DONE, REPORTED RATHER THAN PAPERED OVER
-- ============================================================================
--
-- 1. get_subscription_overview IS DISMISSED, NOT MISSED. It came back
--    byte-identical under narrowing like the other 21, and it does count
--    vehicle_fleet. But the count it returns is a BILLING fact - seats and
--    vehicles against the org's plan limit, read through dynamic SQL beside
--    profiles and api_keys counts. Plan limits are org-wide by definition, so
--    site-scoping it would make an org's plan usage read differently depending
--    on who opened the billing page, and would under-report usage against the
--    cap. It discloses one integer, not site-attributable operational data.
--
-- 2. parts_consumption STILL HAS NO SITE RLS POLICY, AND V557 DOES NOT ADD ONE.
--    V554 established why, and re-measuring did not change the verdict: that
--    column is the ISSUING STORE, not where the machine worked. Only 19 of its
--    43 distinct site values are shared with the fleet register's 57, and 96,047
--    lines carry a value the register never uses. A user scoped to a real fleet
--    site would lose roughly half the expense ledger outright and read the rest
--    attributed by which store issued the part. That is mis-attribution wearing
--    isolation's clothes. Closing it properly means completing store_site_map or
--    scoping expense through the asset the way get_site_operating_cost now does.
--    THE TABLE-LEVEL HOLE REMAINS OPEN: a site-narrowed user selecting from
--    parts_consumption directly still reads every site's lines. The function
--    surface above is bounded; the table is not.
--
-- 3. SITE-LESS ROWS ARE VISIBLE TO EVERYONE BY DESIGN, and the headline figure
--    for this needs restating because the two populations get mixed up. Measured:
--
--      tyre_records total                     11,191
--      site IS NULL, whole table               3,605   (32.2% of the table)
--      KSA rows                                8,145
--      site IS NULL within KSA                 2,041   (25.1% of KSA)
--
--    "3,605 = 44% of KSA" divides the TABLE-WIDE null count by the KSA
--    denominator (3,605/8,145 = 44.3%) and so mixes two populations. The honest
--    pair is 3,605 of 11,191 table-wide, or 2,041 of 8,145 within KSA. 2,041 is
--    the figure that matters for a KSA user, and it is corroborated
--    independently: the narrowed Manager reads 3,846 tyre rows = 1,805 NHC +
--    2,041 site-less, which is exactly V553's and V554's measurement.
--
--    Either way the point stands: the policy idiom's `is null` term makes those
--    rows visible to EVERYONE. That is by design, not a defect - a row with no
--    recorded site cannot be withheld without asserting a site nobody recorded.
--    It is stated here so nobody mistakes site scoping for complete coverage. A
--    narrowed user sees their own site PLUS every site-less row, which is why a
--    narrowed all-scope result legitimately differs from an explicit named-site
--    result rather than matching it byte for byte.
--
-- 4. WRITE scoping through SECURITY DEFINER RPCs is NOT this migration's
--    dimension. V542/V550 scoped the write policies, but ~60 definer write RPCs
--    (accident_* workflow, tyre_move, scrap_tyre_by_serial, post_stock_movement,
--    promote_erp_*) run as owner and so bypass those policies exactly as the
--    read functions bypassed the read ones. That is the same defect class one
--    verb over, and it is still open.
--
-- 5. ~30 further definer functions read a site-bearing table that is EMPTY today
--    (pm_service_records, stock_records, gate_passes, drivers and others). They
--    are correct to guard eventually and disclose nothing now; they were left
--    alone rather than rewritten blind against zero rows.
--
--
-- ============================================================================
-- CAN SITE ISOLATION BE SWITCHED ON NOW? NO - AND HERE IS EXACTLY WHAT LEAKS
-- ============================================================================
-- Measured, not inferred: the same KSA Manager narrowed to sites={NHC} in a
-- rolled-back transaction, reading as role `authenticated` so RLS applies.
--
--   DIRECT TABLE READ, the biggest hole:
--     select count(*) from parts_consumption  ->  108,891 rows
--     spanning AMAALA, DIRIYAH, JED, KSP-T1, NHC, RED SEA, RIY-MET, RIY-SAL
--     That table has NO site policy (item 2 above). The control beside it
--     behaves correctly: tyre_records -> 3,846, because it HAS one.
--
--   DEFINER READ FUNCTIONS STILL WITHOUT ANY SITE PREDICATE. 80 remain after
--   V557. Most are writes, admin, elevated-only reconciliation, or read empty
--   tables - but these are ordinary reporting surfaces a Manager can call, and
--   two were confirmed leaking by name:
--     list_scrapped_tyres        -> still names DIRIYAH, KSP-TP, QIDDIYA,
--                                   RED SEA, RIY-MET
--     get_production_rejections  -> returns every station's rejected production
--   and, unverified individually but structurally identical: get_fleet_cpk,
--   get_brand_size_cpk, get_cpk_drivers, get_cpk_hours_source,
--   get_cpk_km_intelligence, get_cost_per_m3, get_cost_per_m3_trend,
--   get_production_stations, get_asset_master, get_asset_ownership,
--   get_control_center_summary, get_data_trust_overview, get_figure_lineage,
--   holding_consolidated_kpis, data_completeness, data_link_audit,
--   get_asset_disposal_reliability, get_asset_disposal_fleet_baseline,
--   get_console_stats, get_tyre_gap_overview, fx_coverage,
--   get_classification_decisions.
--
--   WRITES. ~60 definer write RPCs still run as owner and so bypass the V542/V550
--   write policies exactly as these read functions bypassed the read ones.
--
-- SO: the READ surface a site-narrowed user meets on the main reporting screens
-- is now bounded, and the site dimension itself (reference_site_options,
-- get_expense_by_site, get_site_operating_cost) no longer enumerates other sites.
-- That is real progress and it is provably a no-op for everyone today. But
-- switching site isolation ON for a real user would still hand them every site's
-- expense ledger through parts_consumption directly, and other sites by name
-- through list_scrapped_tyres. Do NOT narrow a live user's sites until at least
-- the parts_consumption question is decided and the remaining read functions are
-- guarded the same way this migration guards its twenty.
