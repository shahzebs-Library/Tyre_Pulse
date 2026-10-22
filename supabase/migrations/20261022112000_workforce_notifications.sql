-- In-app notification on manager-created workforce assignment.
-- SECURITY DEFINER is limited to a trigger function in a non-exposed schema.
CREATE SCHEMA IF NOT EXISTS workforce_internal;
CREATE OR REPLACE FUNCTION workforce_internal.assignment_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   INSERT INTO public.notifications(user_id,type,title,body,entity_type,entity_id)
   VALUES(NEW.assigned_to,'info','New work assignment',left(NEW.title,240),'workforce_assignment',NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION workforce_internal.assignment_notify() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS workforce_assignment_notify_trigger ON public.workforce_assignments;
CREATE TRIGGER workforce_assignment_notify_trigger AFTER INSERT ON public.workforce_assignments
FOR EACH ROW EXECUTE FUNCTION workforce_internal.assignment_notify();
