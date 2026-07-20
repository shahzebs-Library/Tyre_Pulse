-- =============================================================================
-- MIGRATIONS_V320_MOBILE_APPROVAL_RPC.sql
--
-- Server-side, transactional, optimistic-concurrency-guarded approval RPCs for
-- the mobile Approvals hub. Closes two audit findings:
--
--   FINDING #7 (P0) — Bulk upload approval used to insert batches of 500 rows
--     DIRECTLY from the phone, then flip pending_uploads.status to 'approved'.
--     A partial failure (batch 1 ok, batch 2 fails) left a half-imported batch
--     that duplicated rows on retry. Fixed by moving the import SERVER-SIDE into
--     a single SECURITY DEFINER transaction: the whole batch imports atomically
--     (all-or-nothing) and the status flip is the concurrency + idempotency key,
--     so a retry after a rolled-back attempt is clean and a re-approve is a
--     no-op. The phone now only submits Approve / Reject.
--
--   FINDING #16 (P1) — Inspection / checklist / upload decisions were direct
--     client UPDATEs where the CLIENT supplied approver id + timestamp, with no
--     optimistic-concurrency guard (two managers could take conflicting actions).
--     Fixed: every decision RPC derives the approver from auth.uid() + now()
--     SERVER-SIDE (client-supplied name/time are ignored), and only transitions a
--     row that is STILL pending; a second decider gets a clear "already decided"
--     error instead of silently clobbering the first.
--
-- STATUS: NOT YET APPLIED. Apply only after review (coordinator applies via the
--   Supabase MCP). Additive / non-destructive. Reversal footer at the bottom.
--
-- REUSES existing infra (no new audit/staging tables invented):
--   * pending_uploads (V39)                — the upload staging table.
--   * inspections + inspection_audit_log (V21) — the AFTER-UPDATE audit trigger
--       log_inspection_change() already records approved/rejected transitions;
--       these RPCs only drive the transition + add an optional note row.
--   * checklist_submissions (V212)         — approval lifecycle columns.
--   * accidents closure RPCs (V19)         — the pattern mirrored here.
--   * is_elevated_user() / is_super_admin() / app_current_org() — existing gates.
--
-- NOTE ON SCALE: the heavy row import lives inside approve_pending_upload for the
--   mobile path (browser/mobile importers are capped at ~100k rows/batch). For
--   true million-row loads the import belongs to a server worker (edge function)
--   fed off a staging table; the mobile client must still only submit Approve /
--   Reject. This RPC is the correct, safe surface for the phone.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PART A — pending_uploads: import-outcome + org columns (idempotency bookkeeping)
-- ─────────────────────────────────────────────────────────────────────────────
-- organisation_id makes the same-org gate and the imported rows' org coherent in
-- a multi-tenant world; import_status/imported_count/import_error/imported_at
-- record the decision + import outcome (an honest, queryable trail).

ALTER TABLE public.pending_uploads
  ADD COLUMN IF NOT EXISTS organisation_id uuid,
  ADD COLUMN IF NOT EXISTS import_status   text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS imported_count  integer,
  ADD COLUMN IF NOT EXISTS import_error    text,
  ADD COLUMN IF NOT EXISTS imported_at     timestamptz;

ALTER TABLE public.pending_uploads DROP CONSTRAINT IF EXISTS pending_uploads_import_status_chk;
ALTER TABLE public.pending_uploads
  ADD CONSTRAINT pending_uploads_import_status_chk
  CHECK (import_status IN ('pending', 'importing', 'imported', 'failed', 'rejected'));

-- Backfill organisation_id from the uploader's profile (best effort; legacy rows
-- with no resolvable uploader stay NULL and are treated as caller-org on gate).
UPDATE public.pending_uploads pu
   SET organisation_id = p.organisation_id
  FROM public.profiles p
 WHERE pu.uploaded_by = p.id
   AND pu.organisation_id IS NULL
   AND p.organisation_id IS NOT NULL;

-- Fold prior terminal statuses into the import bookkeeping so history reads true.
UPDATE public.pending_uploads
   SET import_status = 'imported'
 WHERE status = 'approved' AND import_status = 'pending';
UPDATE public.pending_uploads
   SET import_status = 'rejected'
 WHERE status = 'rejected' AND import_status = 'pending';


-- ─────────────────────────────────────────────────────────────────────────────
-- PART B — approve_pending_upload : transactional, idempotent bulk import
-- ─────────────────────────────────────────────────────────────────────────────
-- Whitelisted upload_type -> target table (NEVER trust pending_uploads.target_table,
-- which is a free-text column). The whole function runs in ONE transaction:
--   1. Atomically flip status pending -> approved ONLY IF still pending. This
--      single guarded UPDATE is the optimistic-concurrency + idempotency key:
--      two managers cannot both import, and a re-approve is refused.
--   2. Import every staged row via jsonb_populate_recordset, stamping
--      organisation_id = caller org on each row (multi-tenant correct).
--   3. Record the import outcome.
-- If ANY step raises, the ENTIRE transaction rolls back (status reverts to
-- pending), so there is never a committed partial import and a retry is clean.

CREATE OR REPLACE FUNCTION public.approve_pending_upload(p_upload_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type      text;
  v_rows      jsonb;
  v_org       uuid;
  v_row_org   uuid;
  v_target    text;
  v_imported  integer := 0;
  v_prev      text;
  v_reviewer  text;
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'Only Admin, Manager or Director can approve uploads';
  END IF;

  v_org := public.app_current_org();

  -- (1) Atomic optimistic-concurrency guard: transition ONLY a still-pending row.
  UPDATE public.pending_uploads
     SET status        = 'approved',
         import_status  = 'importing',
         reviewed_by    = auth.uid(),     -- server-derived approver (client ignored)
         reviewed_at    = now()           -- server-derived timestamp
   WHERE id = p_upload_id
     AND status = 'pending'
     AND (organisation_id IS NULL
          OR organisation_id = v_org
          OR public.is_super_admin())
   RETURNING upload_type, rows, COALESCE(organisation_id, v_org)
        INTO v_type, v_rows, v_row_org;

  IF NOT FOUND THEN
    -- Nothing transitioned: either already decided, or not in caller's org.
    SELECT status,
           COALESCE(pr.full_name, pr.username, 'another reviewer')
      INTO v_prev, v_reviewer
      FROM public.pending_uploads pu
      LEFT JOIN public.profiles pr ON pr.id = pu.reviewed_by
     WHERE pu.id = p_upload_id;

    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'That upload no longer exists.';
    ELSIF v_prev <> 'pending' THEN
      RAISE EXCEPTION 'This upload was already % by %.', v_prev, v_reviewer;
    ELSE
      RAISE EXCEPTION 'You do not have access to approve this upload.';
    END IF;
  END IF;

  -- (2) Resolve the target table from a HARDCODED allow-list keyed by upload_type.
  v_target := CASE lower(coalesce(v_type, ''))
                WHEN 'tyres' THEN 'tyre_records'
                WHEN 'stock' THEN 'stock_records'
                ELSE NULL
              END;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Unsupported upload type "%": this batch cannot be imported.', v_type;
  END IF;

  IF v_rows IS NULL OR jsonb_typeof(v_rows) <> 'array' THEN
    v_rows := '[]'::jsonb;
  END IF;

  -- (3) Import atomically, forcing organisation_id = caller org on every row.
  IF v_target = 'tyre_records' THEN
    INSERT INTO public.tyre_records
    SELECT r.*
      FROM jsonb_populate_recordset(
             null::public.tyre_records,
             (SELECT COALESCE(
                       jsonb_agg(elem || jsonb_build_object('organisation_id', v_row_org)),
                       '[]'::jsonb)
                FROM jsonb_array_elements(v_rows) elem)
           ) AS r;
    GET DIAGNOSTICS v_imported = ROW_COUNT;
  ELSIF v_target = 'stock_records' THEN
    INSERT INTO public.stock_records
    SELECT r.*
      FROM jsonb_populate_recordset(
             null::public.stock_records,
             (SELECT COALESCE(
                       jsonb_agg(elem || jsonb_build_object('organisation_id', v_row_org)),
                       '[]'::jsonb)
                FROM jsonb_array_elements(v_rows) elem)
           ) AS r;
    GET DIAGNOSTICS v_imported = ROW_COUNT;
  END IF;

  -- (4) Record the outcome. Same transaction => committed atomically with the rows.
  UPDATE public.pending_uploads
     SET import_status  = 'imported',
         imported_count = v_imported,
         imported_at    = now(),
         import_error   = NULL
   WHERE id = p_upload_id;

  RETURN jsonb_build_object('ok', true, 'imported', v_imported, 'target', v_target);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART C — reject_pending_upload : guarded decision, no import
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reject_pending_upload(p_upload_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_prev     text;
  v_reviewer text;
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'Only Admin, Manager or Director can reject uploads';
  END IF;

  v_org := public.app_current_org();

  UPDATE public.pending_uploads
     SET status        = 'rejected',
         import_status  = 'rejected',
         review_note    = p_reason,
         reviewed_by    = auth.uid(),
         reviewed_at    = now()
   WHERE id = p_upload_id
     AND status = 'pending'
     AND (organisation_id IS NULL
          OR organisation_id = v_org
          OR public.is_super_admin());

  IF NOT FOUND THEN
    SELECT status,
           COALESCE(pr.full_name, pr.username, 'another reviewer')
      INTO v_prev, v_reviewer
      FROM public.pending_uploads pu
      LEFT JOIN public.profiles pr ON pr.id = pu.reviewed_by
     WHERE pu.id = p_upload_id;

    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'That upload no longer exists.';
    ELSIF v_prev <> 'pending' THEN
      RAISE EXCEPTION 'This upload was already % by %.', v_prev, v_reviewer;
    ELSE
      RAISE EXCEPTION 'You do not have access to reject this upload.';
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'rejected');
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART D — restamp_pending_upload_country : server-side batch country correction
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaces the old client-side "Set country" UPDATE of the whole rows blob with a
-- gated, same-org, still-pending-only server operation.

CREATE OR REPLACE FUNCTION public.restamp_pending_upload_country(p_upload_id uuid, p_country text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_rows     jsonb;
  v_new      jsonb;
  v_prev     text;
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'Only Admin, Manager or Director can edit an upload';
  END IF;
  IF p_country IS NULL OR btrim(p_country) = '' THEN
    RAISE EXCEPTION 'A country is required.';
  END IF;

  v_org := public.app_current_org();

  SELECT rows INTO v_rows
    FROM public.pending_uploads
   WHERE id = p_upload_id
     AND status = 'pending'
     AND (organisation_id IS NULL OR organisation_id = v_org OR public.is_super_admin())
   FOR UPDATE;

  IF NOT FOUND THEN
    SELECT status INTO v_prev FROM public.pending_uploads WHERE id = p_upload_id;
    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'That upload no longer exists.';
    ELSIF v_prev <> 'pending' THEN
      RAISE EXCEPTION 'This upload was already decided and can no longer be edited.';
    ELSE
      RAISE EXCEPTION 'You do not have access to edit this upload.';
    END IF;
  END IF;

  IF v_rows IS NULL OR jsonb_typeof(v_rows) <> 'array' THEN
    v_new := '[]'::jsonb;
  ELSE
    SELECT COALESCE(jsonb_agg(elem || jsonb_build_object('country', p_country)), '[]'::jsonb)
      INTO v_new
      FROM jsonb_array_elements(v_rows) elem;
  END IF;

  UPDATE public.pending_uploads
     SET rows = v_new, country = p_country
   WHERE id = p_upload_id;

  RETURN jsonb_build_object('ok', true, 'country', p_country);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART E — decide_inspection_approval : guarded inspection sign-off (FINDING #16)
-- ─────────────────────────────────────────────────────────────────────────────
-- One RPC for approve + reject. Approver id/email/timestamp are derived
-- server-side; the client cannot supply them. Only a row still in
-- 'pending_approval' transitions (optimistic concurrency); a second decider gets
-- an "already decided" error. The existing AFTER-UPDATE trigger
-- log_inspection_change() writes the immutable audit row for the transition; when
-- a note is supplied we add one extra audit row carrying it (no durable
-- reject-reason column exists on inspections).

CREATE OR REPLACE FUNCTION public.decide_inspection_approval(
  p_inspection_id uuid,
  p_decision      text,
  p_note          text DEFAULT NULL,
  p_signature     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_org      uuid;
  v_email    text;
  v_prev     text;
  v_approver text;
  v_status   text;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('Admin', 'Manager', 'Director', 'Maintenance Supervisor') THEN
    RAISE EXCEPTION 'Only an approver (Admin, Manager, Director or Maintenance Supervisor) can decide inspections';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.';
  END IF;

  v_org := public.app_current_org();
  -- approved -> Done (locked); rejected -> back to In Progress for rework.
  v_status := CASE WHEN p_decision = 'approved' THEN 'Done' ELSE 'In Progress' END;

  SELECT COALESCE(full_name, username, email, 'Approver')
    INTO v_approver
    FROM public.profiles WHERE id = auth.uid();
  SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();

  UPDATE public.inspections
     SET approval_status    = p_decision,
         status             = v_status,
         approved_by        = auth.uid(),      -- server-derived (client ignored)
         approver_email     = v_email,         -- server-derived (client ignored)
         approver_signature = COALESCE(p_signature, approver_signature),
         approved_at        = now()            -- server-derived (client ignored)
   WHERE id = p_inspection_id
     AND approval_status = 'pending_approval'
     AND (organisation_id = v_org OR public.is_super_admin());

  IF NOT FOUND THEN
    SELECT i.approval_status,
           COALESCE(pr.full_name, pr.username, 'another approver')
      INTO v_prev, v_approver
      FROM public.inspections i
      LEFT JOIN public.profiles pr ON pr.id = i.approved_by
     WHERE i.id = p_inspection_id;

    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'That inspection no longer exists.';
    ELSIF v_prev <> 'pending_approval' THEN
      RAISE EXCEPTION 'This inspection was already % by %.', v_prev, v_approver;
    ELSE
      RAISE EXCEPTION 'You do not have access to decide this inspection.';
    END IF;
  END IF;

  -- Optional reviewer note as an extra audit entry (the status transition itself
  -- is already logged by the trg_inspection_audit AFTER-UPDATE trigger).
  IF p_note IS NOT NULL AND btrim(p_note) <> '' THEN
    INSERT INTO public.inspection_audit_log (inspection_id, changed_by, action, new_values)
    VALUES (p_inspection_id, auth.uid(), p_decision || '_note',
            jsonb_build_object('note', p_note));
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART F — decide_checklist_approval : guarded checklist sign-off (FINDING #16)
-- ─────────────────────────────────────────────────────────────────────────────
-- checklist_submissions uses approval_status pending|approved|rejected and locks
-- on approval. Same server-derived approver + optimistic-concurrency guard.

CREATE OR REPLACE FUNCTION public.decide_checklist_approval(
  p_submission_id uuid,
  p_decision      text,
  p_note          text DEFAULT NULL,
  p_signature     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_org      uuid;
  v_approver text;
  v_prev     text;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('Admin', 'Manager', 'Director', 'Maintenance Supervisor') THEN
    RAISE EXCEPTION 'Only an approver (Admin, Manager, Director or Maintenance Supervisor) can decide checklists';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.';
  END IF;

  v_org := public.app_current_org();

  SELECT COALESCE(full_name, username, 'Approver')
    INTO v_approver FROM public.profiles WHERE id = auth.uid();

  UPDATE public.checklist_submissions
     SET approval_status    = p_decision,
         approved_by        = auth.uid(),   -- server-derived (client ignored)
         approver_name      = v_approver,   -- server-derived (client ignored)
         approver_signature = COALESCE(p_signature, approver_signature),
         approved_at        = now(),        -- server-derived (client ignored)
         review_note        = p_note,
         locked             = (p_decision = 'approved')
   WHERE id = p_submission_id
     AND approval_status = 'pending'
     AND (organisation_id = v_org OR public.is_super_admin());

  IF NOT FOUND THEN
    SELECT cs.approval_status,
           COALESCE(pr.full_name, pr.username, 'another approver')
      INTO v_prev, v_approver
      FROM public.checklist_submissions cs
      LEFT JOIN public.profiles pr ON pr.id = cs.approved_by
     WHERE cs.id = p_submission_id;

    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'That checklist no longer exists.';
    ELSIF v_prev <> 'pending' THEN
      RAISE EXCEPTION 'This checklist was already % by %.', v_prev, v_approver;
    ELSE
      RAISE EXCEPTION 'You do not have access to decide this checklist.';
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS — signed-in users only; the self-gates above are the real boundary.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.approve_pending_upload(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_pending_upload(uuid, text)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.restamp_pending_upload_country(uuid, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_inspection_approval(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_checklist_approval(uuid, text, text, text)  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_pending_upload(uuid)                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_pending_upload(uuid, text)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restamp_pending_upload_country(uuid, text)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decide_inspection_approval(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decide_checklist_approval(uuid, text, text, text)  FROM PUBLIC, anon;


-- =============================================================================
-- REVERSAL (for rollback):
--   DROP FUNCTION IF EXISTS public.approve_pending_upload(uuid);
--   DROP FUNCTION IF EXISTS public.reject_pending_upload(uuid, text);
--   DROP FUNCTION IF EXISTS public.restamp_pending_upload_country(uuid, text);
--   DROP FUNCTION IF EXISTS public.decide_inspection_approval(uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.decide_checklist_approval(uuid, text, text, text);
--   ALTER TABLE public.pending_uploads DROP CONSTRAINT IF EXISTS pending_uploads_import_status_chk;
--   ALTER TABLE public.pending_uploads
--     DROP COLUMN IF EXISTS organisation_id, DROP COLUMN IF EXISTS import_status,
--     DROP COLUMN IF EXISTS imported_count,  DROP COLUMN IF EXISTS import_error,
--     DROP COLUMN IF EXISTS imported_at;
-- (Historical target-table rows that were imported are business data and are
--  intentionally NOT removed by this reversal.)
-- =============================================================================
