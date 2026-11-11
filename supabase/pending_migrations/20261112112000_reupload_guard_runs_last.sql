-- F-F-05 - the expense re-upload dedupe must run AFTER the org-stamp (and after
--          every other BEFORE trigger), so it dedupes the FINAL, stamped row.
--
-- STATUS: DRAFT - NOT APPLIED (Supabase MCP was down when this was written). The lead
--   applies it via apply_migration and runs the rolled-back probe below BEFORE trusting it.
--   On apply, move this file to supabase/migrations/ keeping the same stamp.
--
-- WHY. expense_reupload_guard() (20261111109000) dedupes a fresh line against stored lines
--   on ten columns with `IS NOT DISTINCT FROM`, INCLUDING organisation_id. BEFORE triggers
--   fire in NAME order. The dedupe trigger is named trg_dedupe_expense_reupload ('d'), which
--   sorts BEFORE a per-import org-stamp trigger such as trg_stamp_import_default_org ('s').
--   A dashboard / service-role import arrives with organisation_id = NULL and is stamped to
--   Company A by the org-stamp trigger; if the dedupe runs first it compares a NULL org
--   against stored rows whose org is Company A, the content key never matches, and the
--   re-upload is NOT caught. (It also must stay after trg_classify_parts_consumption so
--   event_date is populated - the 'd' name already satisfies that; 'zz' keeps it.)
--
-- FIX. Rename the trigger to trg_zz_dedupe_expense_reupload so it fires LAST, after the
--   country guard (trg_aa_), the building guard (trg_ab_), the classifier
--   (trg_classify_parts_consumption) and any org-stamp. It then dedupes the fully
--   stamped + classified row. A row skipped by an earlier guard (RETURN NULL) never reaches
--   this one, which is correct. DROP-free (rename only) + idempotent.
--
-- The trigger keeps binding to public.expense_reupload_guard(); only its name changes, so the
-- dedupe BEHAVIOUR is unchanged. Nothing else is touched.

do $$
begin
  if exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'parts_consumption'
       and t.tgname = 'trg_dedupe_expense_reupload'
  ) and not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'parts_consumption'
       and t.tgname = 'trg_zz_dedupe_expense_reupload'
  ) then
    alter trigger trg_dedupe_expense_reupload on public.parts_consumption
      rename to trg_zz_dedupe_expense_reupload;
  end if;
end $$;

-- VERIFY (one rolled-back call; replaces nothing - copies a real stored line):
--   -- 1. the dedupe now fires LAST among the BEFORE triggers on parts_consumption:
--   select tgname from pg_trigger t
--     join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relname='parts_consumption' and not t.tgisinternal
--    order by tgname;   -- expect trg_zz_dedupe_expense_reupload last (no trg_dedupe_* remains)
--   -- 2. behaviour preserved - insert one existing line twice as a fresh upload, rolled back:
--   begin;
--     -- as service role, insert a row copying an existing stored line's 10 key columns,
--     -- organisation_id NULL (so the org-stamp fills it), created_at = now(); do it TWICE.
--     -- expect: the SECOND is skipped -> 0 new parts_consumption rows for that key beyond
--     --         the first, and +1 expense_import_rejects with reject_reason 'already_stored'.
--   rollback;
--
-- ROLLBACK:
--   alter trigger trg_zz_dedupe_expense_reupload on public.parts_consumption
--     rename to trg_dedupe_expense_reupload;
