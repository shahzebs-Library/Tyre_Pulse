-- handover_reports: content is frozen once the supervisor has signed.
--
-- FINDING: RLS-6 residual (batch 1 follow-up)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG
--   20261112143000 froze an APPROVED handover and the sign-off columns, but a
--   field user could still change the content (odometer, damages, notes, ...) of
--   a handover at pending_incharge - i.e. after the supervisor signed it and
--   before the fleet incharge decided. The incharge would then approve something
--   the supervisor never saw.
--
-- WHAT THIS DOES
--   guard_handover_approval_stages (BEFORE UPDATE) gains one more refusal inside
--   the existing block for signed-in, non-super-admin sessions that did not come
--   through decide_handover_approval:
--       old.approval_status = 'pending_incharge'  ->  42501
--   Nothing else changes. The ladder is untouched:
--     - the incharge approves / the supervisor sends back through
--       decide_handover_approval (it sets handover.via = 'decide');
--     - a REJECTED handover is editable again and can be resubmitted
--       (rejected -> draft / pending_supervisor), exactly as before;
--     - draft and pending_supervisor stay editable;
--     - super admin and backend sessions follow the previous rules.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none. handover_reports held 0 rows at apply time.
-- Clients: web handoverReports.js and Flutter handover_remote_repository.dart
--   write field columns; neither offers an edit on a pending_incharge sheet that
--   the previous guard would have accepted with a status change. Expo has no
--   handover screen.
-- Method: built from the LIVE pg_get_functiondef by one anchored replacement;
--   the block aborts unless the anchor is found exactly once and the new text is
--   not already present. SECURITY DEFINER / search_path / grants are preserved by
--   CREATE OR REPLACE.
-- PostgREST: raises 42501 only.
-- Client behaviour that changes: saving an edit to a handover that is waiting
--   for the fleet incharge now fails with "A handover the supervisor has signed
--   cannot be changed until the fleet incharge decides."
-- Rollback: at the foot.

do $mig$
declare
  v_def text;
  v_a text := E'      raise exception ''An approved handover cannot be changed.'' using errcode = ''42501'';\n    end if;';
begin
  select pg_get_functiondef('public.guard_handover_approval_stages()'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 then
    raise exception 'guard: anchor not found exactly once';
  end if;
  if position('supervisor has signed' in v_def) > 0 then
    raise exception 'guard: already extended';
  end if;
  v_def := replace(v_def, v_a, v_a
    || E'\n    if old.approval_status = ''pending_incharge'' then\n'
    || E'      raise exception ''A handover the supervisor has signed cannot be changed until the fleet incharge decides.'' using errcode = ''42501'';\n'
    || E'    end if;');
  execute v_def;
end
$mig$;

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12 in one rolled-back transaction; identity switched per step.
--  NOTE for anyone re-running: handover.via is transaction-local, so inside ONE
--  test transaction it must be cleared after each RPC call
--  (set_config('handover.via','',true)) or the later steps wrongly pass. In
--  production every request is its own transaction.)
--   Driver   edit own sheet at pending_supervisor                 -> 1 row (control)
--   Manager  decide_handover_approval(sign)                       -> pending_incharge
--   Driver   edit odometer / notes at pending_incharge            -> 42501 (was 1 row)
--   Manager  direct table edit at pending_incharge                -> 42501
--   Manager  decide_handover_approval(send back, with reason)     -> rejected (control)
--   Driver   correct the rejected sheet and resubmit              -> 1 row, pending_supervisor (control)
--   Incharge decide_handover_approval(approve)                    -> approved, content as signed (control)
--
-- ---------------------------------------------------------------------- ROLLBACK
-- Re-create guard_handover_approval_stages without the three added lines
-- (the body in 20261112143000_handover_signoff_forgery_guard.sql).
