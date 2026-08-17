-- =====================================================================================
-- V560 - SITE SCOPING FOR SECURITY DEFINER READERS THAT ALREADY CARRY A COUNTRY GUARD
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A), 2026-08-16.
-- Applied as supabase migration `v560_site_guard_definer_readers`.
-- =====================================================================================
--
-- THE ROOT CAUSE, restated because it explains every hole in this family:
-- A SECURITY DEFINER function runs as its OWNER, and no public table sets FORCE ROW
-- LEVEL SECURITY, so RLS NEVER RUNS INSIDE ONE. Such a function sits outside the policy
-- system by construction and must re-ask every question itself: org, country AND site.
-- RLS itself was never at fault here - on every probe below the same user's DIRECT table
-- read was correctly bounded; only the functions that stepped around it leaked.
--
-- =====================================================================================
-- 1. ENUMERATION (measured, not assumed)
-- =====================================================================================
-- Population, re-derived rather than inherited from V553/V554/V557:
--   * 116 base tables in `public` carry a `site` column.
--   * 306 SECURITY DEFINER functions in `public`, non-trigger, EXECUTE-able by
--     `authenticated`.
--   * 173 of those READ a site-bearing table (FROM/JOIN match, not a bare mention).
--   *  31 of those already carried a site predicate (V553 / V554 / V557).
--   * 142 did not.
--
-- Narrowing that 142 BY HAND (not with a second regex - V551 recorded that a
-- gate-detecting regex is wrong in both directions):
--   * -31  read ONLY `profiles`. That is the USER'S OWN row, so site-scoping them is
--          circular. Dropped, leaving 111 candidates.
--   * -5   anon public share-token boards            -> DELIBERATELY EXCLUDED (sec. 3)
--   * -12  accident RPCs that DELEGATE to a guarded helper -> dismissed on evidence (sec. 4)
--   * -7   super-admin gated                         -> site is moot (sec. 5)
--   * remainder classified 52 writers / 46 readers.
--
-- =====================================================================================
-- 2. WHAT THIS MIGRATION CHANGES - 7 functions
-- =====================================================================================
-- Scope rule chosen to avoid clobbering the sibling V559 country-writer sweep:
--   V560 touches ONLY functions that ALREADY carry a country guard (i.e. V545-V552
--   territory, which a country sweep has no reason to rewrite). Functions missing BOTH
--   a country and a site guard are almost certainly being rewritten by V559 right now,
--   and we would collide on the same anchor - a CREATE OR REPLACE from a stale read is
--   exactly how one agent silently clobbers another. Those are listed in section 7
--   instead of edited here.
--
--   1. list_scrapped_tyres(text,text,integer)          site col: site
--   2. get_production_rejections(text,date,date,text)  site col: site
--   3. get_production_stations(text)                   site col: p.site
--   4. recon_orphan_assets()                           site col: tr.site
--   5. recon_duplicate_tyres()                         site col: site
--   6. recon_serial_multi_asset()                      site col: tr.site
--   7. get_extra_field_stats(text)                     site col: site
--
-- The predicate inserted is shaped exactly like the LIVE site RLS policies
-- (copied back with pg_get_expr from tyre_records_site_isolation) and exactly like the
-- guards V553/V554/V557 already inserted:
--
--   and ((COL)::text is null or btrim((COL)::text) = ''
--        or (select public.is_super_admin())
--        or (select public.app_sees_all_sites())
--        or upper(btrim((COL)::text)) = any(coalesce((select public.app_site_scope()), '{}'::text[])))
--
-- NOTES ON THAT PREDICATE, each verified rather than assumed:
--   * UPPER, not the country reflex lower(). app_site_scope() returns
--     array_agg(upper(btrim(s))), so lower() would match nothing.
--   * The btrim(...)='' term and the null term keep the standing convention that a
--     null/blank-dimension row stays visible to every scope. 2,041 tyre_records rows
--     carry site IS NULL by design; V542's write policies preserve that and so does this.
--   * (COL)::text is cast universally so ONE snippet serves both `text` and
--     `varchar(100)` site columns (work_orders.site is varchar).
--   * The zero-argument scope readers are used, written `(select f())`, so they hoist to
--     a once-per-query InitPlan. The row-argument app_can_see_site(site) takes the row
--     value so it cannot be hoisted, and being SECURITY DEFINER it can never be inlined -
--     a per-row profiles lookup over tables of 89k-212k rows.
--   * is_super_admin() is RETAINED for consistency with V553/V554/V557 even though, for
--     SITE, it is strictly redundant: unlike app_sees_all_countries(), the live
--     app_sees_all_sites() ALREADY contains `p.is_super_admin or p.role = 'Admin'`.
--     Verified by reading both bodies and by impersonation. This is a real asymmetry
--     between the country and site helpers and is the reason a site predicate does NOT
--     black out the platform owner the way a naive country predicate would.
--
-- =====================================================================================
-- 3. DELIBERATELY EXCLUDED - the 5 anon public share-token boards
-- =====================================================================================
--   get_report_snapshot, get_report_tyre_maintenance, get_display_snapshot,
--   get_workshop_snapshot, get_accident_portal_snapshot
--
-- All five are EXECUTE-able by `anon` and derive the org from the share-token row after
-- checking active / expiry / password. Inside a definer function invoked by an anon
-- caller auth.uid() is NULL, so app_sees_all_sites() returns false and app_site_scope()
-- returns '{}' for EVERY viewer - a site guard would reduce every public board to
-- null-site rows only. GUARDING THESE WOULD BE AN OUTAGE, NOT A FIX.
-- get_report_snapshot / get_report_tyre_maintenance additionally take a p_site argument:
-- that is a PRESENTATION filter chosen by whoever minted the link, not a scope claim.
--
-- =====================================================================================
-- 4. DISMISSED ON DELEGATION EVIDENCE - the accident RPC family (12)
-- =====================================================================================
--   accident_claim_decision, accident_claim_register, accident_claim_settlement,
--   accident_decide_closure, accident_downtime_set, accident_evidence_checklist,
--   accident_repair_complete, accident_repair_order_upsert, accident_repair_qc,
--   accident_repair_task_add, accident_repair_task_complete, accident_task_complete
--
-- These look unscoped to any regex and are NOT. Each resolves context through
-- _accident_rpc_context(p_accident_id), whose body ends:
--     if not (public.app_can_see_country(country) and public.app_can_see_site(site))
--     then raise exception ... using errcode = '42501';
--
-- PROVEN BY IMPERSONATION, not by reading that source. As the KSA-only Manager narrowed
-- to ARRAY['NHC'], against a real DIRIYAH-G1 accident (44958d9f-...) and a real NHC one:
--     out-of-scope DIRIYAH -> REFUSED 42501 "Not permitted for this case country/site scope."
--     in-scope     NHC     -> OK, checklist returned
-- So the boundary exists and the feature still works. (The accident child tables are also
-- all 0 rows today, so any residual hole there would be latent regardless.)
--
-- =====================================================================================
-- 5. DISMISSED - super-admin gated (7)
-- =====================================================================================
--   admin_import_history, apply_learned_rule, extract_tyre_freetext_candidates,
--   get_control_center_summary, get_figure_lineage, owner_data_audit,
--   reclassify_from_master
--
-- Only a super admin can execute these, and a super admin sees all sites by definition
-- (app_sees_all_sites() reads is_super_admin directly), so site scoping changes nothing.
-- Confirmed empirically for get_control_center_summary: the narrowed KSA Manager gets
-- {"ok":false,"reason":"unauthorized"} while the super admin gets the full payload.
--
-- ALSO CARRIED FORWARD, unchanged, from V557's judgement (not re-litigated here):
--   * parts_consumption.site is the ISSUING STORE, not where the machine worked, so
--     per-site OPERATING cost is read THROUGH THE ASSET. No site policy is added to
--     parts_consumption and no cost function is scoped on the store column.
--   * get_subscription_overview moves under narrowing but counts against an ORG-WIDE
--     billing limit; scoping it would under-report usage against the cap.
--
-- =====================================================================================
-- 6. EVIDENCE - reproduced BEFORE anything was touched
-- =====================================================================================
-- Nobody is site-narrowed today: 38 approved profiles, sites NULL on 0, '{}' on 0,
-- containing ALL on 38, narrowed to a real site: ZERO (both super admins included).
-- Site isolation has therefore never once been exercised by a real user on this database.
--
-- Test method (V553's): the REAL approved KSA-only Manager 34793423 (role Manager, so
-- app_sees_all_sites() genuinely flips false) narrowed to ARRAY['NHC'] inside a ROLLED
-- BACK transaction, authorised by setting request.jwt.claims to a super admin.
-- NO trigger was disabled and NO ACCESS EXCLUSIVE lock was taken on profiles.
-- (guard_profile_privileged_cols tests the SCALAR `site` column, not the `sites[]` scope
-- array, so a sites-only change does not trip it at all.)
--
-- DIRECT TABLE READS HOLD (RLS was never the problem):
--   tyre_records 11,191 -> 3,846   (1,805 NHC + 2,041 site IS NULL)
--   work_orders           -> 16,391
--   vehicle_fleet         ->    223
--   production_logs       ->  1,145
--
-- THE COMPARATOR THAT MATTERS. Comparing the narrowed user against the SUPER ADMIN is
-- the wrong test: a difference on the COUNTRY dimension masks a site hole. Measured -
-- recon_data_quality_summary differs from the super admin (Egypt/UAE correctly zeroed by
-- the country guard) while its KSA slice reads tyres 8,145 / fleet 1,030 / wo 62,127,
-- IDENTICAL to the super admin's, when a NHC-scoped user should see 3,846 / 223 / 16,391.
-- Country guard working, site guard absent.
-- The correct comparator is THE SAME USER, sites={ALL} vs sites={NHC}: country is
-- identical in both, so any difference is purely site. On that comparator, byte-identical
-- md5 = the function cannot tell the two scopes apart = it applies no site restriction.
-- (list_scrapped_tyres embeds 'generated_at', now(). now() is the TRANSACTION timestamp
-- and both calls run in ONE transaction, so it contributes equally and masks nothing -
-- the identity is genuine, not a hash-of-a-timestamp artefact.)
--
-- RESULT - byte-identical payload on {ALL} vs {NHC}, i.e. no site restriction whatsoever:
--   list_scrapped_tyres              IDENTICAL
--   get_production_rejections        IDENTICAL
--   get_production_stations          IDENTICAL
--   recon_orphan_assets              IDENTICAL
--   recon_data_quality_summary       IDENTICAL   (deferred, see sec. 7)
--   data_completeness                IDENTICAL   (deferred, see sec. 7)
--   data_link_audit                  IDENTICAL   (deferred, see sec. 7)
--   cost_budget_overview             IDENTICAL   (deferred, see sec. 7)
--
-- Named disclosure, before: list_scrapped_tyres('KSA') returned 201 rows carrying tyre
-- SERIAL NUMBERS across DIRIYAH, KSP-TP, NHC, QIDDIYA, RED SEA and RIY-MET to a user
-- scoped to NHC alone. get_production_rejections('KSA') returned by_site rows for
-- stations 28, 29, 39, 40, 96, 97.
--
-- =====================================================================================
-- 6b. VERIFICATION AFTER APPLYING
-- =====================================================================================
-- IT BITES (same narrowed KSA-only Manager, ARRAY['NHC'], rolled back):
--   list_scrapped_tyres       201 rows / 6 sites  ->  102 rows / [NHC, null] ONLY
--   get_production_rejections by_site [28,29,39,40,96,97] -> none
--   get_production_stations   38 stations -> 1
-- CONTROL: the feature still works - the same user still gets their OWN site's 102 rows.
-- Null-site rows remain visible, which is the standing convention this codebase uses
-- everywhere and which V542's write policies also preserve.
--
-- IT IS A NO-OP FOR EVERY REAL USER TODAY, proven exhaustively rather than argued:
-- impersonating EACH of the 38 approved profiles in turn, app_sees_all_sites() = true
-- for 38 of 38, would_be_affected = 0. The inserted OR-term short-circuits to TRUE for
-- every row for every real user. Behavioural control: the KSA Manager on live {ALL} still
-- gets 201 scrapped rows and 38 stations - identical to the super admin AND identical to
-- the pre-migration figure.
--
-- REGRESSION PROOF IS TEXTUAL, which is stronger than re-timing: for all 7 functions,
-- stripping ONLY the inserted text from the live definition reproduces the backed-up
-- definition BYTE FOR BYTE (strip_back_reproduces_original_exactly = true on all 7). So
-- the guard is provably the only change and a permitted site cannot take a different path.
-- All 7 verified still SECURITY DEFINER after CREATE OR REPLACE (which also preserves the
-- pinned search_path and the grants; get_extra_field_stats keeps 'public','extensions').
--
-- Live state after: 38 approved profiles, all 38 still on {ALL} - no profile drift.
-- SECURITY DEFINER functions carrying a site guard: 32 -> 39.
--
-- =====================================================================================
-- 7. OPEN - WORK, recorded so it is not re-derived
-- =====================================================================================
-- (a) FOUR CONFIRMED LEAKS DELIBERATELY NOT FIXED HERE, because they carry NO country
--     guard either and are therefore very likely in the sibling V559 country sweep's
--     hands right now. Editing them from a stale read would clobber that work. Each is
--     probe-confirmed byte-identical on {ALL} vs {NHC}:
--         recon_data_quality_summary()   - KSA slice equals the super admin's
--         data_completeness()
--         data_link_audit()
--         cost_budget_overview()         - reads vehicle_fleet + tyre_records with only
--                                          an org check; needs BOTH country and site.
--     Whoever takes these should add the country guard and the site guard TOGETHER, in
--     one pass, rather than racing.
--
-- (b) ~52 site-bearing WRITE RPCs still bypass V542's write policies the same way
--     (V542 gave the tables a FOR ALL policy with the expression in both USING and WITH
--     CHECK, but a SECURITY DEFINER writer never consults it). V560 is a READER pass only.
--     The severity precedent is V550: a KSA-only Manager SCRAPPED 2 real UAE tyres, which
--     takes equipment out of service. The site analogues to look at first are
--     scrap_tyre_by_serial, tyre_move, apply_tyre_change, set_stock_count,
--     post_stock_movement, correct_wash_record, record_pm_service.
--
-- (c) ~39 further unguarded READERS remain (get_asset_master, get_asset_ownership,
--     get_cost_per_m3, get_cost_per_m3_trend, get_fleet_cpk, get_cpk_drivers,
--     get_brand_size_cpk, get_data_trust_overview, get_classification_decisions,
--     holding_consolidated_kpis, gate_pass_blockers, check_duplicate_serials,
--     count_records_with_extra_fields, recon_duplicate_key_tyres, recon_serial_conflicts,
--     fx_coverage, ...). Not probed individually here; the structural signal ("no site
--     predicate in the body" -> leaks) held on 8 of 8 probed, and the mechanism is
--     deterministic, but they should be probed before being guarded, since delegation
--     (section 4) is exactly the case where the structural signal is wrong.
--
-- (d) NOT PROBED, deliberately: get_tyre_gap_overview and tyre_learn_suggestions run a
--     pre-existing expensive correlated subquery over the 192k-row
--     ksa_country_upload_template_staging and exceed the statement timeout under load.
--     Pre-existing and unrelated to any guard.
--
-- (e) parts_consumption still carries NO site isolation policy at the table level, so
--     site scope does not bound the expense ledger there. Unreachable today because
--     nobody holds a narrowed site scope; it is the gap a first real site assignment
--     would expose. Deliberate, per the issuing-store reasoning in section 5.
--
-- =====================================================================================
-- 8. ROLLBACK
-- =====================================================================================
--   do $$
--   declare r record;
--   begin
--     for r in select def_before from _bak.site_guard_v560 order by captured_at loop
--       execute r.def_before;
--     end loop;
--   end $$;
--
-- Prior definitions are stored verbatim in _bak.site_guard_v560 (proc, site_col,
-- guard_added, def_before, def_after, captured_at) - 7 rows.
-- =====================================================================================

do $mig$
declare
  q      constant text := chr(39);
  t      record;
  v_def  text;
  v_new  text;
  v_site text;
  v_ins  text;
  v_cnt  int;
  v_done int := 0;
begin
  create schema if not exists _bak;
  create table if not exists _bak.site_guard_v560(
    proc         text,
    site_col     text,
    guard_added  text,
    def_before   text,
    def_after    text,
    captured_at  timestamptz default now()
  );

  for t in
    select * from (values
      ('public.list_scrapped_tyres(text,text,integer)',          'site',    'after',
        'lower(btrim(country)) = any(coalesce((select public.app_country_scope()), ' || q || '{}' || q || '::text[])))'),
      ('public.get_production_rejections(text,date,date,text)',  'site',    'after',
        'lower(btrim(country::text)) = any(coalesce((select public.app_country_scope()), ' || q || '{}' || q || '::text[])))'),
      ('public.get_production_stations(text)',                   'p.site',  'after',
        'lower(btrim(p.country)) = any(coalesce((select public.app_country_scope()), ' || q || '{}' || q || '::text[])))'),
      ('public.recon_orphan_assets()',                           'tr.site', 'after',
        'lower(btrim(tr.country::text)) = any(coalesce((select public.app_country_scope()), ' || q || '{}' || q || '::text[])))'),
      ('public.recon_duplicate_tyres()',                         'site',    'after',
        'lower(btrim(country::text)) = any(coalesce((select public.app_country_scope()), ' || q || '{}' || q || '::text[])))'),
      ('public.recon_serial_multi_asset()',                      'tr.site', 'before',
        'AND tr.serial_no IS NOT NULL'),
      ('public.get_extra_field_stats(text)',                     'site',    'after',
        'lower(btrim(country)) = any(coalesce((select public.app_country_scope()), ' || q || '{}' || q || '::text[])))')
    ) as v(sig, col, mode, anchor)
  loop
    v_def := pg_get_functiondef(t.sig::regprocedure);

    -- the site predicate, shaped exactly like the live site RLS policies and like the
    -- guards V553/V554/V557 already inserted. (col)::text is cast so one snippet serves
    -- both text and varchar(100) site columns.
    v_site := ' and ((' || t.col || ')::text is null'
           || ' or btrim((' || t.col || ')::text) = ' || q || q
           || ' or (select public.is_super_admin())'
           || ' or (select public.app_sees_all_sites())'
           || ' or upper(btrim((' || t.col || ')::text)) = any(coalesce((select public.app_site_scope()), '
           || q || '{}' || q || '::text[])))';

    -- never double-guard
    if v_def ilike '%app_site_scope%' then
      raise exception 'V560 abort: % already carries a site guard', t.sig;
    end if;

    -- A PARTIAL RUN IS THE FAILURE MODE THAT MATTERS: half a boundary reads as a closed
    -- one (the V396 lesson). Abort unless the anchor occurs EXACTLY once.
    v_cnt := (length(v_def) - length(replace(v_def, t.anchor, ''))) / nullif(length(t.anchor),0);
    if v_cnt is distinct from 1 then
      raise exception 'V560 abort: anchor for % occurs % times (expected exactly 1)', t.sig, v_cnt;
    end if;

    -- v_ins is the EXACT text inserted, so strip-back can remove precisely it.
    -- (The first run of this migration aborted here: 'before' mode inserted a trailing
    -- space that the strip did not account for. The guard caught it and rolled the whole
    -- migration back with nothing partially applied.)
    if t.mode = 'after' then
      v_ins := v_site;
      v_new := replace(v_def, t.anchor, t.anchor || v_ins);
    else
      v_ins := v_site || ' ';
      v_new := replace(v_def, t.anchor, v_ins || t.anchor);
    end if;

    if v_new = v_def then
      raise exception 'V560 abort: replacement was a no-op for %', t.sig;
    end if;

    -- textual no-op proof: stripping ONLY the inserted text must reproduce the backed-up
    -- definition byte for byte, so the guard is provably the only change.
    if replace(v_new, v_ins, '') <> v_def then
      raise exception 'V560 abort: strip-back does not reproduce original for %', t.sig;
    end if;

    execute v_new;   -- CREATE OR REPLACE preserves SECURITY DEFINER, search_path and grants

    insert into _bak.site_guard_v560(proc, site_col, guard_added, def_before, def_after)
    values (t.sig, t.col, v_ins, v_def, v_new);

    v_done := v_done + 1;
  end loop;

  if v_done <> 7 then
    raise exception 'V560 abort: expected 7 functions guarded, got %', v_done;
  end if;

  raise notice 'V560: % functions guarded', v_done;
end $mig$;

-- =====================================================================================
-- VERIFY (re-runnable)
-- =====================================================================================
-- Textual no-op proof + still DEFINER:
--   select proc, site_col,
--          (replace(def_after, guard_added, '') = def_before) as strip_back_exact,
--          (pg_get_functiondef(proc::regprocedure) = def_after) as live_matches_applied,
--          (pg_get_functiondef(proc::regprocedure) ilike '%app_site_scope%') as guard_live
--     from _bak.site_guard_v560 order by proc;   -- expect true/true/true on all 7
--
-- No-op for every real user (expect 38 / 38 / 0):
--   do $$ declare r record; v bool; begin
--     create temp table _noop(user_id uuid, sees_all bool);
--     for r in select id from profiles where approved loop
--       perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role','authenticated')::text, true);
--       select public.app_sees_all_sites() into v; insert into _noop values (r.id, v);
--     end loop; end $$;
--   select count(*), count(*) filter (where sees_all), count(*) filter (where not sees_all) from _noop;
--
-- Bites (ROLLED BACK - never commit this):
--   begin;
--     select set_config('request.jwt.claims','{"sub":"d2d43a5f-0906-4f7a-9577-e36d89164914","role":"authenticated"}',true);
--     update profiles set sites = array['NHC'] where id='34793423-43df-4b6f-9270-9d1e8be6fa30';
--     set local role authenticated;
--     select set_config('request.jwt.claims','{"sub":"34793423-43df-4b6f-9270-9d1e8be6fa30","role":"authenticated"}',true);
--     select jsonb_array_length(public.list_scrapped_tyres(null,'KSA',500)->'rows') as rows_after,
--            (select jsonb_agg(distinct r->>'site')
--               from jsonb_array_elements(public.list_scrapped_tyres(null,'KSA',500)->'rows') r) as sites_after;
--   rollback;   -- expect 102 and ["NHC", null]
-- =====================================================================================
