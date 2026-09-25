-- ============================================================================
-- 20260924123000  Console new-IP / new-device sign-in alerts
-- ============================================================================
-- Every console sign-in is already audited (console_sessions action 'login')
-- and already notifies every super admin (break-glass trigger, 20260924091000).
-- That alert fires on EVERY sign-in, so it cannot tell a routine login from a
-- login made somewhere the admin has never signed in from before.
--
-- This adds a per-admin register of known (IP, browser) pairs and raises a
-- separate WARNING only when a sign-in comes from:
--   * an IP address this admin has never used for the console, or
--   * a browser/device (user-agent hash) this admin has never used.
-- The first ever recorded sign-in for an admin SEEDS the register silently so
-- turning the feature on does not page everybody once.
--
-- IP: read server-side from request headers via public._request_client_ip()
-- (cf-connecting-ip > first x-forwarded-for > x-real-ip, 20260924117000). The
-- client-supplied p_ip is used ONLY when the server sees no header, and the
-- row records which source was used. User-agent: the request header first,
-- the client value as a fallback. Only a sha256 of the lower-cased UA is the
-- identity; a 200-char label is kept for humans.
--
-- Security: table RLS on, super-admin SELECT only, NO write policy. All writes
-- go through SECURITY DEFINER RPCs that refuse non super admins (42501).
-- Grant order (V500): revoke PUBLIC, revoke anon, grant authenticated.
--
-- VERIFY (rolled back): impersonate a super admin, call twice with IP A
-- (first = seeded, second = known, 0 alerts), then IP B (new_ip, one
-- notification per unlocked super admin + one warning system_logs row).
-- ROLLBACK:
--   drop function if exists public.console_forget_device(uuid);
--   drop function if exists public.console_list_known_devices();
--   drop function if exists public.console_record_login_device(text, text);
--   drop table if exists public.console_known_devices;
-- ============================================================================

create table if not exists public.console_known_devices (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references public.profiles(id) on delete cascade,
  ip          inet,
  ip_source   text not null default 'header' check (ip_source in ('header','client','unknown')),
  ua_hash     text not null,
  ua_label    text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  login_count integer not null default 1,
  constraint console_known_devices_uniq unique nulls not distinct (admin_id, ip, ua_hash)
);
create index if not exists console_known_devices_admin_idx on public.console_known_devices (admin_id, last_seen desc);

alter table public.console_known_devices enable row level security;
drop policy if exists console_known_devices_super_read on public.console_known_devices;
create policy console_known_devices_super_read on public.console_known_devices
  for select to authenticated using ((select public.is_super_admin()));
revoke all on public.console_known_devices from public, anon;
revoke insert, update, delete, truncate, trigger on public.console_known_devices from authenticated;
grant select on public.console_known_devices to authenticated;

-- ── record a sign-in (called best-effort by the console after sign-in) ──────
create or replace function public.console_record_login_device(p_ip text default null, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_ip      inet;
  v_src     text := 'header';
  v_ua      text;
  v_hash    text;
  v_any     boolean;
  v_new_ip  boolean := false;
  v_new_ua  boolean := false;
  v_id      uuid;
  v_who     text;
  v_title   text;
  v_body    text;
  v_alerted int := 0;
  h         json;
begin
  if v_uid is null or not public.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  v_ip := public._request_client_ip();
  if v_ip is null then
    begin
      v_ip := host(nullif(btrim(coalesce(p_ip, '')), '')::inet)::inet;
      v_src := case when v_ip is null then 'unknown' else 'client' end;
    exception when others then
      v_ip := null; v_src := 'unknown';
    end;
  end if;

  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null;
  end;
  v_ua := nullif(btrim(coalesce(h->>'user-agent', '')), '');
  if v_ua is null then v_ua := nullif(btrim(coalesce(p_user_agent, '')), ''); end if;
  v_ua := left(coalesce(v_ua, 'unknown'), 512);
  v_hash := encode(sha256(convert_to(lower(v_ua), 'UTF8')), 'hex');

  select exists (select 1 from public.console_known_devices where admin_id = v_uid) into v_any;
  if v_any then
    v_new_ip := v_ip is not null
      and not exists (select 1 from public.console_known_devices where admin_id = v_uid and ip = v_ip);
    v_new_ua := not exists (select 1 from public.console_known_devices where admin_id = v_uid and ua_hash = v_hash);
  end if;

  insert into public.console_known_devices (admin_id, ip, ip_source, ua_hash, ua_label)
  values (v_uid, v_ip, v_src, v_hash, left(v_ua, 200))
  on conflict on constraint console_known_devices_uniq do update
    set last_seen = now(), login_count = public.console_known_devices.login_count + 1
  returning id into v_id;

  if v_new_ip or v_new_ua then
    select coalesce(full_name, email, v_uid::text) into v_who from public.profiles where id = v_uid;
    v_title := case
      when v_new_ip and v_new_ua then 'Console sign-in from a new device and IP address'
      when v_new_ip then 'Console sign-in from a new IP address'
      else 'Console sign-in from a new device' end;
    v_body := coalesce(v_who, 'Unknown') || ' signed in from '
      || coalesce(host(v_ip), 'an unknown IP') || ' at '
      || to_char(now() at time zone 'Asia/Riyadh', 'DD Mon YYYY HH24:MI') || ' (Riyadh). '
      || 'If this was not them, lock the account and sign it out everywhere.';
    begin
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
      select p.id, 'security', v_title, v_body, 'console_known_device', v_id
        from public.profiles p
       where coalesce(p.is_super_admin, false) and not coalesce(p.locked, false);
      get diagnostics v_alerted = row_count;
      insert into public.system_logs (severity, source, module_id, message, user_id, detail)
      values ('warning', 'new_console_device', 'security_audit', v_title || ' by ' || coalesce(v_who, 'unknown'), v_uid,
              jsonb_build_object('ip', host(v_ip), 'ip_source', v_src, 'new_ip', v_new_ip,
                                 'new_device', v_new_ua, 'device_id', v_id, 'user_agent', left(v_ua, 200)));
      insert into public.console_sessions (admin_id, action, target_id, target_type, details, ip_address)
      values (v_uid, 'new_device_login', v_id, 'console_known_device',
              jsonb_build_object('new_ip', v_new_ip, 'new_device', v_new_ua, 'ip_source', v_src), v_ip);
    exception when others then
      null; -- alerting must never block a sign-in
    end;
  end if;

  return jsonb_build_object('ok', true, 'seeded', not v_any, 'new_ip', v_new_ip,
                            'new_device', v_new_ua, 'alerted', v_alerted, 'device_id', v_id);
end $$;

-- ── list known devices (console page) ───────────────────────────────────────
create or replace function public.console_list_known_devices()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'admin_id', d.admin_id,
             'admin_name', coalesce(p.full_name, p.email, d.admin_id::text),
             'ip', host(d.ip), 'ip_source', d.ip_source, 'ua_label', d.ua_label,
             'first_seen', d.first_seen, 'last_seen', d.last_seen, 'login_count', d.login_count)
           order by d.last_seen desc)
      from public.console_known_devices d
      left join public.profiles p on p.id = d.admin_id), '[]'::jsonb);
end $$;

-- ── forget a device: its next sign-in alerts again ──────────────────────────
create or replace function public.console_forget_device(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.console_known_devices%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  delete from public.console_known_devices where id = p_id returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details, ip_address)
  values (auth.uid(), 'forget_console_device', v_row.admin_id, 'profile',
          jsonb_build_object('device_id', v_row.id, 'ip', host(v_row.ip), 'ua_label', v_row.ua_label),
          public._request_client_ip());
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.console_record_login_device(text, text) from public;
revoke all on function public.console_record_login_device(text, text) from anon;
grant execute on function public.console_record_login_device(text, text) to authenticated;
revoke all on function public.console_list_known_devices() from public;
revoke all on function public.console_list_known_devices() from anon;
grant execute on function public.console_list_known_devices() to authenticated;
revoke all on function public.console_forget_device(uuid) from public;
revoke all on function public.console_forget_device(uuid) from anon;
grant execute on function public.console_forget_device(uuid) to authenticated;
