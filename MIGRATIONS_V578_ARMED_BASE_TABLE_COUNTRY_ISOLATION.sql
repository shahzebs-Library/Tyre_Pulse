-- =====================================================================================
-- V578 - THE TABLES V574 LEFT ARMED. 102 SCOPED, 14 DELIBERATELY NOT.
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc as
-- `v578_armed_base_table_country_isolation` (version 20260817104205).
-- =====================================================================================
--
-- V574 closed six base tables that leaked foreign rows on a DIRECT read with no function
-- involved, and recorded that ~120 more shared the shape but held "ZERO rows today" -
-- armed, not leaking. This closes them. The population and the premise both needed
-- correcting first, and the corrections are the most useful part of this migration.
--
--
-- CORRECTION 1: THE POPULATION IS 116, NOT ~120.
--
--   215  tables in public with a `country` column, RLS enabled, SELECT-able by authenticated
--    99  already carried a country policy before this migration
--   116  did not  =  115 with a scalar `text` country + `profiles` (country is text[])
--   102  scoped here
--    14  deliberately NOT scoped (13 by decision + profiles by type) - see DISMISSALS
--   ---
--   201  scoped after this migration, 14 remaining (all named below)
--
--
-- CORRECTION 2: "THE REST ARE EMPTY" IS FALSE. 27 OF THE 116 HOLD ROWS.
--
-- Measured per table (rows / country-NULL rows / distinct country values):
--
--   audit_log_v2                503,405 / 503,222 / KSA
--   reclassify_log               12,013 /       0 / Egypt,KSA,UAE
--   dup_resolve_archive           9,812 /       0 / Egypt,KSA,UAE
--   stg_monthly_tyres_audit         402 /       0 / KSA
--   _current_km_snapshot_v407       347 /       0 / KSA,UAE
--   ai_token_logs                    37 /      37 / (none)
--   production_station_map           27 /       0 / KSA
--   accident_evidence_requirements   24 /      24 / (none)
--   insurance_policies               23 /       0 / KSA
--   tyre_learned_facts               22 /       1 / KSA
--   store_site_map                   21 /       0 / Egypt,KSA,UAE
--   quality_results                  20 /      20 / (none)
--   import_mapping_profiles          12 /       5 / Egypt,KSA,UAE
--   accident_sla_definitions         11 /      11 / (none)
--   reconciliation_runs               9 /       9 / (none)
--   kpi_targets                       7 /       0 / KSA
--   checklist_templates               6 /       1 / KSA
--   organisations                     4 /       1 / Egypt,KSA,UAE
--   accident_country_rule_profiles    3 /       0 / Egypt,KSA,UAE
--   country_currency                  3 /       0 / Egypt,KSA,UAE
--   upload_history                    2 /       0 / KSA
--   contracts, trust_alerts, inspection_schedules   1 each / 1 null / (none)
--   speed_limiters, support_tickets, rfid_tags      1 each / 0 null / KSA
--
-- Several of those are heavily multi-country, including 9,812 rows of DELETED EXPENSE
-- LINES (dup_resolve_archive) and 12,013 reclassification records. So the standing
-- "empty today" framing understated the exposure.
--
--
-- CORRECTION 3: A ROW COUNT IS NOT A LEAK. ONLY 4 OF THE 116 ACTUALLY LEAKED.
--
-- A table with RLS on and NO PERMISSIVE READ POLICY is deny-all: a RESTRICTIVE policy
-- there changes nothing, because restrictive clauses AND with a permissive grant that
-- does not exist. Probed by impersonation as the real approved KSA-only Manager
-- 34793423 (never by grep - the `get_maint_tyre_split` lesson), foreign rows readable
-- BEFORE:
--
--   store_site_map                    2 foreign of 21 readable   (Egypt, UAE)
--   import_mapping_profiles           2 foreign of 11 readable   (Egypt, UAE)
--   country_currency                  2 foreign of  3 readable   (Egypt, UAE)
--   accident_country_rule_profiles    2 foreign of  3 readable   (Egypt, UAE)
--
-- and the big tables leaked NOTHING, confirming V501's "org-walled" dismissal for these:
--
--   reclassify_log             12,013 rows -> 0 readable  (super-admin gated)
--   dup_resolve_archive         9,812 rows -> 0 readable  (super-admin gated)
--   stg_monthly_tyres_audit       402 rows -> 0 readable  (RLS on, ZERO policies)
--   _current_km_snapshot_v407     347 rows -> 0 readable  (RLS on, ZERO policies)
--   insurance_policies             23 rows -> 0 readable  (Admin-only, V466)
--   audit_log_v2              503,405 rows -> 503,288 readable, 0 foreign, because
--                                             country is NULL on 503,222 and the only
--                                             non-null value present is KSA.
--
-- The 98 empty tables are the genuine "armed, not leaking" case and are scoped on that
-- basis: each fires the moment a second country's rows land in it.
--
--
-- A MEASUREMENT ERROR OF MINE, CORRECTED BEFORE IT REACHED A CONCLUSION
--
-- My first enumeration reported ALL 115 tables as EMPTY. It was a false measurement:
-- the row counts came from `query_to_xml` read with an xpath of `/r/c/text()`, but
-- query_to_xml emits `<row>`, so every count returned NULL and `where n_rows > 0`
-- silently discarded all 115. A probe was then run against material_master (22,162) and
-- audit_log_v2 (503,405) FIRST to prove it could return a known non-zero value before any
-- zero was believed. RULE, already recorded in this project and re-earned here: confirm a
-- probe CAN return data before reading null as proof.
--
--
-- THE POLICY WAS COPIED, NOT COMPOSED
--
-- The expression is read out of the live `tyre_records_country_write` policy with
-- pg_get_expr and applied verbatim; the migration ABORTS unless it still contains every
-- load-bearing term. After apply there is exactly ONE distinct USING expression across
-- all 102 policies, which is the proof they are byte-identical copies:
--
--   ((country IS NULL)
--    OR (SELECT is_super_admin())
--    OR (SELECT app_sees_all_countries())
--    OR (lower(btrim(country)) = ANY (COALESCE((SELECT app_country_scope()), '{}'::text[]))))
--
--   * RESTRICTIVE, FOR ALL, expression in BOTH USING and WITH CHECK, so the read rule and
--     the write rule can never disagree (V542: a SELECT-only policy says nothing about a
--     row being WRITTEN - that is how a KSA Manager once inserted a UAE tyre_records row).
--   * is_super_admin() IS LOAD-BEARING, re-measured here rather than trusted: impersonating
--     the platform owner, is_super_admin() = true but app_sees_all_countries() = FALSE and
--     app_country_scope() = '{}'. A predicate built from the two scope readers alone - the
--     obvious shape - returns ZERO ROWS to the owner on all 102 tables.
--   * lower(), because app_country_scope() returns lower-cased values. The SITE helper is
--     the opposite. That asymmetry is exactly why the expression is copied, not typed.
--   * `country IS NULL` keeps the standing null-dimension convention (78 existing policies).
--     It is load-bearing here in a way it was not in V574: 6 of the 27 populated tables are
--     entirely country-NULL and would otherwise have gone dark.
--
--   FAIL-CLOSED, MEASURED: for a backend caller running as `authenticated` with NO JWT the
--   predicate evaluates to FALSE (not NULL) for any foreign row. The V549 "use is not false"
--   note does not apply to this expression - it never calls app_can_see_country().
--
--
-- DISMISSALS WITH EVIDENCE - 14 tables deliberately NOT scoped. Do NOT re-raise these.
--
-- 1. `country_currency` - LEAKS 2 ROWS AND MUST STAY. This is the country->currency
--    REFERENCE table (V366): KSA/SAR/is_base, UAE/AED, Egypt/EGP. Its rows describe the
--    COUNTRY, not this tenant's operations, and "Egypt uses the Egyptian Pound" is public
--    knowledge. Decisively, it is read by TWO SECURITY INVOKER paths, so RLS DOES apply to
--    them: `currency_for_country()` and, through it, `classify_parts_consumption` - the
--    BEFORE INSERT OR UPDATE trigger that STAMPS `currency` on the 216k-row expense ledger -
--    plus `get_expense_period_trend_multi`, the V544 per-country aggregate whose entire
--    purpose is labelling each country's money in its own currency. Scoping it makes
--    currency_for_country() return NULL for a country the actor cannot see, and a NULL
--    currency in this codebase is the documented MISLABELLED-MONEY class, not a blank:
--    V405 left EGP 5,392,835 labelled AED (~13x), V572 labelled a blended total "AED" to a
--    KSA-only user. A policy here risks mislabelling money to conceal nothing.
--    (Verified separately: the client never queries this table - it mirrors the map in
--    src/lib/governedCost.js - so the hazard is entirely server-side.)
--
-- 2. `organisations` - the tenant registry. V314 already made organisations_select
--    super-admin only, and the KSA-only Manager already reads just 1 of 4 rows (the ORG
--    wall, before and after). `country` on an org row is descriptive; scoping the registry
--    by country could hide an organisation from its own members.
--
-- 3. `profiles` - country is `text[]`, so the canonical expression cannot even be applied
--    (lower(btrim(country)) is not defined for an array). Independently excluded by V574's
--    reasoning: a country policy there breaks broadcast audience resolution and would
--    silently drop colleagues from safety broadcasts.
--
-- 4. DENY-ALL, so a policy would be a no-op (both measured at 0 readable):
--    `stg_monthly_tyres_audit` (402 rows) and `_current_km_snapshot_v407` (347) have RLS
--    enabled and ZERO policies. `stg_tyre_brand` and `stg_wo_lines` carry only a
--    restrictive policy and no permissive read.
--
-- 5. CROSS-BOUNDARY STAGING PIPES - `stg_monthly_tyres`, `stg_complaints`, `stg_assets`,
--    `stg_open_wo`, `stg_job_cards`, `daily_km`. Accepting a row and forwarding it is the
--    entire purpose of these tables (their triggers RETURN NULL so the tables stay empty).
--    A WITH CHECK would refuse a legitimate staging insert of another country's file - the
--    exact import-staging gap V542 deliberately left open on import_batches/_files/_rows.
--
-- 6. `org_units` - the section 3 organisation hierarchy, whose location-scoped RLS is
--    recorded in this project as DELIBERATELY ON HOLD. Not pre-empted here.
--
--
-- ONE JUDGEMENT THAT WENT THE OTHER WAY, and why
--
-- `audit_log_v2` IS scoped, overriding V574's "a wrong policy on the audit trail is its own
-- hazard". The hazard I feared was concrete and turned out not to exist: if the audit
-- writers were SECURITY INVOKER, a WITH CHECK refusal would be swallowed by the trigger's
-- deliberate exception-swallowing tail and audit rows would be LOST SILENTLY. Measured:
-- every writer (`trg_audit_row_change`, `log_accident_change`, `log_inspection_change`) is
-- SECURITY DEFINER owned by postgres, which holds rolbypassrls, so the WITH CHECK can never
-- refuse an audit insert. On the read side 503,222 of 503,405 rows are country-NULL and stay
-- visible to everyone, so the policy is near-inert but correct - readable count is
-- 503,288 before and after. It does NOT address V574's open concern about the
-- old_values/new_values JSONB payloads, which remains open and unmeasured.
--
--
-- VERIFICATION (live, impersonated)
--
-- PROOF OF EFFECT. Most scoped tables are empty, so the honest proof is a ROLLED-BACK
-- insert of foreign rows as the owner, then a read as the KSA-only Manager:
--   suppliers  + 'UAE'   probe -> INVISIBLE (0)
--   customers  + 'Egypt' probe -> INVISIBLE (0)
--   geofences  + 'KSA'   probe -> VISIBLE   (1)   <- the policy admits own-country rows,
--                                                    it does not merely hide everything
--
-- WRITE HALF, live and rolled back, as the KSA-only Manager on a newly scoped table:
--   own-country INSERT   (KSA)  -> ALLOWED   (the feature still works)
--   cross-country INSERT (UAE)  -> REFUSED   "new row violates row-level security policy"
--   country-NULL INSERT         -> ALLOWED   (null-dimension convention preserved)
--   Scoped user then reads 2 rows AND a privileged recount in the SAME transaction also
--   returns 2 - so the cross-country insert was genuinely REFUSED, not written invisibly.
--   (V547's rule: a blocked write and an invisible write both return 0 to the writer.)
--
-- THE FOUR LEAKS, KSA-only Manager, before -> after:
--   store_site_map                    21 readable / 2 foreign  ->  19 / 0
--   import_mapping_profiles           11 readable / 2 foreign  ->   9 / 0
--   accident_country_rule_profiles     3 readable / 2 foreign  ->   1 / 0
--   country_currency                   3 readable / 2 foreign  ->   3 / 2  (dismissed, above)
--   Own data UNCHANGED: tyre_records 8,147, material_master 9,443.
--   The 5 country-NULL import profiles that are in daily use survive, because the client
--   (src/lib/api/imports.js) already asks for `country.eq.<c>,country.is.null` - the policy
--   matches the filter the app was already applying.
--
-- SUPER ADMIN NOT BLACKED OUT - the check that fails if is_super_admin() is omitted.
-- Before == after on every probe: store_site_map 21, import_mapping_profiles 12,
-- accident_country_rule_profiles 3, insurance_policies 23, reclassify_log 12,013,
-- tyre_records 11,193, material_master 22,162, and all three countries still visible.
--
-- 3-COUNTRY USER (KSA+UAE+Egypt) - before == after, foreign rows still legitimately
-- visible: store_site_map 21, import_mapping_profiles 11, accident_country_rule_profiles 3.
-- EGYPT-ONLY DIRECTOR - 0 across the board, before and after: that is the standing ORG
-- wall (organisation e340fa7a holds no data), not an effect of this migration.
--
-- STRUCTURAL, asserted in-migration (aborts otherwise): 102 policies, all RESTRICTIVE,
-- all FOR ALL, app_country_scope in BOTH clauses, is_super_admin in BOTH clauses,
-- lower(btrim(country)) present, and exactly 1 distinct USING expression.
--
--
-- BOUNDARY OF THE CLAIM, stated plainly
--
-- FORCE ROW LEVEL SECURITY is off on every table in this database, so a SECURITY DEFINER
-- function still bypasses every policy added here. These 102 policies bound DIRECT table
-- reads and writes by `authenticated` and NOTHING MORE. That cuts both ways and is why no
-- screen broke: the anon share-token boards (get_report_snapshot, get_workshop_snapshot,
-- get_accident_portal_snapshot, get_display_snapshot), `get_expense_by_site`,
-- `set_store_site_map` and the bulk import path (`process_expenses_country`,
-- `import_commit_batch` - both DEFINER owned by postgres) are all unaffected by
-- construction. service_role and postgres hold rolbypassrls.
--
--
-- THE 102 TABLES SCOPED
--   accident_country_rule_profiles, accident_evidence_requirements, accident_sla_definitions,
--   action_items, ai_token_logs, ai_usage_log, asset_combinations, audit_log_v2, batteries,
--   bay_schedules, carbon_initiatives, carbon_offsets, certifications, charging_sessions,
--   checklist_assignments, checklist_schedules, checklist_templates, cold_chain_logs,
--   contracts, correction_cases, country_addresses, custom_field_catalog, customer_accounts,
--   customers, dashcam_events, developer_api_keys, dispatch_loads, driver_coaching,
--   driver_documents, driver_expenses, driver_safety_events, driver_training, dtc_codes,
--   dup_resolve_archive, emissions_tests, equipment, fitment_rules, fleet_groups,
--   fleet_master, fleet_optimizer_scenarios, fleet_renewal_plans, fuel_cards,
--   fuel_deliveries, fuel_theft_alerts, geofences, gps_positions, hos_logs, ifta_records,
--   import_mapping_profiles, import_master_aliases, inspection_schedules, insurance_policies,
--   journeys, knowledge_documents, kpi_snapshots, kpi_targets, load_plans,
--   marketplace_listings, marketplace_rfqs, materials, ocr_scans, onboarding_tasks,
--   open_work_orders, parts_catalog, pm_programs, pm_service_records, pod_records, policies,
--   production_station_map, quality_results, reclassify_log, reconciliation_runs, rfid_tags,
--   route_plans, saved_searches, shifts, sla_records, speed_limiters, sso_connections, stock,
--   store_site_map, supplier_contracts, supplier_ratings, suppliers, support_tickets,
--   taas_subscriptions, tachograph_records, technician_certs, technician_skills,
--   telematics_devices, toll_transactions, tpms_readings, trip_segments, trips, trust_alerts,
--   tyre_learned_facts, tyre_temperature_readings, upload_history, vehicle_checkinout,
--   vehicle_reservations, webhook_endpoints, weighbridge_tickets
--
--
-- OPEN
--
-- 1. `country_currency` still returns all 3 rows to every user, deliberately (above).
-- 2. `audit_log_v2` old_values/new_values JSONB remain UNMEASURED for other countries' and
--    other tenants' field values; that table has no organisation_id column. Carried from
--    V574, untouched here.
-- 3. FORCE ROW LEVEL SECURITY is off on every table - the stated root cause of the whole
--    sweep, still true, and the reason definer functions remain the wider surface.
-- 4. The 6 staging pipes and 2 deny-all snapshots are unscoped by design; if a permissive
--    read policy is ever added to `stg_monthly_tyres_audit` (402 rows) or
--    `_current_km_snapshot_v407` (347 rows, KSA+UAE), they leak immediately and must be
--    scoped in the same change.
--
--
-- ROLLBACK (drops only what this migration created; nothing else was altered - no data
-- change, no policy replaced, no grant touched):
--
--   do $$
--   declare r record;
--   begin
--     for r in select polname, c.relname from pg_policy p
--              join pg_class c on c.oid = p.polrelid
--              where p.polname like '%\_country\_isolation\_v578'
--     loop
--       execute format('drop policy %I on public.%I', r.polname, r.relname);
--     end loop;
--   end $$;
-- =====================================================================================

do $mig$
declare
  v_expr text;
  -- EXCLUDED BY DECISION, each with evidence in the header above.
  v_excl text[] := array[
    'organisations',              -- tenant registry; V314 already super-admin walled
    'country_currency',           -- country->currency REFERENCE; 2 INVOKER money-stamping paths
    'stg_monthly_tyres_audit',    -- deny-all: RLS on, ZERO policies (0 readable, measured)
    '_current_km_snapshot_v407',  -- deny-all: RLS on, ZERO policies (0 readable, measured)
    'stg_tyre_brand',             -- no permissive read policy
    'stg_wo_lines',               -- no permissive read policy
    'stg_monthly_tyres',          -- cross-boundary staging pipe (V542 precedent)
    'stg_complaints', 'stg_assets', 'stg_open_wo', 'stg_job_cards', 'daily_km',
    'org_units'                   -- section 3 location-scoped RLS deliberately ON HOLD
  ];
  r record;
  n int := 0;
begin
  -- 1. COPY the canonical expression from the live tyre_records FOR ALL policy. Never compose one.
  select pg_get_expr(polqual, polrelid) into v_expr
  from pg_policy where polname = 'tyre_records_country_write';
  if v_expr is null then
    raise exception 'V578 ABORT: canonical policy tyre_records_country_write not found';
  end if;

  -- 2. Assert every load-bearing term. is_super_admin() is what keeps the platform owner
  --    visible (their profiles.country is NULL, so both scope readers are false/empty).
  --    lower() because app_country_scope() returns lower-cased values (the SITE helper is UPPER).
  if v_expr !~ 'is_super_admin' or v_expr !~ 'app_country_scope'
     or v_expr !~ 'app_sees_all_countries' or v_expr !~ 'lower'
     or v_expr !~ 'country IS NULL' then
    raise exception 'V578 ABORT: canonical expression missing a required term: %', v_expr;
  end if;

  for r in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'country'
      and a.attnum > 0 and not a.attisdropped
      and format_type(a.atttypid, a.atttypmod) = 'text'   -- excludes profiles.country (text[])
    where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, 'SELECT')
      and c.relname <> all(v_excl)
      and c.oid not in (
        select polrelid from pg_policy p
        where coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%country%'
           or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%country%')
    order by c.relname
  loop
    -- RESTRICTIVE, FOR ALL, expression in BOTH USING and WITH CHECK so the read rule and the
    -- write rule can never disagree (V542: a SELECT-only policy says nothing about a WRITE).
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
      r.relname || '_country_isolation_v578', r.relname, v_expr, v_expr);
    n := n + 1;
  end loop;

  -- 3. A partial run is the failure mode that matters: half a boundary reads as a closed one.
  if n <> 102 then
    raise exception 'V578 ABORT: expected 102 policies, created % - population changed, re-measure', n;
  end if;
  raise notice 'V578: % country policies created', n;
end $mig$;

-- 4. Structural assertion: every new policy RESTRICTIVE + FOR ALL + scope readers in BOTH clauses.
do $chk$
declare c_all int; c_ok int; c_both int; c_super int;
begin
  select count(*),
         count(*) filter (where not polpermissive and polcmd::text = '*'),
         count(*) filter (where pg_get_expr(polqual,polrelid) like '%app_country_scope%'
                            and pg_get_expr(polwithcheck,polrelid) like '%app_country_scope%'),
         count(*) filter (where pg_get_expr(polqual,polrelid) like '%is_super_admin%')
    into c_all, c_ok, c_both, c_super
  from pg_policy where polname like '%\_country\_isolation\_v578';
  if c_all <> 102 or c_ok <> 102 or c_both <> 102 or c_super <> 102 then
    raise exception 'V578 ABORT: structural check failed (all=% restrictive_for_all=% both_clauses=% super=%)',
      c_all, c_ok, c_both, c_super;
  end if;
end $chk$;
