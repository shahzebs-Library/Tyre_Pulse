-- Faults are classified with the legend saved on the record (template_snapshot),
-- falling back to the current form only for records without a snapshot (Codex P1, PR #469).
create or replace function public._raise_checklist_corrective_actions(p_submission_id uuid, p_dry_run boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  s public.checklist_submissions;
  v_blocking jsonb; v_fields jsonb; v_tname text;
  a record; v_label text; v_n integer := 0;
begin
  select * into s from public.checklist_submissions where id = p_submission_id;
  if not found then return 0; end if;
  select coalesce(s.template_snapshot #> '{option_sets,legend,blocking}', t.option_sets #> '{legend,blocking}'),
         coalesce(s.template_snapshot->'fields', t.fields), t.name
    into v_blocking, v_fields, v_tname
    from public.checklist_templates t where t.id = s.template_id;
  if v_blocking is null or jsonb_typeof(v_blocking) <> 'array' then return 0; end if;

  for a in select key, value from jsonb_each_text(coalesce(s.answers, '{}'::jsonb))
            where jsonb_exists(v_blocking, value) loop
    v_label := public.checklist_field_label(v_fields, a.key);
    continue when exists (
      select 1 from public.corrective_actions c
       where c.source_type = 'checklist' and c.source_id = s.id and c.source_detail = v_label);
    v_n := v_n + 1;
    if not p_dry_run then
      insert into public.corrective_actions
        (organisation_id, title, description, priority, status, site, asset_no, country, region,
         source_type, source_id, source_detail, created_by)
      values
        (s.organisation_id,
         left('Checklist fault: ' || v_label || ' (' || coalesce(s.document_no, v_tname, 'checklist') || ')', 240),
         'Recorded "' || a.value || '" on ' || coalesce(v_tname, 'a checklist')
           || coalesce(' ' || s.document_no, '')
           || coalesce(' for asset ' || s.asset_no, '')
           || ' on ' || to_char(coalesce(s.submitted_at, s.created_at), 'YYYY-MM-DD') || '.',
         'High', 'Open', s.site, s.asset_no, coalesce(s.country, 'KSA'), coalesce(s.country, 'KSA'),
         'checklist', s.id, v_label, s.submitted_by);
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public._raise_checklist_corrective_actions(uuid, boolean) from public;
revoke all on function public._raise_checklist_corrective_actions(uuid, boolean) from anon, authenticated;
