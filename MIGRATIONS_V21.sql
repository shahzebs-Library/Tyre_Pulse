-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V21.sql — Inspection extensions + RLS security fix
--
-- Builds on V20. Additive + idempotent, safe to re-run.
--
--   1. inspections: new columns for checklist v2 (odometer, hour meter,
--      signature, approval workflow, extended photo data)
--   2. RLS fix: allow Tyre Man + Inspector roles to INSERT inspections
--   3. RLS fix: allow Tyre Man to UPDATE own inspection for approval flow
--   4. Audit trigger: log inspection changes (who changed what, when)
--   5. Indexes for new query patterns
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. NEW COLUMNS ON INSPECTIONS ──────────────────────────────────────────

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS odometer_km         numeric(12,1),
  ADD COLUMN IF NOT EXISTS hour_meter          numeric(10,1),
  ADD COLUMN IF NOT EXISTS inspector_signature text,            -- base64 PNG
  ADD COLUMN IF NOT EXISTS approval_status     text DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS approver_email      text,
  ADD COLUMN IF NOT EXISTS approver_signature  text,            -- base64 PNG (future)
  ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Constrain approval_status to valid values
ALTER TABLE public.inspections
  DROP CONSTRAINT IF EXISTS ck_inspection_approval_status;
ALTER TABLE public.inspections
  ADD CONSTRAINT ck_inspection_approval_status
  CHECK (approval_status IN ('done', 'pending_approval', 'approved', 'rejected'));

-- Indexes for approval workflow queries
CREATE INDEX IF NOT EXISTS idx_inspections_approval_status ON public.inspections(approval_status);
CREATE INDEX IF NOT EXISTS idx_inspections_approver_email  ON public.inspections(approver_email);
CREATE INDEX IF NOT EXISTS idx_inspections_created_by      ON public.inspections(created_by);

-- ── 2. RLS FIX — Allow Tyre Man + Inspector to INSERT ─────────────────────
--
-- CRITICAL: The original inspections_insert policy only allowed Reporter,
-- Manager, Admin. Tyre Man is the primary checklist submitter — blocking
-- inserts causes silent save failures for that role.

DROP POLICY IF EXISTS "inspections_insert" ON public.inspections;
CREATE POLICY "inspections_insert"
  ON public.inspections FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('Tyre Man', 'Inspector', 'Reporter', 'Manager', 'Admin', 'Director')
  );

-- ── 3. RLS FIX — Allow Tyre Man to UPDATE own inspections ─────────────────
--
-- Needed for approval_status update (e.g. submitting for approval) and
-- for offline-sync corrections on the submitter's own records.

DROP POLICY IF EXISTS "inspections_update" ON public.inspections;

-- Managers/Admins can update any inspection
-- Tyre Man / Inspector can only update their own (created_by = auth.uid())
CREATE POLICY "inspections_update_admin"
  ON public.inspections FOR UPDATE
  USING (public.get_my_role() IN ('Manager', 'Admin'));

CREATE POLICY "inspections_update_own"
  ON public.inspections FOR UPDATE
  USING (
    public.get_my_role() IN ('Tyre Man', 'Inspector', 'Reporter')
    AND created_by = auth.uid()
  );

-- ── 4. INSPECTION AUDIT LOG TABLE ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inspection_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id  uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  changed_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  action         text NOT NULL,       -- created | updated | approved | rejected | deleted
  old_values     jsonb,
  new_values     jsonb
);

CREATE INDEX IF NOT EXISTS idx_insp_audit_inspection ON public.inspection_audit_log(inspection_id);
CREATE INDEX IF NOT EXISTS idx_insp_audit_changed_at ON public.inspection_audit_log(changed_at DESC);

-- RLS on audit log
ALTER TABLE public.inspection_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insp_audit_select" ON public.inspection_audit_log;
CREATE POLICY "insp_audit_select"
  ON public.inspection_audit_log FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "insp_audit_insert" ON public.inspection_audit_log;
CREATE POLICY "insp_audit_insert"
  ON public.inspection_audit_log FOR INSERT
  WITH CHECK (true); -- trigger runs as SECURITY DEFINER, app never inserts directly

-- ── 5. AUDIT TRIGGER ON INSPECTIONS ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_inspection_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action text;
  v_old    jsonb;
  v_new    jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_new    := to_jsonb(NEW) - 'inspector_signature' - 'approver_signature'; -- strip large blobs
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD) - 'inspector_signature' - 'approver_signature';
    v_new := to_jsonb(NEW) - 'inspector_signature' - 'approver_signature';
    IF v_old = v_new THEN RETURN NEW; END IF; -- no-op if nothing meaningful changed
    v_action := CASE
      WHEN NEW.approval_status = 'approved'  AND OLD.approval_status != 'approved'  THEN 'approved'
      WHEN NEW.approval_status = 'rejected'  AND OLD.approval_status != 'rejected'  THEN 'rejected'
      WHEN NEW.approval_status = 'pending_approval' THEN 'submitted_for_approval'
      ELSE 'updated'
    END;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_old    := to_jsonb(OLD) - 'inspector_signature' - 'approver_signature';
  END IF;

  INSERT INTO public.inspection_audit_log (inspection_id, changed_by, action, old_values, new_values)
  VALUES (
    COALESCE(NEW.id, OLD.id),
    auth.uid(),
    v_action,
    v_old,
    v_new
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_audit ON public.inspections;
CREATE TRIGGER trg_inspection_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION public.log_inspection_change();

-- ── 6. AUDIT RPC — inspection history with actor names ────────────────────

CREATE OR REPLACE FUNCTION public.get_inspection_audit(p_inspection_id uuid)
RETURNS TABLE (
  id            uuid,
  inspection_id uuid,
  changed_by    uuid,
  actor_name    text,
  changed_at    timestamptz,
  action        text,
  old_values    jsonb,
  new_values    jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.inspection_id, a.changed_by,
         COALESCE(p.full_name, p.username, 'System') AS actor_name,
         a.changed_at, a.action, a.old_values, a.new_values
    FROM public.inspection_audit_log a
    LEFT JOIN public.profiles p ON p.id = a.changed_by
   WHERE a.inspection_id = p_inspection_id
   ORDER BY a.changed_at DESC
   LIMIT 200;
$$;

GRANT  EXECUTE ON FUNCTION public.get_inspection_audit(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_inspection_audit(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_inspection_change()    FROM PUBLIC, anon, authenticated;

-- ── 7. SECURITY: lock down anon access on inspections ──────────────────────
-- Ensure anon role cannot read inspection data (belt-and-suspenders)
REVOKE ALL ON public.inspections            FROM anon;
REVOKE ALL ON public.inspection_audit_log   FROM anon;

-- ── 8. REFRESH STATS ───────────────────────────────────────────────────────
ANALYZE public.inspections;
