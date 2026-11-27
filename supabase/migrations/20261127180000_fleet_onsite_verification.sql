-- =============================================================================
-- Fleet "Verify on site"  (20261127180000)
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's explicit yes.
-- =============================================================================
--
-- What it does
--   A Fleet Supervisor / Fleet Incharge / Admin walks the yard, finds a machine
--   from the register, photographs it and confirms (or corrects) its plate and
--   chassis. Or reports it is not here / is in another country.
--
--   * Blank plate or chassis on file + a value observed  -> filled at once.
--   * Observed value DIFFERENT from the file              -> pending; the old
--     value stays until an Admin or Manager approves.
--   * The same plate/chassis already on another machine in the same company and
--     country                                             -> pending, flagged.
--   * "Not found here" / "In another country (which)"     -> pending; a manager
--     confirms before vehicle_fleet.status moves (Inactive / Transferred).
--   * Photo at a UNIQUE path per verification:
--       <org>/<COUNTRY>/<ASSET>/verify/<verification_id>.<ext>
--     in the private bucket vehicle-photos. On accept it becomes
--     vehicle_fleet.image_path, replacing the class artwork.
--   * Who / when / GPS recorded. GPS is optional and never blocks.
--
-- Rules followed
--   * Writes only through SECURITY DEFINER RPCs; the table has NO client
--     insert / update / delete policy or grant.
--   * Every RPC re-checks approved+unlocked, role, org, country and site itself
--     (a definer function runs past RLS - PROJECT_MEMORY 2026-08-16 part 2).
--   * Stale / already-decided refusals use PT409, never 40001 (V-2026-09-26).
--   * Grant order: grant authenticated + service_role, revoke PUBLIC, then anon.
--   * Same asset number in another country is NOT proof of a transfer (V376);
--     list_possible_transfers is a read-only review list, nothing bulk-changes.
--   * Every vehicle_fleet change writes admin_row_changes (before + after), so
--     it is visible in the Data Browser history and undoable there.
--
-- Checked against live (SELECT only, 2026-11-27)
--   * vehicle_fleet triggers: trg_audit_row, trg_enforce_plan_limit (INSERT only),
--     trg_log_vehicle_ops_status, trg_normalize_asset_no / _site / _vehicle_type
--     (column-scoped, untouched here), trg_zz_fleet_maintenance_priority.
--     None blocks an UPDATE of registration_no / chassis_no / image_path / status.
--   * registration_no / chassis_no carry NO unique index or constraint.
--   * status CHECK = Active | Inactive | Retired | Transferred.
--   * custom_roles holds 'Fleet Supervisor' and 'Fleet Incharge';
--     app_role() returns lower-case with underscores (fleet_supervisor ...).
--   * KSA Inactive rows whose asset number also exists in UAE/Egypt: 155.
--
-- VERIFY (after apply)
--   select to_regclass('public.fleet_verifications');                      -- not null
--   select relrowsecurity from pg_class where relname='fleet_verifications';-- t
--   select has_function_privilege('anon','public.submit_fleet_verification(uuid,uuid,text,text,text,text,text,double precision,double precision,double precision,text,text)','execute'); -- f
--   select has_table_privilege('authenticated','public.fleet_verifications','insert'); -- f
--   select public.normalize_chassis(' lzg-ЈЈ 123 ');  -- Cyrillic lookalikes mapped
--   select public.normalize_plate(' 1234  abc ');      -- '1234 ABC'
--   select count(*) from public.list_possible_transfers('KSA');  -- as a super admin: 155
--   Behaviour (rolled back): impersonate a Fleet Supervisor, submit a present
--   verification on a machine with blank chassis -> auto_applied, chassis filled;
--   submit a different plate -> pending, plate unchanged; impersonate a Manager
--   of the same org, decide approve -> plate changed, admin_row_changes row;
--   decide again -> PT409; submitter deciding own -> 42501.
--
-- ROLLBACK
--   drop function if exists public.list_possible_transfers(text);
--   drop function if exists public.list_pending_fleet_verifications(text);
--   drop function if exists public.decide_fleet_verification(uuid,boolean,text);
--   drop function if exists public.submit_fleet_verification(uuid,uuid,text,text,text,text,text,double precision,double precision,double precision,text,text);
--   drop function if exists public.fleet_verifier_allowed();
--   drop function if exists public.fleet_verification_approver_allowed();
--   drop function if exists public.chassis_has_invalid_vin_chars(text);
--   drop function if exists public.plate_key(text);
--   drop function if exists public.normalize_chassis(text);
--   drop function if exists public.normalize_plate(text);
--   drop table if exists public.fleet_verifications;
--   alter table public.vehicle_fleet drop column if exists last_verified_at,
--     drop column if exists last_verified_by, drop column if exists verification_status;
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Normalisers. Mirrored EXACTLY by src/lib/fleetVerification.js and
--    tyre_pulse_flutter/lib/features/fleet_verification/domain/fleet_verification_rules.dart.
--    Change all three together.
-- ---------------------------------------------------------------------------

-- Plate for display/storage: upper case, whitespace runs collapsed, trimmed.
create or replace function public.normalize_plate(p text)
returns text language sql immutable parallel safe
set search_path = public
as $$
  select nullif(btrim(regexp_replace(upper(coalesce(p, '')), '\s+', ' ', 'g')), '')
$$;

-- Plate for comparison: every space removed (V509 - five "conflicts" were spacing).
-- Never reorders characters: a transposition is a judgement, not a whitespace fix.
create or replace function public.plate_key(p text)
returns text language sql immutable parallel safe
set search_path = public
as $$
  select nullif(regexp_replace(upper(coalesce(p, '')), '\s+', '', 'g'), '')
$$;

-- Chassis / VIN: upper case, spaces, dashes and dots removed, Cyrillic lookalike
-- letters mapped to Latin (the TM545 chassis on file carries Cyrillic P).
create or replace function public.normalize_chassis(p text)
returns text language sql immutable parallel safe
set search_path = public
as $$
  select nullif(
    translate(
      regexp_replace(upper(coalesce(p, '')), '[\s\-\.]+', '', 'g'),
      'АВЕКМНОРСТХУІЈ',
      'ABEKMHOPCTXYIJ'
    ), '')
$$;

-- A real 17-character VIN never contains I, O or Q. Flag (do not reject): many
-- plant serials are not VINs.
create or replace function public.chassis_has_invalid_vin_chars(p text)
returns boolean language sql immutable parallel safe
set search_path = public
as $$
  select coalesce(public.normalize_chassis(p) ~ '[IOQ]', false)
$$;

-- ---------------------------------------------------------------------------
-- 2. Who may submit / decide. Fails closed.
-- ---------------------------------------------------------------------------
create or replace function public.fleet_verifier_allowed()
returns boolean language sql stable security definer
set search_path = public
as $$
  select coalesce(public.is_approved_and_unlocked(), false)
     and (coalesce(public.is_super_admin(), false)
          or coalesce(public.app_role(), '') in ('admin', 'fleet_supervisor', 'fleet_incharge'))
$$;

create or replace function public.fleet_verification_approver_allowed()
returns boolean language sql stable security definer
set search_path = public
as $$
  select coalesce(public.is_approved_and_unlocked(), false)
     and (coalesce(public.is_super_admin(), false)
          or coalesce(public.app_role(), '') in ('admin', 'manager'))
$$;

-- ---------------------------------------------------------------------------
-- 3. vehicle_fleet: last verification stamp.
-- ---------------------------------------------------------------------------
alter table public.vehicle_fleet
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_verified_by uuid,
  add column if not exists verification_status text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vehicle_fleet_verification_status_chk') then
    alter table public.vehicle_fleet add constraint vehicle_fleet_verification_status_chk
      check (verification_status is null
             or verification_status in ('verified', 'pending', 'not_found', 'other_country', 'rejected'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. fleet_verifications
-- ---------------------------------------------------------------------------
create table if not exists public.fleet_verifications (
  id                uuid primary key,                  -- = client_uuid (photo path uses it)
  organisation_id   uuid not null,
  country           text,
  site              text,
  vehicle_id        uuid not null references public.vehicle_fleet(id) on delete cascade,
  asset_no          text not null,
  outcome           text not null check (outcome in ('present', 'not_found', 'other_country')),
  other_country     text,
  observed_asset_no text,
  observed_plate    text,
  observed_chassis  text,
  previous_plate    text,
  previous_chassis  text,
  photo_path        text,
  lat               double precision check (lat is null or lat between -90 and 90),
  lng               double precision check (lng is null or lng between -180 and 180),
  accuracy_m        double precision check (accuracy_m is null or accuracy_m >= 0),
  client_uuid       uuid not null unique,
  status            text not null check (status in ('auto_applied', 'pending', 'approved', 'rejected')),
  flags             text[] not null default '{}',
  applied_fields    text[] not null default '{}',
  note              text,
  decided_by        uuid,
  decided_at        timestamptz,
  decision_note     text,
  submitted_by      uuid not null,
  submitted_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint fleet_verifications_other_country_chk
    check (outcome <> 'other_country' or nullif(btrim(other_country), '') is not null),
  constraint fleet_verifications_decided_chk
    check ((status in ('approved', 'rejected')) = (decided_by is not null))
);

create index if not exists fleet_verifications_org_status_idx
  on public.fleet_verifications (organisation_id, country, status, submitted_at desc);
create index if not exists fleet_verifications_vehicle_idx
  on public.fleet_verifications (vehicle_id, submitted_at desc);

alter table public.fleet_verifications enable row level security;

drop policy if exists fleet_verifications_org_isolation on public.fleet_verifications;
create policy fleet_verifications_org_isolation on public.fleet_verifications
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

drop policy if exists fleet_verifications_country_isolation on public.fleet_verifications;
create policy fleet_verifications_country_isolation on public.fleet_verifications
  as restrictive for select to authenticated
  using (public.app_can_see_country(country));

drop policy if exists fleet_verifications_site_isolation on public.fleet_verifications;
create policy fleet_verifications_site_isolation on public.fleet_verifications
  as restrictive for select to authenticated
  using (public.app_can_see_site(site));

drop policy if exists fleet_verifications_read on public.fleet_verifications;
create policy fleet_verifications_read on public.fleet_verifications
  for select to authenticated
  using ((select public.app_is_active()));

revoke all on public.fleet_verifications from public, anon, authenticated;
grant select on public.fleet_verifications to authenticated;
grant all on public.fleet_verifications to service_role;

-- ---------------------------------------------------------------------------
-- 5. Audit helper: one admin_row_changes row (before + after), V364 shape.
-- ---------------------------------------------------------------------------
create or replace function public._fleet_verification_audit(p_org uuid, p_row uuid, p_before jsonb, p_after jsonb)
returns void language sql security definer
set search_path = public
as $$
  insert into public.admin_row_changes (organisation_id, tbl, row_id, action, before_data, after_data, changed_by)
  select p_org, 'vehicle_fleet', p_row, 'update', p_before, p_after, auth.uid()
  where p_before is distinct from p_after
$$;

-- ---------------------------------------------------------------------------
-- 6. submit_fleet_verification
-- ---------------------------------------------------------------------------
create or replace function public.submit_fleet_verification(
  p_client_uuid     uuid,
  p_vehicle_id      uuid,
  p_outcome         text,
  p_observed_asset_no text default null,
  p_observed_plate  text default null,
  p_observed_chassis text default null,
  p_photo_path      text default null,
  p_lat             double precision default null,
  p_lng             double precision default null,
  p_accuracy_m      double precision default null,
  p_other_country   text default null,
  p_note            text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_existing public.fleet_verifications;
  v_old      public.vehicle_fleet;
  v_new      public.vehicle_fleet;
  v_flags    text[] := '{}';
  v_applied  text[] := '{}';
  v_status   text;
  v_plate    text := public.normalize_plate(p_observed_plate);
  v_chassis  text := public.normalize_chassis(p_observed_chassis);
  v_obs_asset text := nullif(upper(regexp_replace(coalesce(p_observed_asset_no, ''), '\s+', '', 'g')), '');
  v_photo    text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_other    text := nullif(btrim(coalesce(p_other_country, '')), '');
  v_dup_plate boolean := false;
  v_dup_chassis boolean := false;
  v_lat double precision := p_lat;
  v_lng double precision := p_lng;
begin
  if v_uid is null then
    raise exception 'Sign in to record a verification' using errcode = '42501';
  end if;
  if not public.fleet_verifier_allowed() then
    raise exception 'Only a Fleet Supervisor, Fleet Incharge or Admin can verify machines on site'
      using errcode = '42501';
  end if;
  if p_client_uuid is null or p_vehicle_id is null then
    raise exception 'A verification needs an id and a machine' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('present', 'not_found', 'other_country') then
    raise exception 'Unknown verification outcome' using errcode = '22023';
  end if;

  -- Idempotent replay: the same device resending the same verification.
  select * into v_existing from public.fleet_verifications where client_uuid = p_client_uuid;
  if found then
    if v_existing.submitted_by <> v_uid then
      raise exception 'This verification id is already used' using errcode = 'PT409';
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'id', v_existing.id,
      'status', v_existing.status, 'flags', to_jsonb(v_existing.flags),
      'applied_fields', to_jsonb(v_existing.applied_fields));
  end if;

  select * into v_old from public.vehicle_fleet where id = p_vehicle_id for update;
  if not found then
    raise exception 'Machine not found' using errcode = '22023';
  end if;
  if not (public.is_super_admin() or v_old.organisation_id = public.app_current_org()) then
    raise exception 'Machine not found' using errcode = '42501';
  end if;
  if public.app_can_see_country(v_old.country) is not true
     or public.app_can_see_site(v_old.site) is not true then
    raise exception 'This machine is outside your country or site' using errcode = '42501';
  end if;

  if p_outcome = 'other_country' then
    if v_other is null then
      raise exception 'Say which country the machine is in' using errcode = '22023';
    end if;
    if upper(v_other) = upper(coalesce(v_old.country, '')) then
      raise exception 'Pick a country other than the one on file' using errcode = '22023';
    end if;
  else
    v_other := null;
  end if;

  -- GPS is best effort: an out-of-range pair is dropped, never refused.
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    v_lat := null; v_lng := null;
  end if;

  -- Photo must sit at this verification's own unique path and be uploaded.
  if v_photo is not null then
    if split_part(v_photo, '/', 1) <> lower(v_old.organisation_id::text)
       or position(('/verify/' || p_client_uuid::text || '.') in v_photo) = 0
       or v_photo like '%..%' then
      raise exception 'Photo path does not belong to this verification' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'vehicle-photos' and o.name = v_photo) then
      raise exception 'The photo has not finished uploading' using errcode = 'PT409';
    end if;
  end if;

  if p_outcome = 'present' then
    if v_obs_asset is not null
       and v_obs_asset <> upper(regexp_replace(coalesce(v_old.asset_no, ''), '\s+', '', 'g')) then
      v_flags := v_flags || 'asset_code_mismatch'::text;
    end if;
    if v_chassis is not null and public.chassis_has_invalid_vin_chars(v_chassis) then
      v_flags := v_flags || 'chassis_invalid_chars'::text;
    end if;

    if v_plate is not null then
      select exists (select 1 from public.vehicle_fleet f
        where f.organisation_id = v_old.organisation_id and f.country is not distinct from v_old.country
          and f.id <> v_old.id and public.plate_key(f.registration_no) = public.plate_key(v_plate))
        into v_dup_plate;
      if v_dup_plate then v_flags := v_flags || 'duplicate_plate'::text; end if;
      if public.plate_key(v_old.registration_no) is not null
         and public.plate_key(v_old.registration_no) <> public.plate_key(v_plate) then
        v_flags := v_flags || 'plate_changed'::text;
      end if;
    end if;

    if v_chassis is not null then
      select exists (select 1 from public.vehicle_fleet f
        where f.organisation_id = v_old.organisation_id and f.country is not distinct from v_old.country
          and f.id <> v_old.id and public.normalize_chassis(f.chassis_no) = v_chassis)
        into v_dup_chassis;
      if v_dup_chassis then v_flags := v_flags || 'duplicate_chassis'::text; end if;
      if public.normalize_chassis(v_old.chassis_no) is not null
         and public.normalize_chassis(v_old.chassis_no) <> v_chassis then
        v_flags := v_flags || 'chassis_changed'::text;
      end if;
    end if;

    v_status := case when cardinality(v_flags) = 0 then 'auto_applied' else 'pending' end;
  else
    v_flags := v_flags || p_outcome;
    v_status := 'pending';
  end if;

  -- Apply what may be applied now: a blank field filled with a clean value
  -- (no duplicate on another machine), and the photo when nothing is pending.
  v_new := v_old;
  if p_outcome = 'present' then
    if v_plate is not null and public.plate_key(v_old.registration_no) is null and not v_dup_plate then
      v_new.registration_no := v_plate; v_applied := v_applied || 'registration_no'::text;
    end if;
    if v_chassis is not null and public.normalize_chassis(v_old.chassis_no) is null and not v_dup_chassis then
      v_new.chassis_no := v_chassis; v_applied := v_applied || 'chassis_no'::text;
    end if;
    if v_status = 'auto_applied' and v_photo is not null then
      v_new.image_path := v_photo; v_applied := v_applied || 'image_path'::text;
    end if;
  end if;

  update public.vehicle_fleet set
    registration_no     = v_new.registration_no,
    chassis_no          = v_new.chassis_no,
    image_path          = v_new.image_path,
    last_verified_at    = now(),
    last_verified_by    = v_uid,
    verification_status = case when v_status = 'auto_applied' then 'verified' else 'pending' end,
    updated_at          = now()
  where id = v_old.id
  returning * into v_new;

  insert into public.fleet_verifications (
    id, organisation_id, country, site, vehicle_id, asset_no, outcome, other_country,
    observed_asset_no, observed_plate, observed_chassis, previous_plate, previous_chassis,
    photo_path, lat, lng, accuracy_m, client_uuid, status, flags, applied_fields, note,
    submitted_by, submitted_at
  ) values (
    p_client_uuid, v_old.organisation_id, v_old.country, v_old.site, v_old.id, v_old.asset_no,
    p_outcome, v_other, v_obs_asset, v_plate, v_chassis, v_old.registration_no, v_old.chassis_no,
    v_photo, v_lat, v_lng, p_accuracy_m, p_client_uuid, v_status, v_flags, v_applied,
    nullif(btrim(coalesce(p_note, '')), ''), v_uid, now()
  );

  if cardinality(v_applied) > 0 then
    perform public._fleet_verification_audit(v_old.organisation_id, v_old.id, to_jsonb(v_old), to_jsonb(v_new));
  end if;

  return jsonb_build_object('ok', true, 'replayed', false, 'id', p_client_uuid,
    'status', v_status, 'flags', to_jsonb(v_flags), 'applied_fields', to_jsonb(v_applied));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. decide_fleet_verification  (Admin or Manager of that org/country)
-- ---------------------------------------------------------------------------
create or replace function public.decide_fleet_verification(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_ver  public.fleet_verifications;
  v_old  public.vehicle_fleet;
  v_new  public.vehicle_fleet;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_applied text[] := '{}';
begin
  if v_uid is null or not public.fleet_verification_approver_allowed() then
    raise exception 'Only an Admin or Manager can decide a verification' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Choose approve or reject' using errcode = '22023';
  end if;

  select * into v_ver from public.fleet_verifications where id = p_id for update;
  if not found then
    raise exception 'Verification not found' using errcode = '22023';
  end if;
  if not (public.is_super_admin() or v_ver.organisation_id = public.app_current_org())
     or public.app_can_see_country(v_ver.country) is not true then
    raise exception 'Verification not found' using errcode = '42501';
  end if;
  if v_ver.status <> 'pending' then
    raise exception 'This verification was already decided' using errcode = 'PT409';
  end if;
  if v_ver.submitted_by = v_uid then
    raise exception 'You cannot decide your own verification' using errcode = '42501';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Give a reason for rejecting' using errcode = '22023';
  end if;

  select * into v_old from public.vehicle_fleet where id = v_ver.vehicle_id for update;
  if not found then
    raise exception 'The machine no longer exists' using errcode = 'PT409';
  end if;
  v_new := v_old;

  if p_approve then
    if v_ver.outcome = 'present' then
      -- Stale guard: the file must still hold what the supervisor compared against.
      if v_ver.observed_plate is not null
         and public.plate_key(v_old.registration_no) is distinct from public.plate_key(v_ver.observed_plate)
         and public.plate_key(v_old.registration_no) is distinct from public.plate_key(v_ver.previous_plate) then
        raise exception 'The plate on file changed since this was submitted' using errcode = 'PT409';
      end if;
      if v_ver.observed_chassis is not null
         and public.normalize_chassis(v_old.chassis_no) is distinct from v_ver.observed_chassis
         and public.normalize_chassis(v_old.chassis_no) is distinct from public.normalize_chassis(v_ver.previous_chassis) then
        raise exception 'The chassis on file changed since this was submitted' using errcode = 'PT409';
      end if;
      if v_ver.observed_plate is not null
         and public.plate_key(v_old.registration_no) is distinct from public.plate_key(v_ver.observed_plate) then
        v_new.registration_no := v_ver.observed_plate; v_applied := v_applied || 'registration_no'::text;
      end if;
      if v_ver.observed_chassis is not null
         and public.normalize_chassis(v_old.chassis_no) is distinct from v_ver.observed_chassis then
        v_new.chassis_no := v_ver.observed_chassis; v_applied := v_applied || 'chassis_no'::text;
      end if;
      if v_ver.photo_path is not null then
        v_new.image_path := v_ver.photo_path; v_applied := v_applied || 'image_path'::text;
      end if;
      v_new.verification_status := 'verified';
    elsif v_ver.outcome = 'not_found' then
      v_new.status := 'Inactive'; v_applied := v_applied || 'status'::text;
      v_new.verification_status := 'not_found';
    else
      v_new.status := 'Transferred'; v_applied := v_applied || 'status'::text;
      v_new.verification_status := 'other_country';
    end if;
  else
    v_new.verification_status := 'rejected';
  end if;

  update public.vehicle_fleet set
    registration_no     = v_new.registration_no,
    chassis_no          = v_new.chassis_no,
    image_path          = v_new.image_path,
    status              = v_new.status,
    verification_status = v_new.verification_status,
    last_verified_at    = case when p_approve then now() else last_verified_at end,
    last_verified_by    = case when p_approve then v_ver.submitted_by else last_verified_by end,
    updated_at          = now()
  where id = v_old.id
  returning * into v_new;

  update public.fleet_verifications set
    status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = v_uid, decided_at = now(), decision_note = v_note,
    applied_fields = applied_fields || v_applied
  where id = v_ver.id;

  if cardinality(v_applied) > 0 then
    perform public._fleet_verification_audit(v_old.organisation_id, v_old.id, to_jsonb(v_old), to_jsonb(v_new));
  end if;

  return jsonb_build_object('ok', true, 'id', v_ver.id,
    'status', case when p_approve then 'approved' else 'rejected' end,
    'applied_fields', to_jsonb(v_applied));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Reads (SECURITY INVOKER: RLS decides what the caller sees).
-- ---------------------------------------------------------------------------
create or replace function public.list_pending_fleet_verifications(p_country text default null)
returns table (
  id uuid, vehicle_id uuid, asset_no text, country text, site text, outcome text, other_country text,
  observed_asset_no text, observed_plate text, observed_chassis text,
  previous_plate text, previous_chassis text, photo_path text, flags text[],
  lat double precision, lng double precision, accuracy_m double precision, note text,
  submitted_by uuid, submitted_by_name text, submitted_at timestamptz,
  vehicle_type text, make text, model text
)
language sql stable security invoker
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
  select v.id, v.vehicle_id, v.asset_no, v.country, v.site, v.outcome, v.other_country,
         v.observed_asset_no, v.observed_plate, v.observed_chassis,
         v.previous_plate, v.previous_chassis, v.photo_path, v.flags,
         v.lat, v.lng, v.accuracy_m, v.note,
         v.submitted_by, p.full_name, v.submitted_at,
         f.vehicle_type, f.make, f.model
  from public.fleet_verifications v
  left join public.profiles p on p.id = v.submitted_by
  left join public.vehicle_fleet f on f.id = v.vehicle_id
  where v.status = 'pending'
    and (p_country is null or p_country = 'All' or v.country = p_country)
  order by v.submitted_at asc, v.id
  limit 500
$$;

-- Read-only "possible transfer" review list. The same asset number in another
-- country is usually a DIFFERENT machine (V376), so this proves nothing and
-- changes nothing; it only puts the candidates in front of a person.
create or replace function public.list_possible_transfers(p_country text default 'KSA')
returns table (
  vehicle_id uuid, asset_no text, country text, site text, status text, vehicle_type text,
  make text, model text, other_vehicle_id uuid, other_country text, other_site text,
  other_status text, other_vehicle_type text, type_match boolean,
  other_latest_job_card date, own_latest_job_card date
)
language sql stable security invoker
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
  select k.id, k.asset_no, k.country, k.site, k.status, k.vehicle_type, k.make, k.model,
         o.id, o.country, o.site, o.status, o.vehicle_type,
         (upper(btrim(coalesce(k.vehicle_type, ''))) <> ''
           and upper(btrim(coalesce(k.vehicle_type, ''))) = upper(btrim(coalesce(o.vehicle_type, '')))),
         (select max(w.opened_at)::date from public.work_orders w
           where w.organisation_id = o.organisation_id and w.country = o.country
             and upper(btrim(w.asset_no)) = upper(btrim(o.asset_no))),
         (select max(w.opened_at)::date from public.work_orders w
           where w.organisation_id = k.organisation_id and w.country = k.country
             and upper(btrim(w.asset_no)) = upper(btrim(k.asset_no)))
  from public.vehicle_fleet k
  join public.vehicle_fleet o
    on o.organisation_id = k.organisation_id
   and o.country is distinct from k.country
   and upper(btrim(o.asset_no)) = upper(btrim(k.asset_no))
  where k.country = coalesce(nullif(p_country, ''), 'KSA')
    and k.status = 'Inactive'
  order by k.asset_no, o.country
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants: authenticated + service_role, revoke PUBLIC, then anon (V500 order).
-- ---------------------------------------------------------------------------
grant execute on function public.normalize_plate(text), public.plate_key(text),
  public.normalize_chassis(text), public.chassis_has_invalid_vin_chars(text),
  public.fleet_verifier_allowed(), public.fleet_verification_approver_allowed(),
  public.submit_fleet_verification(uuid,uuid,text,text,text,text,text,double precision,double precision,double precision,text,text),
  public.decide_fleet_verification(uuid,boolean,text),
  public.list_pending_fleet_verifications(text),
  public.list_possible_transfers(text)
  to authenticated, service_role;

revoke execute on function public.normalize_plate(text), public.plate_key(text),
  public.normalize_chassis(text), public.chassis_has_invalid_vin_chars(text),
  public.fleet_verifier_allowed(), public.fleet_verification_approver_allowed(),
  public.submit_fleet_verification(uuid,uuid,text,text,text,text,text,double precision,double precision,double precision,text,text),
  public.decide_fleet_verification(uuid,boolean,text),
  public.list_pending_fleet_verifications(text),
  public.list_possible_transfers(text),
  public._fleet_verification_audit(uuid,uuid,jsonb,jsonb)
  from public;

revoke execute on function public.normalize_plate(text), public.plate_key(text),
  public.normalize_chassis(text), public.chassis_has_invalid_vin_chars(text),
  public.fleet_verifier_allowed(), public.fleet_verification_approver_allowed(),
  public.submit_fleet_verification(uuid,uuid,text,text,text,text,text,double precision,double precision,double precision,text,text),
  public.decide_fleet_verification(uuid,boolean,text),
  public.list_pending_fleet_verifications(text),
  public.list_possible_transfers(text),
  public._fleet_verification_audit(uuid,uuid,jsonb,jsonb)
  from anon;

-- The audit helper is internal: only the two definer RPCs (owned by postgres) call it.
revoke execute on function public._fleet_verification_audit(uuid,uuid,jsonb,jsonb) from authenticated;

commit;
