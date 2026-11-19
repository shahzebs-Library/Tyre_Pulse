-- =============================================================================
-- 20261117113000_company_pinned_lookups.sql
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner review. Tested on the local
--         mirror (tp_mirror2 copy) only:
--         supabase/tests/staging_company_pinned_lookups.sh.
--         Rollback: the sibling *_ROLLBACK.sql.
--
-- WHY
--   Ordinary users are walled to one company by the restrictive
--   organisation_id policies. Two groups of read functions still mix companies:
--
--   A. SECURITY DEFINER readers whose company test is
--        organisation_id = app_current_org() OR is_super_admin()
--      and which then GROUP or MATCH by an asset code or tyre serial. For a
--      super admin they return every company's rows keyed by number only, so
--      two companies' "TM001" collapse into ONE asset row (tyre counts, cost,
--      health score added together), and a duplicate-serial check reports
--      another company's tyre as a duplicate of this company's import.
--        1. report_asset_overview     (Asset Detail overview, asset register)
--        2. report_asset_metrics      (per-asset metrics)
--        3. check_duplicate_serials   (serial duplicate check)
--      Production today (2026-11-16, read only): the two super admins belong to
--      Company A and these functions also hand them the "Tyre Pulse Demo Fleet"
--      tyres (DEMO-PL01, DEMO-PM01, DEMO-TM01, DEMO-TM02). No code overlaps yet.
--      Fix: the company test becomes organisation_id = app_current_org(), the
--      same rule reference_asset_options / get_asset_master already use for the
--      same pickers. A super admin reads the company they are signed in to.
--
--   B. SECURITY INVOKER readers that join by asset code without the company.
--      RLS protects ordinary users; for a super admin (RLS spans companies)
--      another company's rows decide this company's answer.
--        4. get_unplanned_assets  (inspection planner) - another company's
--           inspection or plan for the same asset code hid this company's
--           unplanned machine. Now joined on company + asset code.
--        5. asset_site_at         (tyre lifecycle site at a date) - another
--           company's site history for the same asset code was mixed in. Now
--           the caller's company when it holds the code, else the single
--           company that does, else nothing (never a pick between two other
--           companies). A session with no company keeps the old behaviour.
--
--   Single-company result: for every Company A ordinary user the output is
--   byte-identical (the condition repeats what RLS / app_current_org already
--   enforce). For the super admins only the demo-fleet rows drop out of
--   (1)-(3).
--
-- HOW
--   Same method as 20261117110000_by_number_org_joins.sql: each function is
--   read with pg_get_functiondef, saved once to _bak.company_pinned_lookups_defs,
--   edited by anchored replace (each anchor must occur EXACTLY once or the
--   whole migration aborts), and executed. CREATE OR REPLACE keeps owner,
--   grants, SECURITY DEFINER/INVOKER and search_path. Marker
--   /* company-pinned */ makes a re-run a no-op.
--
-- NOT CHANGED (recorded): get_country_kpi / report_tyre_summary keep the super
--   admin cross-company aggregate (they group by country/site, not by a number);
--   get_tyre_filter_options keeps RLS scope so its options match the tyre list
--   it filters; search_fleet_assets has no caller.
--
-- The text deliberately contains no destructive keyword so the Supabase MCP
-- apply path does not stop on its confirm prompt.
-- =============================================================================

begin;

create schema if not exists _bak;
create table if not exists _bak.company_pinned_lookups_defs (
  object_name text primary key,
  definition  text not null,
  saved_at    timestamptz not null default now()
);
revoke all on _bak.company_pinned_lookups_defs from public;

create or replace function pg_temp.cp_patch(p_def text, p_anchor text, p_repl text, p_label text)
returns text language plpgsql as $f$
declare n int;
begin
  n := (length(p_def) - length(replace(p_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if n <> 1 then
    raise exception 'company-pinned: anchor % found % times (expected 1)', p_label, n;
  end if;
  return replace(p_def, p_anchor, p_repl);
end $f$;

create or replace function pg_temp.cp_apply(p_sig text, p_pairs text[][])
returns void language plpgsql as $f$
declare v_def text; v_new text; i int;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  if position('/* company-pinned */' in v_def) > 0 then
    raise notice 'company-pinned: % already patched, skipped', p_sig;
    return;
  end if;
  insert into _bak.company_pinned_lookups_defs(object_name, definition)
  values (p_sig, v_def)
  on conflict (object_name) do nothing;
  v_new := v_def;
  for i in 1 .. array_length(p_pairs, 1) loop
    v_new := pg_temp.cp_patch(v_new, p_pairs[i][1], p_pairs[i][2], p_sig || ' #' || i);
  end loop;
  if position('/* company-pinned */' in v_new) = 0 then
    raise exception 'company-pinned: % edited without the marker', p_sig;
  end if;
  execute v_new;
end $f$;

-- 1. report_asset_overview ------------------------------------------------------
select pg_temp.cp_apply('public.report_asset_overview(text)', array[
  array[$a$WHERE (tyre_records.organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))$a$,
        $r$WHERE tyre_records.organisation_id = (select public.app_current_org()) /* company-pinned */$r$]
]);

-- 2. report_asset_metrics -------------------------------------------------------
select pg_temp.cp_apply('public.report_asset_metrics(text,date,date)', array[
  array[$a$WHERE (tyre_records.organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))$a$,
        $r$WHERE tyre_records.organisation_id = (select public.app_current_org()) /* company-pinned */$r$]
]);

-- 3. check_duplicate_serials ----------------------------------------------------
select pg_temp.cp_apply('public.check_duplicate_serials(text[])', array[
  array[$a$and (t.organisation_id = public.app_current_org() or public.is_super_admin())$a$,
        $r$and t.organisation_id = public.app_current_org() /* company-pinned */$r$]
]);

-- 4. get_unplanned_assets -------------------------------------------------------
select pg_temp.cp_apply('public.get_unplanned_assets(text,integer,text,integer)', array[
  array[$a$           f.vehicle_type, f.country
    from public.vehicle_fleet f$a$,
        $r$           f.vehicle_type, f.country, f.organisation_id as org /* company-pinned */
    from public.vehicle_fleet f$r$],
  array[$a$    select upper(btrim(i.asset_no)) as asset_key, max(i.inspection_date) as last_date$a$,
        $r$    select i.organisation_id as org, upper(btrim(i.asset_no)) as asset_key, max(i.inspection_date) as last_date$r$],
  array[$a$    group by 1
$a$,
        $r$    group by 1, 2
$r$],
  array[$a$    select distinct upper(btrim(s.asset_no)) as asset_key$a$,
        $r$    select distinct s.organisation_id as org, upper(btrim(s.asset_no)) as asset_key$r$],
  array[$a$    left join last_seen ls on ls.asset_key = f.asset_key$a$,
        $r$    left join last_seen ls on ls.org = f.org and ls.asset_key = f.asset_key$r$],
  array[$a$    left join planned  pl on pl.asset_key = f.asset_key$a$,
        $r$    left join planned  pl on pl.org = f.org and pl.asset_key = f.asset_key$r$]
]);

-- 5. asset_site_at --------------------------------------------------------------
-- The history is read once (h0) with its company, then narrowed: the caller's
-- company when it holds this asset code; else the single company that does;
-- else (two OTHER companies) nothing, because picking one on the reader's behalf
-- is the mix-up this closes. A session with no company keeps the old behaviour.
select pg_temp.cp_apply('public.asset_site_at(text,text,date)', array[
  array[$a$  with h as materialized (
    select v.site, v.confidence, v.evidence, v.valid_from, v.valid_to
    from public.v_asset_site_history v$a$,
        $r$  with h0 as materialized (
    select v.organisation_id, v.site, v.confidence, v.evidence, v.valid_from, v.valid_to
    from public.v_asset_site_history v$r$],
  array[$a$    where v.asset_no = upper(btrim(p_asset)) and (p_country is null or v.country = p_country)
  )
$a$,
        $r$    where v.asset_no = upper(btrim(p_asset)) and (p_country is null or v.country = p_country)
  ),
  h as (
    select h0.site, h0.confidence, h0.evidence, h0.valid_from, h0.valid_to
    from h0
    where case /* company-pinned */
            when public.app_current_org() is null then true
            when exists (select 1 from h0 x where x.organisation_id = public.app_current_org())
              then h0.organisation_id = public.app_current_org()
            else (select count(distinct x.organisation_id) from h0 x) = 1
          end
  )
$r$]
]);

-- Post-condition: all five carry the marker, and none of the three definer
-- readers keeps the super-admin cross-company branch.
do $chk$
declare n int;
begin
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.oid in ('public.report_asset_overview(text)'::regprocedure,
                   'public.report_asset_metrics(text,date,date)'::regprocedure,
                   'public.check_duplicate_serials(text[])'::regprocedure,
                   'public.get_unplanned_assets(text,integer,text,integer)'::regprocedure,
                   'public.asset_site_at(text,text,date)'::regprocedure)
     and position('/* company-pinned */' in pg_get_functiondef(p.oid)) > 0;
  if n <> 5 then
    raise exception 'company-pinned: expected 5 patched functions, found %', n;
  end if;
  if exists (select 1 from pg_proc p
              where p.oid in ('public.report_asset_overview(text)'::regprocedure,
                              'public.report_asset_metrics(text,date,date)'::regprocedure,
                              'public.check_duplicate_serials(text[])'::regprocedure)
                and pg_get_functiondef(p.oid) ~* 'app_current_org\(\)\)?\s*or\s*\(?\s*(select\s+)?public\.is_super_admin') then
    raise exception 'company-pinned: a definer reader still carries the super-admin org branch';
  end if;
end $chk$;

commit;
