-- "Mark reviewed" also records the form approver when none was ever captured
-- (published versions created before 20261108140000 have no named approver).
create or replace function public.mark_checklist_form_reviewed(p_template_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_row public.checklist_templates;
begin
  if not (public.get_my_role() = any (array['Admin','Manager','Director','Maintenance Supervisor']) or public.is_super_admin()) then
    raise exception 'You do not have permission to review checklist forms' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(full_name), ''), username, email) into v_name from public.profiles where id = auth.uid();
  update public.checklist_templates
     set last_reviewed_at = now(), last_reviewed_by = auth.uid(), last_reviewed_name = v_name,
         form_approved_by = coalesce(form_approved_by, auth.uid()),
         form_approved_name = coalesce(form_approved_name, v_name),
         form_approved_at = case when form_approved_name is null then now() else form_approved_at end
   where id = p_template_id and organisation_id is not distinct from public.app_current_org()
  returning * into v_row;
  if not found then raise exception 'Checklist form not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'last_reviewed_at', v_row.last_reviewed_at, 'last_reviewed_name', v_row.last_reviewed_name);
end $$;
revoke all on function public.mark_checklist_form_reviewed(uuid) from public;
revoke all on function public.mark_checklist_form_reviewed(uuid) from anon;
grant execute on function public.mark_checklist_form_reviewed(uuid) to authenticated, service_role;
