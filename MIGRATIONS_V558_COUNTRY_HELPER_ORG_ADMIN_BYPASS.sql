-- =====================================================================================
-- V558  THE COUNTRY HELPERS THEMSELVES CARRIED THE ORG-ADMIN BYPASS
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A)
-- Migration name in supabase_migrations: v558_country_helper_org_admin_bypass
-- =====================================================================================
--
-- THE DEFECT
-- ----------
-- public.app_can_see_country(text) bypassed for app_is_org_admin(), which is
--   is_super_admin() OR app_role() = 'admin'
-- so a PLAIN org Admin (role Admin, is_super_admin = false) crossed every country
-- boundary anywhere that helper was the gate.
--
-- V498 already settled the principle: country scoping is a DATA-VISIBILITY boundary
-- whose only legitimate bypass is the platform owner. It rewrote 50 *_country_isolation
-- policies to is_super_admin() -- and left the HELPER itself carrying the bypass.
-- V555 hit the same wall on the write path and had to introduce a NEW helper
-- (app_write_country_ok) rather than touch this one, precisely to keep its blast
-- radius tight. V558 closes the original.
--
-- Second, same family: import_user_can_commit_country(text) kept the identical
-- bypass, gating 5 policies plus import_commit_batch / import_enrich_batch, so a
-- plain org Admin could read staged imports for, and commit imports into, any country.
--
--
-- MEASURED BLAST RADIUS  (re-measured; the last count of record was not trusted)
-- -----------------------------------------------------------------------------
--   profiles ....................... 38   (all approved, 0 locked)
--   super admins ................... 2    (both role 'Admin', both country NULL, sites {ALL})
--   app_role() = 'admin' ........... 2    -- and both ARE the super admins
--   PLAIN Admins (admin, not super)  0    <-- the population this defect serves
--   country IS NULL ................ 2    (both supers)   country = '{}' ....... 0
--   'All' / '*' country sentinel ... 0
--
--   Roles: Tyre Man 17, Tyre Data Collector 9, Manager 2, Reporter 2, Admin 2 (both
--   super), Inspector 2, Tire Planning Engineer 1 (KSA+UAE+Egypt), PMV Manager 1 (UAE),
--   Director 1 (Egypt, org e340fa7a), Workshop Maintenance Area Manager 1.
--
-- ==> On today's database app_is_org_admin() and is_super_admin() are EQUIVALENT for
--     all 38 users, so this change moves nothing for anyone. That is exactly the V498
--     posture: this is the only moment the hole can be closed without taking access
--     away from a real person.
--
--
-- ENUMERATION OF CONSUMERS  (pg_policy USING *and* WITH CHECK, plus pg_proc.prosrc)
-- ---------------------------------------------------------------------------------
--   app_can_see_country(text)              1 overload
--     - 95 policies across 38 tables
--     - 62 function bodies
--     - of those 62, 21 have NO row-level country predicate, i.e. this helper is
--       their ONLY country term. That is the live exposure set:
--         _accident_rpc_context (gates the whole 24-RPC accident family),
--         _scope_split_countries, apply_production_station_map,
--         apply_station_proposals, correction_case_open, explain_metric,
--         get_cost_per_m3, get_cost_per_m3_trend, get_report_snapshot_authed,
--         get_upload_coverage, get_upload_coverage_detail, material_category_for,
--         material_master_set, parts_cost_fill, report_country_metrics,
--         report_country_trends, run_quality_checks, run_reconciliation,
--         scan_data_trust, set_store_site_map, tyre_price_backfill
--
--   import_user_can_commit_country(text)   1 overload
--     - 5 policies over 3 tables:
--         import_batches_country_isolation (SELECT), import_batches_country_write (ALL),
--         import_files_country_isolation  (SELECT), import_files_country_write  (ALL),
--         import_rows_country_isolation   (SELECT, via import_batch_country(batch_id))
--     - 2 functions: import_commit_batch, import_enrich_batch
--
--
-- REPRODUCED BEFORE ANYTHING WAS TOUCHED  (every step in a ROLLED-BACK transaction)
-- ---------------------------------------------------------------------------------
-- There are no plain Admins, so one was created: the real KSA-only Manager
-- 34793423 (country {KSA}) promoted to role 'Admin' with is_super_admin left false.
-- Authorised by setting request.jwt.claims to super admin 58787cc7 so
-- trg_guard_profile_privileged passes -- NO trigger was disabled and no ACCESS
-- EXCLUSIVE lock was taken on profiles.
--
-- SAME PERSON, SAME CALLS, only app_role() differs:
--
--   READS                                    as Manager        as plain Admin
--   app_can_see_country('UAE' / 'Egypt') .... false            TRUE
--   import_user_can_commit_country('UAE') ... false            TRUE
--   report_country_metrics(null,null) ....... 1 country row    3 COUNTRY ROWS
--        disclosing  Egypt   591 tyres / EGP 5,893,603.79
--                    UAE   2,455 tyres / AED   424,467.79
--        each with brand count, site count, avg CPK and avg cost per tyre.
--   report_country_trends(null,null) ........ 23 rows / 1 ctry 59 ROWS / 3 COUNTRIES
--   import_batches visible .................. 30 / 1 country   42 / 3 COUNTRIES
--   import_rows visible ..................... 2,751            2,953
--
--   WRITES  -- confirmed by `reset role` and recounting as a PRIVILEGED reader in the
--   SAME transaction, because a count taken from inside an impersonated session counts
--   what is READABLE, not what was written; a blocked write and an invisible write are
--   otherwise indistinguishable.
--   run_quality_checks('UAE') ............... refused          EXECUTED
--        quality_results     country='UAE'    0  ->  10 rows written
--   run_reconciliation('UAE') ............... refused          EXECUTED
--        reconciliation_runs country='UAE'    0  ->   3 rows written
--   scan_data_trust('UAE') .................. refused          PERMITTED (raises trust_alerts)
--
--   GUARDED WITHOUT AN OBSERVED DISCLOSURE -- labelled as such rather than dressed up
--   as leaks. The refusal flipped to permitted, but nothing moved on today's data:
--     tyre_price_backfill(false,'UAE')  ok:true, batch minted, rows = 0
--         (V401c refuses this process's own earlier fills as evidence, and UAE has no
--          new real prices), parts_cost_fill('UAE') 0 rows,
--     get_cost_per_m3('UAE'), material_category_for(...,'UAE'),
--     get_upload_coverage(30,'UAE') -- permitted, no UAE data behind them today.
--
--
-- WHAT THIS DEFECT DOES *NOT* REACH  (measured, so the claim is not overstated)
-- ----------------------------------------------------------------------------
-- * RLS ITSELF WAS NEVER AT FAULT. As the plain Admin, a DIRECT read of tyre_records
--   still returned KSA 8,145 and ZERO UAE / ZERO Egypt. Those tables' policies use the
--   V396/V498 zero-argument scope readers, not this helper.
-- * The 95 policies that DO use the helper are ARMED, NOT FIRING: every populated one
--   holds KSA rows only today -- insurance_policy_assets 2,041 / property_risks 122 /
--   loss_runs 64 / claim_register 59 / site_match_keywords 52 / asset_disposals 37 /
--   asset_replacement_costs 2, all KSA. The other 31 tables hold 0 rows.
-- * On the V549-rewritten functions the bypass was neutralised by the row predicate:
--   get_fleet_cpk('UAE') passed the argument guard (ok:true) yet returned fleet [],
--   against the super admin's full UAE AED 6,438,769.27; report_tyre_summary,
--   get_country_kpi and get_expense_by_site returned 0 for the plain Admin.
--   ==> V549's row-predicate rewrite is what has actually been carrying this boundary.
--       The argument guard was a redundant second gate that a plain Admin stepped around,
--       and the 21 functions above are the ones with no second gate at all.
--
--
-- THE FIX, AND WHY IN PLACE
-- -------------------------
-- Both helpers, one token each:  public.app_is_org_admin()  ->  public.is_super_admin()
--
-- Retargeting consumers instead would mean editing 95 policies + 64 function bodies to
-- express a rule V498 has already settled. A helper whose entire declared job is "may
-- this caller see this country" must not itself carry a non-owner bypass. Every consumer
-- was checked for a legitimate wish to let a plain Admin cross; none has one (see
-- EXCLUDED). Note is_super_admin() also honours `locked = false`, which app_role() does
-- not, so a LOCKED super admin stops crossing countries too -- 0 locked today.
--
-- NOTHING WAS RETYPED. Each definition is read live with pg_get_functiondef and rewritten
-- by an anchored replace() that ABORTS unless the anchor occurs EXACTLY once, then
-- asserts the bypass is gone and the replacement present, then a migration-level verify
-- asserts neither helper still matches app_is_org_admin and both kept SECURITY DEFINER
-- and their pinned search_path. A partial run is the failure mode that matters: half a
-- boundary reads as a closed one.
--
-- TEXTUAL REGRESSION PROOF: reversing the substitution on both LIVE definitions
-- reproduces _bak.country_helper_bypass_v558.def_before BYTE FOR BYTE. The substitution
-- is provably the only change, so a permitted country cannot take a different path.
--
--
-- EXCLUDED, AND WHY
-- -----------------
-- 1. ksa_country_upload_template_staging_admin_read, ksa_kms_admin_read,
--    uae_kms_admin_read -- PERMISSIVE SELECT on one-time raw import landing tables.
--    app_is_org_admin() there is the permission to use an admin-only surface AT ALL;
--    the expression tests no country column. Same class V498 deliberately left alone.
-- 2. cost_apply_actual_budgets, cost_clear_value, cost_convert_line_totals,
--    cost_set_monthly_budget, data_link_create_missing_assets, set_org_branding --
--    each is `IF NOT app_is_org_admin() THEN RAISE 'Admin only'`: a feature permission,
--    not a country term. Substituting is_super_admin() would break them for every
--    future plain Admin -- the exact mistake V553 recorded for set_org_branding.
--
--
-- OPEN -- FOUND WHILE MEASURING, **NOT** CLOSED BY V558
-- ----------------------------------------------------
-- 1. get_report_snapshot_authed IGNORES ITS COUNTRY ARGUMENT ENTIRELY, and this is a
--    LIVE all-countries disclosure to EVERY authenticated user, not just an Admin.
--    Measured as the real KSA-only MANAGER, unmodified, for whom
--    app_can_see_country('UAE') is false: the kpis block returns
--      tyres 11,191 (= KSA 8,145 + UAE 2,455 + Egypt 591), fleet 1,617,
--      tyre_spend 12,450,391 (SAR+AED+EGP added together, so not a quantity of
--      anything), accidents 38, inspections 361, work_orders_open 133
--    IDENTICALLY for p_country = 'KSA', 'UAE', 'Egypt' and NULL. Independent of role,
--    independent of this defect, untouched by V558. Needs its own migration.
-- 2. report_country_metrics / report_country_trends carry the bypass in their ORG term
--    as well: (organisation_id is null or = app_current_org() or app_is_org_admin()).
--    V558 tightened their COUNTRY half (proven 3 -> 1 countries) but a plain Admin
--    still crosses ORGANISATIONS there. Tenant-class defect (V551 family), own migration.
-- 3. inspection_embeddings_tenant_read (policy) and match_inspection_findings (function)
--    inline the V396 predicate WITH app_is_org_admin() as a country-crossing term --
--    the same defect in a different shape, not a consumer of either helper.
--    LATENT: inspection_embeddings holds 0 rows. Arms the moment embeddings exist.
-- 4. import_user_can_commit_country still has `pr.country IS NULL` = commit to ANY
--    country, contradicting V309 ("blank scope = no access"). Measured: 2 profiles have
--    NULL country and BOTH are super admins, who now pass via is_super_admin() anyway,
--    so the branch is unreachable today and a no-op either way. Left deliberately so
--    V558's before/after stays a single provable substitution; it arms the first time a
--    non-super is created without a country.
-- 5. Cosmetic: the comment inside app_write_country_ok (V555) now reads stale --
--    "Unlike app_can_see_country this has NO app_is_org_admin() bypass". They agree now.
--
--
-- THE ONE BEHAVIOURAL CHANGE BEYOND THE INTENDED TIGHTENING
-- ---------------------------------------------------------
-- With NO JWT (cron, an edge function on the service role) app_role() is NULL, so
-- app_is_org_admin() returned NULL, while is_super_admin() returns false. Measured
-- directly: old expression -> NULL, new -> false.
--   * In a WHERE predicate NULL and false behave identically (both non-true): no change.
--   * In a plpgsql `IF NOT app_can_see_country(...) THEN return forbidden` guard,
--     `not NULL` is NULL so the branch was NOT taken (FAIL OPEN); `not false` REFUSES.
-- Containment measured, not assumed: 0 of the 12 cron-invoked functions touch either
-- helper, and 0 anon-executable functions consume either helper. import_commit_batch /
-- import_enrich_batch already refuse a no-JWT caller via is_approved_and_unlocked().
-- So no scheduled and no anonymous path changes behaviour. If a service-role backend
-- caller ever needs one of the 62 guarded RPCs, give that call a JWT -- do not restore
-- the bypass.
--
--
-- VERIFIED AFTER  (all impersonation rolled back)
-- -----------------------------------------------
-- Reproduction re-run post-fix, same rolled-back plain Admin:
--   can_see UAE / Egypt ......... FALSE       own country KSA still TRUE
--   import commit UAE ........... FALSE
--   report_country_metrics ...... 1 row       report_country_trends 1 country
--   import_batches .............. 30 / 1 country
--   run_quality_checks / run_reconciliation / scan_data_trust /
--     tyre_price_backfill on UAE. ALL REFUSED
--   UAE writes, privileged recount in the same transaction:
--     quality_results     10 -> 0        reconciliation_runs     3 -> 0
--
-- Equivalence over every real user, both helpers, computed from the profile rows:
--   38 profiles x 10 country values ('KSA','UAE','Egypt','All','all','ksa',' KSA ',
--   '*','Unknown',NULL) = 380 combinations -> 0 mismatches, 0 affected users.
--
-- Behavioural, ONE USER PER TRANSACTION (the scope readers are STABLE and cache within
-- a statement, so a combined multi-user probe silently reports one user's scope):
--   user                                 KSA/UAE/EGY  commitUAE  tyres   ctry  metrics  batches
--   super admin (shahzeb Rahman) ....... t / t / t        t      11,191   3      3        44
--   KSA-only Manager (adnan) ........... t / f / f        f       8,145   1      1        30
--   3-country Tire Planning Engineer ... t / t / t        t      11,191   3      3        42
--   Egypt-only Director (org e340fa7a) . f / f / t        f           0   -      0         0
--   UAE-only PMV Manager ............... f / t / f        t       2,455   1      1         1
-- Every figure matches the pre-change control. Ground truth: KSA 8,145 / UAE 2,455 /
-- Egypt 591 = 11,191 tyre_records in Company A.
--
--
-- ROLLBACK
-- --------
--   do $$ declare r record; begin
--     for r in select def_before from _bak.country_helper_bypass_v558 loop
--       execute r.def_before;
--     end loop;
--   end $$;
--
-- =====================================================================================

create schema if not exists _bak;

drop table if exists _bak.country_helper_bypass_v558;
create table _bak.country_helper_bypass_v558 as
select p.oid::regprocedure::text as sig,
       pg_get_functiondef(p.oid)  as def_before,
       now()                      as captured_at
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_can_see_country','import_user_can_commit_country');

do $mig$
declare
  r          record;
  v_anchor   text := 'public.app_is_org_admin()';
  v_replace  text := 'public.is_super_admin()';
  v_def      text;
  v_hits     int;
  v_done     int := 0;
begin
  if (select count(*) from _bak.country_helper_bypass_v558) <> 2 then
    raise exception 'V558 abort: expected 2 helper definitions to snapshot, found %',
      (select count(*) from _bak.country_helper_bypass_v558);
  end if;

  for r in
    select p.oid, p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_can_see_country','import_user_can_commit_country')
    order by 1
  loop
    v_def  := r.def;
    v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);

    -- A partial run is the failure mode that matters: half a boundary reads as a
    -- closed one. Refuse anything that is not exactly the shape we measured.
    if v_hits <> 1 then
      raise exception 'V558 abort: % contains the anchor % time(s), expected exactly 1', r.sig, v_hits;
    end if;

    v_def := replace(v_def, v_anchor, v_replace);

    if position(v_anchor in v_def) > 0 then
      raise exception 'V558 abort: bypass still present in % after replace', r.sig;
    end if;
    if position(v_replace in v_def) = 0 then
      raise exception 'V558 abort: replacement missing in %', r.sig;
    end if;

    execute v_def;
    v_done := v_done + 1;
  end loop;

  if v_done <> 2 then
    raise exception 'V558 abort: rewrote % function(s), expected 2', v_done;
  end if;
end
$mig$;

-- Post-check: neither helper may still carry the bypass, and both must still be
-- SECURITY DEFINER with a pinned search_path. CREATE OR REPLACE preserves grants.
do $verify$
declare v_bad int;
begin
  select count(*) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('app_can_see_country','import_user_can_commit_country')
    and p.prosrc ilike '%app_is_org_admin%';
  if v_bad <> 0 then
    raise exception 'V558 verify failed: % helper(s) still carry app_is_org_admin()', v_bad;
  end if;

  select count(*) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('app_can_see_country','import_user_can_commit_country')
    and (p.prosecdef = false or p.proconfig is null);
  if v_bad <> 0 then
    raise exception 'V558 verify failed: % helper(s) lost SECURITY DEFINER or search_path', v_bad;
  end if;
end
$verify$;

-- =====================================================================================
-- RESULTING DEFINITIONS (for the record)
--
-- public.app_can_see_country(p_country text) RETURNS boolean
--   LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path TO 'public'
--     select p_country is null
--       or public.is_super_admin()
--       or exists (select 1 from public.profiles pr
--                  where pr.id = auth.uid()
--                    and pr.country is not null and cardinality(pr.country) > 0
--                    and exists (select 1 from unnest(pr.country) x
--                                where lower(btrim(x)) = 'all'
--                                   or lower(btrim(x)) = lower(btrim(p_country))));
--
-- public.import_user_can_commit_country(p_country text) RETURNS boolean
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
--     SELECT p_country IS NULL
--       OR public.is_super_admin()
--       OR EXISTS (SELECT 1 FROM public.profiles pr
--                  WHERE pr.id = auth.uid()
--                    AND ( pr.country IS NULL OR p_country = ANY(pr.country)
--                          OR 'All' = ANY(pr.country) ));
-- =====================================================================================
