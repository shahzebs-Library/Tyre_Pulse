-- Reassignment / shift handover notifies the new assignee (in-app + phone push) and tells the previous
-- assignee in-app that the work moved. Before this, only INSERT notified, so a handed-over task reached
-- its new owner silently.
-- STATUS: APPLIED LIVE 2026-11-09 (migration workforce_reassign_notify).
-- Same delivery path as workforce_internal.assignment_notify (notifications + domain_events +
-- workflow_notifications -> V119 deliverer -> workflow-notify). Never blocks the reassignment.
-- ROLLBACK: drop trigger workforce_assignment_reassign_notify on public.workforce_assignments;
--           drop function workforce_internal.assignment_reassign_notify();

CREATE OR REPLACE FUNCTION workforce_internal.assignment_reassign_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_tokens jsonb; v_event bigint;
BEGIN
  BEGIN
    INSERT INTO public.notifications(user_id,type,title,body,entity_type,entity_id)
    VALUES(NEW.assigned_to,'info','Work handed over to you',left(NEW.title,240),'workforce_assignment',NEW.id);
    IF OLD.assigned_to IS NOT NULL THEN
      INSERT INTO public.notifications(user_id,type,title,body,entity_type,entity_id)
      VALUES(OLD.assigned_to,'info','Work reassigned to a colleague',left(NEW.title,240),'workforce_assignment',NEW.id);
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id',NEW.assigned_to,'push_token',tok)),'[]'::jsonb)
      INTO v_tokens FROM public._user_push_tokens(NEW.assigned_to) tok;
    IF jsonb_array_length(v_tokens)>0 THEN
      INSERT INTO public.domain_events(event_type,entity_type,entity_id,organisation_id,actor_id,payload,status)
      VALUES('workforce.assignment_push','workforce_assignment',NEW.id::text,NEW.organisation_id,auth.uid(),
             jsonb_build_object('assignment_id',NEW.id,'reassigned',true),'processed')
      RETURNING id INTO v_event;
      INSERT INTO public.workflow_notifications(event_id,organisation_id,instance_id,event_type,payload,recipient_count,status)
      VALUES(v_event,NEW.organisation_id,NULL,'workforce.assignment_push',
             jsonb_build_object('event_type','workforce.assignment_push','entity_type','workforce_assignment',
               'entity_id',NEW.id,'link','/workforce-daily',
               'push',jsonb_build_object('title','Work handed over to you','body',left(NEW.title,240)),
               'recipients',v_tokens),
             jsonb_array_length(v_tokens),'pending');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Workforce reassignment notification could not be enqueued';
  END;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION workforce_internal.assignment_reassign_notify() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER workforce_assignment_reassign_notify
AFTER UPDATE OF assigned_to ON public.workforce_assignments
FOR EACH ROW WHEN (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to)
EXECUTE FUNCTION workforce_internal.assignment_reassign_notify();
