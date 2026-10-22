-- Workforce assignment execution: self-service acknowledgement and controlled transitions.
CREATE POLICY workforce_assignments_employee_update ON public.workforce_assignments
FOR UPDATE TO authenticated
USING(assigned_to=auth.uid() AND status IN ('assigned','acknowledged','in_progress','blocked'))
WITH CHECK(assigned_to=auth.uid() AND status IN ('acknowledged','in_progress','blocked','submitted'));
CREATE OR REPLACE FUNCTION public.workforce_assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE is_manager boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
   is_manager=public.app_is_org_admin();
   IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
   THEN RAISE EXCEPTION 'Assignment ownership is immutable'; END IF;
   IF NOT is_manager THEN
     IF OLD.status='assigned' AND NEW.status NOT IN ('acknowledged','in_progress') OR
        OLD.status='acknowledged' AND NEW.status NOT IN ('in_progress','blocked') OR
        OLD.status='in_progress' AND NEW.status NOT IN ('blocked','submitted') OR
        OLD.status='blocked' AND NEW.status NOT IN ('in_progress','submitted')
     THEN RAISE EXCEPTION 'Invalid employee assignment transition'; END IF;
     IF ROW(NEW.title,NEW.instructions,NEW.site,NEW.priority,NEW.due_at,NEW.estimated_minutes,NEW.source_module,NEW.source_record_id,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.title,OLD.instructions,OLD.site,OLD.priority,OLD.due_at,OLD.estimated_minutes,OLD.source_module,OLD.source_record_id,OLD.created_at)
     THEN RAISE EXCEPTION 'Employees may change status only'; END IF;
   END IF;
   NEW.updated_at=now();
 END IF;
 RETURN NEW;
END $$;
