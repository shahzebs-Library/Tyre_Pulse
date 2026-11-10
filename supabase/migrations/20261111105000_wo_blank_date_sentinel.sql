-- 20261111105000_wo_blank_date_sentinel
-- The ERP writes 1900-01-01 into a date cell it has no value for. The in-app intake
-- (Vehicle Complaints History, src/lib/erpIntake.js parseDate) stored it, so 42 KSA job cards
-- read "completed on 1900-01-01" (16 of them from the 2026-11-10 upload), breaking duration,
-- ageing and completed-before-opened checks. completed_at becomes NULL (unknown); status is
-- untouched. Only the EXACT 1900-01-01 placeholder on rows whose opened_at is a real date is
-- changed: the year 0022-0025 century-dropped rows are left as the owner ruled.
-- Snapshot: _bak.wo_blank_date_20261111 (id, completed_at). Undo:
--   update work_orders w set completed_at=b.completed_at from _bak.wo_blank_date_20261111 b where b.id=w.id;
create table if not exists _bak.wo_blank_date_20261111 as
  select id, completed_at from public.work_orders
  where completed_at = '1900-01-01 00:00:00+00' and opened_at >= '1901-01-01';
update public.work_orders w set completed_at = null
  from _bak.wo_blank_date_20261111 b where b.id = w.id;
