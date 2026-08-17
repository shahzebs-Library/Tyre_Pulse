-- V571  COUNTRY GUARDS ON THE DEFINER READERS REACHABLE ONLY WITH ARGUMENTS
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A) as
-- migration v571_definer_arg_reader_country_guards (20260817035544).
--
-- Same root cause as V545-V556, in the last unprobed corner. A SECURITY DEFINER
-- function runs as its OWNER and no public table sets FORCE ROW LEVEL SECURITY,
-- so RLS NEVER RUNS INSIDE ONE. Such a function must re-ask every question
-- itself. These did not.
--
--
-- WHY THIS CORNER WAS STILL OPEN
--
-- V556 enumerated 97 country-bearing definer READERS and probed only the 54
-- callable with NO arguments, on the reasoning that those have an all-scope
-- default path a screen can reach. The remaining readers - the ones that cannot
-- be called without an argument - were never probed by any sweep. They are this
-- migration's population.
--
-- Enumerated the same way V556 did, by what a function TOUCHES rather than by an
-- argument name (an argument name describes the CALL, not the ROWS):
--
--   231 country-bearing relations in `public` (a `country` column, relkind r/p/v/m)
--   198 SECURITY DEFINER functions EXECUTE-able by `authenticated`, non-trigger,
--       that SCAN one of them (from/join)
--    56 of those already carried the V549 predicate (V549-V570)
--   142 went to triage
--    92 of the 142 REQUIRE at least one argument (pronargs > pronargdefaults)
--
-- Of those 92, the writers belong to the sibling lanes (V559/V562/V564/V565).
-- The readers were separated by volatility rather than by a DML regex, because
-- the regex was wrong in both directions here - it cleared `admin_update_profile`
-- and `set_scrap_reason` as non-writers (they UPDATE through an alias) while
-- flagging cache-writing readers. Every STABLE/IMMUTABLE function cannot write by
-- definition; the volatile remainder was read individually.
--
--
-- THE PROBE RULE THAT DECIDED THIS MIGRATION, AND WHY IT IS FIRST
--
-- A prior report on `get_report_snapshot_authed(p_from, p_to, p_site, p_country)`
-- claimed it "ignores its country argument entirely", measured at 11,191 tyres
-- for 'KSA', 'UAE', 'Egypt' and NULL alike. THAT WAS WRONG. The probe passed the
-- country POSITIONALLY into p_from, where it failed to parse as a date and an
-- EXCEPTION handler swallowed it into NULL - so all four "different" calls were
-- the same call. Its named-country guard was working all along.
--
--   RULE: call every function BY NAME - f(p_country => 'UAE'). A positional probe
--   of a multi-text-argument signature silently measures the wrong thing and
--   reports a WIDER hole than exists. Overstating a hole is not harmless: it
--   aims the fix at the wrong place.
--
-- Every probe below uses named arguments. Every probe also carries an own-country
-- CONTROL, because a probe that cannot return data proves nothing when it returns
-- nothing - and identical bytes are not proof of disclosure either, since an
-- empty payload is identical too. Each match was opened and read.
--
--
-- MEASURED BEFORE, as the real approved KSA-only Manager 34793423 (country {KSA},
-- sites {ALL}), in rolled-back transactions. FOUR LEAKS, all reproduced:
--
-- 1. check_duplicate_serials(serials => ...)
--    tyre_records read by serial, filtered ONLY by organisation_id. No country
--    predicate of any kind. Handed over, for serials the caller supplied:
--      UAE   4 rows - site DUBAI, brands TRIANGLE / ROADX, fitment dates
--      Egypt 3 rows - sites MONORAIL SITE, NEW CAPITAL, BAHR EL BAQER,
--                     brand PIRELLI, fitment dates
--    KSA control returned 2 rows, so the probe was live.
--    The SAME user's DIRECT read of those six serials from tyre_records returned
--    0. The wall held everywhere except inside the function.
--    IT ALSO HANDED OVER THE ROW UUIDs, which is what arms the next one.
--
-- 2. get_record_provenance(p_table => ..., p_id => ...)
--    Returns the WHOLE ROW as jsonb from any of 7 whitelisted tables
--    (tyre_records, work_orders, parts_consumption, vehicle_fleet, accidents,
--    inspections, stock_records - all 7 carry a country column), checking ONLY
--    organisation_id. Feeding it the Egypt tyre UUID leaked by (1) returned that
--    tyre's entire row: country Egypt, site MONORAIL SITE, cost_per_tyre
--    14,035.09, 1,426 bytes of payload.
--    So (1) and (2) chain: one hands out the identifier, the other turns the
--    identifier into the record. Neither is reachable by direct table read.
--    Its `app_is_elevated()` gate is not a restriction - that is
--    app_role() in ('admin','manager','director'), so a plain Manager passes.
--
-- 3. preview_learned_rule(p_token => ..., p_category => ...)
--    parts_consumption, organisation-scoped only, and it GROUPS BY country and
--    RETURNS country as an output column - so it is unscoped by construction.
--    Its scan set spans all three countries: Egypt 28,844 default-classified
--    lines / 41,302,728.29, KSA 58,118 / 13,961,193.07, UAE 33,721 / 6,401,647.40.
--    The live function could not be run to completion - it exceeds a 55s
--    statement timeout on the pre-existing per-row brain_has_word /
--    learned_rule_vetoed evaluation over ~120k rows (a known standing
--    optimisation candidate, unrelated to this guard). It was therefore proven by
--    replaying its EXACT where-clause over a bounded non-KSA row set with a real
--    token: token 'tape' matched Egypt 8 codes / 871 lines / 60,501.56 and
--    UAE 42 codes / 1,892 lines / 9,905.60, every one of which the function
--    would have returned to a KSA-only caller.
--
-- 4. fx_coverage(p_to => 'SAR')
--    Reads `select distinct currency from parts_consumption`, organisation-scoped
--    only. Returned AED, EGP and SAR to the KSA-only Manager. Modest but real:
--    currency is 1:1 with country here (KSA=SAR, UAE=AED, Egypt=EGP), so this
--    tells a KSA-scoped user that UAE and Egypt operations exist in the tenant.
--    An existence disclosure, and the cheapest possible fix.
--
-- 5. admin_check_import_fingerprint(p_sha256 => ...)
--    Reads import_files (which carries a country column), organisation-scoped
--    only. Returned the filename "ASSET LIST EGYPT.xlsx" to the KSA-only Manager.
--    Exploitation requires already holding the file bytes to compute the sha256,
--    so the practical reach is narrow - but the filename names the country and
--    the fix costs one predicate.
--
--
-- DISMISSED, WITH THE EVIDENCE THAT DISMISSED THEM - do not cite these as leaks
--
--   material_category_for   GUARDED by V552. Verified live, not read from source:
--                           p_country => 'UAE' returns NULL (refused) while the
--                           KSA control returns 'spare_part'. The control matters:
--                           without it, NULL would have been misread as "no rows".
--   _accident_rpc_context   GUARDED - org + app_write_country_ok(country) is not
--                           false + app_can_see_site(site). This is the delegate
--                           the whole accident RPC family routes through, which is
--                           why that family looks unscoped in source and is not.
--   accident_evidence_checklist   Delegates to _accident_rpc_context. GUARDED.
--   get_inspection_audit    inspection_audit_log has NO country column (checked
--                           information_schema, 0). Not a country reader at all.
--   match_knowledge_documents   org-guarded by V548; knowledge_documents holds
--                           0 rows. Latent only, as V548 already recorded.
--   get_user_email_by_id, admin_get_effective_access, _login_identifier_exists,
--   get_email_by_identifier     profiles / identity, not country-bearing data.
--                           (get_email_by_identifier remains the standing anon
--                           account-enumeration oracle - unchanged, not in scope.)
--   app_can_see_country, app_can_see_site, app_in_org, app_user_can,
--   storage_object_in_my_org, import_user_can_commit_country
--                           These ARE the boundary. Guarding a boundary helper
--                           with the boundary is circular and would break it.
--
--
-- DELIBERATELY NOT GUARDED - import_batch_country. THIS ONE MATTERS.
--
-- It leaks: import_batch_country(p_batch_id => <egypt batch>) returns 'Egypt' and
-- <uae batch> returns 'UAE' to the KSA-only Manager, while their direct read of
-- those import_batches rows returns 0. It has no org check and no country check.
--
-- IT MUST NOT BE GUARDED, because it is a country RESOLVER feeding a gate, not a
-- data reader. The RLS policy `import_rows_country_isolation` on import_rows is
-- literally:
--
--     import_user_can_commit_country(import_batch_country(batch_id))
--
-- and import_user_can_commit_country begins `p_country IS NULL OR ...`. Measured,
-- as that same user:
--
--     import_user_can_commit_country('Egypt')  ->  false     (today: DENY)
--     import_user_can_commit_country(null)     ->  true      (guarded: ALLOW)
--     import_rows visible for the Egypt batch  ->  0
--
-- So returning NULL for a country the caller cannot see would flip that policy
-- from DENY to ALLOW and open import_rows for every batch the caller cannot see.
-- The guard would be a catastrophic WIDENING dressed as a fix. Returning the
-- country string truthfully is the mechanism by which the isolation WORKS.
--
-- Residual, stated rather than hidden: a caller who already possesses a batch
-- UUID can learn that batch's country label. That is a bare country name attached
-- to an opaque identifier they must already hold, with no financial or
-- operational content - the same trade-off already recorded for
-- import_existing_keys and the global work_order_no. Correctness of the gate wins.
--
--
-- ALSO EXCLUDED - the anonymous share-token boards
--
-- get_report_snapshot and get_report_tyre_maintenance are excluded by standing
-- rule. The SAME reasoning extends to three siblings found in this population:
-- get_display_snapshot, get_workshop_snapshot and get_accident_portal_snapshot.
-- All five are anon-EXECUTE-able and derive the organisation from the token row
-- after checking active / expiry / password. Inside a definer function invoked by
-- an anon caller auth.uid() is NULL, so app_country_scope() is empty and
-- is_super_admin() is false - guarding these would return nothing to every
-- viewer. That is an outage, not a fix.
--
--
-- THE PREDICATE is V549's, unchanged:
--
--   (<col> is null
--    or (select public.is_super_admin())
--    or (select public.app_sees_all_countries())
--    or lower(btrim(<col>::text)) = any(coalesce((select public.app_country_scope()),
--                                                '{}'::text[])))
--
-- RE-MEASURED live rather than trusted, because the whole predicate turns on it:
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
-- alone - the obvious shape - returns ZERO ROWS to the platform owner on all five
-- of these functions. is_super_admin() is load-bearing, not decoration.
--
-- lower() because app_country_scope() is lower-cased (the SITE helper needs
-- UPPER - genuinely asymmetric, do not copy one into the other). ::text because
-- `country` is character varying on some of these tables and text on others.
--
-- The zero-argument scope readers are used rather than the row-argument
-- app_can_see_country(country): written as (select f()) they are uncorrelated
-- subqueries hoisted to a once-per-query InitPlan, whereas app_can_see_country
-- takes the row value so it can never be hoisted, and is SECURITY DEFINER so it
-- can never be inlined - a per-row profiles lookup. In get_record_provenance the
-- test is a plpgsql `if` on a single already-fetched jsonb row, so it is written
-- directly; there is no row loop to hoist out of.
--
--
-- THE REFUSAL SHAPE IS CHOSEN PER FUNCTION so nothing is invented:
--
--   check_duplicate_serials          zero rows (it is a TABLE-returning lookup)
--   preview_learned_rule             zero rows (likewise)
--   get_record_provenance            {"ok":false,"reason":"forbidden"} - which is
--                                    the function's OWN existing refusal, already
--                                    used for its organisation check
--   fx_coverage                      the currency is simply not listed
--   admin_check_import_fingerprint   {"seen": false} - the function's OWN
--                                    not-found shape
--
-- Never a populated row of zeros: that asserts a measurement instead of refusing.
--
--
-- METHOD
--
-- NOTHING IS RETYPED. Every guard is inserted by reading the function's own LIVE
-- pg_get_functiondef and doing an anchored replace(), and every spec ABORTS
-- unless its anchor occurs EXACTLY once, aborts if the function already carries
-- the predicate, and aborts if the replacement was a no-op. A partial run is the
-- failure mode that matters: half a boundary reads as a closed one (the V396
-- lesson). The whole thing is ONE DO block, so any failure applies nothing at all.
-- CREATE OR REPLACE preserves SECURITY DEFINER, the pinned search_path, the
-- volatility and the grants - all re-verified after (see below).
--
--
-- VERIFIED AFTER
--
-- TEXTUAL, which is the strongest regression proof available: for all five,
-- mechanically stripping ONLY the inserted guard lines from the live definition
-- reproduces the backed-up definition BYTE FOR BYTE (md5 equal). So the guard is
-- provably the only change, and a permitted country cannot take a different path.
-- Bytes added: 235 / 237 / 239 / 275 / 331.
--
-- BEHAVIOURAL, by impersonation. KSA-only Manager 34793423:
--
--   probe                                        before        after
--   ------------------------------------------   -----------   -----------------
--   check_duplicate_serials, 6 non-KSA serials    7 rows        0 rows
--   check_duplicate_serials, 2 KSA serials        2 rows        2 rows  <- control
--   get_record_provenance, Egypt tyre uuid        full row      "forbidden"
--   get_record_provenance, a KSA tyre             ok            ok      <- control
--   fx_coverage(p_to => 'SAR')                    AED,EGP,SAR   SAR only
--   admin_check_import_fingerprint, Egypt file    filename      seen:false
--   preview_learned_rule where-clause, 'tape'     EGY+UAE+KSA   KSA only
--                                                               (2,717 lines /
--                                                                39 codes)
--
-- The controls are the half that proves the feature still works: every one of
-- these still returns the caller's OWN country in full.
--
-- SUPER ADMIN d2d43a5f - the no-op proof, and the reason is_super_admin() is in
-- the predicate:
--
--   check_duplicate_serials, 6 serials     7 rows  (identical to before)
--   get_record_provenance, Egypt tyre      ok:true
--   fx_coverage                            AED, EGP, SAR
--   admin_check_import_fingerprint         "ASSET LIST EGYPT.xlsx"
--
-- 3-COUNTRY USER e864b410 (scope {ksa,uae,egypt}, Company A): BYTE-IDENTICAL to
-- before - 7 rows, all three currencies. The guard does not over-refuse someone
-- entitled to all three.
--
-- EGYPT-ONLY DIRECTOR a4fd5401 returns empty on all of these, and that is NOT
-- this guard: they are the one account outside Company A (org e340fa7a, which
-- holds 0 tyre_records), so the ORGANISATION predicate refuses first. That is
-- V551's standing open item, unchanged here. Recorded so the result is not
-- mis-attributed to V571.
--
-- Two refusals encountered while probing are likewise PRE-EXISTING gates, not
-- this migration: get_record_provenance and admin_check_import_fingerprint both
-- raise 42501 for the 3-country user because their custom role
-- "Tire Planning Engineer" is not in app_is_elevated()'s
-- ('admin','manager','director').
--
-- PROPERTIES re-verified on all five after apply: prosecdef true, volatility
-- unchanged (s,s,s,v,s), search_path still pinned, authenticated EXECUTE still
-- granted, anon EXECUTE still false.
--
-- NO COLLISION: sibling v569 landed AFTER this migration in wall-clock order, so
-- the byte-for-byte strip test and the guard-present check were both re-run
-- afterwards - all five still carry this migration's guard and nothing else.
--
--
-- WHAT REMAINS after this migration
--
-- * import_batch_country - deliberately open, reasoned above. If it is ever
--   revisited, the RLS policy import_rows_country_isolation must be rewritten in
--   the SAME change, or the gate inverts.
-- * The five anon share-token boards - deliberately open, reasoned above.
-- * The boundary helpers themselves - by definition.
-- * preview_learned_rule remains slow enough to exceed a 55s statement timeout
--   (pre-existing, on brain_has_word / learned_rule_vetoed over ~120k rows). The
--   guard narrows its scan for a scoped user, which can only help, but the
--   underlying per-row function evaluation is untouched and is still worth
--   optimising separately.
-- * The WRITERS among the 92 argument-requiring functions belong to the sibling
--   lanes (V559 / V562 / V564 / V565) and were not touched here.
--
--
-- ROLLBACK
--
--   -- restores all five to their exact pre-V571 definitions
--   do $$
--   declare r record;
--   begin
--     for r in select def from _bak.definer_arg_readers_v571 loop
--       execute r.def;
--     end loop;
--   end $$;
--
-- Snapshot table: _bak.definer_arg_readers_v571 (sig, proname, def, captured_at).
-- Pre-change md5 of each definition, for confirming a clean rollback:
--   admin_check_import_fingerprint(text)      377d5cee407a08eee6efa9de35db14ea
--   check_duplicate_serials(text[])           50012dfe1b7810c5b57604b4532a5d64
--   fx_coverage(text,date,date)               aa004aee524e13d4ead0d3334b97b272
--   get_record_provenance(text,uuid)          9622824c1c8171750181e27721783da8
--   preview_learned_rule(text,text,integer)   571d89fe30f866bcdb1f884e71124c65
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Snapshot the prior definitions (rollback source).
-- ---------------------------------------------------------------------------
create schema if not exists _bak;

drop table if exists _bak.definer_arg_readers_v571;

create table _bak.definer_arg_readers_v571 as
select p.oid::regprocedure::text as sig,
       p.proname,
       pg_get_functiondef(p.oid)  as def,
       now()                      as captured_at
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.proname in ('check_duplicate_serials',
                    'preview_learned_rule',
                    'get_record_provenance',
                    'fx_coverage',
                    'admin_check_import_fingerprint');


-- ---------------------------------------------------------------------------
-- Apply the guards. One atomic DO block; every spec asserts its anchor count.
-- ---------------------------------------------------------------------------
do $mig$
declare
  spec  record;
  v_src text;
  v_new text;
  v_hits int;
begin
  for spec in
    select * from (values

      -- 1. check_duplicate_serials: tyre_records read by serial, org-scoped only.
      --    Anchor is its organisation predicate - the point where rows are
      --    actually filtered. Refusal = zero rows.
      ('check_duplicate_serials(text[])',
       'and (t.organisation_id = public.app_current_org() or public.is_super_admin())',
       'and (t.organisation_id = public.app_current_org() or public.is_super_admin())'
       || E'\n    and (t.country is null'
       || E'\n         or (select public.is_super_admin())'
       || E'\n         or (select public.app_sees_all_countries())'
       || E'\n         or lower(btrim(t.country::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))',
       1),

      -- 2. preview_learned_rule: parts_consumption, org-scoped only, and it
      --    groups BY country / returns country. Refusal = zero rows.
      ('preview_learned_rule(text,text,integer)',
       'where pc.organisation_id = public.app_current_org()',
       'where pc.organisation_id = public.app_current_org()'
       || E'\n    and (pc.country is null'
       || E'\n         or (select public.is_super_admin())'
       || E'\n         or (select public.app_sees_all_countries())'
       || E'\n         or lower(btrim(pc.country::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))',
       1),

      -- 3. get_record_provenance: returns a whole row as jsonb from 7 tables, all
      --    of which carry a country column. The country is tested on the already
      --    fetched jsonb, immediately after - and mirroring - its own existing
      --    organisation test. Refusal reuses the function's OWN forbidden shape.
      ('get_record_provenance(text,uuid)',
       '(v_rec->>''organisation_id'') is distinct from v_org::text then'
       || E'\n    return json_build_object(''ok'',false,''reason'',''forbidden'');'
       || E'\n  end if;',
       '(v_rec->>''organisation_id'') is distinct from v_org::text then'
       || E'\n    return json_build_object(''ok'',false,''reason'',''forbidden'');'
       || E'\n  end if;'
       || E'\n  if (v_rec ? ''country'') and not ('
       || E'\n       (v_rec->>''country'') is null'
       || E'\n       or public.is_super_admin()'
       || E'\n       or public.app_sees_all_countries()'
       || E'\n       or lower(btrim(v_rec->>''country'')) = any(coalesce(public.app_country_scope(), ''{}''::text[]))'
       || E'\n     ) then'
       || E'\n    return json_build_object(''ok'',false,''reason'',''forbidden'');'
       || E'\n  end if;',
       1),

      -- 4. fx_coverage: distinct currency over parts_consumption. Column names are
      --    unqualified inside its own subquery. Refusal = the currency is simply
      --    not listed.
      ('fx_coverage(text,date,date)',
       'where organisation_id = v_org and currency is not null',
       'where organisation_id = v_org and currency is not null'
       || E'\n               and (country is null'
       || E'\n                    or (select public.is_super_admin())'
       || E'\n                    or (select public.app_sees_all_countries())'
       || E'\n                    or lower(btrim(country::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))',
       1),

      -- 5. admin_check_import_fingerprint: import_files carries country. Refusal
      --    degrades to the function's OWN {"seen": false}.
      ('admin_check_import_fingerprint(text)',
       'and (f.organisation_id = v_org or public.is_super_admin())',
       'and (f.organisation_id = v_org or public.is_super_admin())'
       || E'\n     and (f.country is null'
       || E'\n          or (select public.is_super_admin())'
       || E'\n          or (select public.app_sees_all_countries())'
       || E'\n          or lower(btrim(f.country::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))',
       1)

    ) as t(sig, anchor, replacement, expect)
  loop
    v_src := pg_get_functiondef(spec.sig::regprocedure);

    v_hits := (length(v_src) - length(replace(v_src, spec.anchor, '')))
              / nullif(length(spec.anchor), 0);

    if v_hits is distinct from spec.expect then
      raise exception
        'V571 ABORT: anchor for % occurs % time(s), expected %. Nothing applied.',
        spec.sig, coalesce(v_hits, -1), spec.expect;
    end if;

    if v_src like '%app_country_scope%' then
      raise exception 'V571 ABORT: % already carries the scope predicate.', spec.sig;
    end if;

    v_new := replace(v_src, spec.anchor, spec.replacement);

    if v_new = v_src then
      raise exception 'V571 ABORT: replacement was a no-op for %.', spec.sig;
    end if;

    execute v_new;
  end loop;
end
$mig$;


-- ---------------------------------------------------------------------------
-- VERIFY (run manually; each was run live and is reported in the header).
-- ---------------------------------------------------------------------------
--
-- (a) Textual: stripping only the inserted guard reproduces the backup exactly.
--     Expect still_only_my_guard = true and guard_present = true for all five.
--
-- with live as (
--   select b.sig, b.def before_def, pg_get_functiondef(b.sig::regprocedure) after_def
--   from _bak.definer_arg_readers_v571 b
-- )
-- select sig,
--   (md5(regexp_replace(
--       regexp_replace(after_def,
--         E'\n[ ]*(and |)\(?(pc\.|t\.|f\.|)country is null\n[^\n]*is_super_admin\(\)\)\n[^\n]*app_sees_all_countries\(\)\)\n[^\n]*app_country_scope\(\)[^\n]*\)\)', '', 'g'),
--       E'\n  if \(v_rec \? ''country''\) and not \(\n(?:[^\n]*\n){4}[ ]*\) then\n[^\n]*forbidden[^\n]*\n[ ]*end if;', '', 'g'))
--    = md5(before_def)) as still_only_my_guard,
--   (after_def ~ 'app_country_scope') as guard_present
-- from live order by sig;
--
-- (b) Behavioural, as the KSA-only Manager. Expect 0 / 2 / forbidden / true /
--     SAR-only / false. The 2 and the true are the CONTROLS.
--
-- do $$ begin perform set_config('request.jwt.claims',
--   '{"sub":"34793423-43df-4b6f-9270-9d1e8be6fa30","role":"authenticated"}', true); end $$;
-- set local role authenticated;
-- select count(*) from public.check_duplicate_serials(
--   serials => array['RE10612P936','YMA55857','25C0605393','YNN26619','YMM78495','KUN25347']);
-- select count(*) from public.check_duplicate_serials(serials => array['YLY54762','YLT93049']);
-- select (public.get_record_provenance('tyre_records','009afbc3-bbe8-4ea9-98c8-0e4aa71667fc'::uuid)::jsonb)->>'reason';
-- select public.fx_coverage(p_to => 'SAR')->>'currencies';
-- select public.admin_check_import_fingerprint(
--   '07a8f6563817bb076b717465d8c3ca603e1ac7453500912075faa596abc79dfb')->>'seen';
--
-- (c) Super-admin no-op. Expect 7 rows, ok:true, all three currencies, the
--     Egypt filename - i.e. identical to before the change.
--
-- (d) Properties preserved:
--
-- select p.oid::regprocedure::text, p.prosecdef, p.provolatile, p.proconfig,
--        has_function_privilege('authenticated', p.oid,'EXECUTE') auth_exec,
--        has_function_privilege('anon', p.oid,'EXECUTE') anon_exec
-- from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and p.prokind='f'
--   and p.proname in ('check_duplicate_serials','preview_learned_rule',
--                     'get_record_provenance','fx_coverage','admin_check_import_fingerprint');
