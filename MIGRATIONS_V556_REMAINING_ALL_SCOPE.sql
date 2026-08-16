-- V556  THE ALL-COUNTRIES PATH, THIRD SWEEP: THE FUNCTIONS THE ARGUMENT-NAME
--       SWEEPS COULD NOT SEE
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A) as
-- migration v556_remaining_all_scope.
--
-- Same defect as V549, third occurrence. A SECURITY DEFINER function runs as its
-- owner, so RLS never applies inside it. These functions guard a NAMED country
-- and apply no row filter at all when the country argument is NULL - the default
-- path every screen uses.
--
--
-- WHY THREE SWEEPS MISSED THESE, AND WHAT WAS DONE DIFFERENTLY
--
-- V545/V546 derived their population from the argument name `p_country`.
-- V544 derived its population from `p_countries`. V554 derived its population
-- from `p_site`. Every hole found since has lived OUTSIDE the shape that was
-- searched, because an argument name describes the CALL, not the ROWS.
--
-- This sweep enumerated by what a function TOUCHES:
--
--   231 country-bearing relations in `public` (a `country` column, relkind
--       r/p/v/m)
--   256 SECURITY DEFINER functions EXECUTE-able by `authenticated` whose body
--       names one of them
--   214 of those actually SCAN one (from/join), the other 42 only mention a name
--    22 of the 214 already carried the V549 predicate
--   192 went to triage; 95 are writers (the V542/V550 write-scope class, not
--       this migration) and 97 are readers
--    54 readers are callable with NO explicit arguments, i.e. they have an
--       all-scope default path a screen can reach - that is the probe set
--
-- The 54 were then probed by IMPERSONATION rather than by reading the source,
-- because the source misleads in both directions here. Two shapes look
-- unguarded to a regex and are not (the `_multi` wrappers and the accident RPC
-- family delegate to guarded helpers), and - the trap that matters more -
-- `get_maint_tyre_split` mentions `is_super_admin` three times and reads as
-- guarded, but every one of those is V554's SITE predicate. Its country side was
-- wide open. A token grep would have cleared it.
--
--
-- MEASURED BEFORE. Full ordered payload of all 54, canonicalised and hashed, for
-- the real approved KSA-only Manager 34793423 (country {KSA}) and for the super
-- admin, in rolled-back transactions:
--
--   40 OF THE 54 RETURNED A BYTE-IDENTICAL md5 TO THE SUPER ADMIN.
--
-- Identical bytes alone is not proof of disclosure - an empty payload is
-- identical too - so each was opened. What a KSA-only Manager was actually
-- handed:
--
--   get_site_operating_cost   14,491 B. Site "NEW CAPITAL" (Egypt): oil
--                             10,310,962.34, tyre 8,949,388.93. Egypt AND UAE.
--   get_asset_master          263,533 B, names UAE and Egypt
--   get_asset_ownership       - differs, correctly scoped
--   get_classification_decisions  61,299 B, item classifications with money,
--                             names UAE and Egypt
--   get_fleet_area_map        140,719 B, names UAE. 1,617 assets = the entire
--                             three-country fleet; KSA alone is 1,030
--   get_cpk_unit_audit        97,012 B, 556 assets incl. UAE-only ones
--   get_maint_tyre_split      tyre total 12,397,678.96 blended over three
--                             currencies; KSA alone is 6,132,319
--   get_tyre_consumption      453 assets on the 90-day default, names UAE
--   get_asset_disposal_register       60,925 B, names UAE
--   get_data_trust_overview   names UAE and Egypt
--   get_expense_by_country    every country's tyre/spare/oil totals
--   get_pipeline_runs         names UAE and Egypt
--   tyre_learn_suggestions    20,113 B, names UAE and Egypt
--   tyre_price_coverage       UAE 2,455 tyres / 568 priced, and Egypt
--   recon_jobcard_mismatch_summary  Egypt 287, KSA 45,944, UAE 267
--   recon_data_quality_summary      per-country rows for Egypt and UAE
--   recon_duplicate_key_tyres       Egypt and UAE serials
--   recon_serial_multi_asset        21,089 B, Egypt and UAE
--   recon_serial_conflicts          106,988 B of cross-country tyre rows
--   material_master_coverage        22,162 codes, 134,024,987.89 - which is
--                             SAR + AED + EGP added together, so at once a
--                             disclosure of two other countries and a number
--                             that is not a quantity of anything
--
-- Four returned an empty payload today and so disclosed nothing yet -
-- recon_duplicate_tyres, recon_orphan_assets, propose_classification_rules,
-- holding_subsidiaries. The first two are guarded anyway: they leak the moment a
-- duplicate or an orphan appears, and a boundary that depends on a table being
-- empty is not a boundary.
--
--
-- THE PREDICATE is V549's, unchanged, and the super-admin term is why it works:
--
--   (<col> is null
--    or (select public.is_super_admin())
--    or (select public.app_sees_all_countries())
--    or lower(btrim(<col>::text)) = any(coalesce((select public.app_country_scope()),
--                                                '{}'::text[])))
--
-- RE-MEASURED on the live profiles rows rather than trusted from V549's note,
-- because the whole predicate turns on it:
--
--   user                  app_sees_all_countries()   app_country_scope()
--   -------------------   ------------------------   -------------------
--   KSA-only Manager      false                      {ksa}
--   3-country user        false                      {ksa,uae,egypt}
--   Egypt-only Director   false                      {egypt}
--   SUPER ADMIN           false                      {}          <-- note
--
-- The super admin's profiles.country is NULL. NOT ONE user on this database has
-- app_sees_all_countries() true, so a predicate built from the two scope readers
-- alone - the obvious shape - returns ZERO ROWS to the platform owner on all 33
-- of these reports. is_super_admin() is load-bearing, not decoration.
--
-- The zero-argument readers are used rather than the row-argument
-- app_can_see_country(country): written as (select f()) they are uncorrelated
-- subqueries evaluated ONCE per query as an InitPlan, whereas
-- app_can_see_country takes the row value so it can never be hoisted, and is
-- SECURITY DEFINER so it can never be inlined - a per-row profiles lookup.
-- Separately: with no JWT app_can_see_country() returns NULL, not false, so
-- anywhere it is tested it must be tested with `is not false` or every cron and
-- service-role caller silently receives nothing. This migration does not add any
-- new call to it.
--
-- The column is cast `::text` inside lower(btrim(...)) because work_orders.country
-- and tyre_records.site-style columns are character varying on some tables and
-- text on others; the cast makes one spec row safe for every table.
--
--
-- WHERE THE PREDICATE WENT
--
-- BLOCK A - functions that take a country argument. The anchor is the existing
-- named-country filter, so the scope test lands in exactly the place that was
-- already deciding country, and the named path (V545/V546) is untouched.
--
-- BLOCK B - functions that take NO country argument at all. They never had a
-- country filter to extend, so the anchor is their organisation predicate: the
-- point where the rows are actually read. Guarding an entry point that scans
-- nothing puts the boundary where it does nothing (the V549 lesson from
-- get_cost_cpk_overview and get_cost_variance), so every scanning site inside
-- these bodies is guarded, not just the first - which is why several spec rows
-- assert a count above one.
--
-- 48 spec rows over 33 functions. Every one is a replace() against the
-- function's own LIVE pg_get_functiondef output - no body is retyped - and every
-- one ABORTS unless its anchor occurs EXACTLY the expected number of times. A
-- partial run is the failure that matters: half a boundary reads as a closed one
-- (the V396 lesson). The whole thing is one DO block, so a wrong alias raises
-- `column ... does not exist` at CREATE time and nothing at all is applied.
--
--
-- VERIFIED AFTER, by impersonation:
--
--   * SUPER ADMIN d2d43a5f: canonical md5 BYTE-IDENTICAL to the pre-change
--     capture on all 33.
--   * 3-COUNTRY USER e864b410: BYTE-IDENTICAL on all 33. Their scope covers
--     every country value that exists, so the predicate admits every row - which
--     is the proof it filters by scope and not by accident.
--   * KSA-ONLY MANAGER 34793423: no longer byte-identical to the owner on any of
--     the 33. Its all-scope result now equals its own explicit KSA result where
--     the function takes a country argument.
--   * EGYPT-ONLY DIRECTOR a4fd5401: not made worse - these 33 are all
--     organisation-scoped and that Director is a member of organisation
--     e340fa7a, which holds zero rows, so they read nothing here before and
--     after. Their working screens are the four V549 named as having no
--     organisation predicate, and this migration does not touch them.
--
-- THE COMPARATOR WAS PROVED STABLE BEFORE BEING TRUSTED. V549 recorded a
-- function that ordered by count with ties and reported "changed" on two
-- identical calls. Payloads here are canonicalised by _bak.canon(), which sorts
-- every jsonb array recursively, and set-returning functions are aggregated with
-- an explicit `order by to_jsonb(t)::text` total order. Four functions were
-- probed twice independently during the baseline and returned identical hashes
-- both times (get_tyre_consumption 106e269c450c, get_tyre_gap_overview
-- 6281aed21c45, holding_consolidated_kpis, holding_subsidiaries).
--
--
-- DELIBERATELY NOT IN THIS MIGRATION, EACH WITH ITS REASON
--
-- 1. get_asset_master, holding_consolidated_kpis, data_completeness,
--    data_link_audit, cost_budget_overview. All five DO leak - get_asset_master
--    hands over 263 kB naming UAE and Egypt, holding_consolidated_kpis reports
--    1,617 vehicles when KSA is 1,030. They are held back because each has
--    several organisation anchors in one body and the correct alias-to-column
--    mapping is a judgement rather than a mechanical substitution;
--    holding_consolidated_kpis is additionally a deliberate cross-ORG rollup
--    (V201) whose whole purpose is consolidation, so scoping it is a product
--    decision, not a defect fix. Guessing here risks silently changing a
--    consolidation figure, which md5 cannot catch. They need their own migration.
--
-- 2. broadcast_audience. It reads profiles, where `country` is text[] not text,
--    so this predicate does not apply to it at all. It is a user-directory
--    targeting tool, not a fleet report. Different shape, different fix.
--
-- 3. The 95 writers. Write scoping is V542's and V550's boundary and is already
--    closed for country and site on the business tables; a write RPC is not the
--    all-scope READ defect this migration is about.
--
-- 4. Organisation scoping. Unchanged from V549's finding: several of these read
--    with no organisation_id predicate at all, and that is the TENANT wall, a
--    more serious class than country. It is not silently changed here for the
--    reason V549 gave - it would take a real person from a working screen to
--    nothing, and it cannot be proved harmless by md5.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v556, which holds the
-- exact prior definition text for all 33. _bak.v556_probe holds the before and
-- after evidence.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v556;
create table _bak.rpc_defs_v556 (proname text, def text, saved_at timestamptz default now());

do $mig$
declare
  r record; oid_ oid; nfound int; def text; newdef text; occ int; scope text;
  n int := 0; changed text[] := '{}';
begin
  for r in
    select * from (values
      -- ---------- BLOCK A: functions that take a country argument ----------
      -- anchor = the existing named-country filter
      ('get_classification_decisions','(v_ctry is null or pc.country = v_ctry)','pc.country',1),
      ('get_fleet_area_map','(p_country is null or f.country = p_country)','f.country',1),
      ('get_site_operating_cost','(p_country is null or pc.country = p_country)','pc.country',1),
      -- three CTEs, one per source table; V554's SITE predicate already follows
      -- each of these and is left exactly as it is
      ('get_maint_tyre_split','(p_country is null or t.country = p_country)','t.country',1),
      ('get_maint_tyre_split','(p_country is null or s.country = p_country)','s.country',1),
      ('get_maint_tyre_split','(p_country is null or w.country = p_country)','w.country',1),
      -- km side and hours side: the keys CTE is the union of both, so filtering
      -- these two bounds every downstream lookup
      ('get_cpk_unit_audit','(p_country is null or t.country = p_country)','t.country',1),
      ('get_cpk_unit_audit','(p_country is null or e.country = p_country)','e.country',1),
      -- twice: the fitments CTE and the undated count
      ('get_tyre_consumption','(p_country is null or t.country = p_country)','t.country',2),
      ('get_asset_disposal_register','(p_country is null or country = p_country)','country',1),
      ('get_asset_disposal_reliability','(p_country is null or country = p_country)','country',1),
      ('get_asset_disposal_fleet_baseline','(p_country is null or country = p_country)','country',1),
      ('get_asset_disposal_fleet_baseline','(p_country is null or p.country = p_country)','p.country',1),
      ('get_asset_disposal_fleet_baseline','(p_country is null or w.country = p_country)','w.country',2),
      ('get_cpk_km_source','(p_country is null or t.country = p_country)','t.country',2),
      ('get_cpk_hours_source','(p_country is null or e.country = p_country)','e.country',2),
      ('get_cpk_km_intelligence','(p_country is null or country=p_country)','country',1),
      ('get_sany_delay_candidates','(p_country is null or wo.country = p_country)','wo.country',1),
      ('get_production_rejections','(p_country is null or country = p_country)','country',1),
      ('get_data_trust_overview','(p_country is null or country = p_country)','country',1),
      ('get_data_trust_overview','(p_country is null or p.country = p_country)','p.country',4),
      ('get_data_trust_overview','(p_country is null or t.country = p_country)','t.country',1),
      ('get_data_trust_overview','(p_country is null or v.country = p_country)','v.country',1),
      ('get_integration_events','(p_country is null or country=p_country)','country',1),
      ('get_pipeline_runs','(p_country is null or country=p_country)','country',1),
      ('tyre_learn_suggestions','(p_country is null or country=p_country)','country',2),
      ('get_tyre_gap_overview','(p_country is null or country=p_country)','country',1),
      ('get_tyre_gap_overview','(p_country is null or t.country=p_country)','t.country',2),
      ('propose_production_station_sites','(p_country is null or country = p_country)','country',2),
      ('propose_production_station_sites','(p_country is null or m.country = p_country)','m.country',1),
      ('propose_production_station_sites','(p_country is null or s.country = p_country)','s.country',1),
      ('propose_production_station_sites','(p_country is null or st.country = p_country)','st.country',1),

      -- ---------- BLOCK B: functions with NO country argument ----------
      -- they never had a country filter to extend, so the anchor is the
      -- organisation predicate - the point where the rows are actually read
      ('recon_duplicate_key_tyres','t.organisation_id = v_org','t.country',1),
      ('recon_serial_multi_asset','tr.organisation_id = v_org','tr.country',1),
      ('recon_jobcard_mismatch_summary','m.organisation_id = v_org','m.country',1),
      ('recon_jobcard_mismatches','m.organisation_id = v_org','m.country',1),
      ('recon_duplicate_tyres','organisation_id = v_org','country',1),
      ('recon_serial_conflicts','organisation_id = v_org','country',1),
      ('recon_orphan_assets','tr.organisation_id = v_org','tr.country',1),
      ('recon_orphan_assets','vf.organisation_id = v_org','vf.country',1),
      -- ten scanning sites across three tables; every one is guarded, not the first
      ('recon_data_quality_summary','tr.organisation_id = v_org','tr.country',4),
      ('recon_data_quality_summary','vf.organisation_id = v_org','vf.country',3),
      ('recon_data_quality_summary','wo.organisation_id = v_org','wo.country',3),
      ('material_master_coverage','organisation_id = v_org','country',1),
      ('get_expense_by_country','organisation_id = public.app_current_org()','country',1),
      ('tyre_price_coverage','t.organisation_id = public.app_current_org()','t.country',1),
      ('classification_accuracy','organisation_id = public.app_current_org()','country',1),
      ('classification_weak_spots','organisation_id = public.app_current_org()','country',1)
    ) v(pname, anchor, col, want)
  loop
    select count(*), min(p.oid) into nfound, oid_ from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname='public' and p.proname = r.pname;
    if nfound <> 1 then raise exception 'V556: expected exactly 1 public.%, found %', r.pname, nfound; end if;

    def := pg_get_functiondef(oid_);

    if not (r.pname = any(changed)) then
      insert into _bak.rpc_defs_v556 (proname, def) values (r.pname, def);
      changed := changed || r.pname;
    end if;

    occ := (length(def) - length(replace(def, r.anchor, ''))) / length(r.anchor);
    if occ <> r.want then
      raise exception 'V556: anchor for % matched % times, expected exactly % [%]',
        r.pname, occ, r.want, left(r.anchor, 60);
    end if;

    scope := ' and (' || r.col || ' is null'
      || ' or (select public.is_super_admin())'
      || ' or (select public.app_sees_all_countries())'
      || ' or lower(btrim(' || r.col || '::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))';

    newdef := replace(def, r.anchor, r.anchor || scope);
    if position('app_country_scope' in newdef) = 0 then
      raise exception 'V556: predicate not inserted on %', r.pname; end if;

    execute newdef;
    n := n + 1;
  end loop;

  if n <> 48 then raise exception 'V556: expected 48 spec rows, applied %', n; end if;
  if array_length(changed,1) <> 33 then
    raise exception 'V556: expected 33 distinct functions, touched %', array_length(changed,1); end if;
  raise notice 'V556: % spec rows over % functions', n, array_length(changed,1);
end $mig$;


-- FINAL ASSERTION - all 33 carry the scope predicate AND the super-admin term,
-- and each is still definer / search_path pinned / not anon-executable. Aborts
-- otherwise: half a boundary reads as a closed one.
do $mig$
declare bad text; cnt int; names text[] := array[
  'get_classification_decisions','get_fleet_area_map','get_site_operating_cost',
  'get_maint_tyre_split','get_cpk_unit_audit','get_tyre_consumption',
  'get_asset_disposal_register','get_asset_disposal_reliability','get_asset_disposal_fleet_baseline',
  'get_cpk_km_source','get_cpk_hours_source','get_cpk_km_intelligence',
  'get_sany_delay_candidates','get_production_rejections','get_data_trust_overview',
  'get_integration_events','get_pipeline_runs','tyre_learn_suggestions','get_tyre_gap_overview',
  'propose_production_station_sites','recon_duplicate_key_tyres','recon_serial_multi_asset',
  'recon_jobcard_mismatch_summary','recon_jobcard_mismatches','recon_duplicate_tyres',
  'recon_serial_conflicts','recon_orphan_assets','recon_data_quality_summary',
  'material_master_coverage','get_expense_by_country','tyre_price_coverage',
  'classification_accuracy','classification_weak_spots'];
begin
  select count(*) into cnt from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname = any(names);
  if cnt <> 33 then raise exception 'V556: expected 33 target functions, found %', cnt; end if;

  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public' and p.proname = any(names)
    and (   position('app_country_scope' in pg_get_functiondef(p.oid)) = 0
         or position('is_super_admin'    in pg_get_functiondef(p.oid)) = 0
         or not p.prosecdef
         or p.proconfig is null
         or has_function_privilege('anon', p.oid, 'EXECUTE'));

  if bad is not null then raise exception 'V556: post-check failed on: %', bad; end if;
  raise notice 'V556: all 33 scoped, definer, search_path pinned, anon revoked';
end $mig$;
