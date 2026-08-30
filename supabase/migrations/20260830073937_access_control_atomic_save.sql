-- Atomic role-matrix writer. Keeps legacy view rows and capability overrides
-- in one transaction so the UI can never report a half-saved policy.
create or replace function public.save_access_control_matrix(
  p_view_changes jsonb default '[]'::jsonb,
  p_capability_envelope text default null,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_role text; v_super boolean := false;
  v_item jsonb; v_target_role text; v_module text; v_enabled boolean;
  v_count integer := 0; v_old text; v_envelope jsonb;
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select role, coalesce(is_super_admin, false) into v_role, v_super
    from public.profiles where id = v_uid
      and coalesce(approved, true) = true and coalesce(locked, false) = false;
  if v_role is distinct from 'Admin' and v_super is not true then
    raise exception 'Only an Admin can change access control.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_view_changes, '[]'::jsonb)) <> 'array' then
    raise exception 'p_view_changes must be a JSON array.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_view_changes, '[]'::jsonb)) loop
    v_target_role := nullif(btrim(v_item ->> 'role'), '');
    v_module := nullif(btrim(v_item ->> 'module_key'), '');
    if v_target_role is null or v_module is null or length(v_target_role) > 100
       or length(v_module) > 160 or not (v_item ? 'enabled')
       or jsonb_typeof(v_item -> 'enabled') <> 'boolean' then
      raise exception 'Invalid role permission change.' using errcode = '22023';
    end if;
    v_enabled := (v_item ->> 'enabled')::boolean;
    if v_target_role = 'Admin' then v_enabled := true; end if;
    update public.module_permissions set enabled = v_enabled, updated_by = v_uid, updated_at = now()
      where org_id is null and role = v_target_role and module_key = v_module;
    if not found then
      insert into public.module_permissions(module_key, role, org_id, enabled, updated_by, updated_at)
      values (v_module, v_target_role, null, v_enabled, v_uid, now());
    end if;
    v_count := v_count + 1;
  end loop;

  if p_capability_envelope is not null then
    begin v_envelope := p_capability_envelope::jsonb;
    exception when others then raise exception 'Capability settings must be valid JSON.' using errcode = '22023'; end;
    if jsonb_typeof(v_envelope) <> 'object'
       or jsonb_typeof(coalesce(v_envelope -> 'overrides', '{}'::jsonb)) <> 'object' then
      raise exception 'Invalid capability settings envelope.' using errcode = '22023';
    end if;
    select value into v_old from public.app_settings where key = 'permission_overrides';
    insert into public.app_settings(key, value, description, updated_by, updated_at)
    values ('permission_overrides', p_capability_envelope,
            'Role capability overrides managed by Master Access Control', v_uid, now())
    on conflict (key) do update set value = excluded.value, description = excluded.description,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    if v_old is distinct from p_capability_envelope then
      insert into public.access_audit(actor, actor_email, action, entity, before, after)
      values (v_uid, public.access_audit_actor_email(), 'UPDATE', 'capability_matrix',
        jsonb_build_object('value', case when v_old is null then null else v_old::jsonb end),
        jsonb_build_object('value', v_envelope, 'reason', nullif(btrim(p_reason), '')));
    end if;
  end if;
  return jsonb_build_object('view_changes', v_count, 'capabilities_saved', p_capability_envelope is not null);
end;
$$;
revoke all on function public.save_access_control_matrix(jsonb, text, text) from public, anon;
grant execute on function public.save_access_control_matrix(jsonb, text, text) to authenticated;

-- Custom-role administration must recognise the verified super-admin flag at
-- the database boundary, not only in React. Ordinary users retain SELECT only.
drop policy if exists custom_roles_insert on public.custom_roles;
create policy custom_roles_insert on public.custom_roles for insert to authenticated
  with check (public.get_my_role() = 'Admin' or public.is_super_admin());
drop policy if exists custom_roles_update on public.custom_roles;
create policy custom_roles_update on public.custom_roles for update to authenticated
  using (public.get_my_role() = 'Admin' or public.is_super_admin())
  with check (public.get_my_role() = 'Admin' or public.is_super_admin());
drop policy if exists custom_roles_delete on public.custom_roles;
create policy custom_roles_delete on public.custom_roles for delete to authenticated
  using (public.get_my_role() = 'Admin' or public.is_super_admin());

-- Never remove a role while people still use it. This closes the direct-API
-- bypass around the UI's assigned-user check and prevents orphaned profiles.
create or replace function public.guard_custom_role_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.profiles p
     where p.role = old.name
       and p.organisation_id is not distinct from old.organisation_id
  ) then
    raise exception 'Reassign every user before deleting this role.' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function public.guard_custom_role_delete() from public, anon, authenticated;
drop trigger if exists trg_guard_custom_role_delete on public.custom_roles;
create trigger trg_guard_custom_role_delete before delete on public.custom_roles
  for each row execute function public.guard_custom_role_delete();

-- Destructive data operations are a fixed privileged boundary. A role default
-- or per-user grant can never elevate a non-admin to DELETE.
create or replace function public.app_user_can(p_key text, p_cap text)
returns boolean language plpgsql stable security definer set search_path = public as $$
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
      select value::jsonb into v_json from public.app_settings
       where key = 'permission_overrides' limit 1;
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
$$;
revoke all on function public.app_user_can(text, text) from public, anon;
grant execute on function public.app_user_can(text, text) to authenticated;
