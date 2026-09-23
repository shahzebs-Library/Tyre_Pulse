-- Reuse organisations.settings; preserve the existing branding subtree.
-- Coordinated web/mobile rollout required: global tables become platform-only.
-- Historical global values are retained; no unproven tenant ownership is inferred.
create or replace function public.get_organisation_configuration(p_namespace text, p_key text default null)
returns table(key text,value text)
language plpgsql stable security definer set search_path=public
as $$
declare v_org uuid := public.app_current_org(); v_values jsonb;
begin
  if auth.uid() is null or public.app_is_active() is not true or v_org is null then
    raise exception 'Active organisation membership required.' using errcode='42501';
  end if;
  if p_namespace not in ('settings','app_settings') or p_namespace is null then
    raise exception 'Unknown configuration namespace.' using errcode='22023';
  end if;
  select o.settings -> p_namespace into v_values from public.organisations o where o.id=v_org;
  if not found then raise exception 'Organisation unavailable.' using errcode='42501'; end if;
  return query select e.key,e.value from jsonb_each_text(coalesce(v_values,'{}'::jsonb)) e
    where p_key is null or e.key=p_key order by e.key;
end $$;

create or replace function public.save_organisation_configuration(p_namespace text,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.get_my_role();
  v_before jsonb; v_after jsonb; v_patch jsonb; v_count int;
begin
  if auth.uid() is null or public.app_is_active() is not true or v_org is null then
    raise exception 'Active organisation membership required.' using errcode='42501';
  end if;
  if p_namespace is null or p_namespace not in ('settings','app_settings') or
     jsonb_typeof(p_values) is distinct from 'array' then
    raise exception 'Invalid configuration.' using errcode='22023';
  end if;
  v_count:=jsonb_array_length(p_values);
  if v_count<1 or v_count>100 or octet_length(p_values::text)>1048576 then
    raise exception 'Configuration size is invalid.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_values) e where
    jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'key') is distinct from 'string'
    or length(btrim(e->>'key'))=0 or length(e->>'key')>200
    or jsonb_typeof(e->'value') is distinct from 'string'
    or (e - 'key' - 'value') <> '{}'::jsonb) then
    raise exception 'Each configuration entry requires a key and string value.' using errcode='22023';
  end if;
  if (select count(distinct e->>'key') from jsonb_array_elements(p_values) e)<>v_count then
    raise exception 'Duplicate configuration keys.' using errcode='22023';
  end if;
  if public.is_super_admin() is not true and coalesce(v_role,'')<>'Admin' and not (
    coalesce(v_role,'') in ('Integration Admin','Automation') and p_namespace='app_settings'
    and not exists(select 1 from jsonb_array_elements(p_values) e where e->>'key'<>'erp_connection')
  ) then raise exception 'Administrator access required.' using errcode='42501'; end if;
  -- Browser endpoint configuration must never hold signing credentials.
  if p_namespace='app_settings' and exists (
    select 1 from jsonb_array_elements(p_values) e where e->>'key'='webhook_endpoints'
    and exists(select 1 from jsonb_array_elements((e->>'value')::jsonb) endpoint
      where nullif(endpoint->>'secret','') is not null)
  ) then raise exception 'Webhook signing credentials require server-managed storage.' using errcode='22023'; end if;
  select coalesce(o.settings,'{}'::jsonb) into v_before from public.organisations o where o.id=v_org for update;
  if not found then raise exception 'Organisation unavailable.' using errcode='42501'; end if;
  select jsonb_object_agg(e->>'key',e->'value') into v_patch from jsonb_array_elements(p_values) e;
  v_after:=jsonb_set(v_before,array[p_namespace],coalesce(v_before->p_namespace,'{}'::jsonb)||v_patch,true);
  if v_after is distinct from v_before then
    update public.organisations set settings=v_after,updated_at=now() where id=v_org;
    insert into public.audit_log(table_name,record_id,action,old_data,new_data,changed_by,organisation_id,details)
    values('organisations',v_org,'UPDATE',jsonb_build_object(p_namespace,v_before->p_namespace),
      jsonb_build_object(p_namespace,v_after->p_namespace),auth.uid(),v_org,
      jsonb_build_object('operation','tenant_configuration','namespace',p_namespace));
  end if;
  return jsonb_build_object('saved',v_count);
end $$;

revoke all on function public.get_organisation_configuration(text,text) from public,anon;
revoke all on function public.save_organisation_configuration(text,jsonb) from public,anon;
grant execute on function public.get_organisation_configuration(text,text) to authenticated;
grant execute on function public.save_organisation_configuration(text,jsonb) to authenticated;

-- Global rows have no reliable ownership. Only the platform may use this archive.
create or replace function public.guard_organisation_configuration() returns trigger
language plpgsql set search_path=public as $$
begin
  if current_user in ('authenticated','anon') and (
    old.settings->'settings' is distinct from new.settings->'settings' or
    old.settings->'app_settings' is distinct from new.settings->'app_settings'
  ) then raise exception 'Use the audited configuration operation.' using errcode='42501'; end if;
  return new;
end $$;
create trigger guard_organisation_configuration before update of settings on public.organisations
for each row execute function public.guard_organisation_configuration();
revoke all on function public.guard_organisation_configuration() from public,anon,authenticated;
create policy settings_platform_boundary on public.settings as restrictive for all to authenticated
using(public.is_super_admin()) with check(public.is_super_admin());
create policy app_settings_platform_boundary on public.app_settings as restrictive for all to authenticated
using(public.is_super_admin()) with check(public.is_super_admin());
