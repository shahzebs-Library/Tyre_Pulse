-- ============================================================================
-- MIGRATIONS_V212 — Checklist submission approval + signature
-- ============================================================================
-- PURELY ADDITIVE. Gives checklist_submissions a real approval lifecycle and a
-- captured approver signature, matching the templates' existing
-- `require_approval` / `require_signature` flags. The inspector's drawn
-- signature already has a home (`signature_data`); this adds the approver side:
--   • approval_status  — not_required | pending | approved | rejected
--   • approver_name / approver_signature — who signed off + their drawn signature
--   • approved_by / approved_at          — audit of the approval
--   • review_note                        — reason on rejection
--   • locked                             — set true on approval (read-only after)
--
-- The mobile app only ever INSERTED this table (never updated it), so the
-- permissive "any authenticated" UPDATE policy is safely tightened to elevated
-- roles — i.e. only a supervisor/manager can approve or reject. Org isolation is
-- unchanged. Idempotent and reversible (see footer).
-- ============================================================================

ALTER TABLE public.checklist_submissions
  ADD COLUMN IF NOT EXISTS approval_status    text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approver_name      text,
  ADD COLUMN IF NOT EXISTS approver_signature text,
  ADD COLUMN IF NOT EXISTS approved_by        uuid,
  ADD COLUMN IF NOT EXISTS approved_at        timestamptz,
  ADD COLUMN IF NOT EXISTS review_note        text,
  ADD COLUMN IF NOT EXISTS locked             boolean NOT NULL DEFAULT false;

-- Constrain the status vocabulary (drop-and-recreate for idempotency).
ALTER TABLE public.checklist_submissions DROP CONSTRAINT IF EXISTS checklist_submissions_approval_status_chk;
ALTER TABLE public.checklist_submissions
  ADD CONSTRAINT checklist_submissions_approval_status_chk
  CHECK (approval_status IN ('not_required', 'pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_checklist_submissions_approval
  ON public.checklist_submissions (approval_status);

-- ── Approval writes: elevated roles only ────────────────────────────────────
-- The app inserts submissions (unchanged) but only a supervisor/manager may
-- UPDATE them — which is exactly the approve/reject action. Replaces the old
-- "any authenticated" update policy.
DROP POLICY IF EXISTS checklist_submissions_update ON public.checklist_submissions;
CREATE POLICY checklist_submissions_update ON public.checklist_submissions FOR UPDATE
  USING (public.get_my_role() IN ('Admin', 'Manager', 'Director', 'Maintenance Supervisor'))
  WITH CHECK (public.get_my_role() IN ('Admin', 'Manager', 'Director', 'Maintenance Supervisor'));

-- Reversible:
--   DROP POLICY IF EXISTS checklist_submissions_update ON public.checklist_submissions;
--   CREATE POLICY checklist_submissions_update ON public.checklist_submissions FOR UPDATE
--     USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
--   ALTER TABLE public.checklist_submissions
--     DROP COLUMN IF EXISTS approval_status, DROP COLUMN IF EXISTS approver_name,
--     DROP COLUMN IF EXISTS approver_signature, DROP COLUMN IF EXISTS approved_by,
--     DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS review_note,
--     DROP COLUMN IF EXISTS locked;
