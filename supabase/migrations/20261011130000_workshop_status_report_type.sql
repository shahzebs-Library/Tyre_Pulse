-- =============================================================================
-- 20261011130000_workshop_status_report_type.sql  (APPLIED 2026-10-11, verified: workshop_status accepted, bogus refused)
-- Widen report_schedules.report_type CHECK to allow 'workshop_status', the
-- Daily Ops > Workshop Status scheduled report (vehicles currently in the
-- workshop, src/lib/api/scheduledReports.js DATASETS.workshop_status and the
-- send-scheduled-reports DATASET_DIGEST.workshop_status branch).
--
-- Keeps every value of the latest definition (V254 set + 'workshop' from V298)
-- and the builder:% family. Widening only: no stored row can be invalidated.
--
-- VERIFY:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'report_schedules_report_type_check';
--   -- expect 'workshop_status' and builder:% in the definition.
-- ROLLBACK (only if no schedule uses the new type):
--   alter table public.report_schedules drop constraint report_schedules_report_type_check;
--   alter table public.report_schedules add constraint report_schedules_report_type_check
--     check (report_type = any (array['executive','kpi','fleet','inspection','cost',
--       'accidents','claims','stock','vendor','pm','workshop']::text[])
--       or report_type like 'builder:%');
-- =============================================================================
alter table public.report_schedules drop constraint if exists report_schedules_report_type_check;
alter table public.report_schedules add constraint report_schedules_report_type_check
  check (
    report_type = any (array[
      'executive','kpi','fleet','inspection','cost','accidents','claims',
      'stock','vendor','pm','workshop','workshop_status'
    ]::text[])
    or report_type like 'builder:%'
  );
