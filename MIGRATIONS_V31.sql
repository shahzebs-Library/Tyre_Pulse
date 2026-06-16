-- MIGRATIONS_V31.sql
-- Mobile: auto-lock submitted inspection checklists + realtime.
-- - inspections.locked / locked_at columns
-- - trg_lock_inspection_content: locks a checklist when status='Done' (insert
--   or transition); blocks content edits on a locked row for non-elevated users
--   while leaving the approval-workflow columns editable. Elevated roles
--   (admin/manager/director) may still correct a locked record.
-- - accidents added to supabase_realtime publication (inspections,
--   corrective_actions, tyre_records already enabled) so mobile lists update
--   live without pull-to-refresh.
-- See applied Supabase migration inspection_autolock_and_realtime for the body.

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;
SELECT 'trigger trg_lock_inspection_content + accidents realtime applied via Supabase migration' AS note;
