-- The mobile workshop checklist identifies the asset through the linked fleet
-- record. A second free-text chassis / serial field is both redundant and
-- error-prone, so remove that single field from every version of this named
-- template without relying on generated template UUIDs.
update public.checklist_templates as template
set
  fields = (
    select coalesce(
      jsonb_agg(entry.value order by entry.ordinality),
      '[]'::jsonb
    )
    from jsonb_array_elements(coalesce(template.fields, '[]'::jsonb))
      with ordinality as entry(value, ordinality)
    where entry.value ->> 'id' <> 'f_ws_chassis'
  ),
  updated_at = now()
where template.name = 'Workshop Daily Checklist'
  and exists (
    select 1
    from jsonb_array_elements(coalesce(template.fields, '[]'::jsonb)) as field
    where field ->> 'id' = 'f_ws_chassis'
  );
