-- 20261004104000_console_people_controls.sql
--
-- Super-admin controls for the rebuilt People / Organisations / Incidents
-- console pages. Additive only: five new SECURITY DEFINER functions, no table
-- or column change, no existing function replaced.
--
--   admin_list_user_devices()                       every registered phone, with the
--                                                   app it belongs to (Flutter or the
--                                                   retired Expo app). The push token
--                                                   itself is NEVER returned.
--   admin_revoke_user_device(p_device_id, p_reason)  stop push to ONE device (audited)
--   admin_end_support_sessions(p_id, p_reason)       end one support session (any owner)
--                                                   or, with p_id null, every lapsed one
--   admin_delete_empty_org(p_org_id, p_reason)       delete an organisation only when it
--                                                   has no members and no records
--   incident_change_severity(p_id, p_severity, p_reason)  re-grade an open incident,
--                                                   written to its timeline
--
-- Why a definer read for devices: user_devices only lets a user read their own
-- rows (user_devices_select_own), so the console could never see the device
-- list; it read profiles.push_token instead, which is the retired Expo app's
-- single-token column.
--
-- Every function: search_path pinned, console IP allowlist + is_super_admin()
-- checked in the body, EXECUTE revoked from PUBLIC then anon, granted to
-- authenticated. Every write inserts a console_sessions audit row.
--
-- VERIFY (rolled back, impersonating the super admin):
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims','{"sub":"d2d43a5f-0906-4f7a-9577-e36d89164914","role":"authenticated"}',true);
--   select jsonb_array_length(public.admin_list_user_devices());
--   rollback;
-- ROLLBACK:
--   drop function public.admin_list_user_devices();
--   drop function public.admin_revoke_user_device(uuid, text);
--   drop function public.admin_end_support_sessions(uuid, text);
--   drop function public.admin_delete_empty_org(uuid, text);
--   drop function public.incident_change_severity(uuid, text, text);

create or replace function public.admin_list_user_devices()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can list devices' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'user_id', d.user_id,
      'full_name', p.full_name,
      'username', p.username,
      'role', p.role,
      'organisation_id', d.organisation_id,
      'platform', d.platform,
      'app', case
        when d.push_token like 'ExponentPushToken%' then 'retired_expo'
        when d.app_version ~ '^0\.' then 'flutter'
        when d.push_token is not null and d.push_token <> '' then 'flutter'
        else 'unknown' end,
      'app_version', d.app_version,
      'device_tail', case when d.device_id is null or d.device_id = '' then null else right(d.device_id, 4) end,
      'last_seen_at', d.last_seen_at,
      'revoked', coalesce(d.revoked, false),
      'created_at', d.created_at
    ) order by d.last_seen_at desc nulls last, d.id), '[]'::jsonb)
    into v
    from public.user_devices d
    left join public.profiles p on p.id = d.user_id;
  return v;
end $$;

create or replace function public.admin_revoke_user_device(p_device_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row public.user_devices%rowtype;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can stop push to a device' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  update public.user_devices set revoked = true
   where id = p_device_id and not coalesce(revoked, false)
  returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found_or_already_stopped');
  end if;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'revoke_user_device', v_row.user_id, 'user_device',
          jsonb_build_object('device_id', v_row.id, 'reason', v_reason,
            'app', case when v_row.push_token like 'ExponentPushToken%' then 'retired_expo' else 'flutter' end));
  return jsonb_build_object('ok', true, 'user_id', v_row.user_id);
end $$;

create or replace function public.admin_end_support_sessions(p_id uuid default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ids uuid[];
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can end support sessions' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  with ended as (
    update public.support_sessions
       set active = false, ended_at = coalesce(ended_at, now())
     where ended_at is null and active
       and (case when p_id is not null then id = p_id else expires_at is not null and expires_at <= now() end)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from ended;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), case when p_id is null then 'support_sessions_close_lapsed' else 'support_session_force_end' end,
          p_id, 'support_session',
          jsonb_build_object('reason', v_reason, 'ended', cardinality(v_ids), 'ids', to_jsonb(v_ids)));
  return jsonb_build_object('ok', true, 'ended', cardinality(v_ids));
end $$;

create or replace function public.admin_delete_empty_org(p_org_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_hit boolean;
  v_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can delete an organization' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select name into v_name from public.organisations where id = p_org_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if exists (select 1 from public.profiles where org_id = p_org_id or organisation_id = p_org_id) then
    return jsonb_build_object('ok', false, 'reason', 'has_members');
  end if;
  for r in
    select c.table_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'organisation_id'
       and t.table_type = 'BASE TABLE' and c.table_name not in ('organisations', 'profiles')
       and c.table_name !~ '(audit|_log$|_logs$|_log_|^system_logs$|_events$|^notifications$|_sessions$)'
  loop
    if r.data_type = 'uuid' then
      execute format('select exists (select 1 from public.%I where organisation_id = $1)', r.table_name)
        into v_hit using p_org_id;
    else
      execute format('select exists (select 1 from public.%I where organisation_id::text = $1)', r.table_name)
        into v_hit using p_org_id::text;
    end if;
    if v_hit then
      return jsonb_build_object('ok', false, 'reason', 'has_records', 'table', r.table_name);
    end if;
  end loop;
  begin
    delete from public.organisations where id = p_org_id;
  exception when foreign_key_violation then
    return jsonb_build_object('ok', false, 'reason', 'referenced');
  end;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'delete_org', p_org_id, 'organisation', jsonb_build_object('name', v_name, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.incident_change_severity(p_id uuid, p_severity text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to text := lower(btrim(coalesce(p_severity, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_inc public.platform_incidents%rowtype;
  v_upd uuid;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change incident severity' using errcode = '42501';
  end if;
  if v_to not in ('sev1', 'sev2', 'sev3', 'sev4') then
    raise exception 'Unknown severity' using errcode = '22023';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'A reason of 5 to 500 characters is required' using errcode = '22023';
  end if;
  select * into v_inc from public.platform_incidents where id = p_id for update;
  if not found then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;
  if v_inc.status = 'resolved' then
    raise exception 'A resolved incident cannot be re-graded' using errcode = '22023';
  end if;
  if v_inc.severity = v_to then
    return jsonb_build_object('ok', false, 'reason', 'unchanged');
  end if;
  update public.platform_incidents set severity = v_to where id = p_id;
  insert into public.platform_incident_updates (incident_id, status, message, author)
  values (p_id, v_inc.status,
          'Severity changed from ' || upper(v_inc.severity) || ' to ' || upper(v_to) || '. Reason: ' || v_reason,
          auth.uid())
  returning id into v_upd;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'incident_severity', p_id, 'platform_incident',
          jsonb_build_object('from', v_inc.severity, 'to', v_to, 'reason', v_reason, 'update_id', v_upd));
  return jsonb_build_object('ok', true, 'from', v_inc.severity, 'to', v_to);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_list_user_devices()',
    'public.admin_revoke_user_device(uuid, text)',
    'public.admin_end_support_sessions(uuid, text)',
    'public.admin_delete_empty_org(uuid, text)',
    'public.incident_change_severity(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
