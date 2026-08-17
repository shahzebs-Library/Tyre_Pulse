-- V569  THE FIVE V556 MEASURED AND HELD BACK: MULTI-ANCHOR CONSOLIDATION READERS
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A) as
-- migration v569_consolidation_reader_country_guards.
--
-- V556 closed 33 functions on the all-countries path and stopped at six, for a
-- reason it stated plainly: each of these has SEVERAL organisation anchors in
-- one body, the alias-to-column mapping is a judgement rather than a mechanical
-- substitution, and a wrong guess silently changes a consolidation figure -
-- which an md5 comparison cannot catch. This migration closes five of the six
-- and dismisses the sixth on measured evidence.
--
-- Same defect class as V549/V556, third and final occurrence: a SECURITY DEFINER
-- function runs as its OWNER, so RLS never runs inside it, and these five apply
-- no country restriction of any kind on any path.
--
--
-- ============================================================================
-- MEASURED BEFORE. Every payload canonicalised through _bak.canon() (which sorts
-- every jsonb array recursively) and hashed, for the real approved KSA-only
-- Manager 34793423 (country {KSA}, direct UAE/Egypt read returns 0 rows) and for
-- the super admin d2d43a5f, in rolled-back transactions.
--
-- THE COMPARATOR WAS PROVED STABLE BEFORE ANY DIFFERENCE WAS BELIEVED. Every one
-- of the six functions was probed TWICE, independently, for all four users:
-- 24 of 24 returned an identical md5 on both runs. That matters here because
-- holding_consolidated_kpis carries a `now() - interval '30 days'` window and
-- would have been a candidate for the moving-payload trap that produced five
-- false alarms in V556.
--
--   ALL FIVE RETURNED A BYTE-IDENTICAL md5 TO THE SUPER ADMIN'S.
--
-- Identical bytes is not by itself proof of disclosure - an empty payload is
-- identical too - so each was opened. Ground truth for this organisation:
--
--   vehicle_fleet   KSA 1,030 | UAE   452 | Egypt   135  = 1,617
--   tyre_records    KSA 8,145 | UAE 2,455 | Egypt   591  = 11,191
--   work_orders     KSA 62,127| UAE 14,976| Egypt 12,525 = 89,628
--
-- What a KSA-only Manager was actually handed:
--
--   get_asset_master           263,533 B. 1,000 rows (its own p_limit cap), of
--                              which 389 NAME UAE and 93 NAME Egypt, and 239
--                              carry country_count > 1. Concretely BP041 is
--                              returned as one asset spanning "Egypt, KSA, UAE"
--                              with per-country work-order volumes side by side
--                              (Egypt 6, KSA 118, UAE 3).
--   holding_consolidated_kpis  465 B. vehicles 1,617 and tyres 11,191 - the
--                              entire three-country fleet - against a KSA fleet
--                              of 1,030 and 8,145 tyres.
--   data_completeness          260 B. fleet total 1,617, tyres total 11,191,
--                              plus every per-column fill count over all three
--                              countries.
--   data_link_audit            409 B. fleet_assets 1,617, work_orders 89,628,
--                              tyre_records 11,191, and the orphan/blank counts
--                              derived from them.
--   cost_budget_overview       140 B. vehicles 1,617 and an
--                              actual_avg_monthly_spend of 476,834 - which is
--                              SAR + AED + EGP added together, so at once a
--                              disclosure of two other countries and a number
--                              that is not a quantity of anything.
--
-- Reach: get_asset_master, data_completeness, data_link_audit and
-- cost_budget_overview carry NO role gate at all - any authenticated member of
-- the organisation reaches them. holding_consolidated_kpis gates on role in
-- (Admin, Manager, Director), which the leaking Manager satisfies.
--
--
-- ============================================================================
-- THE holding_consolidated_kpis DECISION - the one that needed deciding rather
-- than fixing.
--
-- It is a deliberate cross-ORGANISATION rollup (V201, holding-company
-- consolidation). Country-scoping a consolidation report could be exactly the
-- wrong thing to do, so this was settled by measurement, not reflex.
--
--   1. IT CONSOLIDATES NOTHING TODAY. The function collects
--      `WHERE id = v_parent OR parent_organisation_id = v_parent`. Measured
--      live: ALL FOUR organisations on this database have
--      parent_organisation_id IS NULL. Nothing is anybody's subsidiary. The
--      function's own output says so - it returns `subsidiary_count: 0` and a
--      `subsidiaries` array holding exactly ONE entry, the caller's own org.
--      So what is actually being served today is a single-organisation fleet KPI
--      report wearing a consolidation shell, and its 1,617 vehicles are not a
--      group total - they are one company's three countries added up.
--
--   2. THE TWO AXES ARE ORTHOGONAL. Consolidation runs along ORGANISATION.
--      Visibility runs along COUNTRY. Guarding country does not collapse the org
--      rollup: every subsidiary still appears as its own row, and the grand
--      total still sums across them. What changes is only WHICH ROWS each
--      subsidiary's counters are computed from. "Consolidated across my
--      subsidiaries, within the countries I am permitted to see" is a coherent
--      report; it is the same report every other screen in this system already
--      gives that user.
--
--   3. THE ORGANISATION LIST IS DELIBERATELY NOT FILTERED. `organisations` also
--      carries a country column. It is left alone on purpose: filtering the
--      tenant list would DROP a whole subsidiary out of the consolidation, which
--      would silently change a group figure. The guard is applied to the rows
--      counted inside each organisation, never to the set of organisations.
--
--   4. THE ALTERNATIVE WAS CONSIDERED AND REJECTED. Restricting execution to
--      super admins is defensible and would also close the leak, but it removes
--      the page from the Managers and Directors who legitimately use it for
--      their own organisation, and it leaves the country boundary absent for
--      whoever is left. Scoping the rows keeps the feature for everyone AND
--      makes each viewer's numbers correct for that viewer. That is strictly
--      better, so the grant is left exactly as it is.
--
-- Decision: GUARD IT. Nothing on the consolidation axis is lost, because there
-- is nothing on that axis today, and the guard remains correct on the day a real
-- subsidiary is added.
--
--
-- ============================================================================
-- broadcast_audience - DISMISSED, with evidence, not guarded.
--
-- V556 held it back because profiles.country is text[] and the scalar predicate
-- does not apply. That is true, but it is not the reason to leave it alone. The
-- reason is that IT DISCLOSES NOTHING THE CALLER CANNOT ALREADY READ DIRECTLY.
--
--   Measured, impersonating the KSA-only Manager, reading public.profiles
--   DIRECTLY under RLS with `set local role authenticated`:
--     37 profile rows readable, INCLUDING 2 users whose country contains UAE and
--     2 whose country contains Egypt.
--
--   broadcast_audience returns, for that same caller: {total: 37, with_app: 16,
--   by_role: [...]} - aggregate counts over exactly the rows they can already
--   SELECT, in far less detail than a plain `select * from profiles` already
--   gives them. profiles is org-scoped but deliberately NOT country-scoped: the
--   user directory is organisation-wide by design.
--
-- Guarding it would therefore close nothing, and would do two kinds of harm:
--
--   a. IT WOULD BREAK THE ONE INVARIANT THE FEATURE RESTS ON. broadcast_send
--      resolves its audience with a predicate character-for-character identical
--      to broadcast_audience's, and the module documents the reason: "The
--      audience is resolved on the SERVER, both for the preview and for the
--      send, so the count an admin is shown before pressing send is produced by
--      the same query that decides who is actually told." Scoping the preview
--      alone makes the preview lie. Scoping both is a change to who receives
--      operational broadcasts, which is a product decision, not a leak fix.
--
--   b. IT WOULD SILENTLY DROP PEOPLE FROM SAFETY NOTICES. A KSA manager sending
--      a company-wide instruction would stop reaching the 2 UAE, 2 Egypt and 2
--      country-less colleagues, while the confirmation still said it had been
--      sent. A message that quietly fails to reach someone is worse than a
--      headcount they can already obtain.
--
-- Left exactly as it is.
--
--
-- ============================================================================
-- THE PREDICATE is V549's and V556's, unchanged:
--
--   and (<col> is null
--        or (select public.is_super_admin())
--        or (select public.app_sees_all_countries())
--        or lower(btrim(<col>::text)) = any(coalesce((select public.app_country_scope()),
--                                                    '{}'::text[])))
--
-- RE-MEASURED on the live profiles rows rather than carried over on trust,
-- because the whole predicate turns on it:
--
--   user                  app_sees_all_countries()   app_country_scope()  super
--   -------------------   ------------------------   -------------------  -----
--   super admin shahzeb   false                      {}                   true
--   KSA Manager adnan     false                      {ksa}                false
--   Egypt Director        false                      {egypt}              false
--   3-country shah311     false                      {ksa,uae,egypt}      false
--
-- The super admin's profiles.country is NULL, so BOTH scope readers are
-- false/empty for the platform owner. NOT ONE of the 38 users has
-- app_sees_all_countries() true. A predicate built from the two scope readers
-- alone - the obvious shape - returns ZERO ROWS to the owner on all five of
-- these reports. is_super_admin() is load-bearing, not decoration.
--
-- lower() because app_country_scope() returns lower-cased values ({ksa}) while
-- the columns hold 'KSA'/'UAE'/'Egypt'. (The SITE helper is the opposite and
-- wants UPPER - the two are genuinely asymmetric. Do not "harmonise" them.)
--
-- ::text because work_orders.country and purchase_orders.country are character
-- varying while the rest are text; the cast makes one spec row safe everywhere.
--
-- The zero-argument readers are used rather than the row-argument
-- app_can_see_country(country): written as (select f()) they are uncorrelated
-- subqueries hoisted to a once-per-query InitPlan, whereas app_can_see_country
-- takes the row value so it can never be hoisted and is SECURITY DEFINER so it
-- can never be inlined - a per-row profiles lookup over tables of 11k to 90k
-- rows. No new call to it is added here.
--
--
-- ============================================================================
-- WHERE THE PREDICATE WENT, AND THE PLACEMENT THAT LOOKS LIKE A BUG AND IS NOT
--
-- Two anchor shapes exist in these five bodies and they behave differently.
--
-- SHAPE 1 - a plain organisation predicate:
--     get_asset_master           WHERE organisation_id = (SELECT oid FROM org)
--     holding_consolidated_kpis  WHERE vf.organisation_id = o.oid
--   The guard is appended with AND at the same level. Unconditional.
--
-- SHAPE 2 - an organisation predicate nested inside a null-org OR:
--     data_completeness / data_link_audit / cost_budget_overview
--     where (org.o is null or t.organisation_id = org.o)
--   The guard is appended AFTER the alias predicate, INSIDE the parentheses, so
--   the clause becomes
--     (org.o is null or t.organisation_id = org.o and <guard>)
--   which by AND-binds-tighter-than-OR reads as
--     (org.o is null) OR (t.organisation_id = org.o AND <guard>).
--
--   THIS IS DELIBERATE AND IT IS THE WHOLE POINT OF THE PLACEMENT. It looks
--   exactly like the classic operator-precedence mistake, so it is recorded
--   here in full to stop a future reader "fixing" it:
--
--     * A real authenticated caller ALWAYS has app_current_org() non-null
--       (measured: all 38 profiles carry an organisation), so org.o is never
--       null on the path that leaks, the second branch is the one that runs, and
--       the guard applies. The leak is closed on every path a user can reach.
--     * A caller with NO JWT - service role, cron, an edge function - gets
--       app_current_org() = NULL (measured directly: NULL, with is_super_admin()
--       false, app_sees_all_countries() false and app_country_scope() {}). On
--       that path the ORGANISATION filter is already switched off by the
--       function's own pre-existing design, and the country guard is now
--       switched off with it, so behaviour there is EXACTLY unchanged.
--
--   Hoisting the guard outside the parentheses instead would take a no-JWT
--   caller from every row to only the null-country rows - a silent regression
--   on a path that has no tenant wall at all. Bolting a country wall onto a
--   doorway that has no organisation wall is theatre, and it would have broken
--   any backend reader for nothing. Measured: NO cron job invokes any of these
--   five (cron.job scanned), so nothing depends on it today either way; the
--   placement is chosen so that if one is added tomorrow it behaves as it does
--   now.
--
--   get_asset_master and holding_consolidated_kpis need no such care:
--   get_asset_master compares organisation_id to a NULL and returns nothing, and
--   holding_consolidated_kpis returns {'error':'no_org'} outright. Both already
--   refuse a no-JWT caller.
--
-- EVERY SCANNING SITE IS GUARDED, NOT THE FIRST. This is exactly the hazard
-- V556 named when it held these back, so the counts are asserted individually:
--
--   get_asset_master           5 sites - vehicle_fleet (twice: the per-country
--                              `fleet` CTE and the `ident` identity CTE),
--                              tyre_records, work_orders, parts_consumption.
--                              All five share one identical anchor string and
--                              every one is a single-table FROM, so the
--                              unqualified `country` is unambiguous in each.
--                              `ident` is guarded too and that is not optional:
--                              it takes max(make)/max(model)/max(vehicle_type)
--                              across countries, so leaving it open would keep
--                              handing over another country's machine identity -
--                              and per V376 a shared asset number is usually a
--                              DIFFERENT machine, so it was also simply wrong.
--   holding_consolidated_kpis  6 sites - vehicle_fleet 1, tyre_records 2
--                              (tyres and low_tread), alerts 2 (open and
--                              critical), purchase_orders 1.
--   data_completeness          2 sites - tyre_records, vehicle_fleet.
--   data_link_audit            8 sites - vehicle_fleet 1 (the `f` reference
--                              set) and 7 on alias x (tyre_records,
--                              work_orders, inspections, corrective_actions,
--                              accidents, plus the two `missing` CTEs).
--                              THE REFERENCE SET AND THE SCANS MUST BE FILTERED
--                              TOGETHER OR THE OUTPUT BECOMES NONSENSE: this
--                              function reports orphans as "asset_no not present
--                              in the fleet list". Scoping the tyre rows to KSA
--                              while leaving the fleet list at all three
--                              countries would under-report orphans; scoping the
--                              fleet list alone would invent thousands. Both
--                              sides carry the identical predicate, so like is
--                              compared with like.
--   cost_budget_overview       4 sites - vehicle_fleet 1, tyre_records 3
--                              (the spend CTE, the flat-rate CTE and its inner
--                              percentage denominator, alias t2). The
--                              denominator is guarded with the numerator or the
--                              flat-rate percentage would be a KSA count over a
--                              three-country base.
--
-- 12 spec rows over 5 functions, 25 guarded scanning sites in total. Every one
-- is a replace() against the function's own LIVE pg_get_functiondef output - no
-- body is retyped - and every one ABORTS unless its anchor occurs EXACTLY the
-- expected number of times. A partial run is the failure that matters: half a
-- boundary reads as a closed one (the V396 lesson). The whole thing is one DO
-- block, so a wrong alias raises `column ... does not exist` at CREATE time and
-- nothing at all is applied. CREATE OR REPLACE preserves SECURITY DEFINER, the
-- pinned search_path and every grant.
--
--
-- ============================================================================
-- VERIFIED AFTER
--
-- TEXTUAL REGRESSION PROOF, which is worth more than re-timing: for all five,
-- mechanically stripping the guard back out of the live definition reproduces
-- the backed-up definition BYTE FOR BYTE. The guard is provably the only change,
-- so a permitted country cannot take a different code path.
--
-- BEHAVIOURAL, by impersonation, same canonicalised comparator:
--
--   SUPER ADMIN d2d43a5f      byte-identical to the pre-change capture on all
--                             five. The owner is a no-op - which is the whole
--                             reason is_super_admin() is in the predicate.
--   KSA MANAGER 34793423      no longer byte-identical to the owner on any of
--                             the five. Now reads its own country only:
--                               get_asset_master  263,533 -> 241,057 B, and the
--                                 content is the real measure: rows naming UAE
--                                 389 -> 0, rows naming Egypt 93 -> 0,
--                                 multi-country rows 239 -> 0, rows that are
--                                 purely KSA 524 -> 1,000. (It still returns
--                                 1,000 rows because that is its own p_limit
--                                 default and KSA holds 1,030 assets, so the
--                                 byte count falls far less than the disclosure
--                                 does - which is exactly why the payload was
--                                 opened rather than sized.)
--                               holding_consolidated_kpis vehicles 1,617 -> 1,030,
--                                 tyres 11,191 -> 8,145. subsidiary_count stays 0
--                                 and the single subsidiary row is still present,
--                                 so the consolidation shape is untouched.
--                               data_completeness fleet 1,617 -> 1,030,
--                                 tyres 11,191 -> 8,145 (and every per-column
--                                 fill count with them: fleet make 783 -> 619,
--                                 vehicle_type 1,170 -> 899; tyre brand
--                                 10,935 -> 7,935, cost 6,832 -> 5,860)
--                               data_link_audit fleet_assets 1,617 -> 1,030,
--                                 work_orders 89,628 -> 62,127,
--                                 tyre_records 11,191 -> 8,145, and the derived
--                                 work_order orphans 5 -> 1 - derived
--                                 consistently, because the fleet reference set
--                                 moved with the scans
--                               cost_budget_overview vehicles 1,617 -> 1,030,
--                                 months_covered 26 -> 23, and avg monthly spend
--                                 476,834 -> 264,331, which is now SAR alone and
--                                 therefore a quantity of something
--   3-COUNTRY USER e864b410   byte-identical to the owner on the four ungated
--                             functions, before AND after. Their scope covers
--                             every country value that exists, so the predicate
--                             admits every row - which is the proof it filters
--                             by scope and not by accident. (They are refused by
--                             holding_consolidated_kpis both before and after:
--                             their role, Tire Planning Engineer, is not in
--                             Admin/Manager/Director. Unchanged.)
--   EGYPT DIRECTOR a4fd5401   not made worse. They are the one account outside
--                             Company A, in organisation e340fa7a which holds
--                             zero rows, so they read nothing here before and
--                             nothing after.
--
-- THE NULL-COUNTRY CONVENTION IS PRESERVED, as everywhere else in this schema: a
-- row whose country is NULL stays visible to every scope. Visible in the result:
-- corrective_actions holds 2 null-country rows and the KSA Manager's
-- data_link_audit still reports corrective_actions total 3 (1 KSA + 2 null).
-- That is the convention, not a leak. inspections (363) and accidents (38) are
-- likewise unchanged for that user because every row of both is already KSA -
-- a guard that moves only the figures that span countries is behaving correctly.
--
-- THE DELIBERATE SHAPE-2 PLACEMENT WAS PROVED EMPIRICALLY, not just reasoned
-- about: called with NO JWT at all, app_current_org() is NULL and
-- data_completeness, data_link_audit and cost_budget_overview all still report
-- 1,617 - byte-for-byte the pre-migration behaviour on that path, exactly as the
-- placement intends.
--
-- SECURITY ATTRIBUTES SURVIVED CREATE OR REPLACE, checked rather than assumed:
-- all five remain SECURITY DEFINER with search_path pinned to 'public',
-- EXECUTE still granted to authenticated and still NOT granted to anon. Guard
-- occurrences per function confirm every planned site landed and no more:
-- get_asset_master 5, holding_consolidated_kpis 6, data_link_audit 8,
-- cost_budget_overview 4, data_completeness 2 = 25; broadcast_audience 0.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v569, which holds the
-- exact prior definition text for all five:
--   do $$ declare r record; begin
--     for r in select def from _bak.rpc_defs_v569 loop execute r.def; end loop;
--   end $$;
--
-- THE ROLLBACK WAS REHEARSED, not just written down. Run inside a transaction
-- and rolled back: all five come back with the guard gone and their definitions
-- byte-identical to the backup. The 25 guards were re-confirmed live afterwards,
-- so the rehearsal left nothing behind. The backed-up definition lengths also
-- match the pre-migration lengths measured independently at the start of this
-- session (get_asset_master 2637, holding_consolidated_kpis 2529,
-- data_completeness 2100, data_link_audit 3427, cost_budget_overview 1535),
-- which is a second, independent check that what was saved is what was there.
--
-- _bak.v569_probe holds the before and after evidence for all six functions
-- across all four users, including the two independent baseline runs and the two
-- independent after-runs that established the comparator was stable in both
-- phases (24 of 24 identical each time).
--
-- NOT TOUCHED, and named so they are not mistaken for oversights: the
-- organisation wall on these bodies (data_completeness, data_link_audit and
-- cost_budget_overview all carry an `org.o is null` escape that switches the
-- TENANT filter off entirely for a caller with no organisation context). That is
-- the more serious boundary, it is a different class from the all-scope country
-- defect this migration closes, and V556 rule 4 already records why it is not
-- changed silently. It is left exactly as found.
-- ============================================================================

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v569;
create table _bak.rpc_defs_v569 (proname text, def text, saved_at timestamptz default now());

do $mig$
declare
  r record; oid_ oid; nfound int; def text; newdef text; occ int; scope text;
  changed text[] := '{}'; n_sites int := 0;
begin
  for r in
    select * from (values
      -- ---------- SHAPE 1: plain organisation predicate, guard ANDed at the
      -- same level. Both of these already refuse a no-JWT caller outright.
      --
      -- get_asset_master: one identical anchor at all FIVE scanning sites -
      -- fleet, tyre_records, work_orders, parts_consumption and ident. Each is a
      -- single-table FROM so unqualified `country` is unambiguous in every one.
      ('get_asset_master','organisation_id = (SELECT oid FROM org)','country',5),

      -- holding_consolidated_kpis: six sites, one per counter. The
      -- `organisations` list itself is deliberately NOT filtered - see header.
      ('holding_consolidated_kpis','vf.organisation_id = o.oid','vf.country',1),
      ('holding_consolidated_kpis','tr.organisation_id = o.oid','tr.country',2),
      ('holding_consolidated_kpis','a.organisation_id = o.oid','a.country',2),
      ('holding_consolidated_kpis','po.organisation_id = o.oid','po.country',1),

      -- ---------- SHAPE 2: nested inside `(org.o is null or ...)`. The guard
      -- lands INSIDE the parentheses on purpose, so it binds to the alias
      -- predicate and not to the null-org escape. See the header - this is
      -- deliberate, not a precedence bug.
      ('data_completeness','t.organisation_id = org.o','t.country',1),
      ('data_completeness','v.organisation_id = org.o','v.country',1),

      -- data_link_audit: the `f` reference set (alias v) and all seven x-scans
      -- carry the SAME predicate, so orphan detection compares like with like.
      ('data_link_audit','v.organisation_id = org.o','v.country',1),
      ('data_link_audit','x.organisation_id = org.o','x.country',7),

      -- cost_budget_overview: t2 is the flat-rate percentage DENOMINATOR and is
      -- guarded with its numerator, or the percentage is a scoped count over an
      -- unscoped base.
      ('cost_budget_overview','f.organisation_id=org.o','f.country',1),
      ('cost_budget_overview','t.organisation_id=org.o','t.country',2),
      ('cost_budget_overview','t2.organisation_id=org.o','t2.country',1)
    ) v(pname, anchor, col, want)
  loop
    select count(*), min(p.oid) into nfound, oid_
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname='public' and p.proname = r.pname;
    if nfound <> 1 then
      raise exception 'V569: expected exactly 1 public.%, found %', r.pname, nfound;
    end if;

    -- read the LIVE definition every iteration, so a second spec row for the
    -- same function sees the result of the first
    def := pg_get_functiondef(oid_);

    -- back up the ORIGINAL text once, before this function is touched at all
    if not (r.pname = any(changed)) then
      insert into _bak.rpc_defs_v569 (proname, def) values (r.pname, def);
      changed := changed || r.pname;
    end if;

    occ := (length(def) - length(replace(def, r.anchor, ''))) / length(r.anchor);
    if occ <> r.want then
      raise exception 'V569: anchor for % matched % times, expected exactly % [%]',
        r.pname, occ, r.want, left(r.anchor, 60);
    end if;

    scope := ' and (' || r.col || ' is null'
      || ' or (select public.is_super_admin())'
      || ' or (select public.app_sees_all_countries())'
      || ' or lower(btrim(' || r.col || '::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))';

    newdef := replace(def, r.anchor, r.anchor || scope);

    if position('app_country_scope' in newdef) = 0 then
      raise exception 'V569: guard did not land in %', r.pname;
    end if;

    execute newdef;
    n_sites := n_sites + occ;
  end loop;

  if array_length(changed, 1) <> 5 then
    raise exception 'V569: expected 5 functions changed, got %', array_length(changed, 1);
  end if;
  raise notice 'V569: % functions, % scanning sites guarded', array_length(changed,1), n_sites;
end $mig$;

-- ---------------------------------------------------------------------------
-- TEXTUAL REGRESSION PROOF: strip the guard back out of every live definition
-- and require the result to equal the backup BYTE FOR BYTE. Aborts if not.
-- ---------------------------------------------------------------------------
do $verify$
declare
  b record; live text; stripped text; c text;
  cols text[] := array['country','vf.country','tr.country','a.country','po.country',
                       't.country','v.country','x.country','f.country','t2.country'];
begin
  for b in select proname, def from _bak.rpc_defs_v569 loop
    select pg_get_functiondef(p.oid) into live
      from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.proname = b.proname;
    stripped := live;
    foreach c in array cols loop
      stripped := replace(stripped,
        ' and (' || c || ' is null'
        || ' or (select public.is_super_admin())'
        || ' or (select public.app_sees_all_countries())'
        || ' or lower(btrim(' || c || '::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))',
        '');
    end loop;
    if stripped <> b.def then
      raise exception 'V569: % does not reproduce its backup after stripping the guard', b.proname;
    end if;
  end loop;
  raise notice 'V569: all 5 reproduce their backup byte for byte after stripping the guard';
end $verify$;
