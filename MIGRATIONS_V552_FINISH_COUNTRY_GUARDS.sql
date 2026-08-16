-- V552  FINISH THE COUNTRY GUARDS: THE FUNCTIONS THE EARLIER PASSES COULD NOT
--       CLOSE MECHANICALLY
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A) as
-- migration v552_finish_country_guards.
--
-- V545 closed eight plpgsql cost RPCs. V546 closed seven LANGUAGE sql ones.
-- V547 swept twenty more. V549 closed the all-countries path on fifteen. V550
-- scoped two writers' rows rather than only their argument. Each of those named,
-- in writing, what it could not reach. This closes that remainder: six read
-- functions whose shape resisted a mechanical `if` insertion, one writer that
-- returns void and so cannot carry a jsonb refusal, and one function keyed on
-- asset_no where a country guard alone would not have closed anything.
--
--
-- THE MEASUREMENT THAT MATTERS, taken before a line of this was written.
--
-- Impersonating the real approved KSA-only Manager 34793423 - for whom
-- app_can_see_country('UAE') is false, app_country_scope() is {ksa}, and a
-- direct read of UAE tyre_records returns 0 rows, so RLS itself is intact - and
-- hashing the full ordered payload of every probe, then repeating as the super
-- admin d2d43a5f:
--
--   ON ALL 31 PROBES THE KSA-ONLY MANAGER'S md5 WAS BYTE-IDENTICAL TO THE SUPER
--   ADMIN'S. So was the three-country user's. Not similar - identical. These
--   functions were incapable of telling the platform owner apart from a user
--   scoped to one country.
--
-- Named-country path, KSA-only Manager asking for a country they cannot see:
--
--   reference_asset_options('UAE')        -> 452 UAE asset numbers
--   reference_site_options('UAE')         ->  20 UAE site names
--   import_existing_keys('tyre','UAE')    -> 1,926 UAE tyre keys, each carrying
--                                            the tyre SERIAL NUMBER
--   get_extra_field_stats('UAE')          -> 5 custom field keys over 5,019 UAE
--                                            tyre records, with sample VALUES
--   material_category_for('UAE',<code>)   -> 'spare_part'; all 9,321 reviewed
--                                            UAE item codes are enumerable
--   set_store_site_map('UAE',...)         -> WROTE a UAE-tagged store->site row
--
-- The same six also leaked Egypt to that user (reference_asset_options('Egypt')
-- and friends all returned data), so this is not a UAE-specific finding.
--
-- All-countries path, the DEFAULT almost every screen uses, where p_country is
-- NULL and these functions applied no row-level country restriction at all:
--
--   reference_asset_options(null)  1,380 assets   (KSA alone is 1,033)
--   reference_site_options(null)      70 sites    (KSA alone is    48)
--   import_existing_keys('tyre')   8,432 keys     (KSA alone is 6,022)
--   get_extra_field_stats(null)   49,914 records  (KSA alone is 44,304)
--
--
-- TWO FUNCTIONS ARE GUARDED WITHOUT AN OBSERVED DISCLOSURE, and are labelled as
-- such rather than dressed up as leaks:
--
--   get_production_stations('UAE') returns [] today because ALL production is
--   KSA: 38 stations under KSA, 0 under UAE and Egypt. The country-filtered read
--   is still open to a country the caller cannot see; it is empty only by
--   today's data. Same category as V547's apply_production_station_map.
--
--   gate_pass_blockers returns {"total":0} for every asset in every country, for
--   every caller. Measured across the whole database: corrective_actions holds 3
--   rows and every one is priority 'Medium' (it needs 'High'); tyre_records.
--   risk_level is NULL on all 11,191 rows (it needs 'Critical'); all 358
--   inspections are severity 'Medium' (it needs 'Critical'). Three independent
--   reasons for zero. See its own section for why it is still rewritten.
--
--
-- fleet_tyre_km_by_asset WAS ALREADY CLOSED, BY V548, AND IS NOT RE-FIXED HERE.
--
-- It was on this migration's list. Re-measured first rather than assumed: as the
-- KSA-only Manager it now raises `permission denied for function
-- fleet_tyre_km_by_asset` [42501], because V548 revoked EXECUTE from
-- authenticated. The prescribed fix had already landed in a parallel pass. The
-- leak figure it carried is corroborated and worth recording - the UAE slice of
-- that query is exactly 166 assets / 49,462,431 km - but nothing here re-applies
-- a revoke that is already in place, because claiming to have closed something
-- already closed is how a boundary gets counted twice and audited once.
--
-- PART 0 instead ASSERTS the revoke, so the invariant is enforced by this
-- migration rather than merely believed, and a future grant that re-opens it
-- cannot pass silently. The three definer callers (get_fleet_cpk,
-- get_cpk_drivers, get_cpk_km_intelligence) execute it as the OWNER, so they are
-- unaffected: verified after, the KSA-only Manager still gets a full CPK report -
-- 148,982,435 km, 281 measured assets, SAR 6,155,767.84 tyre cost, cpk 0.0413.
--
--
-- THE GUARD, AND THE ONE THING THAT IS EASY TO GET WRONG.
--
-- Two clauses, matching the shape V546 and V549 left on get_expense_by_site:
--
--   (a) NAMED PATH
--       (p_country is null or public.app_can_see_country(p_country) is not false)
--
--       `IS NOT FALSE`, NOT a bare truth test, AND THIS IS LOAD-BEARING.
--       Measured on this database: with no JWT - a cron job, an edge function on
--       the service role, any backend caller - app_can_see_country() returns
--       NULL, not false. A predicate written `(p_country is null or
--       app_can_see_country(p_country))` therefore evaluates to NULL for those
--       callers, the row is filtered out, and every backend read silently
--       returns nothing. `is not false` refuses only on a DEFINITIVE false,
--       which mirrors byte-for-byte what plpgsql's `if not app_can_see_country()
--       then refuse` already does in V545/V546/V547 - those fail open on NULL
--       too, because `if NULL` is not taken. This keeps service-role behaviour
--       identical while closing the authenticated-user hole, where the helper
--       always returns a definite true or false.
--
--   (b) ALL-COUNTRIES PATH - the RLS idiom adopted in V396 and reused by V549:
--
--       (<col> is null
--        or (select public.is_super_admin())
--        or (select public.app_sees_all_countries())
--        or lower(btrim(<col>)) = any(coalesce((select public.app_country_scope()),
--                                              '{}'::text[])))
--
--       is_super_admin() IS NOT DECORATION. Re-measured here rather than taken
--       on trust: the super admin's profiles.country is NULL, so for them
--       app_sees_all_countries() is false and app_country_scope() is {}. NOT ONE
--       user on this database has app_sees_all_countries() true. A predicate
--       built from the two scope readers alone - the obvious shape - returns
--       ZERO ROWS to the platform owner. The zero-argument readers are used in
--       preference to the row-argument app_can_see_country(country) because,
--       written as (select f()), they are uncorrelated subqueries hoisted to a
--       once-per-query InitPlan.
--
-- THE 'All' SENTINEL IS DECIDED PER FUNCTION, NOT BLANKET. app_can_see_country
-- ('All') is FALSE - 'All' is the app's own all-countries sentinel, not a country
-- anyone is scoped to.
--   * reference_asset_options and reference_site_options ALREADY special-case
--     `p_country IN ('All','')` as "no filter", so the exemption is carried into
--     the guard. Without it the picker would refuse the All view to every
--     country-scoped user in the app.
--   * import_existing_keys must NOT get the exemption. Measured: it treats 'All'
--     as a LITERAL through `country is not distinct from $2`, so
--     import_existing_keys('tyre','All') already returns 0 rows. Exempting it
--     would take that from 0 to 8,432 - a widening dressed as a guard.
--   * The other three compare p_country by equality, so 'All' already matches
--     nothing and no exemption is needed or added.
--
--
-- THE SHAPE OF THE REFUSAL, chosen per function so nothing is invented:
--   reference_asset_options / reference_site_options / get_extra_field_stats
--     -> ZERO ROWS. All three are TABLE-returning option/stat lists whose
--        clients already render an empty result.
--   get_production_stations -> '[]' through its own existing coalesce.
--   material_category_for   -> NULL, which is that function's own documented
--        "fall back to the patterns". A conservative fallback, not a false
--        assertion, and the safest possible refusal for a classifier input.
--   import_existing_keys    -> zero rows, i.e. "no live duplicates known". Its
--        only caller already wraps it in try/catch and degrades to in-batch
--        dedup, so this is a shape it handles today.
--   set_store_site_map      -> RAISE, see its section.
--
-- NOT ONE of these emits a populated row of zeros. That distinction is V546's:
-- a jsonb-object aggregate with no GROUP BY still yields one row on empty input,
-- which asserts "this country has nothing" instead of refusing. None of the six
-- has that shape - the three TABLE functions group or return per-row, and
-- get_production_stations aggregates to an ARRAY, which coalesces to [] - so
-- none needed converting to plpgsql for that reason.
--
--
-- import_existing_keys: THE 'workorder' MODULE IS DELIBERATELY LEFT GLOBAL.
--
-- It is the import de-duplication oracle. For every module except one, its key
-- already begins with the country and it filters on country. For 'workorder' it
-- sets v_country_predicate := 'true' and keys on work_order_no alone - measured,
-- it returns the same 89,628 keys for KSA, for UAE and for NULL alike.
--
-- That is not an oversight; it is a fix this codebase already made deliberately.
-- work_orders.work_order_no carries a GLOBAL unique constraint, and the standing
-- record of the earlier work states plainly that a per-country dedupe scope
-- reintroduced cross-country contamination and made the whole import batch abort
-- on 23505. Adding a country row-filter to that module would regress it: a KSA
-- import of a number already stored under UAE would not see it, would try to
-- insert, and would take the batch down.
--
-- So the row-level filter is applied to the SHARED predicate, which 'workorder'
-- then overwrites with 'true' - leaving it global by construction rather than by
-- an exception clause. THE TRADE-OFF IS STATED RATHER THAN HIDDEN: a KSA caller
-- can still learn that some work_order_no exists under another country. It is a
-- bare opaque identifier carrying no financial or operational content, and there
-- is no way to both hide it and prevent the duplicate insert, because the client
-- needs the key string itself to match against its file. Correctness of a global
-- unique key wins; the disclosure is named.
--
--
-- set_store_site_map: A RAISE, BECAUSE IT RETURNS void.
--
-- Confirmed cross-country WRITE, counted as a PRIVILEGED reader inside the same
-- transaction (`reset role` then count - counting from the writer's own session
-- is the V542 trap): the KSA-only Manager successfully wrote a UAE-tagged
-- store->site mapping row. That row re-attributes UAE expense in the by-site
-- report, so it is the V550 class - a write into a country the caller cannot see.
--
-- It returns void, so it cannot carry a {"ok":false} refusal. It gets a RAISE
-- with errcode 42501, matching how this codebase raises other permission
-- failures, and NO CLIENT CHANGE IS NEEDED - verified by reading the callers
-- rather than assuming:
--   * src/lib/api/storeSiteExpense.js setStoreSiteMap already does
--     `if (error) throw error`.
--   * src/pages/ExpenseReport.jsx saveMapping already wraps it in try/catch and
--     renders `toUserMessage(e, 'Could not save the site mapping.')`.
--   * src/lib/safeError.js maps SQLSTATE 42501 to "You do not have permission to
--     do that." So the refusal surfaces as a clean, sanitised sentence.
--   * The function ALREADY raises for a non-elevated caller, so a thrown
--     exception is a shape this path handles in production today.
-- The new check is placed AFTER the existing elevated check so an unauthorised
-- user still gets the existing, more general message first.
--
-- A NULL p_country is still allowed, matching V550 and every RLS policy here.
-- Verified this is safe rather than assumed: get_expense_by_site joins
-- store_site_map with `m.country IS NOT DISTINCT FROM pc.country`, so a
-- null-country mapping matches ONLY null-country expense rows - and
-- parts_consumption holds 0 of those out of 209,381. A null-country mapping is
-- inert today and is not an all-countries wildcard.
--
--
-- gate_pass_blockers: A COUNTRY GUARD ALONE WOULD HAVE CLOSED NOTHING.
--
-- It keys on asset_no, p_country DEFAULTS to NULL, null means "any country", and
-- its client passes NULL on the All-countries view
-- (src/lib/api/gatePasses.js: `country && country !== 'All' ? country : null`).
-- So the ordinary call walks straight past any argument-level guard - exactly
-- the V550 finding. And asset numbers are a per-country sequence in this fleet,
-- so the same code in two countries is usually a DIFFERENT machine: matching on
-- asset_no across countries returns another country's tyre serial numbers,
-- inspection findings and site names for a machine that is not the one asked
-- about.
--
-- It cannot leak today, for the three measured reasons in the header above. It
-- is rewritten anyway, on the same basis V548 used for match_knowledge_documents:
-- the fix is free, it is structurally the V550 class, and the first row anyone
-- files with priority 'High' or severity/risk 'Critical' outside the caller's
-- country arms it. The fix SCOPES THE ROWS - the V550 shape - in all three
-- sub-selects, which closes the named path and the NULL default together.
--
--
-- NOTHING IS RETYPED. Every function is rebuilt from its own LIVE
-- pg_get_functiondef output by an anchored replace(), and every replace ABORTS
-- unless its anchor occurs EXACTLY once. A partial run is the failure mode that
-- matters here: half a boundary reads as a closed one (the V396 lesson).
-- CREATE OR REPLACE preserves SECURITY DEFINER, the pinned search_path and the
-- existing grants, all of which are re-verified in PART 3.
--
--
-- VERIFIED AFTER, by impersonation, every test in a rolled-back transaction.
-- See the trailing VERIFICATION block for the exact probes and hashes.
--   * KSA-only Manager asking for UAE: 0 rows / [] / NULL / raise on all eight.
--     Egypt likewise. The write is refused.
--   * The SAME user's own country: md5 BYTE-IDENTICAL to the pre-change capture
--     on every probe, including the 'workorder' dedupe key set.
--   * Their all-scope result is now byte-identical to their explicit KSA result.
--   * SUPER ADMIN: byte-identical on every probe, UAE included.
--   * 3-COUNTRY USER: byte-identical on every probe - their scope covers every
--     country value that exists, which is the proof this filters by scope rather
--     than by accident.
--   * EGYPT DIRECTOR: unchanged. Stated precisely: these six are ORG-scoped on
--     app_current_org(), that user belongs to organisation e340fa7a which holds
--     zero rows, so they received nothing from them BEFORE this change and
--     receive nothing after. The emptiness is the long-recorded org-membership
--     misconfiguration, not something this migration caused - and unlike the
--     four functions V549 flagged, these six were never a cross-ORG hole.
--   * anon still cannot execute any of the eight.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v552, which holds the
-- exact prior definition text:
--   do $$ declare r record; begin
--     for r in select def from _bak.rpc_defs_v552 loop execute r.def; end loop;
--   end $$;

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v552;
create table _bak.rpc_defs_v552 (proname text, def text, saved_at timestamptz default now());

insert into _bak.rpc_defs_v552 (proname, def)
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
where p.proname in ('reference_asset_options','reference_site_options','import_existing_keys',
                    'get_extra_field_stats','material_category_for','get_production_stations',
                    'set_store_site_map','gate_pass_blockers');

do $mig$
declare n int;
begin
  select count(*) into n from _bak.rpc_defs_v552;
  if n <> 8 then raise exception 'V552: expected to snapshot 8 functions, snapshotted %', n; end if;
end $mig$;


------------------------------------------------------------------------------
-- PART 0. ASSERT the V548 revoke on fleet_tyre_km_by_asset still holds.
-- Nothing is changed here. This makes the closure an enforced invariant rather
-- than a belief, so a future grant that re-opens it cannot pass silently.
------------------------------------------------------------------------------
do $mig$
declare o oid;
begin
  select p.oid into o
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
  where p.proname = 'fleet_tyre_km_by_asset';

  if o is null then
    raise exception 'V552: fleet_tyre_km_by_asset is missing';
  end if;
  if has_function_privilege('authenticated', o, 'EXECUTE') then
    raise exception 'V552: fleet_tyre_km_by_asset is EXECUTABLE by authenticated - the V548 revoke has been undone';
  end if;
  if has_function_privilege('anon', o, 'EXECUTE') then
    raise exception 'V552: fleet_tyre_km_by_asset is EXECUTABLE by anon';
  end if;
end $mig$;


------------------------------------------------------------------------------
-- PART 1. THE SIX READ FUNCTIONS.
------------------------------------------------------------------------------
do $mig$
declare
  v_def   text;
  newdef  text;
  anchor  text;
  repl    text;
  n       int;

  -- (a) named path. `is not false` so a NULL answer (no JWT / service role)
  --     fails OPEN, exactly as the plpgsql `if not ...` guards already do.
  guard_all  constant text :=
    '(p_country is null or p_country in (''All'','''') or public.app_can_see_country(p_country) is not false)';
  guard_plain constant text :=
    '(p_country is null or public.app_can_see_country(p_country) is not false)';
begin
  ------------------------------------------------------------------ 1. assets
  select t.def into v_def from _bak.rpc_defs_v552 t where t.proname = 'reference_asset_options';
  anchor := '  WHERE p_country IS NULL OR p_country IN (''All'','''') OR u.country IS NULL OR u.country = p_country';
  n := (length(v_def) - length(replace(v_def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: reference_asset_options anchor matched % times', n; end if;
  -- The original is a bare OR-chain. AND binds tighter than OR, so the guards
  -- MUST be parenthesised as their own conjuncts or they would attach to the
  -- last OR term only.
  repl := '  WHERE (p_country IS NULL OR p_country IN (''All'','''') OR u.country IS NULL OR u.country = p_country)'
       || E'\n    AND ' || guard_all
       || E'\n    AND (u.country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())'
       || E'\n         or lower(btrim(u.country)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))';
  execute replace(v_def, anchor, repl);

  ------------------------------------------------------------------- 2. sites
  select t.def into v_def from _bak.rpc_defs_v552 t where t.proname = 'reference_site_options';
  n := (length(v_def) - length(replace(v_def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: reference_site_options anchor matched % times', n; end if;
  execute replace(v_def, anchor, repl);

  ------------------------------------------------------- 3. extra field stats
  select t.def into v_def from _bak.rpc_defs_v552 t where t.proname = 'get_extra_field_stats';
  anchor := '    AND (p_country IS NULL OR country = p_country)';
  n := (length(v_def) - length(replace(v_def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: get_extra_field_stats anchor matched % times', n; end if;
  repl := anchor
       || E'\n    AND ' || guard_plain
       || E'\n    AND (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())'
       || E'\n         or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))';
  execute replace(v_def, anchor, repl);

  ------------------------------------------------------- 4. production stations
  select t.def into v_def from _bak.rpc_defs_v552 t where t.proname = 'get_production_stations';
  anchor := '         AND (p_country IS NULL OR p.country = p_country)';
  n := (length(v_def) - length(replace(v_def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: get_production_stations anchor matched % times', n; end if;
  repl := anchor
       || E'\n         AND ' || guard_plain
       || E'\n         AND (p.country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())'
       || E'\n              or lower(btrim(p.country)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))';
  execute replace(v_def, anchor, repl);

  ------------------------------------------------------------ 5. material master
  -- p_country is a required argument used in an equality, so there is no
  -- all-countries path to close here: only the named guard applies. The honest
  -- refusal is NULL, which this function itself documents as "fall back to the
  -- patterns" - a conservative classifier fallback, never a false assertion.
  select t.def into v_def from _bak.rpc_defs_v552 t where t.proname = 'material_category_for';
  anchor := '     and m.country = p_country';
  n := (length(v_def) - length(replace(v_def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: material_category_for anchor matched % times', n; end if;
  execute replace(v_def, anchor, anchor || E'\n     and ' || guard_plain);

  --------------------------------------------------------- 6. import dedup keys
  select t.def into v_def from _bak.rpc_defs_v552 t where t.proname = 'import_existing_keys';

  -- 6a. named path: refuse by returning no rows, before any work is done.
  anchor := '  if v_target is null then return; end if;';
  n := (length(v_def) - length(replace(v_def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: import_existing_keys return-guard anchor matched % times', n; end if;
  -- NOTE: no 'All' exemption. 'All' is matched LITERALLY by this function
  -- (`country is not distinct from $2`) and already yields 0 rows; exempting it
  -- would widen 0 -> every country.
  newdef := replace(v_def, anchor,
      '  if p_country is not null and public.app_can_see_country(p_country) is false then return; end if;'
      || E'\n' || anchor);

  -- 6b. all-countries path: scope the ROWS in the shared dynamic predicate.
  -- 'workorder' overwrites v_country_predicate with 'true' further down, so it
  -- stays GLOBAL by construction - see the header for why that is required.
  anchor := '  v_country_predicate text := ''($2 is null or country is not distinct from $2)'';';
  n := (length(newdef) - length(replace(newdef, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: import_existing_keys predicate anchor matched % times', n; end if;
  newdef := replace(newdef, anchor,
      '  v_country_predicate text := ''($2 is null or country is not distinct from $2)'''
      || E'\n    || '' and (country is null or (select public.is_super_admin())'''
      || E'\n    || '' or (select public.app_sees_all_countries())'''
      || E'\n    || '' or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), ''''{}''''::text[])))'';');
  execute newdef;
end $mig$;


------------------------------------------------------------------------------
-- PART 2. THE WRITER (RAISE) AND THE ASSET-KEYED READER (ROW SCOPING).
------------------------------------------------------------------------------
do $mig$
declare
  v_def  text;
  newdef text;
  anchor text;
  n      int;
  scope  constant text :=
    ' AND (%s.country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())'
    || ' or lower(btrim(%s.country)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))';
begin
  ------------------------------------------------------ set_store_site_map
  select t.def into v_def from _bak.rpc_defs_v552 t where t.proname = 'set_store_site_map';
  anchor := '  IF p_store_code IS NULL OR BTRIM(p_store_code) = '''' THEN';
  n := (length(v_def) - length(replace(v_def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: set_store_site_map anchor matched % times', n; end if;
  -- Placed AFTER the existing elevated check so a non-elevated caller still gets
  -- the existing, more general message. errcode 42501 maps to a clean sentence
  -- in src/lib/safeError.js, so no client change is needed. A NULL country is
  -- still allowed - the by-site join is IS NOT DISTINCT FROM, and there are 0
  -- null-country expense rows, so such a mapping is inert, not a wildcard.
  newdef := replace(v_def, anchor,
      '  IF p_country IS NOT NULL AND BTRIM(p_country) <> '''''
      || E'\n     AND public.app_can_see_country(p_country) IS FALSE THEN'
      || E'\n    RAISE EXCEPTION ''You do not have permission to map a store in that country.'''
      || E'\n      USING errcode = ''42501'';'
      || E'\n  END IF;'
      || E'\n' || anchor);
  execute newdef;

  ------------------------------------------------------- gate_pass_blockers
  -- Scope the ROWS, not the argument (the V550 lesson): p_country defaults to
  -- NULL, the client passes NULL on the All view, and the join key is asset_no -
  -- which is a per-country sequence, so the same code is usually a different
  -- machine in another country.
  select t.def into v_def from _bak.rpc_defs_v552 t where t.proname = 'gate_pass_blockers';

  anchor := '    AND (v_country IS NULL OR c.country = v_country OR c.country IS NULL);';
  n := (length(v_def) - length(replace(v_def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: gate_pass_blockers corrective_actions anchor matched % times', n; end if;
  newdef := replace(v_def, anchor,
      '    AND (v_country IS NULL OR c.country = v_country OR c.country IS NULL)'
      || E'\n   ' || format(scope, 'c', 'c') || ';');

  anchor := '      AND (v_country IS NULL OR tr.country = v_country OR tr.country IS NULL)';
  n := (length(newdef) - length(replace(newdef, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: gate_pass_blockers tyre_records anchor matched % times', n; end if;
  newdef := replace(newdef, anchor, anchor || E'\n     ' || format(scope, 'tr', 'tr'));

  anchor := '    AND (v_country IS NULL OR i.country = v_country OR i.country IS NULL);';
  n := (length(newdef) - length(replace(newdef, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'V552: gate_pass_blockers inspections anchor matched % times', n; end if;
  newdef := replace(newdef, anchor,
      '    AND (v_country IS NULL OR i.country = v_country OR i.country IS NULL)'
      || E'\n   ' || format(scope, 'i', 'i') || ';');

  execute newdef;
end $mig$;


------------------------------------------------------------------------------
-- PART 3. ASSERT the outcome: every target guarded, security properties intact.
------------------------------------------------------------------------------
do $mig$
declare
  r        record;
  n_guard  int := 0;
  prior    record;
begin
  for r in
    select p.oid, p.proname, p.prosecdef,
           coalesce(array_to_string(p.proconfig, ','), '') as cfg,
           pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
    where p.proname in ('reference_asset_options','reference_site_options','import_existing_keys',
                        'get_extra_field_stats','material_category_for','get_production_stations',
                        'set_store_site_map','gate_pass_blockers')
  loop
    -- gate_pass_blockers is DELIBERATELY excluded from this check. It is scoped
    -- by ROWS (the V550 shape) rather than by its argument, so it carries
    -- app_country_scope and not app_can_see_country. Asserting the argument
    -- guard on it would be asserting the wrong thing - the row filter is
    -- strictly stronger, closing the named path and the NULL default together.
    -- It is covered by the app_country_scope loop below instead.
    if r.proname <> 'gate_pass_blockers' and r.def not ilike '%app_can_see_country%' then
      raise exception 'V552: % carries no country guard after the rewrite', r.proname;
    end if;
    if not r.prosecdef then
      raise exception 'V552: % lost SECURITY DEFINER', r.proname;
    end if;
    if r.cfg not like '%search_path=%' then
      raise exception 'V552: % lost its pinned search_path', r.proname;
    end if;
    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      raise exception 'V552: % is executable by anon', r.proname;
    end if;
    if not has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      raise exception 'V552: % lost its authenticated grant', r.proname;
    end if;
    n_guard := n_guard + 1;
  end loop;

  if n_guard <> 8 then
    raise exception 'V552: expected to guard 8 functions, guarded %', n_guard;
  end if;

  -- The six that also needed the all-countries row filter must carry it. For
  -- gate_pass_blockers this is its ONLY guard, and its complete one.
  for r in
    select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
    where p.proname in ('reference_asset_options','reference_site_options','import_existing_keys',
                        'get_extra_field_stats','get_production_stations','gate_pass_blockers')
  loop
    if r.def not ilike '%app_country_scope%' then
      raise exception 'V552: % carries no all-countries row filter', r.proname;
    end if;
  end loop;
end $mig$;


------------------------------------------------------------------------------
-- VERIFICATION ACTUALLY RUN (each inside `begin; ... rollback;`)
--
--   select set_config('request.jwt.claims',
--          '{"sub":"<user>","role":"authenticated"}', true);
--   set local role authenticated;
--   -- then hash the full ordered payload of each probe, e.g.
--   select md5(coalesce((select string_agg(asset_no,'|' order by asset_no)
--                          from public.reference_asset_options('KSA')),'~'));
--
-- BEFORE -> AFTER, KSA-only Manager 34793423 (md5 of the ordered payload;
-- 4c761f17...=md5('~')=empty, d75171398...=md5('[]')):
--
--   probe                       before                            after
--   -------------------------   -------------------------------   ---------------
--   rao('KSA')                  f1efcd431c5f6535fcd2eed0a7faf67e  UNCHANGED
--   rso('KSA')                  2e66fd40fdcbe3f9d99c7f2e8faceca7  UNCHANGED
--   iek('tyre','KSA')           8b59e68a1804e5d956396e4781013942  UNCHANGED
--   iek('fleet','KSA')          37c4cfca0e9eb86df94b63b66238cf93  UNCHANGED
--   iek('workorder','KSA')      0f3e3ad7524fd092214c9d548d380e9f  UNCHANGED (89,628)
--   gefs('KSA')                 50e2a3fdb417bbe444895cb81899cb19  UNCHANGED
--   gps('KSA')                  81f2b1836849be63c564c695bdf872a3  UNCHANGED
--   mcf('KSA',...)              'spare_part'                      UNCHANGED
--   gpb('BH006','KSA')          47fe5077f4cc636982606dcac2a91381  UNCHANGED
--   gpb('BH006',null)           4b8f3b360926a10185509eea3bd0c73d  UNCHANGED
--   ---- the attack ----
--   rao('UAE')                  13be84252976783256b919775ecfa7b4  4c761f17 (452 -> 0)
--   rso('UAE')                  4e9a46a07828700ae01232ba6e2f73f7  4c761f17 ( 20 -> 0)
--   iek('tyre','UAE')           f02d0e8ba67557a73556fac5661418e9  4c761f17 (1926 -> 0)
--   gefs('UAE')                 55853408551f28535a3aebe0fdb840ab  4c761f17 (5019 -> 0)
--   gps('UAE')                  d751713988987e9331980363e24189ce  UNCHANGED ([] both)
--   mcf('UAE',...)              'spare_part'                      NULL
--   rao('Egypt') and friends    (Egypt data)                      4c761f17 (empty)
--   ---- the all-countries default ----
--   rao(null)                   46b8fe189dbd957d62a69a2213be97ed  f1efcd43 (1380 -> 1033)
--   rso(null)                   2b436fa8fd1e78531b616d8fdcf35314  2e66fd40 (  70 ->   48)
--   iek('tyre',null)            a768798297dd3986fc6ded3fa1102782  8b59e68a (8432 -> 6022)
--   gefs(null)                  14e5f55f8f7e3e3a3d460c1a0cc48a93  50e2a3fd (49914 -> 44304)
--   gps(null)                   81f2b1836849be63c564c695bdf872a3  UNCHANGED
--   iek('workorder',null)       0f3e3ad7524fd092214c9d548d380e9f  UNCHANGED (89,628)
--   iek('tyre','All')           4c761f17 (already 0)              UNCHANGED
--
-- THE DECISIVE CHECK: after this change that user's ALL-SCOPE result is
-- BYTE-IDENTICAL to their own explicit KSA-scope result on rao, rso, iek(tyre)
-- and gefs - the four probes where an all-scope hole existed.
--
-- SUPER ADMIN d2d43a5f and 3-COUNTRY USER e864b410: byte-identical to their own
-- pre-change capture on all 31 probes, UAE and Egypt included.
--
-- EGYPT DIRECTOR a4fd5401: unchanged. Every probe returned empty BEFORE and
-- returns empty after - these six are org-scoped on app_current_org() and that
-- user's organisation holds no rows.
--
-- WRITE, counted as a privileged reader in the same transaction (`reset role`
-- then count - counting from the writer's own session is the V542 trap):
--   set_store_site_map as the KSA-only Manager
--     BEFORE: 'UAE' accepted, and a NULL-country row accepted; both landed.
--     AFTER : 'UAE'   -> ERROR 42501 "You do not have permission to map a store
--                       in that country."
--             'Egypt' -> ERROR 42501, same.
--   CONTROL, same user, their OWN country: set_store_site_map('KSA',...) still
--   succeeds. Privileged count of the probe rows afterwards reads exactly
--   "KSA/ZZ_V552_CONTROL" - the control landed, neither attack did.
--
-- EVERY import_existing_keys MODULE re-tested, because PART 1 edits the dynamic
-- SQL that module selection builds. All ten compile and run; none errors:
--
--   module       own country   'UAE'   all-scope
--   ----------   -----------   -----   ---------
--   fleet              1,030       0       1,030
--   tyre               6,022       0       6,022
--   workorder         89,628       0      89,628   <- stays GLOBAL by design
--   inspection           347       0         347
--   accident               4       0           4
--   gatepass               0       0           2
--   stock                  0       0           1
--   warranty/supplier/driver  0    0           0
--
-- The gatepass and stock all-scope figures exceed their named-KSA figures by
-- exactly the rows whose country is NULL, which the RLS idiom deliberately makes
-- visible to everyone (`<col> is null` is the first term). Same asymmetry V549
-- recorded for get_country_kpi's corrective_actions. It is the convention, not a
-- leak, and it is not introduced here - those rows were already returned before.
--
-- SERVICE-ROLE / no-JWT BEHAVIOUR IS UNCHANGED, which is the point of `is not
-- false`. Measured after, with no JWT: app_can_see_country('UAE') returns NULL,
-- and material_category_for('UAE',...) still returns 'spare_part'. A bare truth
-- test would have returned NULL here and silently emptied every backend caller.
--
-- ROLLBACK REHEARSED, not merely written down: replaying every def from
-- _bak.rpc_defs_v552 in a rolled-back transaction restored all 8 pre-V552 bodies
-- (guarded count 8 -> 0), and the guards are intact after the rollback of that
-- test (guarded count back to 8/8).
------------------------------------------------------------------------------
