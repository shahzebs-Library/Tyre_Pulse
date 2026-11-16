-- Recall numbers are unique per organisation (Recall Tracker, browser test D1 follow-up).
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15 from the live catalog (pg_constraint,
--         pg_indexes, pg_policies on public.recalls; project jhssdmeruxtrlqnwfksc, SELECT only).
--         Not applied to any database.
--         NOTE FOR WHOEVER APPLIES IT: the text removes a constraint, and the Supabase MCP asks a
--         person to confirm such statements. Apply when the owner can approve the prompt.
--
-- ROOT CAUSE
--   Constraint recall_number_country_uniq is UNIQUE (recall_number, country) with no organisation
--   column. A recall number used by one company in a country can never be used by another company
--   in that country: the second company's save fails with 23505, and the page tells them
--   "Recall number already exists" for a record they cannot see (a cross-company existence
--   signal). It also lets two country-less recalls share a number, because NULLs are distinct.
--   Live today: public.recalls holds 0 rows, so nothing can conflict with the new key.
--
--   (The 403 the browser test saw on save is a CLIENT defect, fixed in code on the same branch:
--   the page offered countries the recalls_country_write policy refuses. No policy change needed.)
--
-- WHAT THIS CHANGES
--   The unique key becomes (organisation_id, recall_number, country) with NULLS NOT DISTINCT
--   (Postgres 15+; live is 17.6), so inside one company the rule is the same as today, plus a
--   country-less recall number is policed too. The client maps 23505 to "Recall number already
--   exists" already (src/pages/RecallTracker.jsx), so no client change is needed.
--
-- RISK TO THE CURRENT COMPANY: NONE. The table is empty. Note the new key is NOT strictly looser:
--   across companies it is looser, but inside one company two COUNTRY-LESS recalls with the same
--   number were accepted by the old key (NULLs distinct) and are refused by the new one (NULLS NOT
--   DISTINCT). Re-check `select organisation_id, recall_number, count(*) from public.recalls
--   where country is null group by 1,2 having count(*) > 1` returns no rows before applying.
--   The app does not depend on this migration: no client code names either constraint.

begin;

alter table public.recalls
  drop constraint if exists recall_number_country_uniq;

alter table public.recalls
  add constraint recalls_org_number_country_uniq
  unique nulls not distinct (organisation_id, recall_number, country);

commit;

-- VERIFY (after applying; read only)
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.recalls'::regclass and contype = 'u';
--   -- expect exactly one row:
--   -- recalls_org_number_country_uniq | UNIQUE NULLS NOT DISTINCT (organisation_id, recall_number, country)
--
-- ROLLBACK (only valid while no two companies share a recall_number + country)
--   begin;
--   alter table public.recalls drop constraint if exists recalls_org_number_country_uniq;
--   alter table public.recalls add constraint recall_number_country_uniq unique (recall_number, country);
--   commit;
