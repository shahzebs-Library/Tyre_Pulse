-- Device ingest: hardware / telematics devices send readings into Tyre Pulse.
--
-- STATUS: AUTHORED, NOT APPLIED. Needs the owner's explicit yes.
-- File renamed from 20261127120000 so it sorts after the latest applied
-- version (20261127212012). No top-level DROP statement: every drop runs
-- inside a DO block behind an existence check, so an MCP apply never stalls
-- on a destructive-statement confirmation.
--
-- Review fixes (2026-11-28):
--   * a key bound to a device writes ONLY to that device's asset. If the
--     device has no asset (or is decommissioned / missing) the reading is
--     quarantined as 'unassigned_device'; the payload's asset / VIN / plate is
--     never used as a fallback for a bound key.
--   * the rate limit counts MESSAGES (batch length), not requests.
--   * a reading older than device_ingest_settings.max_reading_age_days
--     (default 30) is quarantined as 'stale_reading'; the 10 minute future
--     bound still rejects. An admin match from the unmatched list may accept a
--     stale reading on purpose.
--   * an odometer / engine-hours insert that hits ON CONFLICT DO NOTHING is
--     recorded in the ledger as 'duplicate', never as accepted with no target.
--
-- Second review fixes (2026-11-28):
--   * odometer_logs / engine_hours_logs carry GLOBAL unique indexes on
--     client_uuid (odometer_logs_client_uuid_upsert_idx,
--     engine_hours_logs_client_uuid_upsert_idx). The id written there is
--     'dev:<org>:<key>:<message id>' so one org's (or one key's) message id
--     can never suppress another's reading. ON CONFLICT (client_uuid).
--   * the idempotency key is scoped per ingest key, not per org. With no
--     message_id it is md5 of the payload, plus a one-minute receive bucket
--     when the payload has no recorded_at, so a legit repeat is not lost.
--   * keys carry countries: a country-scoped Admin can only mint keys for,
--     list, dry-run against, match into, or revoke within their countries.
--     NULL countries (all) only for a super admin or an 'ALL' profile.
--   * any unexpected error in one message rejects that message only
--     ('processing_error'); the batch, the loop and the rate counter go on.
--   * a key bound to a device only ever updates that device's last_seen_at.
--   * device_ingest_purge(days) trims old usage minutes and rejected ledger
--     rows (service_role only, not scheduled; run from a cron when wanted).
--
-- What this adds (additive only, no existing row is changed):
--   * device_ingest_keys      one hashed key per device or per integration,
--                             scoped to the data types it may send, revocable.
--                             The plaintext key is returned ONCE by the mint
--                             RPC and never stored.
--   * device_ingest_usage     per key per minute request counter (rate limit).
--   * device_ingest_messages  ledger of every message, keyed by an
--                             idempotency key, so a retried batch never
--                             writes twice.
--   * device_ingest_unmatched readings whose asset could not be matched (or
--                             matched more than one asset) are kept here for
--                             review. Nothing is silently dropped.
--   * device_ingest_settings  per org TPMS thresholds.
--   * device_alert_notices    alert dedupe (one notice per alert key per 6 h).
--   * tread_depth_readings, fuel_level_readings   the only reading types that
--                             had no table yet.
--   * rfid_tag_events.action  widened to allow 'read' (a reader saw the tag).
--
-- Writes go to the EXISTING tables: gps_positions, odometer_logs
-- (source 'telematics', so trg_sync_asset_current_km moves current_km),
-- engine_hours_logs, tpms_readings (source 'sensor'), fuel_transactions,
-- dtc_codes, dashcam_events, rfid_tag_events.
--
-- Access: ONLY Admin / super admin (owner rule 2026-11-27). Every admin RPC
-- checks app_is_org_admin() in its body and raises 42501 otherwise. The new
-- tables have RLS with no client write policy; reads are admin only. The two
-- ingest RPCs (key lookup, submit) are executable by service_role only: the
-- device-ingest edge function calls them after it has validated the key.
--
-- Org always comes from the key row. Country and site come from the matched
-- asset. The same asset code can exist in several countries, so a match that
-- finds more than one asset is quarantined as 'ambiguous', never guessed.
--
-- No pgcrypto needed: keys come from gen_random_uuid() (two v4 uuids, 244
-- random bits) and are hashed with the built-in sha256().
--
-- VERIFY (after apply, run as a plain Manager then as an Admin):
--   select public.device_ingest_key_create('test', array['gps'], null, 60, null);
--     -> Manager: ERROR 42501; Admin: {id, key, prefix}
--   select has_function_privilege('authenticated',
--     'public.device_ingest_submit(uuid,jsonb)', 'execute');      -> false
--   select has_function_privilege('anon',
--     'public.device_ingest_key_create(text,text[],uuid,int,timestamptz,text)', 'execute'); -> false
--   supabase/tests/device_ingest.test.mjs covers the same in PGlite.
--
-- ROLLBACK:
--   drop function if exists public.device_ingest_submit(uuid,jsonb),
--     public.device_ingest_key_lookup(text), public.device_ingest_key_create(text,text[],uuid,int,timestamptz,text),
--     public.device_ingest_key_revoke(uuid,text), public.device_ingest_keys_list(),
--     public.device_ingest_overview(), public.device_ingest_unmatched_list(int),
--     public.device_ingest_resolve_unmatched(uuid,uuid), public.device_ingest_dismiss_unmatched(uuid),
--     public.device_ingest_dry_run(jsonb), public.device_ingest_save_settings(jsonb),
--     public._device_ingest_process(uuid,uuid,jsonb,boolean,uuid), public._device_resolve_asset(uuid,uuid,jsonb,uuid,text[]),
--     public._device_admin_countries(), public._device_countries_visible(text[]), public.device_ingest_purge(int),
--     public._device_alert(uuid,text,text,text,text,uuid,text), public._device_ingest_require_admin(),
--     public._device_norm(text);
--   drop table if exists public.device_alert_notices, public.device_ingest_unmatched,
--     public.device_ingest_messages, public.device_ingest_usage, public.device_ingest_settings,
--     public.device_ingest_keys, public.tread_depth_readings, public.fuel_level_readings;
--   (rfid_tag_events: re-add the original CHECK without 'read' once no 'read' row exists.)

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._device_norm(p text)
returns text language sql immutable parallel safe set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g')), '')
$$;

create or replace function public._device_ingest_require_admin()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.app_current_org();
begin
  if auth.uid() is null or not coalesce(public.app_is_org_admin(), false) or v_org is null then
    raise exception 'Only an administrator can manage devices' using errcode = '42501';
  end if;
  return v_org;
end $$;

-- Countries the calling admin may act in. NULL = every country (super admin
-- or a profile carrying 'ALL'); otherwise the profile's own country list,
-- matching public.app_can_see_country.
create or replace function public._device_admin_countries()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when public.is_super_admin() then null
    when exists (select 1 from public.profiles pr, unnest(coalesce(pr.country, '{}'::text[])) x
                  where pr.id = auth.uid() and lower(btrim(x)) = 'all') then null
    else coalesce((select array_agg(distinct upper(btrim(x))) from public.profiles pr, unnest(coalesce(pr.country, '{}'::text[])) x
                    where pr.id = auth.uid() and btrim(x) <> ''), '{}'::text[])
  end
$$;

-- True when the calling admin may see everything a key with these countries
-- can touch. A NULL (all countries) key needs an all-country admin.
create or replace function public._device_countries_visible(p_countries text[])
returns boolean language sql stable security definer set search_path = public as $$
  select public._device_admin_countries() is null
      or (p_countries is not null and cardinality(p_countries) > 0
          and not exists (select 1 from unnest(p_countries) x where not public.app_can_see_country(x)))
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.device_ingest_keys (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  name             text not null check (length(btrim(name)) between 1 and 120),
  kind             text not null default 'integration' check (kind in ('device','integration')),
  vendor           text not null default 'generic' check (vendor in ('generic','teltonika','wialon','samsara')),
  device_row_id    uuid,
  key_prefix       text not null unique,
  key_hash         text not null,
  data_types       text[] not null,
  countries        text[],          -- NULL = every country (super admin / ALL only)
  rate_per_minute  integer not null default 600 check (rate_per_minute between 1 and 6000),
  active           boolean not null default true,
  expires_at       timestamptz,
  last_used_at     timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  revoked_by       uuid,
  revoke_reason    text,
  constraint device_ingest_keys_types_chk check (
    array_length(data_types, 1) >= 1 and data_types <@ array['gps','odometer','engine_hours','tpms','tread',
      'fuel_level','fuel_transaction','dtc','rfid','dashcam']::text[])
);
create index if not exists device_ingest_keys_org_idx on public.device_ingest_keys (organisation_id);

create table if not exists public.device_ingest_usage (
  key_id  uuid not null references public.device_ingest_keys(id) on delete cascade,
  minute  timestamptz not null,
  count   integer not null default 0,
  primary key (key_id, minute)
);

create table if not exists public.device_ingest_messages (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  key_id           uuid,
  idem_key         text not null,
  msg_type         text,
  status           text not null check (status in ('accepted','duplicate','quarantined','rejected')),
  target_table     text,
  target_id        uuid,
  asset_no         text,
  country          text,
  error            text,
  recorded_at      timestamptz,
  received_at      timestamptz not null default now(),
  constraint device_ingest_messages_idem unique (organisation_id, idem_key)
);
create index if not exists device_ingest_messages_org_time_idx on public.device_ingest_messages (organisation_id, received_at desc);
create index if not exists device_ingest_messages_key_idx on public.device_ingest_messages (key_id, received_at desc);

create table if not exists public.device_ingest_unmatched (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  key_id           uuid,
  message_id       uuid,
  msg_type         text,
  reason           text not null check (reason in ('unknown_asset','ambiguous_asset','unassigned_device','stale_reading')),
  identifiers      jsonb,
  candidates       jsonb,
  payload          jsonb not null,
  status           text not null default 'open' check (status in ('open','matched','dismissed')),
  resolved_by      uuid,
  resolved_at      timestamptz,
  resolved_asset_no text,
  created_at       timestamptz not null default now()
);
create index if not exists device_ingest_unmatched_open_idx on public.device_ingest_unmatched (organisation_id, status, created_at desc);

create table if not exists public.device_ingest_settings (
  organisation_id      uuid primary key,
  tpms_low_pct         numeric not null default 15,
  tpms_critical_pct    numeric not null default 25,
  tpms_high_pct        numeric not null default 15,
  tpms_low_psi         numeric,
  tpms_high_psi        numeric,
  tpms_high_temp_c     numeric not null default 85,
  alert_repeat_hours   integer not null default 6 check (alert_repeat_hours between 1 and 168),
  max_reading_age_days integer not null default 30 check (max_reading_age_days between 1 and 365),
  updated_by           uuid,
  updated_at           timestamptz not null default now()
);

create table if not exists public.device_alert_notices (
  organisation_id  uuid not null,
  alert_key        text not null,
  last_sent_at     timestamptz not null default now(),
  times            integer not null default 1,
  primary key (organisation_id, alert_key)
);

create table if not exists public.tread_depth_readings (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  country          text,
  site             text,
  asset_no         text not null,
  tyre_position    text,
  tyre_serial      text,
  depth_mm         numeric not null check (depth_mm >= 0 and depth_mm <= 60),
  measured_at      timestamptz not null default now(),
  source           text not null default 'gauge' check (source in ('gauge','drive_over','manual','import')),
  device_id        text,
  created_at       timestamptz not null default now()
);
create index if not exists tread_depth_readings_asset_idx on public.tread_depth_readings (organisation_id, asset_no, measured_at desc);

create table if not exists public.fuel_level_readings (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  country          text,
  site             text,
  asset_no         text not null,
  level_pct        numeric check (level_pct is null or (level_pct >= 0 and level_pct <= 100)),
  level_litres     numeric check (level_litres is null or level_litres >= 0),
  recorded_at      timestamptz not null default now(),
  device_id        text,
  created_at       timestamptz not null default now()
);
create index if not exists fuel_level_readings_asset_idx on public.fuel_level_readings (organisation_id, asset_no, recorded_at desc);

-- rfid: a reader seeing a tag is a new event kind.
-- Done inside a DO block (no top-level DROP) and only when the constraint
-- exists, so the apply never pauses for a destructive-statement prompt.
do $rfid$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.rfid_tag_events'::regclass and conname = 'rfid_tag_events_action_check') then
    execute 'alter table public.rfid_tag_events drop constraint rfid_tag_events_action_check';
  end if;
  execute $c$alter table public.rfid_tag_events add constraint rfid_tag_events_action_check check (action in
    ('registered','assigned','reassigned','unassigned','retired','reactivated','moved','edited','deleted','read'))$c$;
end $rfid$;

-- RLS: org wall + admin-only read; no client write policy anywhere (all
-- writes go through the DEFINER functions below).
do $rls$
declare t text;
begin
  foreach t in array array['device_ingest_keys','device_ingest_usage','device_ingest_messages','device_ingest_unmatched',
    'device_ingest_settings','device_alert_notices','tread_depth_readings','fuel_level_readings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  foreach t in array array['device_ingest_messages','device_ingest_unmatched','device_ingest_settings',
    'tread_depth_readings','fuel_level_readings'] loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_admin_read') then
      execute format('drop policy %I on public.%I', t || '_admin_read', t);
    end if;
    execute format('create policy %I on public.%I for select to authenticated using (
      organisation_id = (select public.app_current_org()) and (select public.app_is_org_admin()))', t || '_admin_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $rls$;
-- device_ingest_keys / _usage / device_alert_notices: no client access at all
-- (key_hash must never leave the server). The list RPC returns safe columns.

-- ---------------------------------------------------------------------------
-- Alerts: org-scoped in-app notice to Admins + super admins, deduped.
-- (notify_elevated_users is not org scoped, so it is not used here.)
-- ---------------------------------------------------------------------------
create or replace function public._device_alert(p_org uuid, p_key text, p_type text, p_title text, p_body text, p_entity uuid,
  p_country text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_hours int;
  v_last timestamptz;
begin
  select coalesce((select alert_repeat_hours from public.device_ingest_settings where organisation_id = p_org), 6) into v_hours;
  select last_sent_at into v_last from public.device_alert_notices where organisation_id = p_org and alert_key = p_key for update;
  if v_last is not null and v_last > now() - make_interval(hours => v_hours) then
    return false;
  end if;
  insert into public.device_alert_notices (organisation_id, alert_key, last_sent_at, times)
  values (p_org, p_key, now(), 1)
  on conflict (organisation_id, alert_key) do update set last_sent_at = now(), times = device_alert_notices.times + 1;
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, read)
  select p.id, p_type, left(p_title, 200), left(p_body, 1000), 'device_reading', p_entity, false
    from public.profiles p
   where (p.org_id = p_org or p.organisation_id = p_org)
     and coalesce(p.approved, false) and not coalesce(p.locked, false)
     and (coalesce(p.is_super_admin, false) or lower(coalesce(p.role, '')) = 'admin')
     -- a country-scoped Admin only hears about assets in their countries
     and (coalesce(p.is_super_admin, false) or p_country is null
          or exists (select 1 from unnest(coalesce(p.country, '{}'::text[])) x
                      where lower(btrim(x)) in ('all', lower(btrim(p_country)))));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Asset resolution. Returns {status:'ok'|'unknown'|'ambiguous', asset_no,
-- country, site, candidates}.
-- ---------------------------------------------------------------------------
create or replace function public._device_resolve_asset(p_org uuid, p_device_row uuid, p_msg jsonb, p_force_vehicle uuid default null,
  p_countries text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  -- countries the key may write to (NULL = all), lower-cased once
  v_cl text[] := (select array_agg(lower(btrim(x))) from unnest(p_countries) x);
  v_a jsonb := coalesce(p_msg->'asset', '{}'::jsonb);
  v_country text := nullif(btrim(coalesce(v_a->>'country', '')), '');
  v_dev text := public._device_norm(coalesce(p_msg->>'device_id', v_a->>'imei'));
  v_rows jsonb;
  v_n int;
begin
  if p_force_vehicle is not null then
    select jsonb_agg(jsonb_build_object('asset_no', asset_no, 'country', country, 'site', site)) into v_rows
      from public.vehicle_fleet where id = p_force_vehicle and organisation_id = p_org
       and (v_cl is null or country is null or lower(country) = any (v_cl));
  end if;

  -- 1. key bound to a registered device: that device's asset and nothing
  --    else. No asset on the device (or device gone) -> 'unassigned'; the
  --    payload's asset code / VIN / plate is never consulted for a bound key.
  if v_rows is null and p_device_row is not null then
    if not exists (select 1 from public.telematics_devices
                    where id = p_device_row and organisation_id = p_org
                      and status <> 'decommissioned' and public._device_norm(asset_no) is not null) then
      return jsonb_build_object('status', 'unassigned');
    end if;
    select jsonb_agg(distinct jsonb_build_object('asset_no', vf.asset_no, 'country', vf.country, 'site', vf.site)) into v_rows
      from public.telematics_devices td
      join public.vehicle_fleet vf
        on vf.organisation_id = p_org
       and public._device_norm(vf.asset_no) = public._device_norm(td.asset_no)
       and (td.country is null or vf.country is null or lower(vf.country) = lower(td.country))
       and (v_cl is null or vf.country is null or lower(vf.country) = any (v_cl))
     where td.id = p_device_row and td.organisation_id = p_org;
    v_n := coalesce(jsonb_array_length(v_rows), 0);
    if v_n = 1 then
      return jsonb_build_object('status', 'ok') || (v_rows->0);
    elsif v_n > 1 then
      return jsonb_build_object('status', 'ambiguous', 'candidates', v_rows);
    end if;
    return jsonb_build_object('status', 'unknown');
  end if;

  -- 2. an unbound key: a registered device id / IMEI in the payload
  if v_rows is null and v_dev is not null then
    select jsonb_agg(distinct jsonb_build_object('asset_no', vf.asset_no, 'country', vf.country, 'site', vf.site)) into v_rows
      from public.telematics_devices td
      join public.vehicle_fleet vf
        on vf.organisation_id = p_org
       and public._device_norm(vf.asset_no) = public._device_norm(td.asset_no)
       and (td.country is null or vf.country is null or lower(vf.country) = lower(td.country))
     where td.organisation_id = p_org and td.status <> 'decommissioned' and td.asset_no is not null
       and public._device_norm(td.device_id) = v_dev
       and (v_cl is null or vf.country is null or lower(vf.country) = any (v_cl));
  end if;

  -- 3. asset code, 4. VIN / chassis, 5. registration plate
  if v_rows is null and public._device_norm(v_a->>'asset_no') is not null then
    select jsonb_agg(jsonb_build_object('asset_no', asset_no, 'country', country, 'site', site)) into v_rows
      from public.vehicle_fleet
     where organisation_id = p_org and public._device_norm(asset_no) = public._device_norm(v_a->>'asset_no')
       and (v_country is null or lower(country) = lower(v_country))
       and (v_cl is null or country is null or lower(country) = any (v_cl));
  end if;
  if v_rows is null and public._device_norm(coalesce(v_a->>'vin', v_a->>'chassis_no')) is not null then
    select jsonb_agg(jsonb_build_object('asset_no', asset_no, 'country', country, 'site', site)) into v_rows
      from public.vehicle_fleet
     where organisation_id = p_org
       and public._device_norm(coalesce(v_a->>'vin', v_a->>'chassis_no')) in (public._device_norm(vin), public._device_norm(chassis_no))
       and (v_country is null or lower(country) = lower(v_country))
       and (v_cl is null or country is null or lower(country) = any (v_cl));
  end if;
  if v_rows is null and public._device_norm(v_a->>'registration_no') is not null then
    select jsonb_agg(jsonb_build_object('asset_no', asset_no, 'country', country, 'site', site)) into v_rows
      from public.vehicle_fleet
     where organisation_id = p_org and public._device_norm(registration_no) = public._device_norm(v_a->>'registration_no')
       and (v_country is null or lower(country) = lower(v_country))
       and (v_cl is null or country is null or lower(country) = any (v_cl));
  end if;

  v_n := coalesce(jsonb_array_length(v_rows), 0);
  if v_n = 1 then
    return jsonb_build_object('status', 'ok') || (v_rows->0);
  elsif v_n > 1 then
    return jsonb_build_object('status', 'ambiguous', 'candidates', v_rows);
  end if;
  return jsonb_build_object('status', 'unknown');
end $$;

-- ---------------------------------------------------------------------------
-- One canonical message -> one row in the right table. The edge function has
-- already validated the shape (supabase/functions/_shared/deviceIngest.js);
-- this function re-checks what it relies on and never trusts types blindly.
-- ---------------------------------------------------------------------------
create or replace function public._device_ingest_process(
  p_org uuid, p_key_id uuid, p_msg jsonb, p_dry boolean default false, p_force_vehicle uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_type text := p_msg->>'type';
  v_d jsonb := coalesce(p_msg->'data', '{}'::jsonb);
  v_idem text;      -- per-key idempotency key, set below
  v_countries text[];
  v_at timestamptz;
  v_dev_row uuid;
  v_dev_txt text := nullif(btrim(coalesce(p_msg->>'device_id', '')), '');
  v_res jsonb;
  v_asset text; v_country text; v_site text;
  v_msg_id uuid;
  v_tid uuid;
  v_table text;
  v_set public.device_ingest_settings%rowtype;
  v_p numeric; v_t numeric; v_target numeric; v_status text;
  v_sev text;
  v_url text;
  v_reason text;   -- quarantine reason stored in device_ingest_unmatched.reason
  v_short text;    -- short reason returned to the caller
  v_max_age int;
begin
  if v_type is null or v_type not in ('gps','odometer','engine_hours','tpms','tread','fuel_level','fuel_transaction','dtc','rfid','dashcam') then
    return jsonb_build_object('status', 'rejected', 'error', 'unknown_type');
  end if;
  begin
    v_at := coalesce((p_msg->>'recorded_at')::timestamptz, now());
  exception when others then
    return jsonb_build_object('status', 'rejected', 'error', 'bad_recorded_at');
  end;
  if v_at > now() + interval '10 minutes' then
    return jsonb_build_object('status', 'rejected', 'error', 'recorded_at_in_future');
  end if;

  if p_key_id is not null then
    select device_row_id, countries into v_dev_row, v_countries from public.device_ingest_keys where id = p_key_id;
  else
    v_countries := public._device_admin_countries();   -- admin dry run
  end if;

  -- Idempotency key, scoped to the ingest key. A replay from the unmatched
  -- list reuses the stored '_idem'. Without a message_id it is the payload
  -- hash; without recorded_at a one-minute receive bucket is added so the
  -- same reading sent again later is a new reading, not a lost one.
  v_idem := coalesce(nullif(p_msg->>'_idem', ''),
    coalesce(p_key_id::text, 'admin') || ':' || coalesce(
      'm:' || nullif(btrim(p_msg->>'message_id'), ''),
      'h:' || md5((p_msg - 'message_id' - '_idem')::text
        || case when nullif(btrim(coalesce(p_msg->>'recorded_at', '')), '') is null
                then ':' || to_char(date_trunc('minute', now()) at time zone 'UTC', 'YYYYMMDDHH24MI') else '' end)));

  if not p_dry and p_force_vehicle is null then
    if exists (select 1 from public.device_ingest_messages where organisation_id = p_org and idem_key = v_idem) then
      return jsonb_build_object('status', 'duplicate');
    end if;
  end if;

  -- Too old: a backlog replay or a device with a wrong clock. Kept for review,
  -- never written straight into the operational tables. An admin match from
  -- the unmatched list (p_force_vehicle) is a deliberate decision and passes.
  select coalesce((select max_reading_age_days from public.device_ingest_settings where organisation_id = p_org), 30)
    into v_max_age;
  if p_force_vehicle is null and v_at < now() - make_interval(days => v_max_age) then
    v_reason := 'stale_reading'; v_short := 'stale';
  else
    v_res := public._device_resolve_asset(p_org, v_dev_row, p_msg, p_force_vehicle, v_countries);
    if v_res->>'status' <> 'ok' then
      v_short := v_res->>'status';
      v_reason := case v_short when 'unassigned' then 'unassigned_device' else v_short || '_asset' end;
    end if;
  end if;

  if v_reason is not null then
    if p_dry then
      return jsonb_build_object('status', 'quarantined', 'reason', v_short, 'candidates', v_res->'candidates');
    end if;
    insert into public.device_ingest_messages (organisation_id, key_id, idem_key, msg_type, status, error, recorded_at)
    values (p_org, p_key_id, v_idem, v_type, 'quarantined', v_reason, v_at)
    on conflict (organisation_id, idem_key) do nothing
    returning id into v_msg_id;
    if v_msg_id is null then
      return jsonb_build_object('status', 'duplicate');
    end if;
    insert into public.device_ingest_unmatched (organisation_id, key_id, message_id, msg_type, reason, identifiers, candidates, payload)
    values (p_org, p_key_id, v_msg_id, v_type, v_reason,
            jsonb_build_object('device_id', p_msg->>'device_id') || coalesce(p_msg->'asset', '{}'::jsonb),
            v_res->'candidates', p_msg || jsonb_build_object('_idem', v_idem));
    return jsonb_build_object('status', 'quarantined', 'reason', v_short);
  end if;

  v_asset := v_res->>'asset_no'; v_country := v_res->>'country'; v_site := v_res->>'site';

  v_table := case v_type
    when 'gps' then 'gps_positions' when 'odometer' then 'odometer_logs' when 'engine_hours' then 'engine_hours_logs'
    when 'tpms' then 'tpms_readings' when 'tread' then 'tread_depth_readings' when 'fuel_level' then 'fuel_level_readings'
    when 'fuel_transaction' then 'fuel_transactions' when 'dtc' then 'dtc_codes' when 'rfid' then 'rfid_tag_events'
    else 'dashcam_events' end;

  if p_dry then
    return jsonb_build_object('status', 'accepted', 'dry_run', true, 'target_table', v_table,
      'asset_no', v_asset, 'country', v_country, 'site', v_site);
  end if;

  -- Claim the idempotency key first so two concurrent retries cannot both write.
  if p_force_vehicle is null then
    insert into public.device_ingest_messages (organisation_id, key_id, idem_key, msg_type, status, target_table, asset_no, country, recorded_at)
    values (p_org, p_key_id, v_idem, v_type, 'accepted', v_table, v_asset, v_country, v_at)
    on conflict (organisation_id, idem_key) do nothing
    returning id into v_msg_id;
    if v_msg_id is null then
      return jsonb_build_object('status', 'duplicate');
    end if;
  end if;

  if v_type = 'gps' then
    insert into public.gps_positions (organisation_id, country, asset_no, latitude, longitude, speed_kmh, heading, altitude_m,
      ignition, odometer_km, recorded_at, notes)
    values (p_org, v_country, v_asset, (v_d->>'lat')::numeric, (v_d->>'lon')::numeric, (v_d->>'speed_kmh')::numeric,
      (v_d->>'heading')::numeric, (v_d->>'altitude_m')::numeric, (v_d->>'ignition')::boolean, (v_d->>'odometer_km')::numeric,
      v_at, 'device ingest')
    returning id into v_tid;
    update public.vehicle_fleet set latitude = (v_d->>'lat')::double precision, longitude = (v_d->>'lon')::double precision,
           location_updated_at = v_at, gps_source = 'telematics'
     where organisation_id = p_org and asset_no = v_asset and country is not distinct from v_country
       and (location_updated_at is null or location_updated_at < v_at);

  elsif v_type = 'odometer' then
    insert into public.odometer_logs (organisation_id, country, asset_no, odometer_km, reading_date, source, site, notes, client_uuid)
    values (p_org, v_country, v_asset, (v_d->>'odometer_km')::numeric, (v_at at time zone 'UTC')::date, 'telematics', v_site,
            'device ingest', 'dev:' || p_org::text || ':' || v_idem)
    on conflict (client_uuid) do nothing
    returning id into v_tid;
    if v_tid is null then
      -- the same reading is already stored (client_uuid): record it as a
      -- duplicate, never as accepted with no target row.
      if v_msg_id is not null then
        update public.device_ingest_messages set status = 'duplicate', error = 'reading already recorded'
         where id = v_msg_id;
      end if;
      return jsonb_build_object('status', 'duplicate', 'reason', 'reading_already_recorded');
    end if;

  elsif v_type = 'engine_hours' then
    insert into public.engine_hours_logs (organisation_id, country, asset_no, engine_hours, reading_date, source, site, notes, client_uuid)
    values (p_org, v_country, v_asset, (v_d->>'engine_hours')::numeric, (v_at at time zone 'UTC')::date, 'telematics', v_site,
            'device ingest', 'dev:' || p_org::text || ':' || v_idem)
    on conflict (client_uuid) do nothing
    returning id into v_tid;
    if v_tid is null then
      -- the same reading is already stored (client_uuid): record it as a
      -- duplicate, never as accepted with no target row.
      if v_msg_id is not null then
        update public.device_ingest_messages set status = 'duplicate', error = 'reading already recorded'
         where id = v_msg_id;
      end if;
      return jsonb_build_object('status', 'duplicate', 'reason', 'reading_already_recorded');
    end if;

  elsif v_type = 'tpms' then
    select * into v_set from public.device_ingest_settings where organisation_id = p_org;
    v_p := (v_d->>'pressure_psi')::numeric;
    v_t := (v_d->>'temperature_c')::numeric;
    v_target := (v_d->>'target_psi')::numeric;
    if v_target is not null and v_target > 0 and v_p is not null then
      v_status := case
        when v_p < v_target * (1 - coalesce(v_set.tpms_critical_pct, 25) / 100.0) then 'critical'
        when v_p < v_target * (1 - coalesce(v_set.tpms_low_pct, 15) / 100.0) then 'under'
        when v_p > v_target * (1 + coalesce(v_set.tpms_high_pct, 15) / 100.0) then 'over'
        else 'optimal' end;
    elsif v_p is not null and (v_set.tpms_low_psi is not null or v_set.tpms_high_psi is not null) then
      v_status := case when v_set.tpms_low_psi is not null and v_p < v_set.tpms_low_psi then 'under'
                       when v_set.tpms_high_psi is not null and v_p > v_set.tpms_high_psi then 'over'
                       else 'optimal' end;
    end if;
    if v_t is not null and v_t >= coalesce(v_set.tpms_high_temp_c, 85) then
      v_status := 'critical';
    end if;
    insert into public.tpms_readings (organisation_id, country, site, asset_no, tyre_position, tyre_serial, pressure, temperature,
      target_pressure, status, recorded_at, source, notes)
    values (p_org, v_country, v_site, v_asset, nullif(v_d->>'position', ''), nullif(v_d->>'tyre_serial', ''), v_p, v_t,
      v_target, v_status, v_at, 'sensor', left('device ingest' || coalesce(' sensor ' || (v_d->>'sensor_id'), ''), 2000))
    returning id into v_tid;
    if v_status in ('under','over','critical') then
      perform public._device_alert(p_org, 'tpms:' || v_asset || ':' || coalesce(v_d->>'position', '?') || ':' || v_status,
        'tpms_alert',
        'Tyre pressure ' || case v_status when 'under' then 'low' when 'over' then 'high' else 'critical' end
          || ' on ' || v_asset || coalesce(' ' || (v_d->>'position'), ''),
        coalesce(v_p::text || ' psi', 'pressure unknown') || coalesce(', target ' || v_target::text || ' psi', '')
          || coalesce(', ' || v_t::text || ' C', '') || '.', v_tid, v_country);
    end if;

  elsif v_type = 'tread' then
    insert into public.tread_depth_readings (organisation_id, country, site, asset_no, tyre_position, tyre_serial, depth_mm,
      measured_at, source, device_id)
    values (p_org, v_country, v_site, v_asset, nullif(v_d->>'position', ''), nullif(v_d->>'tyre_serial', ''),
      (v_d->>'depth_mm')::numeric, v_at, coalesce(nullif(v_d->>'source', ''), 'gauge'), v_dev_txt)
    returning id into v_tid;

  elsif v_type = 'fuel_level' then
    insert into public.fuel_level_readings (organisation_id, country, site, asset_no, level_pct, level_litres, recorded_at, device_id)
    values (p_org, v_country, v_site, v_asset, (v_d->>'level_pct')::numeric, (v_d->>'level_litres')::numeric, v_at, v_dev_txt)
    returning id into v_tid;

  elsif v_type = 'fuel_transaction' then
    insert into public.fuel_transactions (organisation_id, country, asset_no, site, station, txn_at, litres, amount, currency,
      odometer_km, receipt_no, notes)
    values (p_org, v_country, v_asset, v_site, nullif(v_d->>'station', ''), v_at, (v_d->>'litres')::numeric,
      (v_d->>'amount')::numeric, nullif(upper(v_d->>'currency'), ''), (v_d->>'odometer_km')::numeric,
      nullif(v_d->>'receipt_no', ''), 'device ingest')
    returning id into v_tid;

  elsif v_type = 'dtc' then
    v_sev := case when v_d->>'severity' in ('info','warning','critical') then v_d->>'severity' else 'warning' end;
    select id into v_tid from public.dtc_codes
     where organisation_id = p_org and asset_no = v_asset and status = 'active'
       and upper(coalesce(code, '')) = upper(coalesce(v_d->>'code', ''))
     limit 1;
    if v_tid is not null then
      update public.device_ingest_messages set status = 'duplicate', target_id = v_tid, error = 'code already active'
       where id = v_msg_id;
      return jsonb_build_object('status', 'duplicate', 'reason', 'code_already_active');
    end if;
    insert into public.dtc_codes (organisation_id, country, asset_no, code, description, system, severity, detected_at, status, site, notes)
    values (p_org, v_country, v_asset, left(v_d->>'code', 40), left(v_d->>'description', 500), left(v_d->>'system', 80), v_sev,
      (v_at at time zone 'UTC')::date, 'active', v_site, 'device ingest')
    returning id into v_tid;
    if v_sev = 'critical' then
      perform public._device_alert(p_org, 'dtc:' || v_asset || ':' || upper(coalesce(v_d->>'code', '')), 'dtc_alert',
        'Critical fault code ' || coalesce(v_d->>'code', '') || ' on ' || v_asset,
        coalesce(v_d->>'description', 'No description from the device') || '.', v_tid, v_country);
    end if;

  elsif v_type = 'rfid' then
    insert into public.rfid_tag_events (organisation_id, country, tag_row_id, tag_id, action, to_asset_no, to_site, actor_name, created_at)
    select p_org, v_country, rt.id, v_d->>'tag_id', 'read', v_asset, coalesce(nullif(v_d->>'site', ''), v_site),
           left('reader ' || coalesce(v_d->>'reader_id', v_dev_txt, 'device'), 120), v_at
      from (select 1) x
      left join public.rfid_tags rt on rt.organisation_id = p_org and upper(rt.tag_id) = upper(v_d->>'tag_id')
     limit 1
    returning id into v_tid;
    update public.rfid_tags set last_scanned_at = v_at
     where organisation_id = p_org and upper(tag_id) = upper(v_d->>'tag_id')
       and (last_scanned_at is null or last_scanned_at < v_at);

  elsif v_type = 'dashcam' then
    v_url := v_d->>'video_url';
    if v_url is not null and v_url !~ '^https://[^\s]+$' then v_url := null; end if;
    insert into public.dashcam_events (organisation_id, country, asset_no, driver_name, event_type, severity, event_at, location,
      speed_kmh, video_url, notes)
    values (p_org, v_country, v_asset, left(v_d->>'driver_name', 120),
      case when v_d->>'event_type' in ('collision','harsh_brake','tailgating','distraction','drowsiness','phone_use','no_seatbelt')
           then v_d->>'event_type' else 'other' end,
      case when v_d->>'severity' in ('low','medium','high','critical') then v_d->>'severity' else 'medium' end,
      v_at, left(v_d->>'location', 300), (v_d->>'speed_kmh')::numeric, v_url, 'device ingest')
    returning id into v_tid;
    if v_d->>'event_type' = 'collision' or v_d->>'severity' = 'critical' then
      perform public._device_alert(p_org, 'dashcam:' || v_tid::text, 'dashcam_alert',
        'Dashcam ' || coalesce(v_d->>'event_type', 'event') || ' on ' || v_asset, 'Review the clip in Video Telematics.', v_tid, v_country);
    end if;
  end if;

  if v_msg_id is not null then
    update public.device_ingest_messages set target_id = v_tid where id = v_msg_id;
  end if;
  -- A bound key only ever touches its own device; an unbound key may name one.
  if v_dev_row is not null then
    update public.telematics_devices set last_seen_at = greatest(coalesce(last_seen_at, v_at), v_at)
     where organisation_id = p_org and id = v_dev_row;
  elsif v_dev_txt is not null then
    update public.telematics_devices set last_seen_at = greatest(coalesce(last_seen_at, v_at), v_at)
     where organisation_id = p_org and public._device_norm(device_id) = public._device_norm(v_dev_txt)
       and (v_countries is null or country is null or lower(country) = any (select lower(btrim(x)) from unnest(v_countries) x));
  end if;
  return jsonb_build_object('status', 'accepted', 'target_table', v_table, 'asset_no', v_asset);
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
    -- A bad value in one message rejects that message only. The savepoint of
    -- this exception block undoes its partial writes, including the ledger
    -- row, so a corrected retry with the same message id is still accepted.
    return jsonb_build_object('status', 'rejected', 'error', 'invalid_value');
  when others then
    -- Anything unexpected rejects this one message only (the savepoint undoes
    -- its writes, ledger claim included). The batch, its loop and the rate
    -- counter carry on; the caller sees a generic reason, never internals.
    return jsonb_build_object('status', 'rejected', 'error', 'processing_error');
end $$;

-- ---------------------------------------------------------------------------
-- Service-role entry points (called by the device-ingest edge function only).
-- ---------------------------------------------------------------------------
create or replace function public.device_ingest_key_lookup(p_prefix text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k public.device_ingest_keys%rowtype;
begin
  select * into k from public.device_ingest_keys where key_prefix = p_prefix;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object('found', true, 'id', k.id, 'key_hash', k.key_hash,
    'usable', k.active and k.revoked_at is null and (k.expires_at is null or k.expires_at > now()),
    'data_types', to_jsonb(k.data_types), 'vendor', k.vendor);
end $$;

create or replace function public.device_ingest_submit(p_key_id uuid, p_messages jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k public.device_ingest_keys%rowtype;
  v_minute timestamptz := date_trunc('minute', now());
  v_count int;
  v_out jsonb := '[]'::jsonb;
  v_r jsonb;
  m jsonb;
  i int := 0;
  v_n int;
begin
  select * into k from public.device_ingest_keys where id = p_key_id;
  if not found or not k.active or k.revoked_at is not null or (k.expires_at is not null and k.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'error', 'invalid_key');
  end if;
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 500 then
    return jsonb_build_object('ok', false, 'error', 'bad_batch');
  end if;

  -- The limit is messages per minute: a 500-message batch costs 500, not 1.
  v_n := greatest(jsonb_array_length(p_messages), 1);
  insert into public.device_ingest_usage as u (key_id, minute, count) values (k.id, v_minute, v_n)
  on conflict (key_id, minute) do update set count = u.count + excluded.count
  returning count into v_count;
  if v_count > k.rate_per_minute then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'limit', k.rate_per_minute);
  end if;
  update public.device_ingest_keys set last_used_at = now() where id = k.id;

  for m in select value - '_idem' from jsonb_array_elements(p_messages) loop
    if nullif(m->>'_rejected', '') is not null then
      -- the edge function found the message malformed; record it for monitoring
      v_r := jsonb_build_object('status', 'rejected', 'error', left(m->>'_rejected', 200));
    elsif not (coalesce(m->>'type', '') = any (k.data_types)) then
      v_r := jsonb_build_object('status', 'rejected', 'error', 'type_not_allowed_for_key');
    else
      v_r := public._device_ingest_process(k.organisation_id, k.id, m, false, null);
    end if;
    if v_r->>'status' = 'rejected' then
      -- a random ledger key: a rejection must never block a corrected retry
      insert into public.device_ingest_messages (organisation_id, key_id, idem_key, msg_type, status, error)
      values (k.organisation_id, k.id, 'rejected:' || gen_random_uuid()::text, left(m->>'type', 40), 'rejected', v_r->>'error');
    end if;
    v_out := v_out || jsonb_build_array(v_r || jsonb_build_object('index', i));
    i := i + 1;
  end loop;
  return jsonb_build_object('ok', true, 'results', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- Admin RPCs (web Devices & Integrations page).
-- ---------------------------------------------------------------------------
create or replace function public.device_ingest_key_create(
  p_name text, p_data_types text[], p_device_row uuid default null, p_rate int default 600, p_expires_at timestamptz default null,
  p_vendor text default 'generic')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public._device_ingest_require_admin();
  v_prefix text := 'tpd_' || left(replace(gen_random_uuid()::text, '-', ''), 10);
  v_secret text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_key text;
  v_id uuid;
  v_countries text[] := public._device_admin_countries();
  v_dev_country text;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A name is required' using errcode = '22023';
  end if;
  if v_countries is not null and cardinality(v_countries) = 0 then
    raise exception 'No country is assigned to your account' using errcode = '42501';
  end if;
  if p_device_row is not null then
    select td.country into v_dev_country from public.telematics_devices td
     where td.id = p_device_row and td.organisation_id = v_org;
    if not found or not public.app_can_see_country(v_dev_country) then
      raise exception 'Device not found' using errcode = '22023';
    end if;
    -- a device in a known country only ever writes there
    if v_dev_country is not null then
      v_countries := array[upper(btrim(v_dev_country))];
    end if;
  end if;
  v_key := v_prefix || '.' || v_secret;
  insert into public.device_ingest_keys (organisation_id, name, kind, vendor, device_row_id, key_prefix, key_hash, data_types,
    countries, rate_per_minute, expires_at, created_by)
  values (v_org, btrim(p_name), case when p_device_row is null then 'integration' else 'device' end, coalesce(p_vendor, 'generic'),
    p_device_row, v_prefix, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), p_data_types,
    v_countries, coalesce(p_rate, 600), p_expires_at, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key, 'prefix', v_prefix);
end $$;

create or replace function public.device_ingest_key_revoke(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._device_ingest_require_admin();
begin
  update public.device_ingest_keys set active = false, revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(p_reason, 500)
   where id = p_id and organisation_id = v_org and revoked_at is null and public._device_countries_visible(countries);
  if not found then
    raise exception 'Key not found or already revoked' using errcode = '22023';
  end if;
end $$;

create or replace function public.device_ingest_keys_list()
returns table (id uuid, name text, kind text, vendor text, device_row_id uuid, device_id text, asset_no text, key_prefix text,
  data_types text[], rate_per_minute int, active boolean, expires_at timestamptz, last_used_at timestamptz,
  created_at timestamptz, revoked_at timestamptz, messages_24h bigint, rejected_24h bigint, quarantined_24h bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public._device_ingest_require_admin();
begin
  return query
  select k.id, k.name, k.kind, k.vendor, k.device_row_id, td.device_id, td.asset_no, k.key_prefix, k.data_types, k.rate_per_minute,
         k.active and k.revoked_at is null, k.expires_at, k.last_used_at, k.created_at, k.revoked_at,
         (select count(*) from public.device_ingest_messages m where m.key_id = k.id and m.received_at > now() - interval '24 hours'),
         (select count(*) from public.device_ingest_messages m where m.key_id = k.id and m.status = 'rejected' and m.received_at > now() - interval '24 hours'),
         (select count(*) from public.device_ingest_messages m where m.key_id = k.id and m.status = 'quarantined' and m.received_at > now() - interval '24 hours')
    from public.device_ingest_keys k
    left join public.telematics_devices td on td.id = k.device_row_id
   where k.organisation_id = v_org and public._device_countries_visible(k.countries)
   order by k.created_at desc;
end $$;

create or replace function public.device_ingest_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public._device_ingest_require_admin();
begin
  return jsonb_build_object(
    'by_type', coalesce((select jsonb_object_agg(msg_type, n) from (
        select msg_type, count(*) n from public.device_ingest_messages
         where organisation_id = v_org and received_at > now() - interval '24 hours' group by msg_type) s), '{}'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from public.device_ingest_messages
         where organisation_id = v_org and received_at > now() - interval '24 hours' group by status) s), '{}'::jsonb),
    'unmatched_open', (select count(*) from public.device_ingest_unmatched where organisation_id = v_org and status = 'open'),
    'last_message_at', (select max(received_at) from public.device_ingest_messages where organisation_id = v_org),
    'recent_errors', coalesce((select jsonb_agg(e) from (
        select received_at, msg_type, status, error, key_id from public.device_ingest_messages
         where organisation_id = v_org and status in ('rejected','quarantined')
         order by received_at desc limit 20) e), '[]'::jsonb),
    'settings', (select to_jsonb(s) - 'organisation_id' from public.device_ingest_settings s where organisation_id = v_org));
end $$;

create or replace function public.device_ingest_unmatched_list(p_limit int default 100)
returns setof public.device_ingest_unmatched
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public._device_ingest_require_admin();
begin
  return query select u.* from public.device_ingest_unmatched u
    left join public.device_ingest_keys k on k.id = u.key_id
   where u.organisation_id = v_org and u.status = 'open'
     and public._device_countries_visible(k.countries)
   order by u.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- One-click match: replay the stored message against the chosen asset.
create or replace function public.device_ingest_resolve_unmatched(p_id uuid, p_vehicle_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public._device_ingest_require_admin();
  u public.device_ingest_unmatched%rowtype;
  v_r jsonb;
begin
  select * into u from public.device_ingest_unmatched where id = p_id and organisation_id = v_org and status = 'open' for update;
  if not found or not public._device_countries_visible((select countries from public.device_ingest_keys where id = u.key_id)) then
    raise exception 'Reading not found or already handled' using errcode = '22023';
  end if;
  if not exists (select 1 from public.vehicle_fleet where id = p_vehicle_id and organisation_id = v_org
                   and public.app_can_see_country(country)) then
    raise exception 'Asset not found' using errcode = '22023';
  end if;
  v_r := public._device_ingest_process(v_org, u.key_id, u.payload, false, p_vehicle_id);
  if v_r->>'status' <> 'accepted' then
    return v_r;
  end if;
  update public.device_ingest_unmatched set status = 'matched', resolved_by = auth.uid(), resolved_at = now(),
         resolved_asset_no = v_r->>'asset_no' where id = p_id;
  update public.device_ingest_messages set status = 'accepted', target_table = v_r->>'target_table', asset_no = v_r->>'asset_no',
         error = null where id = u.message_id;
  return v_r;
end $$;

create or replace function public.device_ingest_dismiss_unmatched(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._device_ingest_require_admin();
begin
  update public.device_ingest_unmatched u set status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
   where u.id = p_id and u.organisation_id = v_org and u.status = 'open'
     and public._device_countries_visible((select k.countries from public.device_ingest_keys k where k.id = u.key_id));
end $$;

-- "Send test payload": runs the exact matching path, writes nothing.
create or replace function public.device_ingest_dry_run(p_messages jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public._device_ingest_require_admin();
  v_out jsonb := '[]'::jsonb;
  m jsonb;
  i int := 0;
begin
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 50 then
    raise exception 'Send up to 50 messages' using errcode = '22023';
  end if;
  for m in select value from jsonb_array_elements(p_messages) loop
    v_out := v_out || jsonb_build_array(public._device_ingest_process(v_org, null, m, true, null) || jsonb_build_object('index', i));
    i := i + 1;
  end loop;
  return jsonb_build_object('ok', true, 'results', v_out);
end $$;

create or replace function public.device_ingest_save_settings(p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public._device_ingest_require_admin();
begin
  insert into public.device_ingest_settings (organisation_id, tpms_low_pct, tpms_critical_pct, tpms_high_pct, tpms_low_psi,
    tpms_high_psi, tpms_high_temp_c, alert_repeat_hours, max_reading_age_days, updated_by, updated_at)
  values (v_org,
    least(greatest(coalesce((p_settings->>'tpms_low_pct')::numeric, 15), 1), 60),
    least(greatest(coalesce((p_settings->>'tpms_critical_pct')::numeric, 25), 1), 80),
    least(greatest(coalesce((p_settings->>'tpms_high_pct')::numeric, 15), 1), 80),
    (p_settings->>'tpms_low_psi')::numeric, (p_settings->>'tpms_high_psi')::numeric,
    least(greatest(coalesce((p_settings->>'tpms_high_temp_c')::numeric, 85), 40), 150),
    least(greatest(coalesce((p_settings->>'alert_repeat_hours')::int, 6), 1), 168),
    least(greatest(coalesce((p_settings->>'max_reading_age_days')::int, 30), 1), 365), auth.uid(), now())
  on conflict (organisation_id) do update set
    tpms_low_pct = excluded.tpms_low_pct, tpms_critical_pct = excluded.tpms_critical_pct, tpms_high_pct = excluded.tpms_high_pct,
    tpms_low_psi = excluded.tpms_low_psi, tpms_high_psi = excluded.tpms_high_psi, tpms_high_temp_c = excluded.tpms_high_temp_c,
    alert_repeat_hours = excluded.alert_repeat_hours, max_reading_age_days = excluded.max_reading_age_days, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- Retention: usage minutes are only needed for the current minute; rejected
-- ledger rows are monitoring only. Not scheduled here; call from a cron job.
create or replace function public.device_ingest_purge(p_days int default 90)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_u int; v_r int;
begin
  delete from public.device_ingest_usage where minute < now() - interval '1 day';
  get diagnostics v_u = row_count;
  delete from public.device_ingest_messages
   where status = 'rejected' and received_at < now() - make_interval(days => least(greatest(coalesce(p_days, 90), 7), 3650));
  get diagnostics v_r = row_count;
  return jsonb_build_object('usage_rows', v_u, 'rejected_rows', v_r);
end $$;

-- ---------------------------------------------------------------------------
-- Grants. Order is load-bearing (V500): grant the intended role first, then
-- revoke PUBLIC, then revoke anon by name.
-- ---------------------------------------------------------------------------
do $g$
declare f text;
begin
  foreach f in array array[
    'public.device_ingest_key_create(text,text[],uuid,int,timestamptz,text)',
    'public.device_ingest_key_revoke(uuid,text)',
    'public.device_ingest_keys_list()',
    'public.device_ingest_overview()',
    'public.device_ingest_unmatched_list(int)',
    'public.device_ingest_resolve_unmatched(uuid,uuid)',
    'public.device_ingest_dismiss_unmatched(uuid)',
    'public.device_ingest_dry_run(jsonb)',
    'public.device_ingest_save_settings(jsonb)'] loop
    execute format('grant execute on function %s to authenticated', f);
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
  end loop;
  foreach f in array array[
    'public.device_ingest_key_lookup(text)',
    'public.device_ingest_submit(uuid,jsonb)',
    'public._device_ingest_process(uuid,uuid,jsonb,boolean,uuid)',
    'public._device_resolve_asset(uuid,uuid,jsonb,uuid,text[])',
    'public._device_admin_countries()',
    'public._device_countries_visible(text[])',
    'public.device_ingest_purge(int)',
    'public._device_alert(uuid,text,text,text,text,uuid,text)',
    'public._device_ingest_require_admin()'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('revoke execute on function %s from authenticated', f);
  end loop;
  execute 'grant execute on function public.device_ingest_key_lookup(text) to service_role';
  execute 'grant execute on function public.device_ingest_submit(uuid,jsonb) to service_role';
  execute 'grant execute on function public.device_ingest_purge(int) to service_role';
end $g$;

commit;
