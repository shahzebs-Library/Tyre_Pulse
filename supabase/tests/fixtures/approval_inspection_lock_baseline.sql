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
                            'completed_date','linked_action_id'];
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
    IF COALESCE(v_role,'') NOT IN ('admin','manager','director') THEN
      IF (to_jsonb(OLD) - allowed) IS DISTINCT FROM (to_jsonb(NEW) - allowed) THEN
        RAISE EXCEPTION 'This inspection checklist is locked and cannot be edited.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
