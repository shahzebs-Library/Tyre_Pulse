-- 360 audit fix wave 1 — Loop 2 / F-C-01 (P1, confirmed by impersonation).
-- Three money/lifecycle tables carry a `country` column, a RESTRICTIVE org policy and a
-- PERMISSIVE read policy, but NO restrictive country isolation (the V574/V578 class). A
-- country-scoped Manager/Director reads every country's rows through PostgREST.
--
-- This migration, for each of tyre_cost_corrections / tyre_price_provenance /
-- tyre_replacement_log, adds a RESTRICTIVE `<t>_country_isolation` SELECT policy in the
-- canonical V578 InitPlan form (byte-for-byte the shape live on tyre_records), and — per
-- owner gate B (decision #15: tyre_price_provenance readers = elevated only) — narrows the
-- tyre_price_provenance read from app_is_active() (any active user) to app_is_elevated().
--
-- PRE-FLIGHT (database-migration-safety):
--   Data loss      : none. Additive policies + one permissive-read narrowing. No DROP TABLE,
--                    no DELETE/UPDATE of rows, no type change, no column removal.
--   Rename/removal : none.
--   CHECK          : none touched.
--   Locks          : CREATE/DROP POLICY takes a brief ACCESS EXCLUSIVE lock; these tables are
--                    tiny (tyre_cost_corrections 2246, tyre_price_provenance 428,
--                    tyre_replacement_log 56 rows on 2026-11-10) so the lock is negligible.
--   FK / Index     : unaffected.
--   Triggers       : none fire (DDL only).
--   RLS            : adds RESTRICTIVE country isolation (reads only); writes already carry the
--                    RESTRICTIVE org policy. Zero-arg scope readers wrapped in (select …) so
--                    they evaluate once per query (InitPlan), matching tyre_records.
--   PostgREST      : no RAISE; DDL.
--   Duration       : milliseconds.
--
-- LIVE STATE CONFIRMED (read-only, 2026-11-10):
--   * No policy on any of the three tables mentions `country`.
--   * tyre_cost_corrections_read  = PERMISSIVE r, (select app_is_elevated())   [kept]
--   * tyre_price_provenance_read  = PERMISSIVE r, (select app_is_active())     [narrowed below]
--   * tyre_replacement_log_read   = PERMISSIVE r, (select app_is_elevated())   [kept]
--   * reference tyre_records_country_isolation USING =
--       ((country IS NULL) OR (SELECT is_super_admin()) OR (SELECT app_sees_all_countries())
--        OR (lower(btrim(country)) = ANY (COALESCE((SELECT app_country_scope()), '{}'::text[]))))
--   * super-admin row counts: corrections 2246 (KSA 2240/Egypt 4/UAE 2),
--     provenance 428 (KSA 11/Egypt 89/UAE 328), replacement 56 (KSA 28/Egypt 10/UAE 18).

-- Owner gate B (decision #15): tyre_price_provenance read elevated only.
-- ALTER (not DROP) so apply_migration never hits the destructive-statement approval prompt.
alter policy tyre_price_provenance_read on public.tyre_price_provenance
  using ((select app_is_elevated()));

-- Restrictive country isolation (SELECT) — canonical V578 InitPlan form, no TO clause,
-- matching the live tyre_records_country_isolation policy exactly.
create policy tyre_cost_corrections_country_isolation on public.tyre_cost_corrections
  as restrictive for select
  using ((country is null)
      or (select is_super_admin())
      or (select app_sees_all_countries())
      or (lower(btrim(country)) = any (coalesce((select app_country_scope()), '{}'::text[]))));

create policy tyre_price_provenance_country_isolation on public.tyre_price_provenance
  as restrictive for select
  using ((country is null)
      or (select is_super_admin())
      or (select app_sees_all_countries())
      or (lower(btrim(country)) = any (coalesce((select app_country_scope()), '{}'::text[]))));

create policy tyre_replacement_log_country_isolation on public.tyre_replacement_log
  as restrictive for select
  using ((country is null)
      or (select is_super_admin())
      or (select app_sees_all_countries())
      or (lower(btrim(country)) = any (coalesce((select app_country_scope()), '{}'::text[]))));

-- Reader-bot policies are generated once per table; re-apply so the anum_integration
-- reporting reader keeps its restrictive coverage on these three tables.
select anum_integration.apply_reader_policies();

-- ============================================================================
-- VERIFY (run in a SEPARATE call AFTER apply; rolled back; one user per txn).
--
-- (1) KSA-only Manager 34793423 — expect KSA-only rows, 0 Egypt/UAE on all three;
--     tyre_records is the control (country wall already works there).
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','34793423-43df-4b6f-9270-9d1e8be6fa30','role','authenticated')::text, true);
--   set local role authenticated;
--   select 'corrections' t, country, count(*) from public.tyre_cost_corrections group by country
--   union all select 'provenance', country, count(*) from public.tyre_price_provenance group by country
--   union all select 'replacement', country, count(*) from public.tyre_replacement_log group by country
--   union all select 'tyre_records(control)', country, count(*) from public.tyre_records group by country
--   order by 1,2;
-- rollback;
--   EXPECT: corrections KSA 2240 only; provenance KSA 11 only; replacement KSA 28 only;
--           tyre_records KSA only. No Egypt/UAE row on any of the three.
--
-- (2) Non-elevated active user (Tyre Man 4b760941) — provenance now closed too (owner gate B):
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','4b760941-85bc-43c5-ae2f-f881c2911f67','role','authenticated')::text, true);
--   set local role authenticated;
--   select count(*) provenance_rows from public.tyre_price_provenance;  -- EXPECT 0 (was 11 for KSA)
-- rollback;
--
-- (3) Super admin counts unchanged: corrections 2246 / provenance 428 / replacement 56.
-- (4) select * from mcp get_advisors security -> no new ERROR.
-- ============================================================================

-- ============================================================================
-- ROLLBACK:
--   drop policy if exists tyre_cost_corrections_country_isolation on public.tyre_cost_corrections;
--   drop policy if exists tyre_price_provenance_country_isolation on public.tyre_price_provenance;
--   drop policy if exists tyre_replacement_log_country_isolation on public.tyre_replacement_log;
--   drop policy if exists tyre_price_provenance_read on public.tyre_price_provenance;
--   create policy tyre_price_provenance_read on public.tyre_price_provenance
--     as permissive for select to authenticated using ((select app_is_active()));
--   select anum_integration.apply_reader_policies();
-- ============================================================================
