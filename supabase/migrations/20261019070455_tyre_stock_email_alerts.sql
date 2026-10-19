-- Allow the existing scheduled-report pipeline to deliver a tyre low-stock alert.
-- The report is scoped to the schedule's organisation by the server-side job.
alter table public.report_schedules
  drop constraint if exists report_schedules_report_type_check;

alter table public.report_schedules
  add constraint report_schedules_report_type_check
  check (
    report_type = any (array[
      'executive', 'kpi', 'fleet', 'inspection', 'cost', 'accidents',
      'claims', 'stock', 'vendor', 'pm', 'workshop', 'workshop_status',
      'tyre_stock_alert'
    ]::text[])
    or report_type like 'builder:%'
  );
