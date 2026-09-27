-- ============================================================================
-- 20260927130000_cost_per_m3_trend_approved_only
--
-- PURPOSE
--   get_cost_per_m3_trend counted production as sum(coalesce(approved_m3, m3)),
--   so a load with no approved quantity fell back to the SUPPLIED m3 and was
--   counted as signed for. The headline get_cost_per_m3 has counted
--   approved_m3 only since V523 ("Approved/Signed Qty IS the counted quantity;
--   substituting supplied m3 is a fabrication"). The monthly trend and the
--   headline therefore disagreed on the same window.
--
--   This rebuilds the function from its LIVE definition (pg_get_functiondef)
--   with two anchored replacements, each guarded to occur EXACTLY once:
--     1. production: sum(coalesce(approved_m3, m3)) -> sum(coalesce(approved_m3, 0))
--        (same null-safe sum semantics as the headline).
--     2. SANY: add `and coalesce(doc_type, 'summary') <> 'detail'`, the same
--        filter the headline uses so a SANY parts-detail row is never counted
--        twice. No cost changed today (trend cost == headline cost before and
--        after), but the two functions now share one definition.
--   SECURITY DEFINER, search_path=public, signature and grants are unchanged
--   (CREATE OR REPLACE keeps them); anon EXECUTE is re-revoked defensively.
--
-- MEASURED BEFORE (super admin, window 2025-10-01 .. 2026-09-30)
--   KSA   trend m3 1,426,690.3  vs headline 1,365,645.3  (gap 61,045.0 m3)
--         trend cost 10,779,245.95 == headline cost
--   All   trend m3 1,426,690.3  vs headline 1,365,645.3 (same gap; UAE/Egypt 0 m3)
--   UAE / Egypt: 0 m3 both sides (no production_logs), cost identical.
--   KSA per month before: 2025-10 287,595.5 | 2025-11 289,448.5 | 2025-12 107,710.5
--         | 2026-04 291,983.5 | 2026-07 359,119.3 (cpm 7.0808) | 2026-08 90,833.0
-- MEASURED AFTER: see the migration report; window m3 must equal the headline
--   (1,365,645.3) and the difference lands on 2026-07 (the dn-less July batch
--   with approved_m3 NULL, per V523).
--
-- ROLLBACK
--   Re-run the same DO block with the two replacements reversed:
--   'sum(coalesce(approved_m3, 0)) as production_m3' -> 'sum(coalesce(approved_m3, m3)) as production_m3'
--   and remove the added SANY doc_type line.
-- ============================================================================
do $mig$
declare
  v_def text;
  v_new text;
  v_n int;
  a1 constant text := 'sum(coalesce(approved_m3, m3)) as production_m3';
  r1 constant text := 'sum(coalesce(approved_m3, 0)) as production_m3';
  a2 constant text := E'from public.sany_invoices\n    where organisation_id = v_org and (p_country is null or country = p_country)\n      and (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(country::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))\n      and period_date between v_from and v_to\n';
  r2 constant text := E'from public.sany_invoices\n    where organisation_id = v_org and (p_country is null or country = p_country)\n      and (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(country::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))\n      and period_date between v_from and v_to\n      and coalesce(doc_type, ''summary'') <> ''detail''\n';
begin
  select pg_get_functiondef('public.get_cost_per_m3_trend(text,date,date)'::regprocedure) into v_def;

  v_n := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
  if v_n <> 1 then raise exception 'anchor 1 (production coalesce) found % times, expected 1', v_n; end if;
  v_n := (length(v_def) - length(replace(v_def, a2, ''))) / length(a2);
  if v_n <> 1 then raise exception 'anchor 2 (sany filter) found % times, expected 1', v_n; end if;
  if position('coalesce(doc_type' in v_def) > 0 then raise exception 'doc_type filter already present'; end if;

  v_new := replace(replace(v_def, a1, r1), a2, r2);
  if position('coalesce(approved_m3, m3)' in v_new) > 0 then raise exception 'supplied-m3 fallback still present'; end if;

  execute v_new;
end
$mig$;

revoke execute on function public.get_cost_per_m3_trend(text,date,date) from public;
revoke execute on function public.get_cost_per_m3_trend(text,date,date) from anon;
grant execute on function public.get_cost_per_m3_trend(text,date,date) to authenticated, service_role;
