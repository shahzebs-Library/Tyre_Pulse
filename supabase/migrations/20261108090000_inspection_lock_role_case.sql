-- Locked inspections: let Admin / Manager / Director (and super admins) correct
-- a wrong reading, as the lock was always meant to allow.
--
-- STATUS: APPLIED LIVE 2026-11-08 (project jhssdmeruxtrlqnwfksc).
--
-- Bug: lock_inspection_content() compared profiles.role to lowercase
-- 'admin'/'manager'/'director' while roles are stored Title Case ('Admin'),
-- so NOBODY passed the elevated check. 2,093 of 2,493 inspections are locked
-- (every Done one), so a wrong odometer could never be corrected; the edit
-- failed with "This inspection checklist is locked and cannot be edited."
--
-- Fix: case-insensitive role compare + super admins. The allowed-column list
-- and every other line are unchanged. Non-elevated users stay blocked.
-- The approval immutability guard (approval_private.guard_document) is NOT
-- touched: a governed submission that is pending/approved still refuses
-- content edits (0 such rows today).
--
-- VERIFY: as an Admin, updating odometer_km on a locked row succeeds; as a
-- Tyre Man it raises.
-- ROLLBACK: re-create with `COALESCE(v_role,'') NOT IN ('admin','manager','director')`
-- and without the is_super_admin() term.

CREATE OR REPLACE FUNCTION public.lock_inspection_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role    text;
  allowed   text[] := ARRAY['approval_status','approver_email','approver_signature',
                            'approved_at','approved_by','locked','locked_at',
                            'completed_date','linked_action_id','approval_revision','approval_workflow_id','approval_policy_required','approval_outcome'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Done' AND NEW.locked IS NOT TRUE THEN
      NEW.locked := true; NEW.locked_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: auto-lock on transition to Done
  IF NEW.status = 'Done' AND (OLD.status IS DISTINCT FROM 'Done') AND NEW.locked IS NOT TRUE THEN
    NEW.locked := true; NEW.locked_at := now();
  END IF;

  -- Block content edits on a locked checklist for non-elevated users
  IF OLD.locked IS TRUE THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF lower(btrim(COALESCE(v_role,''))) NOT IN ('admin','manager','director')
       AND NOT COALESCE(public.is_super_admin(), false) THEN
      IF (to_jsonb(OLD) - allowed) IS DISTINCT FROM (to_jsonb(NEW) - allowed) THEN
        RAISE EXCEPTION 'This inspection checklist is locked and cannot be edited.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
