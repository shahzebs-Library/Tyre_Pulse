-- Applied live to Tyre_pulse: jhssdmeruxtrlqnwfksc on 2026-10-22.
-- A validated, authenticated employee-only task transition RPC.
-- Safe to reapply (CREATE OR REPLACE); does not change existing task schema.
CREATE OR REPLACE FUNCTION public.tp_employee_action_transition(p_action_id uuid, p_status text, p_reason text DEFAULT NULL::text, p_resolution text DEFAULT NULL::text)
 RETURNS action_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_old public.action_items; v_updated public.action_items; v_next text:=lower(btrim(coalesce(p_status,'')));
begin
 if auth.uid() is null then raise exception 'Sign-in required' using errcode='42501'; end if;
 if v_next not in ('acknowledged','in_progress','blocked','resolved') then raise exception 'Invalid transition' using errcode='22023'; end if;
 select * into v_old from public.action_items a
 where a.id=p_action_id and a.assigned_user_id=auth.uid()
   and a.organisation_id=public.app_current_org() for update;
 if not found then raise exception 'Action not assigned or inaccessible' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles p where p.id=auth.uid()
   and (p.organisation_id=v_old.organisation_id or p.org_id=v_old.organisation_id)
   and coalesce(p.approved,true) and not coalesce(p.locked,false)) then
   raise exception 'Inactive employee account' using errcode='42501';
 end if;
 if not (
  (v_old.status='open' and v_next in ('acknowledged','in_progress','blocked')) or
  (v_old.status='acknowledged' and v_next in ('in_progress','blocked')) or
  (v_old.status='in_progress' and v_next in ('blocked','resolved')) or
  (v_old.status='blocked' and v_next='in_progress')
 ) then raise exception 'Disallowed state transition' using errcode='22023'; end if;
 if v_next='blocked' and length(btrim(coalesce(p_reason,'')))<5 then
  raise exception 'Block reason required' using errcode='22023'; end if;
 if v_next='resolved' and length(btrim(coalesce(p_resolution,'')))<10 then
  raise exception 'Completion details required' using errcode='22023'; end if;
 update public.action_items set status=v_next,
   blocked_reason=case when v_next='blocked' then left(btrim(p_reason),4000) else blocked_reason end,
   resolution=case when v_next='resolved' then left(btrim(p_resolution),4000) else resolution end,
   completed_at=case when v_next='resolved' then now() else completed_at end,
   updated_at=now()
 where id=p_action_id returning * into v_updated;
 return v_updated;
end $function$
;
REVOKE ALL ON FUNCTION public.tp_employee_action_transition(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tp_employee_action_transition(uuid,text,text,text) TO authenticated;
