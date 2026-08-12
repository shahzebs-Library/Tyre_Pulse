-- =====================================================================
-- V538  THE BIGGEST TABLE WAS MISSED BY THE V234/V236 RLS SWEEP
-- STATUS: APPLIED LIVE 2026-08-12 (project jhssdmeruxtrlqnwfksc)
--         migration name: v538_production_logs_rls_initplan
-- =====================================================================
--
-- V234 and V236 wrapped the zero-arg STABLE RLS helpers in `(select ...)` so
-- Postgres evaluates them ONCE per query as an InitPlan instead of once per
-- row. production_logs - the largest table in the schema at 212,567 rows - was
-- left out, and it was the only large table still on the bare form.
--
-- WHY IT WAS EASY TO MISS: its country and site isolation policies ARE already
-- wrapped (they came later, from V269/V396). So the table's policy list shows
-- correct-looking InitPlan syntax sitting directly beside the defect.
--
-- MEASURED as a real approved KSA Manager, first inside a rolled-back
-- transaction and then confirmed live after applying:
--   sum(approved_m3) KSA 2026        1067.6 ms -> 71.3 ms   (~15x)
--   get_production_monthly('KSA',..) 2651.4 ms -> 768.4 ms  (3.45x)
-- The live plan now shows all seven helpers as InitPlan, over a Parallel Index
-- Scan - the parallel half only became available with V536.
--
-- SEMANTICS PROVEN UNCHANGED, not assumed: the same impersonated user returns
-- 70,107 rows and 680890.8 m3 before and after, which is the KSA figure already
-- recorded in PROJECT_MEMORY.
--
-- SCOPE, stated honestly: get_cost_per_m3 is SECURITY DEFINER and bypasses RLS,
-- so it does NOT benefit. The beneficiaries are get_production_monthly (SECURITY
-- INVOKER, feeding every production surface) and every direct PostgREST read of
-- this table, including costPerM3.listProduction which pages up to 20,000 rows.
--
-- production_logs_org_isolation is RESTRICTIVE FOR ALL, so its USING and its
-- WITH CHECK carry the same expression and BOTH move together. Rewriting one
-- half of a boundary and not the other is the V396 lesson, and it is the one
-- way this migration could quietly go wrong.
--
-- classification_feedback (21,668 rows) had the identical defect and is fixed
-- here too. Much smaller prize; included so the pattern does not survive.
--
-- GUARD NOTE, worth keeping: the first version of the check below used a
-- lookbehind, `(?<!select )`. Postgres regular expressions do not support
-- lookbehind, so it matched every policy and aborted a migration that was
-- actually correct. The check now strips the rendered `( SELECT ... )`
-- subexpressions first and then looks for anything left over, which needs no
-- lookbehind at all.
--
-- ROLLBACK: re-run each ALTER with the bare call (drop the `(select ...)`).
-- VERIFY: the KSA 2026 aggregate must still return 70,107 rows / 680890.8.
-- =====================================================================

alter policy production_logs_select on public.production_logs
  using ((select public.app_is_active()));

alter policy production_logs_org_isolation on public.production_logs
  using      (not (organisation_id is distinct from (select public.app_current_org())))
  with check (not (organisation_id is distinct from (select public.app_current_org())));

alter policy production_logs_insert on public.production_logs
  with check ((select public.get_my_role()) = any (array['Admin','Manager','Director']));

alter policy production_logs_update on public.production_logs
  using      ((select public.get_my_role()) = any (array['Admin','Manager','Director']))
  with check ((select public.get_my_role()) = any (array['Admin','Manager','Director']));

alter policy production_logs_delete on public.production_logs
  using      ((select public.get_my_role()) = any (array['Admin','Manager','Director']));

alter policy classification_feedback_read on public.classification_feedback
  using ((select public.app_is_active()));

alter policy classification_feedback_write on public.classification_feedback
  with check ((select public.app_is_elevated()));

do $$
declare n int;
begin
  select count(*) into n
    from pg_policy p,
         lateral (select
           regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
                          '\( SELECT [^()]*\([^()]*\)[^()]*\)', '', 'g') as q,
           regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                          '\( SELECT [^()]*\([^()]*\)[^()]*\)', '', 'g') as w
         ) s
   where p.polrelid in ('public.production_logs'::regclass,
                        'public.classification_feedback'::regclass)
     and (s.q ~ '\m(app_is_active|app_current_org|get_my_role|app_is_elevated)\('
       or s.w ~ '\m(app_is_active|app_current_org|get_my_role|app_is_elevated)\(');
  if n > 0 then
    raise exception 'V538: % policy expression(s) still call a helper outside (select ...)', n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- NOT DONE, and worth recording so nobody re-adds it.
--
-- An index `parts_consumption (organisation_id, event_date desc)` was proposed
-- off a measured 14.6x, and I created it, tested it, and DROPPED it again.
--
-- The 14.6x was real but it was measured against a query shape this app never
-- issues: `country = X OR country IS NULL` ordered by `event_date DESC` with no
-- tiebreak. There are exactly TWO client reads of parts_consumption -
-- materialMaster.js (strict `.eq('country')`, orders by line_cost) and
-- listExpenseRows (strict `.eq('country')`, orders `event_date ASC, id ASC`).
-- Neither uses the OR form and neither sorts by event_date DESC, so the planner
-- correctly ignored the new index - verified by EXPLAIN, which still chose a
-- Parallel Seq Scan with a top-N heapsort.
--
-- The existing parts_consumption_org_country_date_idx already covers the filter
-- and the leading sort key for the read that does exist. Leaving a 3 MB index
-- on a table that takes 217k-row bulk imports, for a query nobody makes, is a
-- write-path cost with no read-path payer.
--
-- RULE: name the exact query before adding an index, and confirm the planner
-- picks it afterwards. A benchmark that proves an index helps a query you
-- invented proves nothing about the application.
-- ---------------------------------------------------------------------
