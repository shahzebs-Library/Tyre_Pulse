-- LIVE definitions copied from production (project jhssdmeruxtrlqnwfksc) on 2026-11-12 with
-- pg_get_functiondef, used by supabase/tests/current_prod_*.test.mjs so the drafts in
-- supabase/pending_migrations/20261113130000_cur_* are exercised against the real bodies.
-- md5(prosrc) of app_user_can at copy time: df5b4f662cb0822453a8be753da453db.
-- Do not edit: re-copy from production if the live function changes.

CREATE OR REPLACE FUNCTION public.app_user_can(p_key text, p_cap text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_role text; v_super boolean := false;
  v_cap text := coalesce(nullif(btrim(p_cap), ''), 'view');
  v_default boolean := false; v_revoked boolean; v_granted boolean;
  v_json jsonb; v_ov jsonb;
begin
  if v_uid is null then return false; end if;
  select role, coalesce(is_super_admin, false) into v_role, v_super
    from public.profiles
   where id = v_uid
     and coalesce(approved, true) = true
     and coalesce(locked, false) = false;
  if not found then return false; end if;

  if v_super is true or v_role = 'Admin' then return true; end if;
  if v_cap = 'delete' then return false; end if;

  if v_cap = 'view' then
    v_default := coalesce((
      select enabled from public.module_permissions
       where org_id is null and role = v_role and module_key = p_key
       order by updated_at desc nulls last limit 1
    ), false);
  else
    begin
      select (settings->'app_settings'->>'permission_overrides')::jsonb into v_json from public.organisations where id=public.app_current_org();
      v_ov := coalesce(v_json -> 'overrides', v_json);
      v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, false);
    exception when others then v_default := false;
    end;
  end if;

  v_revoked := exists (
    select 1 from public.user_access_grants g
     where g.user_id = v_uid and g.module_key = p_key and g.capability = v_cap
       and g.effect = 'revoke' and (g.expires_at is null or g.expires_at > now())
  );
  if v_revoked then return false; end if;
  if v_default then return true; end if;
  v_granted := exists (
    select 1 from public.user_access_grants g
     where g.user_id = v_uid and g.module_key = p_key and g.capability = v_cap
       and g.effect = 'grant' and (g.expires_at is null or g.expires_at > now())
  );
  return v_granted;
end;
$function$
;
