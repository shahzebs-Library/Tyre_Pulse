-- ROLLBACK of 20261121120000_report_pdf_retention_schedule_reload.sql.
-- Removes the dry-run function. The job row is left as it is: the migration only wrote
-- the same schedule and command again, so there is nothing to undo there. To stop the
-- job entirely (it only marks, it never removes a file), run the first statement below.
--   select cron.unschedule('report-pdf-retention');
begin;
drop function if exists public.pdf_cache_retention_preview(integer);
commit;

-- VERIFY:
-- select to_regprocedure('public.pdf_cache_retention_preview(integer)');   -- null
