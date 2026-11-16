-- =====================================================================================
-- AI tyre SERIAL-NUMBER recognition (DEFERRED FEATURE, DRAFT)
--
-- STATUS: AUTHORED, NOT APPLIED. Do not apply without the owner's explicit approval.
--         Tested only on a private copy of the LOCAL staging database
--         (supabase/tests/staging_ai_serial_recognition.sh). Nothing here ran on production.
-- DESIGN: docs/features/AI_SERIAL_RECOGNITION.md
--
-- WHAT:  two append-only tables and three functions.
--   ai_tyre_serial_readings       one sanitised serial reading per AI job + its comparison with the
--                                 tyre registered on the SAME company, country, asset and ACTUAL wheel
--                                 (resolved through the shared tyre-position service, never by text).
--   ai_tyre_serial_review_events  reviewer decisions on readings that need review (append-only).
--   ai_tyre_serial_outcome(...)   pure comparison: SQL mirror of compareSerial() in
--                                 supabase/functions/ai-tyre-inspection/serial.ts (shared fixture
--                                 src/test/fixtures/aiSerialOutcomeCases.json pins both).
--   ai_tyre_serial_record(job, reading)   worker-only (service_role): sanitise again, compare, store.
--   ai_tyre_serial_review(reading, decision, serial, note)   reviewer decision, appended.
--
-- SAFETY:
--   * NO tyre_records / fitment / movement / history row is written by anything here. A reviewer
--     decision only records what the reviewer saw; correcting the register stays a separate,
--     human action in the tyre module.
--   * Inert until the worker flag system_config.ai_tyre_serial_enabled = 'true' AND the edge
--     function source in this branch is deployed. This file does NOT seed that key.
--   * Depends on the shared position service already live in production
--     (tyre_asset_layout, tyre_position_resolve, tyre_position_compare; read 2026-11-16).
--   * Org isolation RESTRICTIVE + country isolation RESTRICTIVE (same expression as tyre_records),
--     reads for active reviewer roles only, no direct client writes (definer RPCs only), anon nothing.
--
-- VERIFY (rolled back), as a signed-in reviewer of the organisation:
--   begin; select public.ai_tyre_serial_outcome('readable','high','ABC12345','resolved',array['ABC12345']);
--     -- expect {"outcome":"match",...}
--   select has_function_privilege('authenticated','public.ai_tyre_serial_record(uuid,jsonb)','execute');  -- f
--   select has_table_privilege('authenticated','public.ai_tyre_serial_readings','insert');                -- f
--   rollback;
-- ROLLBACK: 20261117130000_ai_tyre_serial_recognition_ROLLBACK.sql (removes only these objects).
-- =====================================================================================

begin;

-- ── readings ──────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_tyre_serial_readings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  job_id uuid not null unique references public.ai_tyre_inspection_jobs(id),
  inspection_id uuid,
  country text,
  asset_no text,
  tyre_position text,                         -- the photo's slot id (R1Li, F2R, FL ...)
  photo_ref text,
  prompt_version text,
  model_version text,
  raw text not null default '' check (length(raw) <= 80),
  normalized text check (normalized is null or (length(normalized) between 1 and 40 and normalized ~ '^[A-Z0-9?]+$')),
  source text not null check (source in ('label', 'moulded', 'none')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  status text not null check (status in ('readable', 'partial', 'unreadable')),
  issues text[] not null default '{}',
  position_status text not null check (position_status in ('resolved', 'ambiguous', 'unknown', 'inconsistent')),
  position_reason text,
  canonical_position text,
  layout_key text,
  registered_tyre_ids uuid[] not null default '{}',
  registered_serials text[] not null default '{}',
  outcome text not null check (outcome in ('match', 'mismatch', 'ambiguous', 'unreadable', 'no_serial_on_record', 'weak_serial_on_record')),
  reason text not null,
  needs_review boolean not null,
  created_at timestamptz not null default now(),
  constraint ai_tyre_serial_readings_unreadable_has_no_value check (status <> 'unreadable' or normalized is null),
  constraint ai_tyre_serial_readings_uncertain_is_partial check (normalized is null or position('?' in normalized) = 0 or status = 'partial'),
  constraint ai_tyre_serial_readings_review_set check (needs_review = (outcome in ('mismatch', 'ambiguous', 'unreadable')))
);
create index if not exists ai_tyre_serial_readings_org_review_idx
  on public.ai_tyre_serial_readings (organisation_id, needs_review, created_at desc);
create index if not exists ai_tyre_serial_readings_inspection_idx on public.ai_tyre_serial_readings (inspection_id);

-- ── reviewer decisions ────────────────────────────────────────────────────────────────
create table if not exists public.ai_tyre_serial_review_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  reading_id uuid not null references public.ai_tyre_serial_readings(id),
  country text,
  decision text not null check (decision in (
    'record_correct',          -- the registered serial is right; the photo was misread or shows another tyre
    'photo_shows_other_tyre',  -- the photo shows a different tyre on this wheel; register needs a human check
    'unreadable_confirmed',    -- the serial genuinely cannot be read from this photo
    'dismissed')),             -- not a serial question (wrong photo, duplicate)
  confirmed_serial text check (confirmed_serial is null or (length(btrim(confirmed_serial)) between 1 and 40)),
  note text not null check (length(btrim(note)) between 3 and 800),
  reviewer_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_tyre_serial_review_events_reading_idx on public.ai_tyre_serial_review_events (reading_id, created_at);

-- Append-only: no update, no delete, for anyone (the definer RPCs only insert).
create or replace function public.ai_tyre_serial_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'AI serial evidence is append-only' using errcode = '42501';
end $$;
revoke all on function public.ai_tyre_serial_append_only() from public, anon, authenticated;
drop trigger if exists ai_tyre_serial_readings_append_only on public.ai_tyre_serial_readings;
create trigger ai_tyre_serial_readings_append_only before update or delete on public.ai_tyre_serial_readings
  for each row execute function public.ai_tyre_serial_append_only();
drop trigger if exists ai_tyre_serial_review_events_append_only on public.ai_tyre_serial_review_events;
create trigger ai_tyre_serial_review_events_append_only before update or delete on public.ai_tyre_serial_review_events
  for each row execute function public.ai_tyre_serial_append_only();

-- ── RLS ───────────────────────────────────────────────────────────────────────────────
alter table public.ai_tyre_serial_readings enable row level security;
alter table public.ai_tyre_serial_review_events enable row level security;
revoke all on public.ai_tyre_serial_readings from public, anon, authenticated;
revoke all on public.ai_tyre_serial_review_events from public, anon, authenticated;
grant select on public.ai_tyre_serial_readings to authenticated;
grant select on public.ai_tyre_serial_review_events to authenticated;
grant all on public.ai_tyre_serial_readings to service_role;
grant all on public.ai_tyre_serial_review_events to service_role;

drop policy if exists ai_tyre_serial_readings_org_isolation on public.ai_tyre_serial_readings;
create policy ai_tyre_serial_readings_org_isolation on public.ai_tyre_serial_readings
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
drop policy if exists ai_tyre_serial_readings_country_isolation on public.ai_tyre_serial_readings;
create policy ai_tyre_serial_readings_country_isolation on public.ai_tyre_serial_readings
  as restrictive for all to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))))
  with check ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));
drop policy if exists ai_tyre_serial_readings_reviewer_read on public.ai_tyre_serial_readings;
create policy ai_tyre_serial_readings_reviewer_read on public.ai_tyre_serial_readings
  for select to authenticated
  using ((select public.is_super_admin()) or ((select public.app_is_active())
         and lower(coalesce((select public.get_my_role()), '')) = any (array['admin', 'manager', 'director', 'maintenance supervisor'])));

drop policy if exists ai_tyre_serial_review_events_org_isolation on public.ai_tyre_serial_review_events;
create policy ai_tyre_serial_review_events_org_isolation on public.ai_tyre_serial_review_events
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
drop policy if exists ai_tyre_serial_review_events_country_isolation on public.ai_tyre_serial_review_events;
create policy ai_tyre_serial_review_events_country_isolation on public.ai_tyre_serial_review_events
  as restrictive for all to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))))
  with check ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));
drop policy if exists ai_tyre_serial_review_events_reviewer_read on public.ai_tyre_serial_review_events;
create policy ai_tyre_serial_review_events_reviewer_read on public.ai_tyre_serial_review_events
  for select to authenticated
  using ((select public.is_super_admin()) or ((select public.app_is_active())
         and lower(coalesce((select public.get_my_role()), '')) = any (array['admin', 'manager', 'director', 'maintenance supervisor'])));

-- ── pure comparison (mirror of compareSerial in serial.ts) ─────────────────────────────
create or replace function public.ai_tyre_serial_norm(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select left(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9?]', '', 'g'), 40)
$$;

create or replace function public.ai_tyre_serial_outcome(
  p_status text, p_confidence text, p_normalized text, p_position_status text, p_registered text[])
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_regs text[];
  v_strong text[];
  v_norms text[];
  v_reg text;
  v_read text := nullif(public.ai_tyre_serial_norm(p_normalized), '');
  v_ok boolean;
  i int;
  o text; r text;
begin
  select coalesce(array_agg(distinct btrim(s)), '{}') into v_regs
    from unnest(coalesce(p_registered, '{}'::text[])) s where nullif(btrim(s), '') is not null;
  select coalesce(array_agg(s), '{}') into v_strong from unnest(v_regs) s where public.tyre_serial_is_strong(s);
  select coalesce(array_agg(distinct public.ai_tyre_serial_norm(s)), '{}') into v_norms from unnest(v_strong) s;
  if coalesce(p_position_status, '') <> 'resolved' then o := 'ambiguous'; r := 'wheel_not_resolved';
  elsif cardinality(v_regs) = 0 then o := 'no_serial_on_record'; r := 'no_tyre_on_wheel';
  elsif cardinality(v_strong) = 0 then o := 'weak_serial_on_record'; r := 'registered_serial_weak';
  elsif cardinality(v_norms) > 1 then o := 'ambiguous'; r := 'several_serials_on_wheel';
  else
    v_reg := v_norms[1];
    if p_status = 'unreadable' or v_read is null then o := 'unreadable'; r := 'serial_not_readable';
    elsif p_status = 'readable' and v_read = v_reg then
      if p_confidence = 'low' then o := 'ambiguous'; r := 'low_confidence_match'; else o := 'match'; r := 'same_serial'; end if;
    elsif p_status = 'partial' then
      v_ok := length(v_read) = length(v_reg);
      if v_ok then
        for i in 1 .. length(v_read) loop
          if substr(v_read, i, 1) <> '?' and substr(v_read, i, 1) <> substr(v_reg, i, 1) then v_ok := false; exit; end if;
        end loop;
      end if;
      if v_ok then o := 'ambiguous'; r := 'partial_consistent'; else o := 'mismatch'; r := 'partial_conflicts'; end if;
    elsif p_confidence = 'low' then o := 'ambiguous'; r := 'low_confidence_different';
    else o := 'mismatch'; r := 'different_serial';
    end if;
  end if;
  return jsonb_build_object('outcome', o, 'reason', r, 'needs_review', o in ('mismatch', 'ambiguous', 'unreadable'));
end $$;

-- ── worker entry point (service_role only) ─────────────────────────────────────────────
-- Re-sanitises the reading (defence in depth: the edge function already did), resolves the photo's
-- wheel on the asset's layout as of the inspection day, finds the tyres the register shows fitted to
-- that wheel that day, compares, stores ONE row per job. Writes nothing else.
create or replace function public.ai_tyre_serial_record(p_job uuid, p_reading jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.ai_tyre_inspection_jobs%rowtype;
  v_insp record;
  v_day date;
  v_raw text := left(btrim(coalesce(p_reading->>'raw', '')), 80);
  v_norm text;
  v_source text := lower(coalesce(p_reading->>'source', ''));
  v_conf text := lower(coalesce(p_reading->>'confidence', ''));
  v_status text := lower(coalesce(p_reading->>'status', ''));
  v_issues text[] := '{}';
  v_layout jsonb;
  v_obs jsonb;
  v_pos_status text;
  v_pos_reason text;
  v_ids uuid[] := '{}';
  v_serials text[] := '{}';
  v_pending int := 0;
  c jsonb;
  t record;
  v_out jsonb;
  v_id uuid;
begin
  select * into j from public.ai_tyre_inspection_jobs where id = p_job;
  if j.id is null then return jsonb_build_object('ok', false, 'reason', 'job_not_found'); end if;
  select id, organisation_id, country, asset_no, vehicle_type, inspection_date, created_at into v_insp
    from public.inspections where id = j.inspection_id and organisation_id = j.organisation_id;
  if v_insp.id is null then return jsonb_build_object('ok', false, 'reason', 'inspection_not_found'); end if;

  select id into v_id from public.ai_tyre_serial_readings where job_id = j.id;
  if v_id is not null then
    select jsonb_build_object('ok', true, 'reading_id', id, 'outcome', outcome, 'reason', reason, 'needs_review', needs_review, 'existing', true)
      into v_out from public.ai_tyre_serial_readings where id = v_id;
    return v_out;
  end if;

  -- sanitise (mirror of sanitizeSerialReading's hard rules)
  if v_source not in ('label', 'moulded', 'none') then v_source := 'none'; v_issues := array_append(v_issues, 'source_unknown'); end if;
  if v_conf not in ('high', 'medium', 'low') then v_conf := 'low'; v_issues := array_append(v_issues, 'confidence_unknown'); end if;
  if v_status not in ('readable', 'partial', 'unreadable') then v_status := 'unreadable'; v_issues := array_append(v_issues, 'status_unknown'); end if;
  v_norm := nullif(public.ai_tyre_serial_norm(v_raw), '');
  if v_norm is null or v_source = 'none' or v_status = 'unreadable' or replace(v_norm, '?', '') = '' then
    v_status := 'unreadable'; v_norm := null; v_conf := 'low';
    if v_source <> 'none' and v_raw = '' then v_source := 'none'; end if;
  else
    if position('?' in v_norm) > 0 and v_status = 'readable' then v_status := 'partial'; v_issues := array_append(v_issues, 'uncertain_characters'); end if;
    if length(v_norm) < 6 and v_status = 'readable' then v_status := 'partial'; v_issues := array_append(v_issues, 'too_short'); end if;
    if position('?' in v_norm) = 0 and (not public.tyre_serial_is_strong(v_raw) or not public.tyre_serial_is_strong(v_norm)) then
      if v_status = 'readable' then v_status := 'partial'; end if;
      v_issues := array_append(v_issues, 'not_a_strong_serial');
    end if;
    if v_status = 'partial' and v_conf = 'high' then v_conf := 'medium'; end if;
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_issues
    from unnest(v_issues || coalesce(array(select jsonb_array_elements_text(
      case when jsonb_typeof(p_reading->'issues') = 'array' then p_reading->'issues' else '[]'::jsonb end)), '{}')) x
    where x ~ '^[a-z_]{1,60}$';

  -- the photo's wheel, on the asset's own layout as of the inspection day (shared position service)
  v_day := coalesce(v_insp.inspection_date, v_insp.created_at::date);
  v_layout := public.tyre_asset_layout(j.organisation_id, v_insp.country, v_insp.asset_no, v_insp.vehicle_type, v_day);
  v_obs := public.tyre_position_resolve(v_layout, j.tyre_position, 'slot');
  v_pos_status := coalesce(v_obs->>'status', 'unknown');
  v_pos_reason := v_obs->>'reason';
  if v_pos_status not in ('resolved', 'ambiguous', 'unknown', 'inconsistent') then v_pos_status := 'unknown'; end if;

  if v_pos_status = 'resolved' then
    for t in
      select r.id, r.serial_no, coalesce(nullif(btrim(r.tyre_position), ''), nullif(btrim(r.position), ''), '') as pos
        from public.tyre_records r
       where r.organisation_id = j.organisation_id
         and r.country is not distinct from v_insp.country
         and upper(btrim(r.asset_no)) = upper(btrim(coalesce(v_insp.asset_no, '')))
         and r.issue_date is not null and r.issue_date <= v_day
         and (r.removal_date is null or r.removal_date > v_day)
    loop
      c := public.tyre_position_compare(v_layout, j.tyre_position, t.pos);
      if (c->>'match')::boolean is true then
        v_ids := v_ids || t.id;
        if nullif(btrim(coalesce(t.serial_no, '')), '') is not null then v_serials := v_serials || btrim(t.serial_no); end if;
      elsif (c->>'match') is null then
        v_pending := v_pending + 1;
      end if;
    end loop;
    -- A register row whose position cannot be read on this layout might be this wheel: never decide over it.
    if cardinality(v_ids) = 0 and v_pending > 0 then v_pos_status := 'ambiguous'; v_pos_reason := 'register_position_unresolved'; end if;
    select coalesce(array_agg(distinct s), '{}') into v_serials from unnest(v_serials) s;
  end if;

  v_out := public.ai_tyre_serial_outcome(v_status, v_conf, v_norm, v_pos_status, v_serials);

  insert into public.ai_tyre_serial_readings (organisation_id, job_id, inspection_id, country, asset_no, tyre_position,
    photo_ref, prompt_version, model_version, raw, normalized, source, confidence, status, issues,
    position_status, position_reason, canonical_position, layout_key, registered_tyre_ids, registered_serials,
    outcome, reason, needs_review)
  values (j.organisation_id, j.id, j.inspection_id, v_insp.country, v_insp.asset_no, j.tyre_position,
    j.photo_ref, j.prompt_version, j.model_version, v_raw, v_norm, v_source, v_conf, v_status, v_issues,
    v_pos_status, v_pos_reason, v_obs->>'canonical', v_layout->>'key', v_ids, v_serials,
    v_out->>'outcome', v_out->>'reason', (v_out->>'needs_review')::boolean)
  on conflict (job_id) do nothing
  returning id into v_id;

  return v_out || jsonb_build_object('ok', true, 'reading_id', v_id);
end $$;

-- ── reviewer decision (signed-in reviewer of the same company and country) ─────────────
create or replace function public.ai_tyre_serial_review(p_reading uuid, p_decision text, p_serial text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.ai_tyre_serial_readings%rowtype;
  v_role text := lower(coalesce(public.get_my_role(), ''));
  v_id uuid;
begin
  if auth.uid() is null or not (public.is_super_admin()
     or (public.app_is_active() and v_role = any (array['admin', 'manager', 'director', 'maintenance supervisor']))) then
    raise exception 'Supervisor role required' using errcode = '42501';
  end if;
  select * into r from public.ai_tyre_serial_readings where id = p_reading;
  if r.id is null or not (r.organisation_id = public.app_current_org() or public.is_super_admin()) then
    raise exception 'Reading not found' using errcode = 'P0002';
  end if;
  if not (r.country is null or public.is_super_admin() or public.app_sees_all_countries()
          or lower(btrim(r.country)) = any (coalesce(public.app_country_scope(), '{}'::text[]))) then
    raise exception 'Country is outside permitted scope' using errcode = '42501';
  end if;
  if p_decision not in ('record_correct', 'photo_shows_other_tyre', 'unreadable_confirmed', 'dismissed') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  insert into public.ai_tyre_serial_review_events (organisation_id, reading_id, country, decision, confirmed_serial, note, reviewer_id)
  values (r.organisation_id, r.id, r.country, p_decision, nullif(left(btrim(coalesce(p_serial, '')), 40), ''),
          left(btrim(p_note), 800), auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'event_id', v_id);
end $$;

revoke all on function public.ai_tyre_serial_norm(text) from public, anon;
revoke all on function public.ai_tyre_serial_outcome(text, text, text, text, text[]) from public, anon;
grant execute on function public.ai_tyre_serial_norm(text) to authenticated, service_role;
grant execute on function public.ai_tyre_serial_outcome(text, text, text, text, text[]) to authenticated, service_role;
revoke all on function public.ai_tyre_serial_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ai_tyre_serial_record(uuid, jsonb) to service_role;
revoke all on function public.ai_tyre_serial_review(uuid, text, text, text) from public, anon;
grant execute on function public.ai_tyre_serial_review(uuid, text, text, text) to authenticated, service_role;

-- New tables must carry the owner's read-only reporting-bot policies (V102 rule).
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'anum_integration' and p.proname = 'apply_reader_policies') then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
