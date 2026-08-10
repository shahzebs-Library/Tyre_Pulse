-- MIGRATIONS_V496_ACTION_CHAIN.sql
-- STATUS: APPLIED LIVE 2026-08-10, full chain tested end to end (rolled back).
--
-- WHY
-- An inspector could record a damaged or punctured tyre and NOTHING downstream
-- was created. Measured on the live system: 13 inspections found damage or a
-- puncture across 12 assets, while the entire database held 3 corrective
-- actions. Findings ended at the report.
--
-- corrective_actions had no link in EITHER direction - no record of what raised
-- it, and no link to the work order that fixes it. These columns close both ends
-- WITHOUT a new module: corrective_actions and work_orders already exist and
-- each keeps its own workflow.
--
--   inspection defect  ->  corrective_actions  ->  work_orders
--       source_id            (the register)         work_order_id
--
-- THE UNIQUE INDEX IS THE PRODUCT DECISION, not a technicality:
--   * one OPEN action per (source row, asset, specific defect), so pressing
--     "Raise corrective action" twice cannot raise the same tyre twice - and
--     the guard holds even if two people press it simultaneously, which no
--     amount of client-side filtering can promise;
--   * but a NEW action IS allowed once the previous one is closed, because the
--     same wheel position genuinely can fail again. A plain unique constraint
--     would silently suppress the recurrence - the more dangerous failure.
-- The client filters known-open keys first, so a blocked insert (23505) is an
-- expected "already open" outcome and is reported as skipped, not as an error.
--
-- source_detail holds the defect's stable key (e.g. 'damage:LHF1',
-- 'overdue:RHR1:S123') produced by inspectionTyreFlags.defectsForAction. That
-- pure function is ALSO what draws the flag on the register, so the defect a
-- user sees and the action raised from it can never diverge.
--
-- VERIFIED LIVE (rolled back) against a real inspection that recorded damage:
--   raise -> 1 open action carrying source_type/source_id/source_detail
--   press again -> still 1 (the guard held)
--   close it, defect recurs -> a second action IS created
--   raise the job -> work order created and linked, action shows job WO-...
--
-- ROLLBACK
--   drop index if exists ux_corrective_actions_open_source_defect;
--   drop index if exists idx_corrective_actions_work_order;
--   drop index if exists idx_corrective_actions_source;
--   alter table public.corrective_actions
--     drop constraint if exists corrective_actions_source_type_chk,
--     drop column if exists source_detail, drop column if exists source_id,
--     drop column if exists source_type,   drop column if exists work_order_id;

alter table public.corrective_actions
  add column if not exists work_order_id uuid references public.work_orders(id) on delete set null,
  add column if not exists source_type   text not null default 'manual',
  add column if not exists source_id     uuid,
  add column if not exists source_detail text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'corrective_actions_source_type_chk') then
    alter table public.corrective_actions
      add constraint corrective_actions_source_type_chk
      check (source_type in ('manual','inspection','checklist','accident'));
  end if;
end $$;

create index if not exists idx_corrective_actions_source
  on public.corrective_actions (source_type, source_id);
create index if not exists idx_corrective_actions_work_order
  on public.corrective_actions (work_order_id) where work_order_id is not null;

create unique index if not exists ux_corrective_actions_open_source_defect
  on public.corrective_actions (source_id, asset_no, source_detail)
  where source_id is not null
    and source_detail is not null
    and lower(coalesce(status, '')) not in ('closed', 'resolved', 'cancelled');

-- NOT DONE HERE (recorded, needs its own decision):
--  * checklist_submissions still has no failed-items column, so a failed
--    checklist item cannot yet raise an action the way an inspection defect can.
--    source_type already allows 'checklist' for when it can.
--  * nothing auto-raises an action; it is a deliberate human press. Automatic
--    creation on every damaged tyre would have generated 13 actions retroactively
--    on data nobody has reviewed.
