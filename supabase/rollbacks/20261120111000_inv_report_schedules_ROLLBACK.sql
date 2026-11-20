-- ROLLBACK of 20261120111000_inv_report_schedules.sql. Refuses while an 'inventory'
-- schedule exists: the owner removes or retypes those schedules first (the rollback
-- never deletes a schedule). Restores the production report_type CHECK copied 2026-11-20.
begin;
do $$ begin
  if exists (select 1 from public.report_schedules where report_type = 'inventory') then
    raise exception 'Inventory report schedules exist; remove or retype them before rolling back.';
  end if;
end $$;
drop view if exists public.v_inv_report_snapshot;
alter table public.report_schedules drop constraint if exists report_schedules_report_type_check;
alter table public.report_schedules add constraint report_schedules_report_type_check check ((report_type = any (array[
  'executive'::text, 'kpi'::text, 'fleet'::text, 'inspection'::text, 'cost'::text, 'accidents'::text, 'claims'::text,
  'stock'::text, 'vendor'::text, 'pm'::text, 'workshop'::text, 'workshop_status'::text, 'tyre_stock_alert'::text]))
  or (report_type ~~ 'builder:%'::text));
commit;
