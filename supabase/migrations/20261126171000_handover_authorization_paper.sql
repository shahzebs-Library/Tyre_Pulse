-- Vehicle Handover as an AUTHORIZATION PAPER: two attributed driver signatures
-- with server time, location, a per-org document number, a freeze once signed,
-- an approver-is-not-the-driver rule and an append-only audit trail.
--
-- STATUS: AUTHORED, NOT APPLIED. Proven in PGlite by
-- supabase/tests/handover_authorization.test.mjs. Apply only on the owner's yes.
--
-- WHAT WAS WRONG (measured in the repo, 2026-11-26):
--   * ONE signature (signature_url), with nothing saying who gave it or when; the
--     driver names were free text, so two drivers called "Ahmed" were the same
--     person on paper.
--   * No location. Nothing said where the vehicle changed hands.
--   * The damage marks, odometer, photos and the signature itself stayed
--     editable through a plain UPDATE after the driver had signed, so the paper a
--     driver signed could be changed afterwards.
--   * The document number was HND-<8 hex of the id>, which says nothing about the
--     vehicle or the year and cannot be read out over the phone.
--   * No audit trail of edits.
--
-- WHAT THIS ADDS (all additive; nothing is dropped or renamed):
--   1. Driver identity: from_driver_id / to_driver_id -> drivers(id), the same
--      key the driver workspace and driver_account_links use. The free-text
--      from_driver / to_driver columns are KEPT (legacy rows, and a yard or
--      third party who is not in the driver register).
--   2. Two signatures, each with name, server time (now()) and the account that
--      collected it. Written ONLY by sign_handover(); a direct UPDATE or an
--      INSERT that carries them is refused.
--   3. Location (latitude, longitude, accuracy, status) captured with the
--      signature, plus a site column under the standard site isolation.
--   4. document_no = HO-<ASSET>-<YEAR>-<NNNN>, minted at INSERT from a per
--      (org, asset, year) counter. Existing rows keep the number they have.
--   5. FREEZE: from the first driver signature the record content can no longer
--      change. Only the sign-off columns (approval_status, supervisor_*,
--      incharge_*, review_note) may still move, and only through
--      decide_handover_approval. A signed handover cannot be deleted except by a
--      super admin.
--   6. decide_handover_approval refuses an approval before both drivers have
--      signed, and refuses ANY decision by an account linked to either driver.
--   7. handover_report_events: append-only audit trail of every insert, change,
--      signature, decision and deletion.
--
-- DECISIONS WORTH KNOWING:
--   * The freeze starts at the FIRST signature, not only the receiving one. A
--     signature attests to what is on the paper; editing the paper after the
--     handing driver signed would make that signature describe a different
--     record. A half-signed record (handing only) that is wrong is deleted and
--     recaptured; delete stays open until the receiving driver signs.
--   * signed_by is the ACCOUNT that collected the signature (often a supervisor's
--     tablet). signed_name is the driver's register name when a driver id is set
--     (resolved server side, never from the client), else the typed name. The
--     approver rule is therefore keyed on driver_account_links, not signed_by.
--   * Location is client measured (the browser or phone GPS) and stored with an
--     honest status: captured / denied / unavailable. The TIME is never client.
--   * Year in the document number is the UTC year of handover_at (or now()).
--   * SENDING BACK clears both driver signatures (and any supervisor signature),
--     the location and the freeze, and returns the record to draft with the
--     reason in review_note; the trail records it as 'sent_back' with every
--     cleared value. The record can then be corrected and signed again. A
--     signed record that is waiting for sign-off stays frozen.
--   * WHO MAY SIGN (review H4): the account linked to the named driver
--     (driver_account_links), or a supervisor-level account signing with an
--     explicit p_on_behalf = true, which is stored (from_on_behalf /
--     to_on_behalf) and audited. A driver on the handover can never sign on
--     behalf of the other party, and one account never collects both
--     signatures: two on-behalf signatures come from two different accounts. The approver may not be either signing account
--     nor the account that created the record.
--   * Signatures must match the same strict SVG / PNG shape the driver charge
--     module accepts (handover_valid_signature), not merely start with <svg.
--   * Driver ids must belong to the handover's organisation (and country when
--     both are set); a trigger refuses anything else.
--
-- PRE-FLIGHT
--   Data loss: none. Additive columns, new tables, CREATE OR REPLACE functions.
--   Live rows: 0 handover_reports rows at authoring time.
--   Locks: ADD COLUMN without defaults is catalog only. FKs on a 0-row table.
--   RLS: org + country isolation already exist (V181, V226/V542). This adds
--     RESTRICTIVE FOR ALL site isolation on the new site column (null or blank
--     site = visible, the standard convention).
--   DEFINER functions: search_path pinned; revoke PUBLIC then anon; only the two
--     RPCs are granted to authenticated. The minting helper takes an org id and
--     is NOT executable by authenticated (the V378 lesson).
--   PostgREST: raises use 42501 / 22023 / P0001, never 40001.
--   Rollback: at the foot of this file.

-- --------------------------------------------------------------------- COLUMNS
alter table public.handover_reports
  add column if not exists from_driver_id        uuid references public.drivers(id),
  add column if not exists to_driver_id          uuid references public.drivers(id),
  add column if not exists hour_meter            numeric,
  add column if not exists site                  text,
  add column if not exists from_signature        text,
  add column if not exists from_signed_name      text,
  add column if not exists from_signed_at        timestamptz,
  add column if not exists from_signed_by        uuid references public.profiles(id),
  add column if not exists to_signature          text,
  add column if not exists to_signed_name        text,
  add column if not exists to_signed_at          timestamptz,
  add column if not exists to_signed_by          uuid references public.profiles(id),
  add column if not exists latitude              double precision,
  add column if not exists longitude             double precision,
  add column if not exists location_accuracy_m   numeric,
  add column if not exists location_status       text,
  add column if not exists location_captured_at  timestamptz,
  add column if not exists frozen_at             timestamptz,
  add column if not exists from_on_behalf        boolean,
  add column if not exists to_on_behalf          boolean;

comment on column public.handover_reports.from_driver_id is
  'Driver handing the vehicle over (drivers.id). On a check-out this is usually the yard or previous driver.';
comment on column public.handover_reports.to_driver_id is
  'Driver receiving the vehicle (drivers.id).';
comment on column public.handover_reports.from_signed_at is
  'Server time (now()) the handing party signed. Written only by sign_handover().';
comment on column public.handover_reports.to_signed_at is
  'Server time (now()) the receiving party signed. From this point the record is frozen.';
comment on column public.handover_reports.from_signed_by is
  'Account that collected the handing signature (the device user), not necessarily the driver.';
comment on column public.handover_reports.location_status is
  'captured / denied / unavailable. Coordinates are device measured; the time is server time.';
comment on column public.handover_reports.frozen_at is
  'Server time the record content froze (first driver signature). Cleared when the handover is sent back.';
comment on column public.handover_reports.from_on_behalf is
  'True when a supervisor-level account signed for the handing party instead of the driver''s own linked account.';
comment on column public.handover_reports.to_on_behalf is
  'True when a supervisor-level account signed for the receiving party instead of the driver''s own linked account.';

-- ------------------------------------------------------ SIGNATURE VALIDATOR
-- The SAME shape the driver charge module accepts
-- (private.driver_charge_valid_signature): a PNG data URL, or the static SVG the
-- web SignatureCapture emits (paths only, no script, no external reference).
create or replace function public.handover_valid_signature(p text)
returns boolean language sql immutable set search_path = '' as $fn$
  -- Same rule as private.driver_charge_valid_signature: a real PNG of some
  -- size, or the web pad SVG with at least 10 points. A dot is not a signature.
  select (coalesce(p,'') ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$' and length(p) >= 1400)
    or (coalesce(p,'') ~ '^<svg xmlns="http://www.w3.org/2000/svg" width="[0-9]+" height="[0-9]+" viewBox="[0-9 .]+">(<path d="[ML0-9 .-]+" fill="none" stroke="#[a-fA-F0-9]{6}" stroke-width="[0-9.]+" stroke-linecap="round" stroke-linejoin="round"/>)+</svg>$'
        and length(p) - length(replace(p, 'L', '')) >= 9)
$fn$;
revoke all on function public.handover_valid_signature(text) from public;
revoke all on function public.handover_valid_signature(text) from anon;
revoke all on function public.handover_valid_signature(text) from authenticated;

-- ------------------------------------------------- DRIVER IDS IN THIS ORG ONLY
-- A driver id from another organisation (or another country, when both are
-- set) would put a foreign driver on this paper and leak that driver's name
-- back through sign_handover. Refused at write time.
create or replace function public.guard_handover_driver_scope()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  d record;
  k uuid;
begin
  foreach k in array array[new.from_driver_id, new.to_driver_id] loop
    continue when k is null;
    if tg_op = 'UPDATE' and (k = old.from_driver_id or k = old.to_driver_id) then
      continue;
    end if;
    select dr.organisation_id, dr.country into d from public.drivers dr where dr.id = k;
    if not found or d.organisation_id is distinct from new.organisation_id
       or (d.country is not null and new.country is not null
           and lower(btrim(d.country)) <> lower(btrim(new.country))) then
      raise exception 'That driver is not in this organisation or country.' using errcode = '22023';
    end if;
  end loop;
  if new.from_driver_id is not null and new.from_driver_id = new.to_driver_id then
    raise exception 'The handing and receiving driver must be different people.' using errcode = '22023';
  end if;
  return new;
end
$fn$;
revoke all on function public.guard_handover_driver_scope() from public;
revoke all on function public.guard_handover_driver_scope() from anon;
revoke all on function public.guard_handover_driver_scope() from authenticated;

drop trigger if exists trg_a1_guard_handover_driver_scope on public.handover_reports;
create trigger trg_a1_guard_handover_driver_scope
  before insert or update on public.handover_reports
  for each row execute function public.guard_handover_driver_scope();

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'handover_reports_location_chk'
                  and conrelid = 'public.handover_reports'::regclass) then
    alter table public.handover_reports add constraint handover_reports_location_chk check (
      (latitude is null or latitude between -90 and 90)
      and (longitude is null or longitude between -180 and 180)
      and ((latitude is null) = (longitude is null))
      and (location_accuracy_m is null or location_accuracy_m >= 0)
      and (location_status is null or location_status in ('captured','denied','unavailable'))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'handover_reports_hour_meter_chk'
                  and conrelid = 'public.handover_reports'::regclass) then
    alter table public.handover_reports add constraint handover_reports_hour_meter_chk
      check (hour_meter is null or hour_meter >= 0);
  end if;
  -- Two signatures, two accounts (second review). Belt and braces beside the
  -- sign_handover check, so no path can store one account against both.
  if not exists (select 1 from pg_constraint where conname = 'handover_reports_two_signers_chk'
                  and conrelid = 'public.handover_reports'::regclass) then
    alter table public.handover_reports add constraint handover_reports_two_signers_chk
      check (from_signed_by is null or to_signed_by is null or from_signed_by <> to_signed_by);
  end if;
end
$chk$;

create index if not exists idx_handover_reports_from_driver on public.handover_reports (from_driver_id);
create index if not exists idx_handover_reports_to_driver   on public.handover_reports (to_driver_id);
create index if not exists idx_handover_reports_from_by     on public.handover_reports (from_signed_by);
create index if not exists idx_handover_reports_to_by       on public.handover_reports (to_signed_by);
create unique index if not exists ux_handover_reports_document_no
  on public.handover_reports (organisation_id, document_no) where document_no is not null;

-- ----------------------------------------------------------- SITE ISOLATION
drop policy if exists handover_reports_site_isolation on public.handover_reports;
create policy handover_reports_site_isolation on public.handover_reports
  as restrictive for all to authenticated
  using ((site is null) or (btrim(site) = '') or (select public.app_sees_all_sites())
         or (upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))))
  with check ((site is null) or (btrim(site) = '') or (select public.app_sees_all_sites())
         or (upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))));

-- ------------------------------------------------------ DOCUMENT NUMBER COUNTER
create table if not exists public.handover_document_counters (
  organisation_id uuid    not null,
  asset_key       text    not null,
  year            integer not null,
  last_no         integer not null default 0,
  primary key (organisation_id, asset_key, year)
);
alter table public.handover_document_counters enable row level security;
revoke all on public.handover_document_counters from public, anon, authenticated;

-- HO-<ASSET>-<YEAR>-<NNNN>. The asset part is the asset number upper-cased with
-- everything except letters, digits and hyphens removed. Atomic under
-- concurrency: the upsert takes the row lock, so two simultaneous handovers on
-- one asset get 0001 and 0002, never the same number.
create or replace function public.next_handover_document_no(p_org uuid, p_asset text, p_at timestamptz)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_org  uuid := coalesce(p_org, '00000000-0000-0000-0000-000000000000'::uuid);
  v_key  text := nullif(regexp_replace(upper(coalesce(p_asset, '')), '[^A-Z0-9-]', '', 'g'), '');
  v_year integer := extract(year from (coalesce(p_at, now()) at time zone 'UTC'))::integer;
  v_no   integer;
begin
  v_key := coalesce(v_key, 'ASSET');
  insert into public.handover_document_counters as c (organisation_id, asset_key, year, last_no)
  values (v_org, v_key, v_year, 1)
  on conflict (organisation_id, asset_key, year) do update set last_no = c.last_no + 1
  returning c.last_no into v_no;
  return 'HO-' || v_key || '-' || v_year || '-' || lpad(v_no::text, 4, '0');
end
$fn$;
revoke all on function public.next_handover_document_no(uuid, text, timestamptz) from public;
revoke all on function public.next_handover_document_no(uuid, text, timestamptz) from anon;
revoke all on function public.next_handover_document_no(uuid, text, timestamptz) from authenticated;

-- Replaces the HND-<hex> stamp. guard_handover_insert (trg_a0) blanks any client
-- supplied document_no first, so the server number always wins.
create or replace function public.stamp_handover_document_no()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.document_no is null then
    new.document_no := public.next_handover_document_no(new.organisation_id, new.asset_no, new.handover_at);
  end if;
  return new;
end
$fn$;
revoke all on function public.stamp_handover_document_no() from public;
revoke all on function public.stamp_handover_document_no() from anon;
revoke all on function public.stamp_handover_document_no() from authenticated;

-- ------------------------------------------------------------ INSERT GUARD
-- Full body of the 20261112143000 guard plus the signature / location / freeze
-- columns: none of them may arrive on an INSERT.
create or replace function public.guard_handover_insert()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.from_signature is not null or new.from_signed_name is not null
     or new.from_signed_at is not null or new.from_signed_by is not null
     or new.to_signature is not null or new.to_signed_name is not null
     or new.to_signed_at is not null or new.to_signed_by is not null
     or new.latitude is not null or new.longitude is not null
     or new.location_accuracy_m is not null or new.location_status is not null
     or new.location_captured_at is not null or new.frozen_at is not null
     or new.from_on_behalf is not null or new.to_on_behalf is not null then
    raise exception 'Signatures and location are recorded through the signing step only.' using errcode = '42501';
  end if;

  if auth.uid() is null or public.is_super_admin() then
    return new;
  end if;

  if coalesce(new.approval_status, 'pending_supervisor') not in ('draft', 'pending_supervisor') then
    raise exception 'A new handover starts as a draft or waits for supervisor sign-off.' using errcode = '42501';
  end if;

  if new.supervisor_name is not null or new.supervisor_signature is not null
     or new.supervisor_at is not null or new.supervisor_by is not null
     or new.incharge_name is not null or new.incharge_signature is not null
     or new.incharge_at is not null or new.incharge_by is not null
     or new.review_note is not null then
    raise exception 'Sign-off details cannot be supplied when a handover is created.' using errcode = '42501';
  end if;

  new.document_no := null;
  return new;
end
$fn$;
revoke all on function public.guard_handover_insert() from public;
revoke all on function public.guard_handover_insert() from anon;
revoke all on function public.guard_handover_insert() from authenticated;

-- ---------------------------------------------- SIGNATURE + FREEZE GUARD (UPDATE)
-- Applies to EVERY caller, the super admin and the service role included: an
-- authorization paper is only worth something if nobody can quietly edit it.
create or replace function public.guard_handover_record_integrity()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_via      text := coalesce(current_setting('handover.via', true), '');
  -- Set only inside decide_handover_approval's send-back branch.
  v_sendback boolean := coalesce(current_setting('handover.sendback', true), '') = 'on';
  v_sign_cols text[] := array['from_signature','from_signed_name','from_signed_at','from_signed_by',
    'to_signature','to_signed_name','to_signed_at','to_signed_by','latitude','longitude',
    'location_accuracy_m','location_status','location_captured_at','frozen_at',
    'from_on_behalf','to_on_behalf'];
  -- Columns that may still change on a frozen record: the sign-off ladder.
  v_open_cols text[] := array['approval_status','supervisor_name','supervisor_signature','supervisor_at',
    'supervisor_by','incharge_name','incharge_signature','incharge_at','incharge_by','review_note','updated_at'];
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  k text;
begin
  if v_sendback then
    -- Sending back may only CLEAR the signing columns, never write new ones.
    foreach k in array v_sign_cols loop
      if (v_new -> k) is not null and v_new -> k <> 'null'::jsonb then
        raise exception 'Sending a handover back can only clear its signatures.' using errcode = '42501';
      end if;
    end loop;
  elsif v_via <> 'sign' then
    foreach k in array v_sign_cols loop
      if (v_old -> k) is distinct from (v_new -> k) then
        raise exception 'Signatures and location are recorded through the signing step only.' using errcode = '42501';
      end if;
    end loop;
  end if;

  if old.from_signed_at is not null or old.to_signed_at is not null then
    if v_via = 'sign' or v_sendback then
      -- The signing step may only add the signature it is recording; the
      -- send-back step may only clear them (checked above).
      v_open_cols := v_open_cols || v_sign_cols;
    end if;
    foreach k in array v_open_cols loop
      v_old := v_old - k;
      v_new := v_new - k;
    end loop;
    if v_old is distinct from v_new then
      raise exception 'This handover has been signed and can no longer be changed.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$fn$;
revoke all on function public.guard_handover_record_integrity() from public;
revoke all on function public.guard_handover_record_integrity() from anon;
revoke all on function public.guard_handover_record_integrity() from authenticated;

drop trigger if exists trg_a2_guard_handover_record_integrity on public.handover_reports;
create trigger trg_a2_guard_handover_record_integrity
  before update on public.handover_reports
  for each row execute function public.guard_handover_record_integrity();

create or replace function public.guard_handover_signed_delete()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if old.to_signed_at is not null and not public.is_super_admin() then
    raise exception 'A signed handover is a record and cannot be deleted.' using errcode = '42501';
  end if;
  return old;
end
$fn$;
revoke all on function public.guard_handover_signed_delete() from public;
revoke all on function public.guard_handover_signed_delete() from anon;
revoke all on function public.guard_handover_signed_delete() from authenticated;

drop trigger if exists trg_guard_handover_signed_delete on public.handover_reports;
create trigger trg_guard_handover_signed_delete
  before delete on public.handover_reports
  for each row execute function public.guard_handover_signed_delete();

-- --------------------------------------------------------------- AUDIT TRAIL
create table if not exists public.handover_report_events (
  id              uuid primary key default gen_random_uuid(),
  handover_id     uuid not null,
  organisation_id uuid,
  country         text,
  site            text,
  action          text not null,
  actor           uuid,
  actor_name      text,
  changes         jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now()
);
create index if not exists idx_handover_report_events_handover on public.handover_report_events (handover_id, at);
create index if not exists idx_handover_report_events_org      on public.handover_report_events (organisation_id);

alter table public.handover_report_events enable row level security;
revoke all on public.handover_report_events from public, anon;
revoke insert, update, delete, truncate on public.handover_report_events from authenticated;
grant select on public.handover_report_events to authenticated;

drop policy if exists handover_report_events_org_isolation on public.handover_report_events;
create policy handover_report_events_org_isolation on public.handover_report_events
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
drop policy if exists handover_report_events_read on public.handover_report_events;
create policy handover_report_events_read on public.handover_report_events
  for select to authenticated using (auth.uid() is not null);
-- Same country and site boundary as handover_reports (review M2): the trail
-- carries field values, so it must not be readable outside the record's scope.
drop policy if exists handover_report_events_country_isolation on public.handover_report_events;
create policy handover_report_events_country_isolation on public.handover_report_events
  as restrictive for select to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));
drop policy if exists handover_report_events_site_isolation on public.handover_report_events;
create policy handover_report_events_site_isolation on public.handover_report_events
  as restrictive for select to authenticated
  using ((site is null) or (btrim(site) = '') or (select public.app_sees_all_sites())
         or (upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))));

create or replace function public.guard_handover_events_append_only()
returns trigger language plpgsql set search_path = public as $fn$
begin
  raise exception 'The handover audit trail cannot be changed.' using errcode = '42501';
end
$fn$;
revoke all on function public.guard_handover_events_append_only() from public;
revoke all on function public.guard_handover_events_append_only() from anon;
revoke all on function public.guard_handover_events_append_only() from authenticated;

drop trigger if exists trg_handover_events_append_only on public.handover_report_events;
create trigger trg_handover_events_append_only
  before update or delete on public.handover_report_events
  for each row execute function public.guard_handover_events_append_only();

-- Diff of what changed. Signature images are recorded as present / absent, never
-- copied into the trail (they are kept on the record itself).
create or replace function public.log_handover_event()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_action  text;
  v_changes jsonb := '{}'::jsonb;
  v_old     jsonb;
  v_new     jsonb;
  v_row     public.handover_reports;
  v_name    text;
  k         text;
  v_blob    text[] := array['from_signature','to_signature','supervisor_signature','incharge_signature','signature_url'];
begin
  if tg_op = 'INSERT' then
    v_row := new; v_action := 'created';
    v_changes := jsonb_build_object('document_no', new.document_no, 'asset_no', new.asset_no,
      'handover_type', new.handover_type);
  elsif tg_op = 'DELETE' then
    v_row := old; v_action := 'deleted';
    v_changes := to_jsonb(old) - v_blob;
  else
    v_row := new;
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      if k = 'updated_at' then continue; end if;
      if (v_old -> k) is distinct from (v_new -> k) then
        if k = any (v_blob) then
          v_changes := v_changes || jsonb_build_object(k, jsonb_build_object(
            'old', case when v_old ->> k is null then null else 'signed' end,
            'new', case when v_new ->> k is null then null else 'signed' end));
        else
          v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k));
        end if;
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
    v_action := case
      when coalesce(current_setting('handover.sendback', true), '') = 'on' then 'sent_back'
      when old.from_signed_at is null and new.from_signed_at is not null then 'signed_handing'
      when old.to_signed_at   is null and new.to_signed_at   is not null then 'signed_receiving'
      when old.approval_status is distinct from new.approval_status then 'decision_' || coalesce(new.approval_status, 'none')
      else 'edited' end;
  end if;

  select coalesce(full_name, username) into v_name from public.profiles where id = auth.uid();
  insert into public.handover_report_events (handover_id, organisation_id, country, site, action, actor, actor_name, changes)
  values (v_row.id, v_row.organisation_id, v_row.country, v_row.site, v_action, auth.uid(), v_name, v_changes);
  return null;
end
$fn$;
revoke all on function public.log_handover_event() from public;
revoke all on function public.log_handover_event() from anon;
revoke all on function public.log_handover_event() from authenticated;

drop trigger if exists trg_zz_log_handover_event on public.handover_reports;
create trigger trg_zz_log_handover_event
  after insert or update or delete on public.handover_reports
  for each row execute function public.log_handover_event();

-- ------------------------------------------------------------------ SIGN RPC
-- p_party: 'handing' (from_*) or 'receiving' (to_*). The handing party signs
-- first. The time is now(); the signer account is auth.uid(); the name comes
-- from the driver register (same organisation only) when a driver id is set.
-- The receiving signature submits the handover for supervisor sign-off.
--
-- WHO MAY SIGN (review H4):
--   * the account linked to that party's driver (driver_account_links), or
--   * a supervisor-level account (handover_can_sign_supervisor) passing
--     p_on_behalf = true. The flag is stored on the row and in the trail.
--   A party with no driver id (a typed name, a yard) can only be signed on
--   behalf. An account linked to EITHER driver on this handover may not sign on
--   behalf of the other party, and one account never collects both signatures
--   (from_signed_by <> to_signed_by always, second review).
create or replace function public.sign_handover(
  p_id uuid,
  p_party text,
  p_signature text,
  p_signer_name text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m numeric default null,
  p_location_status text default null,
  p_on_behalf boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_org       uuid := public.app_current_org();
  r           public.handover_reports;
  v_party     text := lower(btrim(coalesce(p_party, '')));
  v_sig       text := btrim(coalesce(p_signature, ''));
  v_name      text;
  v_status    text;
  v_has_loc   boolean := p_latitude is not null or p_longitude is not null;
  v_now       timestamptz := now();
  v_driver_id uuid;
  v_self      boolean := false;
  v_member    boolean := false;
  v_behalf    boolean := false;
begin
  if auth.uid() is null or not coalesce(public.app_is_active(), false) then
    raise exception 'Sign in with an active account to sign a handover.' using errcode = '42501';
  end if;
  if v_party not in ('handing', 'receiving') then
    raise exception 'Choose who is signing: the handing or the receiving driver.' using errcode = '22023';
  end if;
  if v_sig = '' then
    raise exception 'A signature is required.' using errcode = '22023';
  end if;
  if length(v_sig) > 200000 then
    raise exception 'The signature is too large. Clear it and sign again.' using errcode = '22023';
  end if;
  if not public.handover_valid_signature(v_sig) then
    raise exception 'The signature is not in a recognised format. Clear it and sign again.' using errcode = '22023';
  end if;
  if v_has_loc then
    if p_latitude is null or p_longitude is null
       or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
      raise exception 'The location reading is not valid.' using errcode = '22023';
    end if;
    if p_accuracy_m is not null and p_accuracy_m < 0 then
      raise exception 'The location accuracy is not valid.' using errcode = '22023';
    end if;
  end if;

  select * into r from public.handover_reports hr
   where hr.id = p_id
     and (hr.organisation_id = v_org or public.is_super_admin())
     and public.app_write_country_ok(hr.country)
     and (hr.site is null or btrim(hr.site) = '' or public.app_sees_all_sites()
          or upper(btrim(hr.site)) = any (coalesce(public.app_site_scope(), '{}'::text[])))
   for update;
  if r.id is null then
    raise exception 'That handover no longer exists.' using errcode = '22023';
  end if;
  if coalesce(r.approval_status, 'pending_supervisor') not in ('draft', 'pending_supervisor') then
    raise exception 'This handover is already in sign-off and cannot be signed again.' using errcode = '22023';
  end if;

  if v_party = 'handing' then
    if r.from_signed_at is not null then
      raise exception 'The handing driver has already signed this handover.' using errcode = '22023';
    end if;
    v_driver_id := r.from_driver_id;
  else
    if r.from_signed_at is null then
      raise exception 'The handing driver signs first.' using errcode = '22023';
    end if;
    if r.to_signed_at is not null then
      raise exception 'The receiving driver has already signed this handover.' using errcode = '22023';
    end if;
    v_driver_id := r.to_driver_id;
  end if;

  -- ---- who is holding the pen ----
  if v_driver_id is not null then
    select exists (select 1 from public.driver_account_links l
                    where l.driver_id = v_driver_id and l.user_id = auth.uid()
                      and l.organisation_id = r.organisation_id)
      into v_self;
  end if;
  select exists (select 1 from public.driver_account_links l
                  where l.user_id = auth.uid()
                    and l.driver_id in (r.from_driver_id, r.to_driver_id))
    into v_member;

  if not v_self then
    if not coalesce(p_on_behalf, false) then
      raise exception 'This driver signs with their own account. A supervisor can sign on their behalf.' using errcode = '42501';
    end if;
    if not public.handover_can_sign_supervisor() then
      raise exception 'Only a supervisor can sign on behalf of a driver.' using errcode = '42501';
    end if;
    if v_member then
      raise exception 'A driver on this handover cannot sign on behalf of the other driver.' using errcode = '42501';
    end if;
    v_behalf := true;
  end if;

  -- Second review: one account may NEVER collect both signatures, on behalf
  -- or not. Otherwise one supervisor could sign for both drivers alone, with
  -- nothing showing either driver was there, and driver charges can rest on
  -- this paper. from_signed_by and to_signed_by are therefore always two
  -- different accounts, and both are stored on the row and in the trail.
  if v_party = 'receiving' and r.from_signed_by = auth.uid() then
    raise exception 'The same account cannot sign for both drivers. The second signature must be given by the driver or by another supervisor.' using errcode = '42501';
  end if;

  if v_driver_id is not null then
    select d.driver_name into v_name from public.drivers d
     where d.id = v_driver_id and d.organisation_id = r.organisation_id;
  end if;
  if v_party = 'handing' then
    v_name := coalesce(nullif(btrim(v_name), ''), nullif(btrim(p_signer_name), ''), nullif(btrim(r.from_driver), ''));
  else
    v_name := coalesce(nullif(btrim(v_name), ''), nullif(btrim(p_signer_name), ''), nullif(btrim(r.to_driver), ''));
  end if;
  if v_name is null then
    raise exception 'Name the person who is signing.' using errcode = '22023';
  end if;
  v_name := left(v_name, 200);

  perform set_config('handover.via', 'sign', true);

  if v_party = 'handing' then
    update public.handover_reports set
      from_signature = v_sig, from_signed_name = v_name, from_signed_at = v_now, from_signed_by = auth.uid(),
      from_on_behalf = v_behalf,
      frozen_at = coalesce(frozen_at, v_now),
      latitude = case when latitude is null and v_has_loc then p_latitude else latitude end,
      longitude = case when longitude is null and v_has_loc then p_longitude else longitude end,
      location_accuracy_m = case when latitude is null and v_has_loc then p_accuracy_m else location_accuracy_m end,
      location_captured_at = case when latitude is null and v_has_loc then v_now else location_captured_at end,
      location_status = case
        when latitude is not null then location_status
        when v_has_loc then 'captured'
        else coalesce(location_status, case when lower(p_location_status) = 'denied' then 'denied' else 'unavailable' end) end
     where id = r.id;
  else
    v_status := 'pending_supervisor';
    update public.handover_reports set
      to_signature = v_sig, to_signed_name = v_name, to_signed_at = v_now, to_signed_by = auth.uid(),
      to_on_behalf = v_behalf,
      frozen_at = coalesce(frozen_at, v_now),
      -- The receiving moment IS the handover moment: its reading wins.
      latitude = case when v_has_loc then p_latitude else latitude end,
      longitude = case when v_has_loc then p_longitude else longitude end,
      location_accuracy_m = case when v_has_loc then p_accuracy_m else location_accuracy_m end,
      location_captured_at = case when v_has_loc then v_now else location_captured_at end,
      location_status = case
        when v_has_loc then 'captured'
        when latitude is not null then location_status
        else case when lower(p_location_status) = 'denied' then 'denied' else 'unavailable' end end,
      approval_status = 'pending_supervisor'
     where id = r.id;
  end if;

  perform set_config('handover.via', '', true);

  return jsonb_build_object('ok', true, 'party', v_party, 'signed_name', v_name,
    'signed_at', v_now, 'signed_by', auth.uid(), 'on_behalf', v_behalf, 'frozen', true,
    'status', coalesce(v_status, r.approval_status));
end
$fn$;
revoke all on function public.sign_handover(uuid, text, text, text, double precision, double precision, numeric, text, boolean) from public;
revoke all on function public.sign_handover(uuid, text, text, text, double precision, double precision, numeric, text, boolean) from anon;
grant execute on function public.sign_handover(uuid, text, text, text, double precision, double precision, numeric, text, boolean) to authenticated;

-- ---------------------------------------------- DECIDE: SIGNED + NOT THE DRIVER
-- Anchored inserts into the live body (two anchors, each must occur once), the
-- same technique as 20261112143000, so nothing else in the function moves.
do $mig$
declare
  v_def text;
  v_a   text := E'  if v_status = ''draft'' then';
  v_b   text := E'  -- ---- approval ----';
  v_c   text := E'       set approval_status = ''rejected'', review_note = p_note\n';
  v_d   text := E'    return jsonb_build_object(''ok'', true, ''decision'', ''rejected'', ''status'', ''rejected'', ''both_steps'', false);';
begin
  select pg_get_functiondef('public.decide_handover_approval(uuid, boolean, text, text)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 then
    raise exception 'decide: draft anchor not found exactly once';
  end if;
  if (length(v_def) - length(replace(v_def, v_b, ''))) / length(v_b) <> 1 then
    raise exception 'decide: approval anchor not found exactly once';
  end if;
  if position('signing driver' in v_def) > 0 then
    raise exception 'decide: already extended';
  end if;
  if (length(v_def) - length(replace(v_def, v_c, ''))) / length(v_c) <> 1 then
    raise exception 'decide: send-back update anchor not found exactly once';
  end if;
  if (length(v_def) - length(replace(v_def, v_d, ''))) / length(v_d) <> 1 then
    raise exception 'decide: send-back return anchor not found exactly once';
  end if;
  v_def := replace(v_def, v_a,
       E'  if exists (select 1 from public.handover_reports hr\n'
    || E'               join public.driver_account_links l on l.driver_id in (hr.from_driver_id, hr.to_driver_id)\n'
    || E'              where hr.id = p_id and l.user_id = auth.uid()) then\n'
    || E'    raise exception ''A signing driver cannot sign off their own handover.'' using errcode = ''42501'';\n'
    || E'  end if;\n'
    || E'  if exists (select 1 from public.handover_reports hr\n'
    || E'              where hr.id = p_id and auth.uid() in (hr.from_signed_by, hr.to_signed_by, hr.created_by)) then\n'
    || E'    raise exception ''You collected a signature on this handover or created it, so another approver must decide it.'' using errcode = ''42501'';\n'
    || E'  end if;\n\n'
    || v_a);
  v_def := replace(v_def, v_b, v_b
    || E'\n  if not exists (select 1 from public.handover_reports hr\n'
    || E'                  where hr.id = p_id and hr.from_signed_at is not null and hr.to_signed_at is not null) then\n'
    || E'    raise exception ''Both drivers must sign the handover before it can be approved.'' using errcode = ''22023'';\n'
    || E'  end if;');
  -- Send back (review M6): clear both driver signatures, any supervisor
  -- signature, the location and the freeze, and return the record to draft so
  -- it can be corrected and signed again. The reason stays in review_note and
  -- the trail records the whole change as 'sent_back'.
  v_def := replace(v_def, v_c,
       E'       set approval_status = ''draft'', review_note = p_note,\n'
    || E'           from_signature = null, from_signed_name = null, from_signed_at = null, from_signed_by = null, from_on_behalf = null,\n'
    || E'           to_signature = null, to_signed_name = null, to_signed_at = null, to_signed_by = null, to_on_behalf = null,\n'
    || E'           latitude = null, longitude = null, location_accuracy_m = null, location_status = null,\n'
    || E'           location_captured_at = null, frozen_at = null,\n'
    || E'           supervisor_name = null, supervisor_signature = null, supervisor_at = null, supervisor_by = null\n');
  v_def := replace(v_def, E'    update public.handover_reports\n       set approval_status = ''draft'', review_note = p_note,',
       E'    perform set_config(''handover.sendback'', ''on'', true);\n'
    || E'    update public.handover_reports\n       set approval_status = ''draft'', review_note = p_note,');
  v_def := replace(v_def, v_d,
       E'    perform set_config(''handover.sendback'', '''', true);\n'
    || E'    return jsonb_build_object(''ok'', true, ''decision'', ''rejected'', ''status'', ''draft'', ''both_steps'', false, ''signatures_cleared'', true);');
  if position(E'set_config(''handover.sendback'', ''on'', true)' in v_def) = 0 then
    raise exception 'decide: send-back rewrite did not apply';
  end if;
  execute v_def;
end
$mig$;

-- ============================================================================
-- ROLLBACK (file only):
--   drop trigger trg_zz_log_handover_event on public.handover_reports;
--   drop trigger trg_guard_handover_signed_delete on public.handover_reports;
--   drop trigger trg_a2_guard_handover_record_integrity on public.handover_reports;
--   drop function public.sign_handover(uuid, text, text, text, double precision, double precision, numeric, text, boolean);
--   drop trigger trg_a1_guard_handover_driver_scope on public.handover_reports;
--   drop function public.guard_handover_driver_scope();
--   drop function public.handover_valid_signature(text);
--   drop function public.log_handover_event();
--   drop function public.guard_handover_signed_delete();
--   drop function public.guard_handover_record_integrity();
--   drop table public.handover_report_events;  -- loses the trail; export first
--   drop table public.handover_document_counters;
--   drop function public.next_handover_document_no(uuid, text, timestamptz);
--   re-apply guard_handover_insert, stamp_handover_document_no and
--   decide_handover_approval from 20261112130000 + 20261112143000;
--   drop policy handover_reports_site_isolation on public.handover_reports;
--   alter table public.handover_reports drop constraint handover_reports_location_chk,
--     drop constraint handover_reports_hour_meter_chk, drop constraint handover_reports_two_signers_chk, drop column from_driver_id, ...;
-- ============================================================================
