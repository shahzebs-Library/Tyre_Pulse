-- CUR-2: one uniqueness rule for KPI targets, and it includes the organisation.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE pg_indexes and pg_constraint
--         rows of public.kpi_targets. Not applied to any database. Tested on PGlite only
--         (supabase/tests/current_prod_kpi_targets_key.test.mjs).
--         ORDER MATTERS: apply only AFTER the web release that saves targets through
--         saveKpiTargets (src/lib/api/kpiTargets.js) is live and open tabs have reloaded. An old
--         bundle still sends upsert on_conflict=metric,year,month,site; with the old constraint
--         gone that request is rejected (42P10). Today the same request already fails on every
--         save after the first, so the old bundle loses only the very first save of a new target.
--         NOTE FOR WHOEVER APPLIES IT: the text contains the word "drop" (one constraint, one
--         index, both replaced in the same transaction), so the Supabase MCP destructive-statement
--         gate will ask a human to confirm. No row is removed.
--
-- ROOT CAUSE OF "KPI TARGETS CANNOT BE SAVED A SECOND TIME" (MODC-03)
--   kpi_targets carries two unique rules that disagree about blanks:
--     kpi_targets_metric_year_month_site_key  UNIQUE (metric, year, month, site)
--        NULL never equals NULL here, so two rows with blank month and site do not conflict.
--     kpi_targets_scope_uidx  UNIQUE (metric, year, coalesce(month,0), coalesce(site,''),
--                                     coalesce(lower(btrim(country)),''))
--        blank counts as a value here, so the same two rows DO conflict.
--   The web saved targets with upsert(on_conflict = metric,year,month,site). Targets are saved with
--   month and site blank, so the conflict target never matched the row saved last time, the upsert
--   became a plain INSERT, and the second index refused it (23505, shown to the user as "A record
--   with these details already exists"). First save of a year worked; every later save failed.
--   CONFIRMED from the catalog and the code path; all 7 live rows have month and site NULL.
--   Not reproduced by a write, because production is read-only for this work.
--
--   The save is fixed in the web code without this migration: it now reads the stored target and
--   updates it by id, or inserts when there is none. That works against the indexes as they are.
--
-- WHAT THIS MIGRATION ADDS
--   Neither index includes the organisation, so two companies cannot both hold a target for the
--   same metric, year and country: the second company's first save is refused as a duplicate of a
--   row it cannot even see. This replaces both rules with one that starts with the organisation:
--     kpi_targets_org_scope_uidx UNIQUE (organisation_id, metric, year, coalesce(month,0),
--                                        coalesce(site,''), coalesce(lower(btrim(country)),''))
--   A row with no organisation is treated as its own group (the zero uuid) so it can never
--   collide with a tenant's row.
--
-- WHO GAINS OR LOSES ACCESS: nobody. No policy changes. Writers stay Manager and Admin
--   (kpi_targets_insert / kpi_targets_update), delete stays Admin.
--
-- RISK TO THE CURRENT COMPANY: LOW. 7 rows, one organisation, all distinct under the new rule
--   (checked: 7 rows, 7 distinct scopes). The pre-check below aborts if that is no longer true.
--
-- VERIFY (rolled back, after applying)
--   begin;
--   select indexname from pg_indexes where schemaname='public' and tablename='kpi_targets'
--    order by 1;   -- idx_kpi_targets_created_by, idx_kpi_targets_organisation_id,
--                  -- kpi_targets_org_scope_uidx, kpi_targets_pkey
--   select count(*) from public.kpi_targets;   -- unchanged (7 today)
--   rollback;
--
-- ROLLBACK
--   begin;
--   drop index if exists public.kpi_targets_org_scope_uidx;
--   alter table public.kpi_targets
--     add constraint kpi_targets_metric_year_month_site_key unique (metric, year, month, site);
--   create unique index kpi_targets_scope_uidx on public.kpi_targets
--     (metric, year, coalesce(month, 0), coalesce(site, ''::text), coalesce(lower(btrim(country)), ''::text));
--   commit;

begin;

do $do$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes from (
    select 1
      from public.kpi_targets
     group by coalesce(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid),
              metric, year, coalesce(month, 0), coalesce(site, ''), coalesce(lower(btrim(country)), '')
    having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'CUR-2 aborted: % target scope(s) hold more than one row. Resolve them before applying.', v_dupes;
  end if;
end
$do$;

create unique index if not exists kpi_targets_org_scope_uidx on public.kpi_targets (
  coalesce(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid),
  metric,
  year,
  coalesce(month, 0),
  coalesce(site, ''::text),
  coalesce(lower(btrim(country)), ''::text)
);

alter table public.kpi_targets drop constraint if exists kpi_targets_metric_year_month_site_key;
drop index if exists public.kpi_targets_scope_uidx;

commit;
