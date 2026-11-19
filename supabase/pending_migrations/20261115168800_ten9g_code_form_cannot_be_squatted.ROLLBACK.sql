-- ROLLBACK for 20261115168800_ten9g_code_form_cannot_be_squatted.sql
-- Restores _resolve_sign_in_profile exactly as it stands before TEN-9g (staging copy of
-- production, md5 of pg_get_functiondef = 1ee66847b3d067fd171305fa7de11233; compare with
-- production before applying TEN-9g) and removes the name guard. No data is touched.
begin;
drop trigger if exists trg_guard_profile_sign_in_names on public.profiles;
drop function if exists public.guard_profile_sign_in_names();
CREATE OR REPLACE FUNCTION public._resolve_sign_in_profile(p_identifier text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id text := lower(btrim(coalesce(p_identifier, '')));
  v_legacy uuid := public._legacy_config_org();
  v_ids uuid[]; v_pick uuid; v_code text; v_name text; v_org uuid;
begin
  if v_id = '' then return null; end if;

  -- Step 1: exactly as typed, every company. Username first, then employee id.
  select array_agg(p.id) into v_ids from public.profiles p where lower(p.username) = v_id;
  if v_ids is null then
    select array_agg(p.id) into v_ids from public.profiles p where lower(p.employee_id) = v_id;
  end if;
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  if cardinality(v_ids) > 1 then
    select p.id into v_pick from public.profiles p where p.id = any (v_ids) and p.org_id = v_legacy;
    if found and (select count(*) from public.profiles p where p.id = any (v_ids) and p.org_id = v_legacy) = 1 then
      return v_pick;
    end if;
    return null;                     -- ambiguous outside the legacy company: the code is required
  end if;

  -- Step 2: "<company code>/<name>", inside that company only.
  select s.company_code, lower(s.name) into v_code, v_name from public._split_sign_in_identifier(p_identifier) s;
  if v_code is null or v_name is null then return null; end if;
  v_org := public._org_by_code(v_code);
  if v_org is null then return null; end if;
  select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.username) = v_name limit 1;
  if v_pick is null then
    select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.employee_id) = v_name limit 1;
  end if;
  return v_pick;
end $function$;
commit;
