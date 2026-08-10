-- MIGRATIONS_V497_WORK_ORDER_STATUS_CHECK_UNION.sql
-- STATUS: APPLIED LIVE 2026-08-10, verified.
--
-- A SHIPPED FEATURE THAT COULD NEVER SAVE.
--
-- Found while wiring the corrective-action -> job chain: inserting a work order
-- with status 'New' - exactly what workshopLive.createJob writes via
-- normalizeWoStatus('New') - raised work_orders_status_check.
--
-- The CHECK allowed six values:
--   Open, In Progress, Awaiting Parts, Completed, Closed, Cancelled
-- V294 then unified the app onto ELEVEN canonical Title Case statuses:
--   New, Awaiting Assignment, Assigned, In Progress, Waiting for Parts,
--   Waiting for Approval, Quality Inspection, Completed, Overdue, Cancelled,
--   On Hold
-- and taught normalizeWoStatus to FOLD the legacy values on READ
-- (open -> New, closed -> Completed, awaiting_parts -> Waiting for Parts).
--
-- That fold is why this stayed invisible: every READ rendered correctly, so the
-- kanban and the registers looked healthy. Only WRITES failed, and they failed
-- on a constraint whose message names no feature.
--
-- MEASURED, 88,773 work orders - the statuses actually in use:
--   Closed 56,882 | Completed 31,784 | Open 63 | In Progress 43 | Cancelled 1
-- Not ONE row carries New, Assigned, Waiting for Parts, Quality Inspection,
-- Overdue, On Hold, Awaiting Assignment or Waiting for Approval, because the
-- database has never accepted them. So the Workshop Live "New Job" button, the
-- kanban status moves and the QC pass/fail flow could not write at all - which
-- is consistent with the other measured symptom, an assigned owner on 20 of
-- 88,773 orders.
--
-- FIX: the UNION of both vocabularies. Widening can never invalidate a stored
-- row (all six legacy values stay allowed) and it unblocks the shipped features
-- immediately. Narrowing the app to six instead would delete real workflow
-- states the kanban is built from, so the union is the correct direction.
--
-- ROLLBACK (restores the six-value CHECK; do NOT do this while the app writes
-- canonical statuses):
--   alter table public.work_orders drop constraint work_orders_status_check;
--   alter table public.work_orders add constraint work_orders_status_check
--     check (status in ('Open','In Progress','Awaiting Parts','Completed','Closed','Cancelled'));

alter table public.work_orders drop constraint if exists work_orders_status_check;

alter table public.work_orders
  add constraint work_orders_status_check check (status in (
    -- canonical vocabulary (src/lib/workOrderStatus.js WO_STATUSES)
    'New', 'Awaiting Assignment', 'Assigned', 'In Progress', 'Waiting for Parts',
    'Waiting for Approval', 'Quality Inspection', 'Completed', 'Overdue',
    'Cancelled', 'On Hold',
    -- legacy values held by the 88,773 imported rows; normalizeWoStatus folds
    -- these on read, so they must remain storable
    'Open', 'Closed', 'Awaiting Parts'
  ));

-- RULE: WO_STATUSES and this CHECK are a PAIR. Adding a canonical status without
-- widening this CHECK produces a feature that renders correctly and cannot save -
-- which is precisely how this went unnoticed across an entire module.
--
-- STILL OPEN (recorded, not changed here): the app carries two "done" statuses,
-- Closed (56,882) and Completed (31,784), which no single query reconciles.
-- normalizeWoStatus folds both to Completed on read, so reporting is consistent,
-- but the stored split remains and should be settled with the owner.
