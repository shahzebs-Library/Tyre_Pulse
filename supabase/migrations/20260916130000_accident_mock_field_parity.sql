-- ============================================================================
-- ACCIDENT MOCK FIELD PARITY (2026-09-16)
-- STATUS: AUTHORED, NOT APPLIED. Owner instruction: production must not be
-- disturbed; apply only on an explicit go-ahead. Everything here is ADDITIVE
-- (nullable columns, widened CHECKs, two new tables). No existing row changes.
--
-- Source: the owner's 10 accident mock screens. Fields the mocks show that had
-- no home in the live schema:
--   M2 dispatch details, vehicle handover condition, vendor receipt  -> accident_dispatches
--   M2 vendor contact block                                          -> accident_repair_orders.*
--   M3 third-party plate/driver/phone, payer (6), responsible company,
--      recovery required, taqdeer required, per-field verification    -> accident_liability_assessments.*
--   M5 safe-to-move, labour cost split, parts availability, route reason,
--      quotation status, expected duration, on-site route            -> accident_damage_assessments.* / repair_orders
--   M6 checklist items with time + note                              -> accident_fleet_validation_items
--   M2 delivered_to_workshop_at loses its time (date column)         -> timestamptz
-- Rollback SQL is at the bottom of this file.
-- ============================================================================

begin;

-- ── M3 Responsibility and payment ────────────────────────────────────────────
alter table public.accident_liability_assessments
  add column if not exists payer text
    check (payer is null or payer = any (array[
      'other_party_insurance','our_insurance','company','driver_recovery','warranty','pending'])),
  add column if not exists responsible_company text,
  add column if not exists recovery_required boolean,
  add column if not exists third_party_plate text,
  add column if not exists third_party_driver text,
  add column if not exists third_party_phone text,
  add column if not exists third_party_insurer text,
  add column if not exists taqdeer_required boolean,
  -- {field_key: {recorded_by:text, recorded_at:timestamptz, verification:'verified'|'pending'|'missing', verified_by:text, verified_at:timestamptz}}
  add column if not exists field_audit jsonb not null default '{}'::jsonb;

-- ── M2 vendor block + M5 route/quotation ─────────────────────────────────────
alter table public.accident_repair_orders
  add column if not exists vendor_city text,
  add column if not exists vendor_contact_name text,
  add column if not exists vendor_contact_phone text,
  add column if not exists vendor_contact_email text,
  add column if not exists vendor_registration_no text,
  add column if not exists vendor_inspector_name text,
  add column if not exists expected_duration_days integer,
  add column if not exists quotation_status text
    check (quotation_status is null or quotation_status = any (array[
      'not_requested','requested','received','approved','rejected']));

-- 'on_site' repair route (mock M5 third tile). Widen both CHECKs in place.
alter table public.accident_repair_orders drop constraint if exists accident_repair_orders_repair_route_check;
alter table public.accident_repair_orders add constraint accident_repair_orders_repair_route_check
  check (repair_route is null or repair_route = any (array[
    'none','temporary','internal','external','on_site','insurer_approved','dealer','specialist',
    'replacement','total_loss','disposal','under_review']));
alter table public.accident_damage_assessments drop constraint if exists accident_damage_assessments_recommended_route_check;
alter table public.accident_damage_assessments add constraint accident_damage_assessments_recommended_route_check
  check (recommended_route is null or recommended_route = any (array[
    'none','temporary','internal','external','on_site','insurer_approved','dealer','specialist',
    'replacement','total_loss','disposal','under_review']));

-- ── M5 Repair assessment ─────────────────────────────────────────────────────
alter table public.accident_damage_assessments
  add column if not exists safe_to_move boolean,
  add column if not exists recovery_required boolean,
  add column if not exists estimated_labour_cost numeric,
  add column if not exists parts_available_count integer,
  add column if not exists parts_special_order_count integer,
  add column if not exists route_reason text;
-- damage_areas jsonb marks now also carry: action ('repair'|'replace'|'structural_review'|'monitor'),
-- damage_type from the mock list (dent|scratch|cracked|broken|missing|bent|other), view incl. 'top'/'front_left'.
comment on column public.accident_damage_assessments.damage_areas is
  'Array of marks {view, region_key, region_label, damage_type, severity(minor|moderate|severe), action, note(<=200), photo_refs[]}. Vocabulary: src/lib/accidentCaseVocab.js. Shared with the Flutter app.';

-- ── M2 delivered_to_workshop_at kept its date but lost the time ──────────────
alter table public.accident_vehicle_downtime
  alter column delivered_to_workshop_at type timestamptz
  using (delivered_to_workshop_at::timestamptz);

-- ── M2 Dispatch and handover: one row per dispatch leg ───────────────────────
create table if not exists public.accident_dispatches (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null default public.app_current_org(),
  accident_id             uuid not null references public.accidents(id) on delete cascade,
  repair_order_id         uuid references public.accident_repair_orders(id) on delete set null,
  country                 text,
  site                    text,
  -- 2 Dispatch details
  sent_by_id              uuid,
  sent_by_name            text,
  departure_at            timestamptz,
  carrier                 text,
  driver_name             text,
  recovery_vehicle        text,
  origin                  text,
  destination             text,
  eta_at                  timestamptz,
  live_status             text not null default 'preparing'
                            check (live_status = any (array['preparing','in_transit','arrived','accepted'])),
  -- 3 Vehicle handover condition (outgoing)
  out_odometer_km         numeric,
  out_engine_hours        numeric,
  out_fuel_pct            numeric check (out_fuel_pct is null or (out_fuel_pct >= 0 and out_fuel_pct <= 100)),
  keys_count              integer,
  documents_sent          jsonb not null default '[]'::jsonb,   -- [text]
  accessories             jsonb not null default '[]'::jsonb,   -- [text]
  outgoing_photos         jsonb not null default '[]'::jsonb,   -- [storage_ref]
  outgoing_signed_by      text,
  outgoing_signed_at      timestamptz,
  outgoing_signature      text,                                 -- storage ref or data url
  -- 4 Workshop receipt (completed by vendor)
  arrived_at              timestamptz,
  received_by_name        text,
  received_by_designation text,
  in_odometer_km          numeric,
  in_engine_hours         numeric,
  in_fuel_pct             numeric check (in_fuel_pct is null or (in_fuel_pct >= 0 and in_fuel_pct <= 100)),
  condition_matches       boolean,
  additional_damage_remarks text,
  receiving_photos        jsonb not null default '[]'::jsonb,
  handover_paper_ref      text,
  receiver_signature      text,
  sender_signature        text,
  custody_accepted        boolean not null default false,
  accepted_at             timestamptz,
  accepted_by_id          uuid,
  created_by              uuid default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists accident_dispatches_accident_idx on public.accident_dispatches (accident_id, created_at desc);
create trigger set_updated_at_accident_dispatches before update on public.accident_dispatches
  for each row execute function public.set_updated_at();

-- ── M6 Fleet validation checklist items ──────────────────────────────────────
create table if not exists public.accident_fleet_validation_items (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  accident_id      uuid not null references public.accidents(id) on delete cascade,
  country          text,
  site             text,
  item_key         text not null,
  state            text not null default 'pending'
                     check (state = any (array['pending','done','attention','not_applicable'])),
  count_done       integer,
  count_required   integer,
  checked_by_id    uuid,
  checked_by_name  text,
  checked_at       timestamptz,
  note             text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (accident_id, item_key)
);
create trigger set_updated_at_accident_fleet_validation_items before update on public.accident_fleet_validation_items
  for each row execute function public.set_updated_at();

-- ── RLS: byte-mirror of accident_handover_inspections (V417 pattern) ─────────
do $$
declare t text; cap text;
begin
  for t, cap in select * from (values
      ('accident_dispatches', 'accept_handover'),
      ('accident_fleet_validation_items', 'validate_fleet')) v(t, cap)
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I as restrictive for all to authenticated
      using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
      with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))$p$,
      t || '_org_isolation', t);
    execute format($p$create policy %I on public.%I as restrictive for select to authenticated
      using (public.app_can_see_country(country))$p$, t || '_country_isolation', t);
    execute format($p$create policy %I on public.%I as restrictive for all
      using (public.app_can_see_country(country)) with check (public.app_can_see_country(country))$p$,
      t || '_country_write', t);
    execute format($p$create policy %I on public.%I as restrictive for select to authenticated
      using (public.app_can_see_site(site))$p$, t || '_site_isolation', t);
    execute format($p$create policy %I on public.%I as restrictive for all
      using (public.app_can_see_site(site)) with check (public.app_can_see_site(site))$p$,
      t || '_site_write', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using ((select public.app_is_active()))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using ((select public.app_is_elevated()) or (select public.app_user_can('accidents', %L)))
      with check (((select public.app_is_elevated()) or (select public.app_user_can('accidents', %L)))
        and public.app_can_see_country(country) and public.app_can_see_site(site))$p$,
      t || '_write', t, cap, cap);
    execute format($p$create policy admin_only_delete_guard on public.%I as restrictive for delete to authenticated
      using (public.app_can_admin_delete())$p$, t);
  end loop;
end $$;

commit;

-- ── VERIFY (read-only) ───────────────────────────────────────────────────────
-- select column_name from information_schema.columns where table_name='accident_dispatches';
-- select count(*) from pg_policies where tablename in ('accident_dispatches','accident_fleet_validation_items'); -- 16
-- select pg_get_constraintdef(oid) from pg_constraint where conname='accident_repair_orders_repair_route_check'; -- includes on_site

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- drop table if exists public.accident_fleet_validation_items;
-- drop table if exists public.accident_dispatches;
-- alter table public.accident_vehicle_downtime alter column delivered_to_workshop_at type date using delivered_to_workshop_at::date;
-- alter table public.accident_damage_assessments drop column if exists safe_to_move, drop column if exists recovery_required,
--   drop column if exists estimated_labour_cost, drop column if exists parts_available_count,
--   drop column if exists parts_special_order_count, drop column if exists route_reason;
-- alter table public.accident_repair_orders drop column if exists vendor_city, drop column if exists vendor_contact_name,
--   drop column if exists vendor_contact_phone, drop column if exists vendor_contact_email, drop column if exists vendor_registration_no,
--   drop column if exists vendor_inspector_name, drop column if exists expected_duration_days, drop column if exists quotation_status;
-- alter table public.accident_liability_assessments drop column if exists payer, drop column if exists responsible_company,
--   drop column if exists recovery_required, drop column if exists third_party_plate, drop column if exists third_party_driver,
--   drop column if exists third_party_phone, drop column if exists third_party_insurer, drop column if exists taqdeer_required,
--   drop column if exists field_audit;
-- (re-create the two route CHECKs without 'on_site' if needed)
