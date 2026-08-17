-- =============================================================================
-- V585 - TYRE RECORDS FILTER DROPDOWNS WERE SILENTLY INCOMPLETE
-- STATUS: APPLIED live on jhssdmeruxtrlqnwfksc (verify against the live object,
--         never the catalog header - see PROJECT_MEMORY standing traps).
-- =============================================================================
--
-- THE DEFECT (measured, not inferred)
-- -----------------------------------
-- `listSiteOptions` / `listBrandOptions` in src/lib/api/tyreRecords.js were bare
-- selects with no ORDER BY, no .range() and no paging:
--
--     supabase.from('tyre_records').select('site').not('site','is',null)
--
-- PostgREST caps EVERY response at 1000 rows regardless of what the caller asks
-- for, and tyre_records holds 11,193. The page then derived its dropdown with
-- `[...new Set(rows.map(r => r.site))]`, so the filter offered only the distinct
-- values that happened to fall in an ARBITRARY unordered first 1000 rows.
--
-- Measured on live data at the time of writing:
--
--     sites   23 real ->  16 offered   (7 missing, 30%)
--     brands 104 real ->  51 offered  (53 missing, 51%)
--
-- Over half the brands were unreachable. The most damaging single case:
--   MONORAIL SITE  -  92 tyre records, could not be selected at all
--   DIRIYAH-ST2    -  18 tyre records
--   LING LONG      -  25 rows,  APOLLO 18 rows,  LINGLONG 17,  JK 17
--
-- A user filtering for a site that IS in the register got an empty dropdown
-- entry that never existed - the data was there, the picker could not name it.
--
-- THE FIX
-- -------
-- One SECURITY INVOKER function returning both option lists in a single round
-- trip (the page previously made two).
--
-- SECURITY INVOKER IS THE LOAD-BEARING CHOICE AND IS DELIBERATE.
-- A SECURITY DEFINER function runs as its OWNER and RLS never runs inside one
-- (the owner holds rolbypassrls) - that is the entire V545-V576 defect class,
-- 30+ migrations of re-work. This function must show the CALLER exactly the
-- values the caller can already read, so the correct answer is to let RLS do
-- its job: INVOKER adds ZERO new security surface. Verified below.
--
-- Do NOT "harden" this into a DEFINER function. Doing so would silently hand
-- every caller every country's site and brand list.
--
-- WHY RAW (UNTRIMMED) VALUES ARE RETURNED
-- ---------------------------------------
-- 20 brand rows carry leading/trailing whitespace. Returning a TRIMMED option
-- would look tidier and would be a NEW silent-truncation bug: the grid filters
-- with an exact `.eq('brand', value)`, so a trimmed option would fail to match
-- the padded rows and they would disappear from the result with no error. Every
-- option returned here is therefore byte-exact and selectable.
--
-- Blank / whitespace-only values ARE excluded (96 brand rows). They render as an
-- invisible, unclickable entry in a dropdown, so they are not a filter
-- affordance. Those rows are a data-quality gap, not a picker feature.
--
-- NOT FIXED HERE, STATED INSTEAD (separate data migration, V245/V246 class):
--   brand splits by CASE - 'Longmarch' vs 'LONGMARCH' (910 rows) and
--   'Hankook' vs 'HANKOOK' (60 rows) are each offered as TWO options, and
--   picking one misses the other's rows. That needs a normalise + backfill +
--   guard trigger on the column, exactly as V245 did for vehicle_type and V246
--   for site. It is NOT papered over in the dropdown, because merging the
--   options without normalising the column would make the grid drop rows.
--
-- COUNTRY
-- -------
-- p_country mirrors the client's `applyCountry` helper EXACTLY:
--   a country matches its own rows OR rows with a NULL country (uncategorised
--   rows are never silently dropped); NULL / 'All' applies no filter.
-- The client currently passes nothing, which preserves today's behaviour
-- byte-for-byte: loadFilters() has [] deps and never re-ran on country change.
-- The parameter exists so the dropdown CAN be made country-consistent with the
-- grid later - that is a deliberate product change, not part of this bug fix.
--
-- VERIFICATION (run as the real KSA-only Manager 34793423, rolled back)
-- --------------------------------------------------------------------
--   before (capped read)      sites 16 / brands  51
--   after  (this function)    sites 17 / brands  98   <- their true RLS scope
--   super admin               sites 23 / brands 104
--   Egypt-only Director       scoped to Egypt only, no KSA/UAE values
--   timing                    42.2 ms for both distincts, warm-up discarded
--
-- ROLLBACK
-- --------
--   drop function if exists public.get_tyre_filter_options(text);
--   -- and revert src/lib/api/tyreRecords.js to the two bare selects.
-- =============================================================================

create or replace function public.get_tyre_filter_options(p_country text default null)
returns jsonb
language sql
stable
security invoker              -- explicit: RLS MUST apply. See header.
set search_path = public
as $$
  select jsonb_build_object(
    'sites', coalesce(
      (select jsonb_agg(v order by v)
         from (select distinct t.site as v
                 from public.tyre_records t
                where t.site is not null
                  and btrim(t.site) <> ''
                  and (p_country is null or p_country = 'All'
                       or t.country = p_country or t.country is null)
              ) s),
      '[]'::jsonb),
    'brands', coalesce(
      (select jsonb_agg(v order by v)
         from (select distinct t.brand as v
                 from public.tyre_records t
                where t.brand is not null
                  and btrim(t.brand) <> ''
                  and (p_country is null or p_country = 'All'
                       or t.country = p_country or t.country is null)
              ) b),
      '[]'::jsonb)
  );
$$;

comment on function public.get_tyre_filter_options(text) is
  'Distinct site/brand filter options for the Tyre Records screen. SECURITY '
  'INVOKER on purpose so RLS scopes the caller - do NOT convert to DEFINER. '
  'Replaces two bare selects that PostgREST capped at 1000 of 11,193 rows, '
  'hiding 7 of 23 sites and 53 of 104 brands (V585).';

-- Grant order is load-bearing (V500): grant the roles that need it FIRST, then
-- revoke PUBLIC, then revoke anon BY NAME. A revoke from anon alone does not
-- clear a PUBLIC grant, and a revoke from PUBLIC alone does not clear the
-- explicit anon grant Supabase creates at CREATE time.
grant execute on function public.get_tyre_filter_options(text) to authenticated, service_role;
revoke execute on function public.get_tyre_filter_options(text) from public;
revoke execute on function public.get_tyre_filter_options(text) from anon;
