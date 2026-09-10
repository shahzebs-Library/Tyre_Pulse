select jsonb_agg(x order by role, organisation_id) from (
  select jsonb_build_object(
    'role', role,
    'organisation_id', organisation_id,
    'approved_unlocked_users', count(*)
  ) as x, role, organisation_id
  from public.profiles
  where organisation_id is not null
    and coalesce(approved, false)
    and coalesce(locked, false) = false
  group by role, organisation_id
) s;
