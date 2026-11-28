-- ============================================================================
-- Workshop Status -> Vehicle intake (shared sheet, phone, manual, ERP-first)
-- ============================================================================
-- STATUS: APPLIED LIVE 2026-11-28 (owner OK). Apply only on an explicit owner go-ahead.
--         Verified live with a rolled-back DO block (see VERIFY at the end).
--
-- WHAT: vehicles coming into the workshop are entered as rows (web shared
-- sheet, phone, a live Google Sheet pushed by Apps Script, or an ERP job card
-- that arrives first). Each row becomes ONE workshop_status_records row, is
-- routed to the on-shift supervisor of its workshop site and waits for that
-- person to confirm it. The vehicle stays listed until a person releases it.
--
-- EXTENDS Workshop Status (no parallel module). Decisions from the
-- independent review of the intake plan:
--   1. Landing table is workshop_status_records (not repair_requests).
--      New columns: intake_source, confirm_status, submitted_*, confirmed_*,
--      returned_*, source_key (unique per source), row_hash, work_order_id,
--      provisional_ref, routed_to, job outcome fields.
--   2. Release rule per source: ONLY rows from the daily Excel may be released
--      by "missing from the file" (patched in workshop_status_confirm_upload).
--      Sheet / phone / manual / ERP rows leave only by a reasoned release.
--   3. Outcomes with a mandatory reason, each an event row: rescheduled (new
--      date), returned_parts_unavailable, closed_other, work_not_done. They
--      keep the vehicle listed until a separate release.
--   4. ERP-first job cards: see 20261128091000 (separate, riskier hot path).
--      Work order numbers are NEVER renamed; a sheet row keeps provisional_ref.
--   5. Incremental ingest: unique (org, source, source_key); the server
--      computes row_hash and skips unchanged rows; at most 200 rows per call.
--   6. Google Sheet: Apps Script push -> edge function (HMAC + timestamp) ->
--      workshop_intake_sheet_ingest (service role only) + heartbeat + silence
--      alert.
--   7. Supervisor roster per site with day / night shifts (default day
--      06:00-18:00, night 18:00-06:00, site-local time). Routing: on-shift ->
--      any supervisor of the site -> area manager. Nobody confirms their own
--      entry: enforced in a trigger, not only in the UI.
--   8. No realtime publication change; clients poll with an updated_at cursor.
--
-- ANTI-MANIPULATION: all times are server-stamped (client time is kept only
-- as client_entered_at); every change is an append-only event; backdated,
-- repeated, flip-flopping, too-quick and bulk-across-sites patterns are listed
-- by workshop_intake_anomalies() for managers, never for the flagged person.
--
-- ROLLBACK (manual, in this order; no data in intake columns is lost by 1-3):
--   1. Re-run 20261007110000/20261011150000 definition of
--      workshop_status_confirm_upload (or reverse the anchored replace).
--   2. Re-create workshop_status_can / _my_permissions from
--      20261007100000 (without 'intake', 'intake_confirm', 'roster').
--   3. drop the workshop_intake_* functions, the trigger
--      trg_workshop_intake_guard, cron job workshop-intake-sheet-watch.
--   4. drop tables workshop_site_supervisors, workshop_intake_sheets and the
--      added columns only after exporting them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns on workshop_status_records
-- ---------------------------------------------------------------------------
alter table public.workshop_status_records
  add column if not exists intake_source      text not null default 'excel_upload',
  add column if not exists confirm_status     text not null default 'confirmed',
  add column if not exists submitted_by       uuid,
  add column if not exists submitted_by_name  text,
  add column if not exists submitted_at       timestamptz,
  add column if not exists client_entered_at  timestamptz,
  add column if not exists confirmed_by       uuid,
  add column if not exists confirmed_by_name  text,
  add column if not exists confirmed_at       timestamptz,
  add column if not exists confirm_note       text,
  add column if not exists returned_reason    text,
  add column if not exists returned_by        uuid,
  add column if not exists returned_at        timestamptz,
  add column if not exists source_key         text,
  add column if not exists row_hash           text,
  add column if not exists work_order_id      uuid references public.work_orders(id) on delete set null,
  add column if not exists provisional_ref    text,
  add column if not exists routed_to          uuid[] not null default '{}',
  add column if not exists routed_at          timestamptz,
  add column if not exists work_type          text,
  add column if not exists priority           text,
  add column if not exists production_out_at  timestamptz,
  add column if not exists link_suggestion    jsonb,
  add column if not exists job_outcome        text,
  add column if not exists job_outcome_reason text,
  add column if not exists job_outcome_by     uuid,
  add column if not exists job_outcome_by_name text,
  add column if not exists job_outcome_at     timestamptz,
  add column if not exists rescheduled_for    date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshop_status_records_intake_source_check') then
    alter table public.workshop_status_records add constraint workshop_status_records_intake_source_check
      check (intake_source in ('excel_upload', 'sheet', 'phone', 'manual', 'erp'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workshop_status_records_confirm_status_check') then
    alter table public.workshop_status_records add constraint workshop_status_records_confirm_status_check
      check (confirm_status in ('pending_confirm', 'confirmed', 'returned'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workshop_status_records_returned_reason') then
    alter table public.workshop_status_records add constraint workshop_status_records_returned_reason
      check (confirm_status <> 'returned' or nullif(btrim(returned_reason), '') is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workshop_status_records_job_outcome_check') then
    alter table public.workshop_status_records add constraint workshop_status_records_job_outcome_check
      check ((job_outcome is null or job_outcome in
               ('rescheduled', 'returned_parts_unavailable', 'closed_other', 'work_not_done'))
             and (job_outcome is null or nullif(btrim(job_outcome_reason), '') is not null)
             and (job_outcome is distinct from 'rescheduled' or rescheduled_for is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workshop_status_records_priority_check') then
    alter table public.workshop_status_records add constraint workshop_status_records_priority_check
      check (priority is null or priority in ('Low', 'Medium', 'High', 'Critical'));
  end if;
end $$;

create unique index if not exists workshop_status_records_source_key
  on public.workshop_status_records (organisation_id, intake_source, source_key)
  where source_key is not null and deleted_at is null;
create index if not exists workshop_status_records_pending_idx
  on public.workshop_status_records (organisation_id, country, confirm_status)
  where confirm_status <> 'confirmed' and current_active;
create index if not exists workshop_status_records_routed_idx
  on public.workshop_status_records using gin (routed_to);
create index if not exists workshop_status_records_poll_idx
  on public.workshop_status_records (organisation_id, country, updated_at desc);
create index if not exists workshop_status_records_wo_idx
  on public.workshop_status_records (work_order_id) where work_order_id is not null;

-- Event vocabulary: add the intake events (widening only; no row can fail it).
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.workshop_status_events'::regclass and conname = 'workshop_status_events_event_type_check';
  if v_def is not null and v_def not like '%intake_submitted%' then
    execute $c$alter table public.workshop_status_events
      drop constraint workshop_status_events_event_type_check,
      add constraint workshop_status_events_event_type_check
      check (event_type in ('added', 'excel_updated', 'removed', 'manual_update', 'field_change',
        'restored', 'archived', 'unarchived', 'soft_deleted', 'undeleted', 'permanently_deleted',
        'final_disposition', 'attachment_added', 'attachment_removed', 'upload_previewed',
        'upload_confirmed', 'upload_cancelled', 'upload_failed', 'export',
        'intake_submitted', 'intake_updated', 'intake_confirmed', 'intake_returned',
        'intake_linked', 'job_outcome', 'released', 'roster_changed'))$c$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Supervisor roster and registered sheets
-- ---------------------------------------------------------------------------
create table if not exists public.workshop_site_supervisors (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country         text not null,
  site            text not null,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'primary' check (role in ('primary', 'backup')),
  shift_name      text not null default 'day' check (shift_name in ('day', 'night', 'all')),
  shift_start     time,
  shift_end       time,
  active          boolean not null default true,
  valid_from      date,
  valid_to        date,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  constraint workshop_site_supervisors_dates check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create unique index if not exists workshop_site_supervisors_one
  on public.workshop_site_supervisors (organisation_id, lower(country), upper(site), user_id, shift_name)
  where active;
create index if not exists workshop_site_supervisors_site_idx
  on public.workshop_site_supervisors (organisation_id, lower(country), upper(site)) where active;

create table if not exists public.workshop_intake_sheets (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null default public.app_current_org(),
  country           text not null,
  name              text not null,
  default_site      text,
  active            boolean not null default true,
  last_seen_at      timestamptz,
  last_row_count    integer,
  last_result       jsonb,
  silent_alerted_at timestamptz,
  last_request_ts   bigint,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

alter table public.workshop_site_supervisors enable row level security;
alter table public.workshop_intake_sheets enable row level security;
revoke all on public.workshop_site_supervisors from anon, authenticated;
revoke all on public.workshop_intake_sheets from anon, authenticated;
grant select on public.workshop_site_supervisors to authenticated;
grant select on public.workshop_intake_sheets to authenticated;

-- Policies are created once (no DROP needed: both tables are new).
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'workshop_site_supervisors' and policyname = 'workshop_site_supervisors_org') then
    create policy workshop_site_supervisors_org on public.workshop_site_supervisors
      as restrictive for all to authenticated
      using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'workshop_site_supervisors' and policyname = 'workshop_site_supervisors_read') then
    create policy workshop_site_supervisors_read on public.workshop_site_supervisors
      for select to authenticated using ((select public.workshop_status_can_view()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'workshop_intake_sheets' and policyname = 'workshop_intake_sheets_org') then
    create policy workshop_intake_sheets_org on public.workshop_intake_sheets
      as restrictive for all to authenticated
      using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'workshop_intake_sheets' and policyname = 'workshop_intake_sheets_read') then
    create policy workshop_intake_sheets_read on public.workshop_intake_sheets
      for select to authenticated using ((select public.workshop_status_can('configure')));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Permissions: add intake, intake_confirm, roster (same function, same
--    fail-closed rules; no all-sites requirement so a site supervisor can
--    confirm his own site).
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_can(p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
begin
  if not coalesce(public.app_is_active(), false) then return false; end if;
  if not (v_action = any (array[
      'view', 'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'view_audit',
      'update', 'upload', 'confirm', 'assign', 'disposition', 'export',
      'archive', 'restore', 'soft_delete', 'configure', 'permanent_delete',
      'intake', 'intake_confirm', 'roster'])) then
    return false;
  end if;
  if coalesce(public.is_super_admin(), false) then return true; end if;
  if v_action = 'permanent_delete' then return false; end if;
  if v_action = 'view' then return coalesce(public.workshop_status_can_view(), false); end if;
  -- Loop 17: a daily file is country-wide, so staging or confirming one needs the whole site scope.
  if v_action in ('upload', 'confirm')
     and not coalesce(public.app_sees_all_sites(), false) then
    return false;
  end if;
  return coalesce(public.workshop_status_can_view(), false)
     and coalesce(public.app_user_can('daily_ops:workshop:' || v_action, 'view'), false);
end $$;

create or replace function public.workshop_status_my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(a, public.workshop_status_can(a))
    from unnest(array[
      'view', 'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'view_audit',
      'update', 'upload', 'confirm', 'assign', 'disposition', 'export',
      'archive', 'restore', 'soft_delete', 'configure', 'permanent_delete',
      'intake', 'intake_confirm', 'roster']) as a
$$;

-- Role defaults, insert-only (an administrator's existing row is untouched).
do $$
declare
  -- Who may add vehicles to the intake sheet.
  v_intake_roles text[] := array['Workshop Supervisor', 'Maintenance Supervisor',
    'Workshop Area Manager', 'Workshop Maintenance Area Manager',
    'PMV Manager', 'Manager', 'Data Monitor Officer'];
  -- Who confirms a vehicle routed to them and edits the site roster.
  v_confirm_roles text[] := array['Workshop Supervisor', 'Maintenance Supervisor',
    'Workshop Area Manager', 'Workshop Maintenance Area Manager'];
begin
  if to_regclass('public.module_permissions') is null then return; end if;
  insert into public.module_permissions (role, module_key, enabled, org_id)
  select s.role, s.module_key, true, null
    from (
      select r as role, 'daily_ops:workshop' as module_key from unnest(v_intake_roles) r
      union select r, 'daily_ops:workshop:intake' from unnest(v_intake_roles) r
      union select r, 'daily_ops:workshop:intake_confirm' from unnest(v_confirm_roles) r
      union select r, 'daily_ops:workshop:roster' from unnest(v_confirm_roles) r
    ) s
   where not exists (select 1 from public.module_permissions x
                      where x.role = s.role and x.module_key = s.module_key and x.org_id is null);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.workshop_intake_tz(p_country text)
returns text language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p_country, '')))
           when 'uae' then 'Asia/Dubai' when 'egypt' then 'Africa/Cairo' else 'Asia/Riyadh' end
$$;

-- Is the time-of-day inside a shift? A shift whose end is before its start
-- crosses midnight (night 18:00-06:00). No times means "always".
create or replace function public.workshop_intake_in_shift(p_t time, p_start time, p_end time)
returns boolean language sql immutable set search_path = public as $$
  select case
    when p_start is null or p_end is null or p_start = p_end then true
    when p_start < p_end then p_t >= p_start and p_t < p_end
    else p_t >= p_start or p_t < p_end end
$$;

-- Same caller scope check every writer uses (org, country, site).
create or replace function public.workshop_intake_in_scope(p_org uuid, p_country text, p_site text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_super_admin(), false)
      or (p_org is not distinct from public.app_current_org()
          and (p_country is null or coalesce(public.app_sees_all_countries(), false)
               or lower(btrim(p_country)) = any (coalesce(public.app_country_scope(), '{}'::text[])))
          and (p_site is null or btrim(p_site) = '' or coalesce(public.app_sees_all_sites(), false)
               or upper(btrim(p_site)) = any (coalesce(public.app_site_scope(), '{}'::text[]))))
$$;

-- Could this person confirm a vehicle of this country / site? Evaluated AS that
-- person (same impersonation pattern as workshop_status_recipient_scope).
create or replace function public.workshop_intake_recipient_ok(p_uid uuid, p_org uuid, p_country text, p_site text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_sub text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v boolean := false;
begin
  if p_uid is null then return false; end if;
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    v := coalesce(public.workshop_status_can('intake_confirm'), false)
         and coalesce(public.workshop_intake_in_scope(p_org, p_country, p_site), false);
  exception when others then
    v := false;
  end;
  perform set_config('request.jwt.claim.sub', v_sub, true);
  perform set_config('request.jwt.claims', v_claims, true);
  return v;
end $$;

-- Who gets a vehicle: on-shift supervisors of the site (primary first), else
-- any active supervisor of the site, else the area managers of the
-- organisation. The person who entered the row is always left out.
create or replace function public.workshop_intake_route(
  p_org uuid, p_country text, p_site text, p_at timestamptz, p_exclude uuid)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_local timestamp := p_at at time zone public.workshop_intake_tz(p_country);
  v_out uuid[] := '{}';
begin
  select coalesce(array_agg(s.user_id order by (s.role = 'primary') desc, s.created_at), '{}')
    into v_out
    from public.workshop_site_supervisors s
   where s.organisation_id = p_org and s.active
     and lower(s.country) = lower(btrim(coalesce(p_country, '')))
     and upper(btrim(s.site)) = upper(btrim(coalesce(p_site, '')))
     and (s.valid_from is null or s.valid_from <= v_local::date)
     and (s.valid_to is null or s.valid_to >= v_local::date)
     and s.user_id is distinct from p_exclude
     and public.workshop_intake_in_shift(v_local::time, s.shift_start, s.shift_end)
     and public.workshop_intake_recipient_ok(s.user_id, p_org, p_country, p_site);
  if cardinality(v_out) > 0 then return (select array_agg(distinct u) from unnest(v_out) u); end if;

  select coalesce(array_agg(distinct s.user_id), '{}') into v_out
    from public.workshop_site_supervisors s
   where s.organisation_id = p_org and s.active
     and lower(s.country) = lower(btrim(coalesce(p_country, '')))
     and upper(btrim(s.site)) = upper(btrim(coalesce(p_site, '')))
     and s.user_id is distinct from p_exclude
     and public.workshop_intake_recipient_ok(s.user_id, p_org, p_country, p_site);
  if cardinality(v_out) > 0 then return v_out; end if;

  select coalesce(array_agg(distinct p.id), '{}') into v_out
    from public.profiles p
   where (p.organisation_id = p_org or p.org_id = p_org)
     and p.role in ('Workshop Maintenance Area Manager', 'Workshop Area Manager')
     and coalesce(p.approved, false) and not coalesce(p.locked, false)
     and p.id is distinct from p_exclude
     and public.workshop_intake_recipient_ok(p.id, p_org, p_country, p_site);
  return v_out;
end $$;

-- Content fingerprint computed by the SERVER (a client hash is never trusted).
create or replace function public.workshop_intake_hash(
  p_asset text, p_site text, p_jc text, p_complaint text, p_type text, p_priority text,
  p_out timestamptz, p_remarks text)
returns text language sql immutable set search_path = public as $$
  select md5(concat_ws('|', upper(coalesce(p_asset, '')), upper(btrim(coalesce(p_site, ''))),
    upper(btrim(coalesce(p_jc, ''))), btrim(coalesce(p_complaint, '')), coalesce(p_type, ''),
    coalesce(p_priority, ''), coalesce(to_char(p_out at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), ''),
    btrim(coalesce(p_remarks, ''))))
$$;

create or replace function public.workshop_intake_ts(p text)
returns timestamptz language plpgsql immutable set search_path = public as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return p::timestamptz;
exception when others then return null;
end $$;

-- One digest per recipient: "N vehicles waiting for you to confirm", N being
-- that person's whole pending count, not just this batch.
create or replace function public.workshop_intake_notify(p_org uuid, p_users uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_u uuid; v_n int; v_assets text[]; v_sent int := 0;
begin
  for v_u in select distinct u from unnest(coalesce(p_users, '{}')) u where u is not null loop
    select count(*)::int, (array_agg(r.asset_no order by r.submitted_at desc))[1:5]
      into v_n, v_assets
      from public.workshop_status_records r
     where r.organisation_id = p_org and r.current_active and r.deleted_at is null
       and r.confirm_status = 'pending_confirm' and v_u = any (r.routed_to);
    if v_n > 0 then
      perform public.workshop_status_notice_send(p_org, v_u, 'workshop_intake_pending',
        case when v_n = 1 then '1 vehicle waiting for you to confirm'
             else v_n || ' vehicles waiting for you to confirm' end,
        public.workshop_status_asset_list(v_assets),
        'workshop_status', null, '/daily-ops/workshop?tab=intake&view=waiting');
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end $$;

-- Find (or create) the work order for a confirmed vehicle with a job card
-- number. Never renames a number. Returns a small result object.
create or replace function public.workshop_intake_link_work_order(p_record_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.workshop_status_records%rowtype;
  w record;
  v_type text;
  v_id uuid;
begin
  select * into r from public.workshop_status_records where id = p_record_id;
  if not found or nullif(btrim(r.job_card_ref), '') is null then
    return jsonb_build_object('linked', false, 'reason', 'no_job_card');
  end if;
  select id, asset_no, status into w from public.work_orders
   where organisation_id = r.organisation_id and work_order_no = btrim(r.job_card_ref);
  if found then
    if public.workshop_status_asset_key(w.asset_no) <> public.workshop_status_asset_key(r.asset_no) then
      return jsonb_build_object('linked', false, 'reason', 'job_card_other_vehicle', 'asset_no', w.asset_no);
    end if;
    update public.work_orders set status = 'Awaiting Assignment', updated_at = now()
     where id = w.id and status in ('Open', 'New');
    update public.workshop_status_records set work_order_id = w.id where id = r.id;
    return jsonb_build_object('linked', true, 'created', false, 'work_order_id', w.id);
  end if;
  v_type := case when r.work_type in ('Tyre Change', 'Inspection', 'Repair', 'Emergency', 'Other',
                                      'Service', 'Preventive Maintenance') then r.work_type else 'Repair' end;
  insert into public.work_orders (organisation_id, country, work_order_no, asset_no, plate_no, site,
                                  status, work_type, description, opened_at, production_out_at, custom_data)
  values (r.organisation_id, r.country, btrim(r.job_card_ref), r.asset_no, r.reg_no, r.site,
          'Awaiting Assignment', v_type, r.complaint,
          coalesce(r.production_out_at, r.first_seen_at), r.production_out_at,
          jsonb_build_object('origin', 'workshop_intake', 'workshop_record_id', r.id,
                             'intake_source', r.intake_source))
  returning id into v_id;
  update public.workshop_status_records set work_order_id = v_id where id = r.id;
  return jsonb_build_object('linked', true, 'created', true, 'work_order_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Guard trigger: identity of the intake, server stamps, self-confirm rule.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_intake_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    -- Server time only: submitted_at / confirmed_at are never client-supplied.
    NEW.submitted_at := case when NEW.intake_source <> 'excel_upload' then now() end;
    NEW.confirmed_at := case when NEW.confirm_status = 'confirmed' then now() end;
    NEW.confirmed_by := case when NEW.confirm_status = 'confirmed' then v_uid end;
    return NEW;
  end if;
  if NEW.intake_source is distinct from OLD.intake_source
     or NEW.submitted_by is distinct from OLD.submitted_by
     or NEW.submitted_at is distinct from OLD.submitted_at
     or NEW.client_entered_at is distinct from OLD.client_entered_at
     or (OLD.source_key is not null and NEW.source_key is distinct from OLD.source_key) then
    raise exception 'Who entered a workshop vehicle, and when, cannot be changed' using errcode = '42501';
  end if;
  if OLD.confirm_status = 'confirmed' and NEW.confirm_status <> 'confirmed' then
    raise exception 'A confirmed vehicle cannot be unconfirmed' using errcode = '42501';
  end if;
  if NEW.confirm_status = 'confirmed' and OLD.confirm_status <> 'confirmed' then
    if v_uid is null then
      raise exception 'A vehicle must be confirmed by a person' using errcode = '42501';
    end if;
    if v_uid = coalesce(OLD.submitted_by, OLD.first_seen_by) then
      raise exception 'You entered this vehicle. Another supervisor or the area manager must confirm it'
        using errcode = '42501';
    end if;
    NEW.confirmed_by := v_uid;
    NEW.confirmed_by_name := coalesce(public.workshop_status_actor_name(), 'System');
    NEW.confirmed_at := now();
  else
    NEW.confirmed_by := OLD.confirmed_by;
    NEW.confirmed_by_name := OLD.confirmed_by_name;
    NEW.confirmed_at := OLD.confirmed_at;
  end if;
  if NEW.confirm_status = 'returned' and OLD.confirm_status <> 'returned' then
    NEW.returned_by := v_uid;
    NEW.returned_at := now();
  elsif NEW.confirm_status = OLD.confirm_status then
    NEW.returned_by := OLD.returned_by;
    NEW.returned_at := OLD.returned_at;
  end if;
  if NEW.job_outcome is distinct from OLD.job_outcome
     or NEW.job_outcome_reason is distinct from OLD.job_outcome_reason
     or NEW.rescheduled_for is distinct from OLD.rescheduled_for then
    NEW.job_outcome_by := v_uid;
    NEW.job_outcome_by_name := coalesce(public.workshop_status_actor_name(), 'System');
    NEW.job_outcome_at := now();
  else
    NEW.job_outcome_by := OLD.job_outcome_by;
    NEW.job_outcome_by_name := OLD.job_outcome_by_name;
    NEW.job_outcome_at := OLD.job_outcome_at;
  end if;
  return NEW;
end $$;

create or replace trigger trg_workshop_intake_guard
  before insert or update on public.workshop_status_records
  for each row execute function public.workshop_intake_guard();

-- ---------------------------------------------------------------------------
-- 6. Release rule per source (anchored replace of the LIVE definition).
--    Only daily-Excel rows can be released by "missing from the file".
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.workshop_status_confirm_upload(uuid,boolean)'::regprocedure);
  v_anchor text := E'and not (public.workshop_status_asset_key(asset_no) = any (v_active))\n     order by asset_no, id';
  v_new text := E'and not (public.workshop_status_asset_key(asset_no) = any (v_active))\n'
             || E'       and coalesce(intake_source, ''excel_upload'') = ''excel_upload''\n     order by asset_no, id';
  v_n int;
begin
  if strpos(v_def, 'coalesce(intake_source, ''excel_upload'')') > 0 then return; end if;  -- already patched
  select count(*) into v_n from regexp_matches(v_def, 'any \(v_active\)\)\n     order by asset_no, id', 'g');
  if v_n <> 1 then
    raise exception 'workshop_status_confirm_upload anchor matched % times (expected 1); not patched', v_n;
  end if;
  execute replace(v_def, v_anchor, v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Ingest core (shared by web sheet, phone, manual and the Google Sheet).
--    Incremental: an unchanged row (same server hash) is skipped.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_intake__ingest(
  p_org uuid, p_country text, p_source text, p_rows jsonb, p_actor uuid, p_default_site text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e jsonb;
  v_res jsonb := '[]'::jsonb;
  v_key text; v_asset text; v_site text; v_jc text; v_comp text; v_type text; v_prio text;
  v_out timestamptz; v_rem text; v_client timestamptz; v_hash text;
  r public.workshop_status_records%rowtype;
  v_f record;
  v_id uuid; v_route uuid[];
  v_notify uuid[] := '{}';
  n_new int := 0; n_upd int := 0; n_same int := 0; n_dup int := 0; n_bad int := 0; n_skip int := 0;
  v_name text := case when p_actor is null then 'System' else coalesce(public.workshop_status_actor_name(), 'System') end;
begin
  if p_source not in ('sheet', 'phone', 'manual') then
    raise exception 'Unknown intake source' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'Send at most 200 rows at a time' using errcode = '22023';
  end if;
  perform set_config('workshop.source', case when p_source = 'sheet' then 'system' else 'manual' end, true);

  for e in select value from jsonb_array_elements(p_rows) loop
    v_key   := nullif(btrim(e ->> 'source_key'), '');
    v_asset := nullif(upper(regexp_replace(coalesce(e ->> 'asset_no', ''), '\s', '', 'g')), '');
    v_site  := nullif(upper(btrim(coalesce(e ->> 'site', ''))), '');
    v_jc    := nullif(btrim(coalesce(e ->> 'job_card_ref', '')), '');
    v_comp  := nullif(btrim(coalesce(e ->> 'complaint', '')), '');
    v_type  := nullif(btrim(coalesce(e ->> 'work_type', '')), '');
    v_prio  := case when initcap(btrim(coalesce(e ->> 'priority', ''))) in ('Low', 'Medium', 'High', 'Critical')
                    then initcap(btrim(e ->> 'priority')) end;
    v_out   := public.workshop_intake_ts(e ->> 'production_out_at');
    v_rem   := nullif(btrim(coalesce(e ->> 'remarks', '')), '');
    v_client := public.workshop_intake_ts(e ->> 'client_entered_at');

    if v_key is null and p_source = 'sheet' then
      n_bad := n_bad + 1;
      v_res := v_res || jsonb_build_object('outcome', 'invalid', 'asset_no', v_asset, 'message', 'Row id is missing');
      continue;
    end if;
    v_key := coalesce(v_key, gen_random_uuid()::text);
    if v_asset is null then
      n_bad := n_bad + 1;
      v_res := v_res || jsonb_build_object('source_key', v_key, 'outcome', 'invalid', 'message', 'Asset code is missing');
      continue;
    end if;
    if v_out is not null and v_out > now() + interval '1 hour' then
      n_bad := n_bad + 1;
      v_res := v_res || jsonb_build_object('source_key', v_key, 'outcome', 'invalid', 'asset_no', v_asset,
                                            'message', 'Production out time is in the future');
      continue;
    end if;

    select f.id, f.registration_no, f.vehicle_type, f.site into v_f
      from public.vehicle_fleet f
     where f.organisation_id = p_org and lower(f.country) = lower(p_country)
       and upper(regexp_replace(f.asset_no, '\s', '', 'g')) = v_asset
     limit 1;
    v_site := coalesce(v_site, nullif(upper(btrim(p_default_site)), ''), upper(btrim(v_f.site)));
    v_hash := public.workshop_intake_hash(v_asset, v_site, v_jc, v_comp, v_type, v_prio, v_out, v_rem);

    -- The same row seen before (same source, same row id)?
    select * into r from public.workshop_status_records
     where organisation_id = p_org and intake_source = p_source and source_key = v_key and deleted_at is null
     order by current_active desc, created_at desc limit 1;
    if found then
      if r.row_hash = v_hash then
        n_same := n_same + 1;
        v_res := v_res || jsonb_build_object('source_key', v_key, 'outcome', 'unchanged', 'record_id', r.id);
      elsif not r.current_active then
        n_skip := n_skip + 1;
        v_res := v_res || jsonb_build_object('source_key', v_key, 'outcome', 'released', 'record_id', r.id,
                                              'message', 'This vehicle was already released');
      else
        v_route := case when upper(btrim(coalesce(r.site, ''))) is distinct from coalesce(v_site, '')
                          and r.confirm_status <> 'confirmed'
                        then public.workshop_intake_route(p_org, p_country, v_site, now(), r.submitted_by)
                        else r.routed_to end;
        update public.workshop_status_records set
          site = v_site, job_card_ref = coalesce(v_jc, job_card_ref), complaint = v_comp,
          work_type = v_type, priority = v_prio, production_out_at = v_out, source_remarks = v_rem,
          row_hash = v_hash, routed_to = v_route,
          routed_at = case when v_route is distinct from r.routed_to then now() else routed_at end,
          confirm_status = case when confirm_status = 'returned' then 'pending_confirm' else confirm_status end
         where id = r.id;
        insert into public.workshop_status_events
          (organisation_id, country, site, record_id, asset_no, event_type, source, details)
        values (p_org, p_country, v_site, r.id, r.asset_no, 'intake_updated',
                case when p_source = 'sheet' then 'system' else 'manual' end,
                jsonb_build_object('intake_source', p_source, 'source_key', v_key,
                  'resubmitted', r.confirm_status = 'returned',
                  'before', jsonb_build_object('site', r.site, 'job_card_ref', r.job_card_ref,
                    'complaint', r.complaint, 'work_type', r.work_type, 'priority', r.priority,
                    'production_out_at', r.production_out_at)));
        if r.confirm_status = 'returned' or v_route is distinct from r.routed_to then
          v_notify := v_notify || v_route;
        end if;
        n_upd := n_upd + 1;
        v_res := v_res || jsonb_build_object('source_key', v_key, 'outcome', 'updated', 'record_id', r.id);
      end if;
      continue;
    end if;

    -- Vehicle already in the workshop list (any source)?
    select * into r from public.workshop_status_records
     where organisation_id = p_org and country = p_country and current_active and deleted_at is null
       and public.workshop_status_asset_key(asset_no) = v_asset
     limit 1;
    if found then
      n_dup := n_dup + 1;
      v_res := v_res || jsonb_build_object('source_key', v_key, 'outcome', 'already_listed', 'record_id', r.id,
                                            'asset_no', v_asset, 'message', 'This vehicle is already in the workshop list');
      continue;
    end if;

    v_route := public.workshop_intake_route(p_org, p_country, v_site, now(), p_actor);
    insert into public.workshop_status_records
      (organisation_id, country, asset_no, vehicle_id, asset_breakdown_id, reg_no, vehicle_category, site,
       job_card_ref, complaint, source_remarks, ooc_since, current_active, daily_report_status,
       intake_source, confirm_status, submitted_by, submitted_by_name, client_entered_at,
       source_key, row_hash, routed_to, routed_at, work_type, priority, production_out_at,
       excel_data)
    values
      (p_org, p_country, v_asset, v_f.id, public.workshop_status_breakdown_for(p_org, p_country, v_asset),
       coalesce(nullif(btrim(e ->> 'reg_no'), ''), v_f.registration_no), v_f.vehicle_type, v_site,
       v_jc, v_comp, v_rem, (coalesce(v_out, now()) at time zone public.workshop_intake_tz(p_country))::date,
       true, 'active',
       p_source, 'pending_confirm', p_actor, v_name, v_client,
       v_key, v_hash, v_route, now(), v_type, v_prio, v_out,
       jsonb_strip_nulls(jsonb_build_object('entered_by', nullif(btrim(e ->> 'entered_by'), ''))))
    returning id into v_id;
    update public.workshop_status_records
       set provisional_ref = 'WI-' || upper(substr(replace(v_id::text, '-', ''), 1, 8))
     where id = v_id;
    insert into public.workshop_status_events
      (organisation_id, country, site, record_id, asset_no, event_type, source, details)
    values (p_org, p_country, v_site, v_id, v_asset, 'intake_submitted',
            case when p_source = 'sheet' then 'system' else 'manual' end,
            jsonb_strip_nulls(jsonb_build_object('intake_source', p_source, 'source_key', v_key,
              'routed_to', to_jsonb(v_route), 'client_entered_at', v_client,
              'unknown_vehicle', v_f.id is null, 'no_supervisor', cardinality(v_route) = 0)));
    v_notify := v_notify || v_route;
    n_new := n_new + 1;
    v_res := v_res || jsonb_build_object('source_key', v_key, 'outcome', 'new', 'record_id', v_id,
                                          'asset_no', v_asset, 'routed', cardinality(v_route),
                                          'unknown_vehicle', v_f.id is null);
  end loop;
  perform set_config('workshop.source', '', true);
  perform public.workshop_intake_notify(p_org, v_notify);
  return jsonb_build_object('new', n_new, 'updated', n_upd, 'unchanged', n_same, 'already_listed', n_dup,
                            'invalid', n_bad, 'released', n_skip, 'rows', v_res);
end $$;

-- Web sheet / phone / manual entry by the signed-in person.
create or replace function public.workshop_intake_upsert_rows(p_country text, p_source text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.app_current_org();
begin
  if not coalesce(public.workshop_status_can('intake'), false) then
    raise exception 'You do not have permission to add workshop vehicles' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'Your account is not linked to an organisation' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_country, '')), '') is null
     or not public.workshop_intake_in_scope(v_org, p_country, null) then
    raise exception 'Choose a country you can work in' using errcode = '42501';
  end if;
  if coalesce(p_source, '') not in ('sheet', 'phone', 'manual') then
    raise exception 'Unknown intake source' using errcode = '22023';
  end if;
  -- A row for a site outside the caller's scope is refused, not silently moved.
  if exists (select 1 from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
              where nullif(btrim(x ->> 'site'), '') is not null
                and not public.workshop_intake_in_scope(v_org, p_country, x ->> 'site')) then
    raise exception 'One or more rows are for a site you cannot work in' using errcode = '42501';
  end if;
  return public.workshop_intake__ingest(v_org, p_country, p_source, p_rows, auth.uid(), null);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Confirm / return / outcome / release / job card / roster
-- ---------------------------------------------------------------------------
create or replace function public.workshop_intake__load(p_id uuid)
returns public.workshop_status_records language plpgsql security definer set search_path = public as $$
declare r public.workshop_status_records%rowtype;
begin
  select * into r from public.workshop_status_records where id = p_id for update;
  if not found or r.deleted_at is not null
     or not public.workshop_intake_in_scope(r.organisation_id, r.country, r.site) then
    raise exception 'Workshop vehicle not found' using errcode = 'P0002';
  end if;
  return r;
end $$;

create or replace function public.workshop_intake_confirm(p_ids uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; r public.workshop_status_records%rowtype;
  v_out jsonb := '[]'::jsonb; v_link jsonb;
  v_override boolean := coalesce(public.is_super_admin(), false)
    or public.app_role() in ('admin')
    or exists (select 1 from public.profiles p where p.id = auth.uid()
                and p.role in ('Workshop Maintenance Area Manager', 'Workshop Area Manager'));
begin
  if not coalesce(public.workshop_status_can('intake_confirm'), false) then
    raise exception 'You do not have permission to confirm workshop vehicles' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_ids, '{}')) = 0 or cardinality(p_ids) > 200 then
    raise exception 'Choose between 1 and 200 vehicles' using errcode = '22023';
  end if;
  perform set_config('workshop.source', 'manual', true);
  foreach v_id in array p_ids loop
    begin
      r := public.workshop_intake__load(v_id);
      if r.confirm_status = 'confirmed' then
        v_out := v_out || jsonb_build_object('id', v_id, 'outcome', 'already_confirmed', 'by', r.confirmed_by_name);
        continue;
      end if;
      if not r.current_active then
        v_out := v_out || jsonb_build_object('id', v_id, 'outcome', 'released');
        continue;
      end if;
      if not (auth.uid() = any (r.routed_to)) and not v_override then
        v_out := v_out || jsonb_build_object('id', v_id, 'outcome', 'not_routed_to_you');
        continue;
      end if;
      update public.workshop_status_records
         set confirm_status = 'confirmed', confirm_note = nullif(btrim(coalesce(p_note, '')), '')
       where id = v_id;  -- trg_workshop_intake_guard refuses a self-confirm and stamps who / when
      v_link := public.workshop_intake_link_work_order(v_id);
      insert into public.workshop_status_events
        (organisation_id, country, site, record_id, asset_no, event_type, reason, source, details)
      values (r.organisation_id, r.country, r.site, r.id, r.asset_no, 'intake_confirmed',
              nullif(btrim(coalesce(p_note, '')), ''), 'manual',
              jsonb_build_object('intake_source', r.intake_source, 'override', not (auth.uid() = any (r.routed_to)),
                                 'work_order', v_link));
      v_out := v_out || jsonb_build_object('id', v_id, 'outcome', 'confirmed', 'work_order', v_link);
    exception when sqlstate '42501' or sqlstate 'P0002' then
      v_out := v_out || jsonb_build_object('id', v_id, 'outcome', 'refused', 'message', sqlerrm);
    end;
  end loop;
  perform set_config('workshop.source', '', true);
  return jsonb_build_object('results', v_out);
end $$;

create or replace function public.workshop_intake_return(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workshop_status_records%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not coalesce(public.workshop_status_can('intake_confirm'), false) then
    raise exception 'You do not have permission to return workshop vehicles' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'Give a reason (at least 5 characters)' using errcode = '22023';
  end if;
  r := public.workshop_intake__load(p_id);
  if r.confirm_status <> 'pending_confirm' or not r.current_active then
    raise exception 'Only a vehicle waiting for confirmation can be returned' using errcode = '22023';
  end if;
  perform set_config('workshop.source', 'manual', true);
  update public.workshop_status_records set confirm_status = 'returned', returned_reason = v_reason where id = p_id;
  insert into public.workshop_status_events
    (organisation_id, country, site, record_id, asset_no, event_type, reason, source, details)
  values (r.organisation_id, r.country, r.site, r.id, r.asset_no, 'intake_returned', v_reason, 'manual',
          jsonb_build_object('intake_source', r.intake_source));
  if r.submitted_by is not null then
    perform public.workshop_status_notice_send(r.organisation_id, r.submitted_by, 'workshop_intake_returned',
      'Workshop vehicle returned to you: ' || r.asset_no, v_reason, 'workshop_status', r.id,
      '/daily-ops/workshop?tab=intake&record=' || r.id);
  end if;
  perform set_config('workshop.source', '', true);
  return jsonb_build_object('id', p_id, 'outcome', 'returned');
end $$;

create or replace function public.workshop_intake_set_outcome(
  p_id uuid, p_outcome text, p_reason text, p_rescheduled_for date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.workshop_status_records%rowtype;
  v_o text := nullif(lower(btrim(coalesce(p_outcome, ''))), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not coalesce(public.workshop_status_can('update'), false) then
    raise exception 'You do not have permission to update workshop vehicles' using errcode = '42501';
  end if;
  if v_o is not null and v_o not in ('rescheduled', 'returned_parts_unavailable', 'closed_other', 'work_not_done') then
    raise exception 'Unknown outcome' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'Give a reason (at least 5 characters)' using errcode = '22023';
  end if;
  if v_o = 'rescheduled' and (p_rescheduled_for is null
      or p_rescheduled_for < (now() at time zone 'Asia/Riyadh')::date - 1) then
    raise exception 'Choose the new date for the rescheduled job' using errcode = '22023';
  end if;
  r := public.workshop_intake__load(p_id);
  if not r.current_active then
    raise exception 'This vehicle was already released' using errcode = '22023';
  end if;
  perform set_config('workshop.source', 'manual', true);
  update public.workshop_status_records set
    job_outcome = v_o,
    job_outcome_reason = case when v_o is null then null else v_reason end,
    rescheduled_for = case when v_o = 'rescheduled' then p_rescheduled_for end,
    expected_release_date = case when v_o = 'rescheduled' then p_rescheduled_for else expected_release_date end
   where id = p_id;
  insert into public.workshop_status_events
    (organisation_id, country, site, record_id, asset_no, event_type, field_name, old_value, new_value, reason, source, details)
  values (r.organisation_id, r.country, r.site, r.id, r.asset_no, 'job_outcome', 'job_outcome',
          r.job_outcome, coalesce(v_o, 'cleared'), v_reason, 'manual',
          jsonb_strip_nulls(jsonb_build_object('rescheduled_for', p_rescheduled_for)));
  perform set_config('workshop.source', '', true);
  return jsonb_build_object('id', p_id, 'outcome', coalesce(v_o, 'cleared'));
end $$;

-- A reasoned release by a person. Excel rows are normally released by the file;
-- this is the only way out for sheet / phone / manual / ERP rows.
create or replace function public.workshop_intake_release(p_id uuid, p_disposition text, p_remarks text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.workshop_status_records%rowtype;
  v_d text := nullif(lower(btrim(coalesce(p_disposition, ''))), '');
  v_rem text := nullif(btrim(coalesce(p_remarks, '')), '');
begin
  if not coalesce(public.workshop_status_can('disposition'), false) then
    raise exception 'You do not have permission to release workshop vehicles' using errcode = '42501';
  end if;
  if v_d is null or v_d not in ('repair_completed', 'returned_to_operation', 'transferred_site',
      'sent_external_workshop', 'vehicle_sold', 'vehicle_scrapped', 'wrong_entry', 'duplicate_entry', 'other') then
    raise exception 'Choose how the vehicle left the workshop' using errcode = '22023';
  end if;
  if v_rem is null or length(v_rem) < 5 then
    raise exception 'Give a reason (at least 5 characters)' using errcode = '22023';
  end if;
  r := public.workshop_intake__load(p_id);
  if not r.current_active then
    raise exception 'This vehicle was already released' using errcode = '22023';
  end if;
  perform set_config('workshop.source', 'manual', true);
  perform set_config('workshop.reason', 'released_by_person', true);
  update public.workshop_status_records set
    current_active = false, daily_report_status = 'removed_from_current_report',
    removed_at = now(), removed_reason = 'released_by_person',
    previous_current_stage = current_stage, previous_delay_reason = delay_reason,
    previous_responsible_user_id = responsible_user_id,
    final_disposition = v_d, final_disposition_remarks = v_rem
   where id = p_id;
  insert into public.workshop_status_events
    (organisation_id, country, site, record_id, asset_no, event_type, reason, source, details)
  values (r.organisation_id, r.country, r.site, r.id, r.asset_no, 'released', v_rem, 'manual',
          jsonb_build_object('disposition', v_d, 'intake_source', r.intake_source,
                             'confirm_status', r.confirm_status));
  perform set_config('workshop.reason', '', true);
  perform set_config('workshop.source', '', true);
  return jsonb_build_object('id', p_id, 'outcome', 'released');
end $$;

create or replace function public.workshop_intake_set_job_card(p_id uuid, p_job_card text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workshop_status_records%rowtype; v_jc text := nullif(btrim(coalesce(p_job_card, '')), ''); v_link jsonb;
begin
  if not (coalesce(public.workshop_status_can('update'), false) or coalesce(public.workshop_status_can('intake'), false)) then
    raise exception 'You do not have permission to update workshop vehicles' using errcode = '42501';
  end if;
  if v_jc is null then raise exception 'Enter the job card number' using errcode = '22023'; end if;
  r := public.workshop_intake__load(p_id);
  if r.work_order_id is not null then
    raise exception 'This vehicle is already linked to a job card' using errcode = '22023';
  end if;
  perform set_config('workshop.source', 'manual', true);
  update public.workshop_status_records set job_card_ref = v_jc, link_suggestion = null where id = p_id;
  insert into public.workshop_status_events
    (organisation_id, country, site, record_id, asset_no, event_type, field_name, old_value, new_value, source)
  values (r.organisation_id, r.country, r.site, r.id, r.asset_no, 'field_change', 'job_card_ref', r.job_card_ref, v_jc, 'manual');
  if r.confirm_status = 'confirmed' then
    v_link := public.workshop_intake_link_work_order(p_id);
  end if;
  perform set_config('workshop.source', '', true);
  return jsonb_build_object('id', p_id, 'work_order', v_link);
end $$;

-- Roster: add or change one entry (supervisors and area managers edit it).
create or replace function public.workshop_intake_roster_save(p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_id uuid := nullif(p_row ->> 'id', '')::uuid;
  v_country text := nullif(btrim(coalesce(p_row ->> 'country', '')), '');
  v_site text := nullif(upper(btrim(coalesce(p_row ->> 'site', ''))), '');
  v_user uuid := nullif(p_row ->> 'user_id', '')::uuid;
  v_shift text := coalesce(nullif(lower(btrim(p_row ->> 'shift_name')), ''), 'day');
  v_start time; v_end time;
  v_role text := coalesce(nullif(lower(btrim(p_row ->> 'role')), ''), 'primary');
  v_active boolean := coalesce((p_row ->> 'active')::boolean, true);
  v_old public.workshop_site_supervisors%rowtype;
begin
  if not (coalesce(public.workshop_status_can('roster'), false) or coalesce(public.workshop_status_can('configure'), false)) then
    raise exception 'You do not have permission to change the supervisor roster' using errcode = '42501';
  end if;
  if v_country is null or v_site is null or v_user is null then
    raise exception 'Choose the country, site and supervisor' using errcode = '22023';
  end if;
  if not public.workshop_intake_in_scope(v_org, v_country, v_site) then
    raise exception 'You cannot change the roster of this site' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user
                  and (p.organisation_id = v_org or p.org_id = v_org)) then
    raise exception 'That person is not in your organisation' using errcode = '22023';
  end if;
  v_start := coalesce(nullif(p_row ->> 'shift_start', '')::time,
                      case v_shift when 'day' then time '06:00' when 'night' then time '18:00' end);
  v_end   := coalesce(nullif(p_row ->> 'shift_end', '')::time,
                      case v_shift when 'day' then time '18:00' when 'night' then time '06:00' end);
  if v_id is null then
    insert into public.workshop_site_supervisors
      (organisation_id, country, site, user_id, role, shift_name, shift_start, shift_end, active,
       valid_from, valid_to, created_by, updated_by)
    values (v_org, v_country, v_site, v_user, v_role, v_shift, v_start, v_end, v_active,
            nullif(p_row ->> 'valid_from', '')::date, nullif(p_row ->> 'valid_to', '')::date, auth.uid(), auth.uid())
    returning id into v_id;
  else
    select * into v_old from public.workshop_site_supervisors
     where id = v_id and organisation_id = v_org for update;
    if not found then raise exception 'Roster entry not found' using errcode = 'P0002'; end if;
    update public.workshop_site_supervisors set
      country = v_country, site = v_site, user_id = v_user, role = v_role, shift_name = v_shift,
      shift_start = v_start, shift_end = v_end, active = v_active,
      valid_from = nullif(p_row ->> 'valid_from', '')::date, valid_to = nullif(p_row ->> 'valid_to', '')::date,
      updated_by = auth.uid(), updated_at = now()
     where id = v_id;
  end if;
  insert into public.workshop_status_events
    (organisation_id, country, site, event_type, source, details)
  values (v_org, v_country, v_site, 'roster_changed', 'manual',
          jsonb_build_object('roster_id', v_id, 'user_id', v_user, 'shift', v_shift, 'role', v_role,
                             'active', v_active, 'before', case when v_old.id is not null then to_jsonb(v_old) end));
  return jsonb_build_object('id', v_id);
exception when invalid_datetime_format or invalid_text_representation then
  raise exception 'Check the dates and times' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------
-- 9. Google Sheet: registration (admin), ingest (service role only), watch.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_intake_sheet_register(p_country text, p_name text, p_default_site text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(public.workshop_status_can('configure'), false) then
    raise exception 'You do not have permission to connect a sheet' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or nullif(btrim(coalesce(p_country, '')), '') is null then
    raise exception 'Give the sheet a name and a country' using errcode = '22023';
  end if;
  insert into public.workshop_intake_sheets (organisation_id, country, name, default_site, created_by)
  values (public.app_current_org(), btrim(p_country), btrim(p_name), nullif(upper(btrim(p_default_site)), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Called only by the workshop-sheet-ingest edge function (service role), after
-- it checked the HMAC signature and timestamp. Records a heartbeat every call.
create or replace function public.workshop_intake_sheet_ingest(p_sheet_id uuid, p_rows jsonb, p_request_ts bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.workshop_intake_sheets%rowtype; v jsonb;
begin
  select * into s from public.workshop_intake_sheets where id = p_sheet_id and active for update;
  if not found then
    raise exception 'Sheet not registered or switched off' using errcode = 'P0002';
  end if;
  -- Replay guard: each signed request carries a timestamp that must move forward.
  if p_request_ts is not null and s.last_request_ts is not null and p_request_ts <= s.last_request_ts then
    raise exception 'Replayed or out-of-order request' using errcode = 'PT409';
  end if;
  if coalesce(jsonb_array_length(p_rows), 0) = 0 then
    v := jsonb_build_object('new', 0, 'updated', 0, 'unchanged', 0, 'rows', '[]'::jsonb);
  else
    v := public.workshop_intake__ingest(s.organisation_id, s.country, 'sheet', p_rows, null, s.default_site);
  end if;
  update public.workshop_intake_sheets
     set last_seen_at = now(), last_request_ts = coalesce(p_request_ts, last_request_ts), last_row_count = coalesce(jsonb_array_length(p_rows), 0),
         last_result = v - 'rows', silent_alerted_at = null
   where id = s.id;
  return v;
end $$;

-- A sheet that stopped sending (Apps Script quota, removed trigger, revoked
-- access) alerts its owner once per silence.
create or replace function public.workshop_intake_sheet_watch()
returns integer language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  for s in select * from public.workshop_intake_sheets
            where active and created_by is not null and silent_alerted_at is null
              and coalesce(last_seen_at, created_at) < now() - interval '30 minutes' loop
    perform public.workshop_status_notice_send(s.organisation_id, s.created_by, 'workshop_intake_sheet_silent',
      'Workshop sheet stopped sending: ' || s.name,
      'Nothing has arrived from this sheet for 30 minutes. Check the Apps Script trigger.',
      'workshop_status', s.id, '/daily-ops/workshop?tab=intake&view=sheets');
    update public.workshop_intake_sheets set silent_alerted_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  if to_regnamespace('cron') is not null
     and not exists (select 1 from cron.job where jobname = 'workshop-intake-sheet-watch') then
    perform cron.schedule('workshop-intake-sheet-watch', '*/15 * * * *', 'select public.workshop_intake_sheet_watch()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Anomaly list for managers. Rows about the caller are never shown to the
--     caller (a flag is a prompt to look, not an accusation).
-- ---------------------------------------------------------------------------
create or replace function public.workshop_intake_anomalies(p_country text default null, p_days int default 14)
returns table (kind text, record_id uuid, asset_no text, site text, actor_id uuid, actor_name text,
               at timestamptz, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.app_current_org(); v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90));
begin
  if not (coalesce(public.workshop_status_can('view_reports'), false) or coalesce(public.workshop_status_can('configure'), false)) then
    raise exception 'You do not have permission to see workshop checks' using errcode = '42501';
  end if;
  return query
  with recs as (
    select r.* from public.workshop_status_records r
     where r.organisation_id = v_org and r.deleted_at is null
       and (p_country is null or lower(r.country) = lower(p_country))
       and r.first_seen_at >= v_since
       and public.workshop_intake_in_scope(r.organisation_id, r.country, r.site)
  ), flags as (
    select 'pending_too_long'::text k, r.id, r.asset_no, r.site, r.submitted_by a, r.submitted_by_name an, r.submitted_at t,
           jsonb_build_object('hours', round(extract(epoch from now() - r.submitted_at) / 3600)) d
      from recs r where r.confirm_status = 'pending_confirm' and r.current_active and r.submitted_at < now() - interval '24 hours'
    union all
    select 'backdated_entry', r.id, r.asset_no, r.site, r.submitted_by, r.submitted_by_name, r.submitted_at,
           jsonb_build_object('production_out_at', r.production_out_at)
      from recs r where r.production_out_at is not null and r.submitted_at is not null
       and r.production_out_at < r.submitted_at - interval '3 days'
    union all
    select 'clock_mismatch', r.id, r.asset_no, r.site, r.submitted_by, r.submitted_by_name, r.submitted_at,
           jsonb_build_object('client_entered_at', r.client_entered_at)
      from recs r where r.client_entered_at is not null
       and abs(extract(epoch from r.client_entered_at - r.submitted_at)) > 1800
    union all
    select 'repeat_vehicle', r.id, r.asset_no, r.site, r.submitted_by, r.submitted_by_name, r.first_seen_at,
           jsonb_build_object('visits', x.n)
      from recs r join (select public.workshop_status_asset_key(asset_no) ak, country, count(*) n
                          from recs where first_seen_at >= now() - interval '7 days' group by 1, 2 having count(*) > 1) x
        on x.ak = public.workshop_status_asset_key(r.asset_no) and x.country = r.country
     where r.first_seen_at >= now() - interval '7 days'
    union all
    select 'quick_release', r.id, r.asset_no, r.site, r.removed_by_user_id, null, r.removed_at,
           jsonb_build_object('minutes', round(extract(epoch from r.removed_at - r.first_seen_at) / 60))
      from recs r where r.intake_source <> 'excel_upload' and r.removed_at is not null
       and r.removed_at < r.first_seen_at + interval '30 minutes'
    union all
    select 'outcome_flip_flop', e.record_id, max(e.asset_no), max(e.site), null::uuid, null, max(e.created_at),
           jsonb_build_object('changes', count(*))
      from public.workshop_status_events e
     where e.organisation_id = v_org and e.event_type = 'job_outcome' and e.created_at >= now() - interval '7 days'
       and e.record_id in (select id from recs)
     group by e.record_id having count(*) >= 3
    union all
    select 'bulk_confirm_many_sites', null::uuid, null, null, c.confirmed_by, max(c.confirmed_by_name), max(c.confirmed_at),
           jsonb_build_object('sites', count(distinct c.site), 'vehicles', count(*))
      from recs c where c.confirmed_at is not null and c.intake_source <> 'excel_upload'
     group by c.confirmed_by, date_trunc('hour', c.confirmed_at), floor(extract(minute from c.confirmed_at) / 10)
    having count(distinct c.site) > 3
  )
  select f.k, f.id, f.asset_no, f.site, f.a, f.an, f.t, f.d from flags f
   where f.a is distinct from auth.uid()
   order by f.t desc nulls last
   limit 500;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Grants: every function SECURITY DEFINER with a pinned search_path;
--     internal helpers callable by no client; sheet ingest by service role only.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'workshop_intake_tz(text)', 'workshop_intake_in_shift(time,time,time)',
    'workshop_intake_recipient_ok(uuid,uuid,text,text)', 'workshop_intake_route(uuid,text,text,timestamptz,uuid)',
    'workshop_intake_hash(text,text,text,text,text,text,timestamptz,text)', 'workshop_intake_ts(text)',
    'workshop_intake_notify(uuid,uuid[])', 'workshop_intake_link_work_order(uuid)', 'workshop_intake_guard()',
    'workshop_intake__ingest(uuid,text,text,jsonb,uuid,text)', 'workshop_intake__load(uuid)',
    'workshop_intake_sheet_ingest(uuid,jsonb,bigint)', 'workshop_intake_sheet_watch()',
    'workshop_intake_in_scope(uuid,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'workshop_intake_upsert_rows(text,text,jsonb)', 'workshop_intake_confirm(uuid[],text)',
    'workshop_intake_return(uuid,text)', 'workshop_intake_set_outcome(uuid,text,text,date)',
    'workshop_intake_release(uuid,text,text)', 'workshop_intake_set_job_card(uuid,text)',
    'workshop_intake_roster_save(jsonb)', 'workshop_intake_sheet_register(text,text,text)',
    'workshop_intake_anomalies(text,int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'grant execute on function public.workshop_intake_sheet_ingest(uuid,jsonb,bigint) to service_role';
end $$;

-- ============================================================================
-- VERIFY (run in a transaction that ends in RAISE EXCEPTION, so nothing stays):
--   * as a supervisor: workshop_intake_upsert_rows('KSA','manual', 1 row)
--     returns new=1; the same call again returns unchanged=1;
--   * that supervisor confirming his own row is refused (42501);
--   * an area manager confirms it: confirm_status = 'confirmed', confirmed_by
--     stamped; a job card number creates / links one work order;
--   * workshop_status_confirm_upload no longer releases a non-Excel row;
--   * routing: a night roster entry 18:00-06:00 is on shift at 23:00 local.
-- ============================================================================
