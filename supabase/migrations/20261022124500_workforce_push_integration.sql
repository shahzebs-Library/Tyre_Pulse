-- Queue workforce-assignment push in the EXISTING workflow-notify pipeline.
-- The in-app notification remains the source of record even if push fails.
CREATE OR REPLACE FUNCTION workforce_internal.assignment_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_tokens jsonb; v_event bigint;
BEGIN
  INSERT INTO public.notifications(user_id,type,title,body,entity_type,entity_id)
  VALUES(NEW.assigned_to,'info','New work assignment',left(NEW.title,240),
         'workforce_assignment',NEW.id);
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', NEW.assigned_to, 'push_token', tok)), '[]'::jsonb)
      INTO v_tokens FROM public._user_push_tokens(NEW.assigned_to) tok;
    IF jsonb_array_length(v_tokens)>0 THEN
      INSERT INTO public.domain_events(
        event_type,entity_type,entity_id,organisation_id,actor_id,payload,status)
      VALUES('workforce.assignment_push','workforce_assignment',NEW.id::text,
             NEW.organisation_id,NEW.assigned_by,
             jsonb_build_object('assignment_id',NEW.id),'processed')
      RETURNING id INTO v_event;
      INSERT INTO public.workflow_notifications(
        event_id,organisation_id,instance_id,event_type,payload,
        recipient_count,status)
      VALUES(v_event,NEW.organisation_id,NULL,'workforce.assignment_push',
             jsonb_build_object(
               'event_type','workforce.assignment_push',
               'entity_type','workforce_assignment',
               'entity_id',NEW.id,
               'link','/workforce-daily',
               'push',jsonb_build_object('title','New work assignment',
                                        'body',left(NEW.title,240)),
               'recipients',v_tokens),
             jsonb_array_length(v_tokens),'pending');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Workforce assignment push could not be enqueued';
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION workforce_internal.assignment_notify()
 FROM PUBLIC,anon,authenticated;
