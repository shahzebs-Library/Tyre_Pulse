-- V237: new users land cleanly in Company A + their region as country, still
-- approval-gated (approved=false). Previously org_id came from the column default
-- (Company A) but organisation_id and country were left NULL, so a newly-APPROVED
-- user would see ALL countries. Now both org columns are set and country = [region],
-- so once an admin approves the user they see only their country's data.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  v_region text := coalesce(nullif(new.raw_user_meta_data->>'region',''), 'KSA');
begin
  insert into public.profiles (id, username, full_name, role, region, employee_id, email,
                               org_id, organisation_id, country, approved)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'full_name',
    'Reporter',
    v_region,
    nullif(new.raw_user_meta_data->>'employee_id',''),
    new.email,
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    ARRAY[v_region],
    false
  )
  on conflict (id) do nothing;
  return new;
end $function$;
