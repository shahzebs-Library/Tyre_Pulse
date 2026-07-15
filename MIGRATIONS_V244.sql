-- V244 — Fix report_schedules CHECK constraints that blocked saving schedules
--
-- Two defects made "cannot save schedule" for whole categories of report:
--
-- 1) report_schedules_report_type_check only allowed
--    ['executive','kpi','fleet','inspection','cost'] — but the app (single source
--    src/lib/api/scheduledReports.js REPORT_TYPES) also offers accidents, claims,
--    stock and vendor, PLUS every saved Report Builder layout scheduled as
--    'builder:<template-id>' (BUILDER_TYPE_PREFIX). All of those violated the
--    constraint, so accident/claims/stock/vendor and ALL custom-layout schedules
--    (incl. the new Accidents Analytics auto-email) could never be saved.
--
-- 2) Two overlapping frequency constraints existed: report_schedules_frequency_chk
--    correctly allows once/daily/weekly/monthly, but the older
--    report_schedules_frequency_check allowed only daily/weekly/monthly — so a
--    'once' (specific-date) schedule failed the stricter one. Drop the stale
--    duplicate; keep the correct one.
--
-- The new report_type rule = the known base vocabulary OR any 'builder:%' layout
-- reference. Existing rows (constrained to the old 5) all satisfy it, so the
-- swap is safe with no data backfill.

-- 1) report_type: known base types OR a builder layout reference
ALTER TABLE public.report_schedules
  DROP CONSTRAINT IF EXISTS report_schedules_report_type_check;

ALTER TABLE public.report_schedules
  ADD CONSTRAINT report_schedules_report_type_check CHECK (
    report_type = ANY (ARRAY[
      'executive','kpi','fleet','inspection','cost',
      'accidents','claims','stock','vendor'
    ]::text[])
    OR report_type LIKE 'builder:%'
  );

-- 2) Remove the stale, stricter frequency constraint (blocked 'once');
--    report_schedules_frequency_chk (once/daily/weekly/monthly) remains.
ALTER TABLE public.report_schedules
  DROP CONSTRAINT IF EXISTS report_schedules_frequency_check;
