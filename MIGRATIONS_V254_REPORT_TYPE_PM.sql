-- =============================================================================
-- MIGRATIONS_V254_REPORT_TYPE_PM.sql  (applied live)
-- Widen report_schedules.report_type CHECK to allow the new 'pm' (Preventive
-- Maintenance due) scheduled-report type, alongside the existing base types and
-- the builder:% family. Mirrors the V244 widening pattern.
-- Idempotent + reversible (re-add the prior 9-value + builder:% constraint).
-- =============================================================================
ALTER TABLE public.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_report_type_check;
ALTER TABLE public.report_schedules ADD CONSTRAINT report_schedules_report_type_check
  CHECK (
    report_type = ANY (ARRAY['executive','kpi','fleet','inspection','cost','accidents','claims','stock','vendor','pm']::text[])
    OR report_type LIKE 'builder:%'
  );
