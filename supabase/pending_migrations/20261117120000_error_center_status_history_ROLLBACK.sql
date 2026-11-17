-- ROLLBACK for 20261117120000_error_center_status_history.sql
-- Restores the four function bodies exactly as they were (md5 42fa2d7c / 5c262e9c / 61f89efa / d7c8fb45),
-- drops the new read/resolve RPCs and the history trigger. The history table is KEPT on purpose: it is
-- an audit record (immutable). Drop it only with the owner's explicit approval.
begin;
drop trigger if exists trg_error_group_state_history on public.error_group_state;
drop function if exists public.log_error_group_state_change();
drop function if exists public.resolve_system_log_groups(uuid[], text, text, text);
drop function if exists public.system_log_open_counts(timestamptz);
drop function if exists public.list_system_logs_with_status(text, text, text, timestamptz, int);
drop function if exists public.error_group_status(text);
CREATE OR REPLACE FUNCTION public.error_group_regression()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    update public.error_group_state
       set status = 'for_review', regressed_at = now(), updated_at = now(),
           note = left(coalesce(note || ' | ', '') || 'Came back after it was closed', 500)
     where group_key = public.system_log_group_key(new.source, new.message, new.error_fingerprint)
       and status in ('resolved', 'fixed_in_code')
       and coalesce(resolved_at, updated_at) < new.created_at;
  exception when others then
    null;
  end;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_error_groups(p_keys text[], p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int := 0;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can resolve errors' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to resolve error groups' using errcode = '22023';
  end if;
  if p_keys is null or cardinality(p_keys) = 0 then
    return jsonb_build_object('ok', true, 'resolved', 0);
  end if;
  if cardinality(p_keys) > 500 then
    raise exception 'Resolve at most 500 groups at a time' using errcode = '22023';
  end if;

  insert into public.error_group_state as s (group_key, status, note, resolved_at, updated_at, updated_by)
  select distinct k, 'resolved', left(p_reason, 500), now(), now(), auth.uid()
  from unnest(p_keys) k where nullif(btrim(k), '') is not null
  on conflict (group_key) do update set status = 'resolved', note = left(p_reason, 500),
    resolved_at = now(), updated_at = now(), updated_by = auth.uid();
  get diagnostics v_n = row_count;

  perform public.log_console_event('error_groups_resolve', null, 'error_group',
    jsonb_build_object('count', v_n, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'resolved', v_n);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_system_logs(p_module text DEFAULT NULL::text, p_severity text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer; v_org uuid := public.app_current_org();
BEGIN
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;

  IF NOT (public.is_super_admin() OR public.get_my_role() = 'Admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.system_logs SET resolved = true, resolved_by = auth.uid(), resolved_at = now()
  WHERE resolved = false
    AND (organisation_id IS NOT DISTINCT FROM v_org)
    AND (p_module IS NULL OR module_id = p_module)
    AND (p_severity IS NULL OR severity = p_severity);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $function$
;
CREATE OR REPLACE FUNCTION public.set_error_group_state(p_key text, p_status text DEFAULT NULL::text, p_owner uuid DEFAULT NULL::uuid, p_version text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_notify boolean DEFAULT NULL::boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old public.error_group_state;
  v_status text;
  v_notified int := 0;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can triage errors' using errcode = '42501';
  end if;
  if nullif(btrim(p_key), '') is null then
    raise exception 'Choose an error group first' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('for_review','reviewed','fixed_in_code','resolved','ignored','routine') then
    raise exception 'That status is not recognised' using errcode = '22023';
  end if;
  if p_status in ('resolved','ignored') and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to resolve or ignore an error group' using errcode = '22023';
  end if;

  select * into v_old from public.error_group_state where group_key = p_key;
  v_status := coalesce(p_status, v_old.status, 'for_review');
  if p_owner is not null and p_status is null and v_status = 'for_review' then v_status := 'reviewed'; end if;

  insert into public.error_group_state as s (group_key, status, owner_id, resolved_in_version, note, notify_when_fixed,
                                             resolved_at, updated_at, updated_by)
  values (p_key, v_status, p_owner, nullif(btrim(p_version), ''), nullif(btrim(p_note), ''), coalesce(p_notify, false),
          case when v_status = 'resolved' then now() end, now(), auth.uid())
  on conflict (group_key) do update set
    status = v_status,
    owner_id = coalesce(p_owner, s.owner_id),
    resolved_in_version = coalesce(nullif(btrim(p_version), ''), s.resolved_in_version),
    note = coalesce(nullif(btrim(p_note), ''), s.note),
    notify_when_fixed = coalesce(p_notify, s.notify_when_fixed),
    resolved_at = case when v_status = 'resolved' then now() when v_status in ('for_review','reviewed') then null else s.resolved_at end,
    updated_at = now(), updated_by = auth.uid();

  if v_status = 'resolved' and coalesce(p_notify, v_old.notify_when_fixed, false)
     and (v_old.notified_at is null) then
    insert into public.notifications (user_id, type, title, body, entity_type)
    select distinct l.user_id, 'system', 'A problem you hit has been fixed',
      'An error you ran into has been fixed' ||
        coalesce(' in version ' || nullif(btrim(coalesce(p_version, v_old.resolved_in_version)), ''), '') ||
        '. Reload the app to get the fix.',
      'error_group'
    from public.system_logs l
    where l.user_id is not null
      and public.system_log_group_key(l.source, l.message, l.error_fingerprint) = p_key;
    get diagnostics v_notified = row_count;
    update public.error_group_state set notified_at = now() where group_key = p_key;
  end if;

  perform public.log_console_event('error_group_state', null, 'error_group',
    jsonb_build_object('group_key', left(p_key, 300), 'from', v_old.status, 'to', v_status,
      'owner_id', p_owner, 'version', p_version, 'notify', p_notify, 'reason', p_reason, 'notified', v_notified));

  return jsonb_build_object('ok', true, 'status', v_status, 'notified', v_notified);
end;
$function$
;
-- error_group_state.last_reason is left in place (harmless, nullable); drop with:
--   alter table public.error_group_state drop column last_reason;
commit;
