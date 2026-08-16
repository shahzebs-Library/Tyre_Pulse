-- V547  COUNTRY GUARD SWEEP - THE REST OF THE p_country DEFINER POPULATION
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A).
--
-- Continues V545. Same defect class: a SECURITY DEFINER function runs as its
-- OWNER and bypasses RLS, so one that takes a p_country and never asks whether
-- the CALLER may see that country hands another country's data - or another
-- country's WRITES - to a user scoped out of it.
--
-- SCOPE. The population is the ~65 SECURITY DEFINER functions taking p_country
-- that carry no app_can_see_country call. V545 closed eight; a parallel change
-- owns seven LANGUAGE sql ones (get_country_kpi, report_tyre_summary,
-- get_expense_by_site, get_tyre_cost_by_asset, report_asset_metrics,
-- report_asset_overview, get_brand_size_cpk). This migration triages the
-- remainder and guards the twenty that an ordinary authenticated user can reach.
--
-- WHY "ELEVATED" WAS NOT PROTECTION, which is the finding that drove the size of
-- this sweep. app_is_elevated() is `app_role() in ('admin','manager','director')`,
-- so a plain Manager PASSES every elevated gate. Sixteen of the twenty below sit
-- behind app_is_elevated() and were reachable by the very user they leak to.
-- Only is_super_admin() / app_is_org_admin() gating actually excludes them, and
-- app_can_see_country() itself already returns true for an org admin.
--
-- REPRODUCED FIRST, in rolled-back transactions, as the real approved KSA-only
-- Manager 34793423-43df-4b6f-9270-9d1e8be6fa30, for whom
-- app_can_see_country('UAE') is false and a direct read of UAE tyre_records,
-- parts_consumption and work_orders all return 0 rows:
--
--   READS
--   get_data_trust_overview(...,'UAE')      -> AED 15,631,822.96 over 59,810
--                                              expense lines, 2,455 tyres, 452 assets
--   get_classification_decisions('UAE',...) -> UAE item codes priced in AED,
--                                              one line at AED 1,428,353.46
--   run_quality_checks('UAE')               -> 59,584 UAE expense lines with no
--                                              import key, 33,721 unclassified
--   get_upload_coverage(30,'UAE')           -> 12 UAE feeds, 26,853 UAE rows by day
--   get_upload_coverage_detail(30,'UAE')    -> the same, cut per site
--   get_report_snapshot_authed(...,'UAE')   -> fleet 452, tyres 2,455,
--                                              tyre spend 424,468, 44 open job cards
--   get_tyre_gap_overview('UAE')            -> 2,455 UAE tyre records
--   run_reconciliation('UAE')               -> UAE reconciliation, 170 assets
--   tyre_learn_suggestions('UAE',...)       -> UAE tyre serial numbers
--   explain_metric('fleet_cpk','UAE',...)   -> UAE source_row_count 2,455
--                                              (their own country reads 8,145)
--   get_pipeline_runs('UAE',...)            -> UAE import run history
--
--   WRITES - the V542 class, and the more serious half
--   scrap_tyre_by_serial('...','...','UAE') -> SCRAPPED 2 real UAE tyre_records
--   tyre_learn_confirm(...,'UAE',...,false) -> rebranded 1 real UAE tyre and
--                                              wrote a UAE tyre_learned_facts row
--   material_master_set('UAE',...)          -> created a UAE material_master row
--   correction_case_open(...,'UAE',...)     -> wrote a UAE-tagged correction case
--
-- Each write was counted as a PRIVILEGED reader inside the same transaction
-- (`reset role` then count). Counting from the writer's own session returns 0
-- because the writer cannot see the row it just created, which looks exactly
-- like a refusal - the V542 measurement trap.
--
-- THREE MORE ARE GUARDED WITHOUT AN OBSERVED DISCLOSURE, and are labelled as such
-- rather than dressed up as leaks: apply_production_station_map,
-- parts_cost_fill and tyre_price_backfill each returned 0 rows for UAE today,
-- and get_integration_events returned an empty list because its source table is
-- empty. They are country-filtered write/read paths open to a country the caller
-- cannot see, and empty only by today's data. apply_production_station_map is
-- additionally the one member of its own family left unguarded - its siblings
-- apply_station_proposals and propose_production_station_sites already carry the
-- guard - and its KSA dry run reports 206,868 rows, so the exposure is real even
-- though UAE happens to hold no production.
--
-- The guard is V545's, verbatim, placed immediately after the body opens. The
-- only variation is the builder: ten of these return `json` rather than `jsonb`,
-- so those get json_build_object. The refusal shape {"ok":false,...} matches the
-- shape these functions already use for their own unauthorized path, which is
-- what makes it safe for existing clients.
--
-- It inserts by reading each LIVE definition rather than retyping bodies of up
-- to 15k characters, and ABORTS unless it guards exactly the twenty named. A
-- partial run is the failure mode that matters: half a boundary reads as a
-- closed one (the V396 lesson).
--
-- VERIFIED AFTER, by impersonation:
--   * KSA-only Manager asking for UAE: all twenty return ok:false/forbidden.
--   * The same user's OWN country is unchanged, value for value.
--   * A null p_country still means "no country filter" and still works.
--   * Super admin still reads UAE.
--   * anon still cannot execute any of them.
--
-- DELIBERATELY NOT TOUCHED, with reasons, so the remainder stays honest:
--   * get_report_snapshot / get_report_tyre_maintenance are the ANONYMOUS public
--     share-token boards. They derive the org from the token row
--     (`v_org := t.organisation_id`) after checking active / expiry / password,
--     and the country is a presentation filter chosen by whoever minted the link.
--     There is no caller scope to consult - auth.uid() is null - so
--     app_can_see_country would return false for every anon viewer and BREAK
--     every country-filtered public board. Guarding these would be an outage,
--     not a fix.
--   * set_store_site_map is a confirmed cross-country WRITE (it wrote a UAE
--     store->site mapping for this user) but RETURNS void, so it cannot carry a
--     jsonb refusal; it needs a RAISE-based guard, which changes its contract for
--     callers. Left for a deliberate change rather than forced in here.
--   * The LANGUAGE sql members cannot carry an `if` guard at all and are listed
--     in the report as remaining: fleet_tyre_km_by_asset (166 UAE assets /
--     49,462,431 km, and it also takes a p_org while being granted to
--     authenticated - the V378 pattern), reference_asset_options (452 UAE
--     assets), reference_site_options (20 UAE sites), import_existing_keys
--     (1,926 UAE tyre keys), get_extra_field_stats, material_category_for,
--     get_production_stations.
--   * gate_pass_blockers is plpgsql/jsonb but returned nothing for UAE (that
--     country holds no Critical tyres, no open Critical inspections and no open
--     High corrective actions), so no disclosure was observed. Its real weakness
--     is that it keys on asset_no and treats a null p_country as "no filter", so
--     a guard would not close it anyway.
--   * The `_`-prefixed helpers (_cost_cpk, _cost_dim, _cost_var_dim,
--     _cost_totals, _report_cost_block, _upload_coverage_for_org,
--     _upload_coverage_detail_for_org, _log_scrap_action) take a p_org and are
--     NOT executable by authenticated - the V378 pattern applied correctly.
--   * The super-admin-gated ones refuse this user already, verified live:
--     get_control_center_summary, get_diagnostics_feed, get_figure_lineage all
--     return {"ok":false,"reason":"unauthorized"}, and admin_dup_preview /
--     admin_dup_resolve / admin_dup_scan / admin_update_profile /
--     restamp_pending_upload_country raise 42501.
--   * brain_classify_cached takes a p_org and is granted to authenticated, but it
--     is called by the NON-definer trigger classify_parts_consumption, which runs
--     as the inserting user and therefore REQUIRES that grant. Revoking it would
--     break every expense insert. It returns a classification token, not
--     business data.
--
-- KNOWN RESIDUAL, stated because the guard does not close it: p_country DEFAULTS
-- TO NULL on scrap_tyre_by_serial, tyre_learn_confirm, apply_production_station_map,
-- correction_case_open and gate_pass_blockers, and null legitimately means "no
-- country filter". Measured: with the country argument OMITTED ENTIRELY, this
-- same KSA-only Manager still scrapped 2 UAE tyres and rebranded 1. So for the
-- serial-keyed writers the guard closes the explicit-country path only. Closing
-- the rest means scoping the writes themselves - adding
-- `and public.app_can_see_country(country)` to their UPDATE predicates - which is
-- a body change per function, not a mechanical insertion, and is left as the top
-- follow-up.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v547, which holds the
-- exact prior definition text.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v547;
create table _bak.rpc_defs_v547 (proname text, ret text, def text, saved_at timestamptz default now());

do $mig$
declare
  r        record;
  def      text;
  body_at  int;
  rel_at   int;
  begin_at int;
  newdef   text;
  guard    text;
  n        int := 0;
  targets  text[] := array[
    -- reads with an observed cross-country disclosure
    'get_upload_coverage','get_upload_coverage_detail','get_classification_decisions',
    'get_data_trust_overview','get_report_snapshot_authed','get_tyre_gap_overview',
    'get_pipeline_runs','explain_metric','tyre_learn_suggestions',
    'run_quality_checks','run_reconciliation','scan_data_trust',
    -- writes with an observed cross-country effect
    'scrap_tyre_by_serial','tyre_learn_confirm','material_master_set','correction_case_open',
    -- country-filtered and reachable, empty for UAE today (labelled, not claimed)
    'get_integration_events','apply_production_station_map','parts_cost_fill','tyre_price_backfill'
  ];
begin
  for r in
    select p.oid, p.proname, pg_get_function_result(p.oid) as ret
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_language l   on l.oid  = p.prolang
    where ns.nspname = 'public' and p.prosecdef and l.lanname = 'plpgsql'
      and p.proname = any(targets)
      and pg_get_function_result(p.oid) in ('jsonb','json')
    order by p.proname
  loop
    def := pg_get_functiondef(r.oid);
    if position('app_can_see_country' in def) > 0 then
      continue;
    end if;
    insert into _bak.rpc_defs_v547 (proname, ret, def) values (r.proname, r.ret, def);

    -- The refusal must be built with the function's own return type. jsonb->json
    -- is only an assignment cast, so matching the builder keeps the change inert
    -- for every existing caller.
    if r.ret = 'jsonb' then
      guard := E'\n  if p_country is not null and not public.app_can_see_country(p_country) then\n    return jsonb_build_object(''ok'', false, ''reason'', ''forbidden''); end if;\n';
    else
      guard := E'\n  if p_country is not null and not public.app_can_see_country(p_country) then\n    return json_build_object(''ok'', false, ''reason'', ''forbidden''); end if;\n';
    end if;

    -- Anchor on the body delimiter first, so a `begin` in the signature or a
    -- comment cannot be mistaken for the body opener. Case varies across these
    -- bodies (some DECLARE/BEGIN, some declare/begin), hence the lower().
    body_at := position('$function$' in def);
    if body_at = 0 then
      raise exception 'V547: no $function$ delimiter on %', r.proname;
    end if;
    rel_at := position(E'\nbegin' in lower(substring(def from body_at)));
    if rel_at = 0 then
      raise exception 'V547: no body-opening begin found on %', r.proname;
    end if;
    begin_at := body_at + rel_at + 5;   -- just past the word `begin`

    newdef := substring(def from 1 for begin_at) || guard || substring(def from begin_at + 1);
    if position('app_can_see_country' in newdef) = 0 then
      raise exception 'V547: guard not inserted on %', r.proname;
    end if;

    execute newdef;
    n := n + 1;
  end loop;

  raise notice 'V547: guarded % functions', n;
  if n <> 20 then
    raise exception 'V547: expected to guard 20 functions, guarded %', n;
  end if;
end
$mig$;
