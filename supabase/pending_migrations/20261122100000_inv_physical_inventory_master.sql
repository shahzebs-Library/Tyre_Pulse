-- =============================================================================
-- 20261122100000_inv_physical_inventory_master.sql
-- STATUS: DRAFT, NOT APPLIED. Lives in supabase/pending_migrations/ so no deploy
--         can apply it. Requires the applied inventory release 20261120100000..115000
--         (+ 20261121100000 / 110000). Rollback: 20261122100000_inv_physical_inventory_master_ROLLBACK.sql
--
-- PURPOSE
--   One integrated physical-inventory registration and identification system built
--   ON the existing objects (material_master, material_aliases, material_master_reviews,
--   oem_part_references, inventory_locations, opening_balance_batches, the immutable
--   ledger, inventory_rpc_requests). No second item master, no new location tree.
--
--   1. Company-wide identity layer:
--        material_canonical        = one replacement group / company SKU per COMPANY
--                                     (no country column: identification is shared by
--                                     every authorised location of the company; it
--                                     holds no stock, no cost, no balance).
--        material_variants          = a physical variant under a canonical item
--                                     (manufacturer, part number, genuine/OES/
--                                     aftermarket/unknown, country of manufacture).
--        material_canonical_items   = country ERP SKU mapping: material_master row
--                                     (country-specific, unchanged) -> canonical
--                                     (+ variant). Stock and cost stay per ERP item,
--                                     i.e. per variant per country: genuine and
--                                     aftermarket costs never mix.
--        material_aliases (extended)= references for canonical / variant (OEM,
--                                     aftermarket, company SKU, ERP SKU, barcode,
--                                     superseded) with original text + normalised
--                                     value, verification, evidence, historical state.
--   2. Physical inventory discovery:
--        physical_inventory_sessions / _captures / _photos. A capture is EVIDENCE:
--        it never posts stock. Unidentified captures get a temporary reference and
--        are never promotable until mapped by someone other than the counter.
--   3. Master-data correction centre: material_correction_requests (+ append-only
--        material_correction_events). Requester != approver; never touches
--        material_master, stock, ledger or any financial row.
--   4. Global search (security invoker: RLS decides what is seen) with authorised
--        availability, and inventory_transfer_requests ("request a transfer instead
--        of re-purchasing").
--   5. inv_pi_to_opening_batch: identified captures become an opening-balance batch
--        through the EXISTING inv_opening_batch_create; the existing submit/approve
--        (preparer != approver) posts through the ledger. Unpriced lines stay
--        unvalued. A line whose item+location already holds a balance, or whose site
--        still has unmapped legacy balances, is marked needs_review (no double count).
--   6. inv_pi_dashboard (security invoker) feeds the management dashboard.
--
-- SECURITY
--   Every new table: _inv_secure_table (RESTRICTIVE org isolation, country / site
--   SELECT scoping where the column exists, client INSERT/UPDATE/DELETE revoked).
--   Every write is a SECURITY DEFINER inv_* (p_payload jsonb) with pinned search_path,
--   anon revoked. Helpers are _inv_pi_* and not executable by authenticated.
--   Photos use the existing private bucket tyre-photos under physical_inventory/<org>/
--   (its live policies: insert app_is_active, read storage_object_in_my_org). No
--   storage policy is changed.
--
-- VERIFY (after apply, as postgres)
--   select count(*) from material_aliases where item_id is null;            -- 0 before use
--   select has_table_privilege('authenticated','public.physical_inventory_captures','INSERT'); -- f
--   select has_function_privilege('anon','public.inv_pi_capture(jsonb)','EXECUTE');           -- f
--   select count(*) from pg_proc where proname like '\_inv\_pi\_%'
--     and has_function_privilege('authenticated', oid, 'EXECUTE');           -- 0
--   Production counts that must NOT change: material_master 22162, stock_records,
--   stock_movements, opening_balance_lines, tyre_records (md5 fingerprints doc 96).
--
-- ROLLBACK
--   20261122100000_inv_physical_inventory_master_ROLLBACK.sql (refuses while any
--   capture, canonical, variant or correction exists unless inv.rollback_discard=on).
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.material_ref_norm(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;
comment on function public.material_ref_norm(text) is
  'Normalised search value of a part number / SKU / barcode: upper case, letters and digits only. The original text is always stored next to it.';

create or replace function public._inv_pi_can_capture()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved_and_unlocked()
     and (public.app_is_elevated() or public.inv_can('count') or public.inv_can('receive'))
$$;

create or replace function public._inv_pi_can_master()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved_and_unlocked()
     and (public.app_is_elevated() or public.inv_can('engineering_approve') or public.is_super_admin())
$$;

-- ---------------------------------------------------------------------------
-- 1. Company-wide identity layer
-- ---------------------------------------------------------------------------
create table if not exists public.material_canonical (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  company_sku text check (company_sku is null or length(btrim(company_sku)) between 1 and 80),
  company_sku_normalized text generated always as (public.material_ref_norm(company_sku)) stored,
  description text not null check (length(btrim(description)) between 2 and 300),
  category text,
  base_uom text,
  manufacturer text,
  brand text,
  specs jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','active','rejected','obsolete')),
  superseded_by uuid references public.material_canonical(id),
  duplicate_candidates jsonb not null default '[]'::jsonb,
  not_duplicate_reason text,
  proposed_by uuid not null default auth.uid(), proposed_at timestamptz not null default now(),
  proposed_from_site text,
  approved_by uuid, approved_at timestamptz, decision_note text,
  updated_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> proposed_by),
  check (superseded_by is null or superseded_by <> id)
);
create unique index if not exists material_canonical_sku_uq on public.material_canonical (organisation_id, company_sku_normalized)
  where company_sku_normalized is not null and status in ('proposed','active');
create index if not exists material_canonical_desc_idx on public.material_canonical (organisation_id, lower(description));
select public._inv_secure_table('material_canonical', false, false);
comment on table public.material_canonical is
  'Company-wide replacement group / company SKU. Identification only: no stock, cost or balance. Visible to every approved user of the same company (org isolation), never to another company.';

create table if not exists public.material_variants (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  canonical_id uuid not null references public.material_canonical(id),
  manufacturer text,
  brand text,
  part_number text check (part_number is null or length(btrim(part_number)) between 1 and 120),
  part_number_normalized text generated always as (public.material_ref_norm(part_number)) stored,
  part_classification text not null default 'unknown'
    check (part_classification in ('genuine','oes','aftermarket','unknown')),
  country_of_manufacture text,
  classification_evidence jsonb not null default '[]'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','active','rejected','retired')),
  proposed_by uuid not null default auth.uid(), proposed_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz, decision_note text,
  updated_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> proposed_by),
  -- A genuine / OES claim is never accepted on packaging alone: an ACTIVE variant
  -- classified genuine or OES must carry at least one evidence entry.
  check (status <> 'active' or part_classification not in ('genuine','oes')
         or jsonb_array_length(classification_evidence) > 0)
);
create index if not exists material_variants_canonical_idx on public.material_variants (canonical_id);
create index if not exists material_variants_pn_idx on public.material_variants (organisation_id, part_number_normalized);
select public._inv_secure_table('material_variants', false, false);

create table if not exists public.material_canonical_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text,
  canonical_id uuid not null references public.material_canonical(id),
  variant_id uuid references public.material_variants(id),
  item_id uuid not null references public.material_master(id),
  linked_by uuid not null default auth.uid(), linked_at timestamptz not null default now(),
  note text,
  unique (item_id)
);
create index if not exists material_canonical_items_canonical_idx on public.material_canonical_items (canonical_id);
create index if not exists material_canonical_items_variant_idx on public.material_canonical_items (variant_id);
select public._inv_secure_table('material_canonical_items', true, false);
comment on table public.material_canonical_items is
  'Country ERP SKU mapping (material_master is per country and unchanged). One ERP item belongs to exactly one canonical item / variant; the country row keeps its own stock and cost.';

-- material_aliases: references can now hang on a canonical item or a variant as
-- well as on a country ERP item. Additive; the table holds 0 rows in production.
alter table public.material_aliases
  add column if not exists canonical_id uuid references public.material_canonical(id),
  add column if not exists variant_id uuid references public.material_variants(id),
  add column if not exists manufacturer text,
  add column if not exists brand text,
  add column if not exists ref_status text not null default 'active',
  add column if not exists verified boolean not null default false,
  add column if not exists evidence jsonb not null default '[]'::jsonb;
alter table public.material_aliases alter column item_id drop not null;
alter table public.material_aliases drop constraint if exists material_aliases_alias_type_check;
alter table public.material_aliases add constraint material_aliases_alias_type_check
  check (alias_type in ('oem','alternative','superseded','barcode','erp_legacy','aftermarket','company_sku','erp_sku'));
alter table public.material_aliases drop constraint if exists material_aliases_target_chk;
alter table public.material_aliases add constraint material_aliases_target_chk
  check (item_id is not null or canonical_id is not null or variant_id is not null);
alter table public.material_aliases drop constraint if exists material_aliases_ref_status_chk;
alter table public.material_aliases add constraint material_aliases_ref_status_chk
  check (ref_status in ('active','historical'));
create unique index if not exists material_aliases_identity_uq on public.material_aliases
  (organisation_id, alias_type, value_normalized,
   coalesce(canonical_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where item_id is null and ref_status = 'active';
create index if not exists material_aliases_canonical_idx on public.material_aliases (canonical_id) where canonical_id is not null;
create index if not exists material_aliases_variant_idx on public.material_aliases (variant_id) where variant_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Physical inventory discovery
-- ---------------------------------------------------------------------------
create table if not exists public.physical_inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text not null,
  site text not null,
  location_id uuid references public.inventory_locations(id),
  audit_id uuid references public.inventory_audits(id),
  reference text not null,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  notes text,
  started_by uuid not null default auth.uid(), started_at timestamptz not null default now(),
  closed_by uuid, closed_at timestamptz, close_note text,
  opening_batch_id uuid references public.opening_balance_batches(id),
  unique (organisation_id, reference)
);
create index if not exists physical_inventory_sessions_open_idx on public.physical_inventory_sessions (organisation_id, status, site);
select public._inv_secure_table('physical_inventory_sessions', true, true);

create table if not exists public.physical_inventory_captures (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  session_id uuid not null references public.physical_inventory_sessions(id),
  country text not null,
  site text not null,
  location_id uuid references public.inventory_locations(id),
  location_hint text,
  capture_kind text not null check (capture_kind in ('identified','proposed_new','unidentified')),
  temp_ref text,
  canonical_id uuid references public.material_canonical(id),
  variant_id uuid references public.material_variants(id),
  item_id uuid references public.material_master(id),
  scanned_code text,
  scanned_code_type text check (scanned_code_type is null or scanned_code_type in
    ('barcode','company_sku','erp_sku','oem','aftermarket','manufacturer','description','label')),
  entered_refs jsonb not null default '{}'::jsonb,
  quantity numeric not null check (quantity >= 0),
  uom text,
  condition text not null default 'unknown' check (condition in ('new','used','refurbished','repairable','damaged','scrap','unknown')),
  ownership text not null default 'owned' check (ownership in ('owned','consignment','supplier','customer','unknown')),
  remarks text,
  duplicate_candidates jsonb not null default '[]'::jsonb,
  review_flags text[] not null default '{}',
  identification_status text not null default 'pending_review'
    check (identification_status in ('identified','pending_review','mapped','rejected')),
  mapped_by uuid, mapped_at timestamptz, mapping_note text,
  captured_by uuid not null default auth.uid(),
  captured_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  device_id text,
  client_uuid uuid not null,
  opening_line_id uuid references public.opening_balance_lines(id),
  unique (organisation_id, client_uuid),
  check (mapped_by is null or mapped_by <> captured_by),
  check (capture_kind = 'identified' or temp_ref is not null)
);
create unique index if not exists physical_inventory_captures_temp_ref_uq on public.physical_inventory_captures (organisation_id, temp_ref)
  where temp_ref is not null;
create index if not exists physical_inventory_captures_session_idx on public.physical_inventory_captures (session_id);
create index if not exists physical_inventory_captures_status_idx on public.physical_inventory_captures (organisation_id, identification_status);
create index if not exists physical_inventory_captures_canonical_idx on public.physical_inventory_captures (canonical_id);
select public._inv_secure_table('physical_inventory_captures', true, true);
comment on column public.physical_inventory_captures.identification_status is
  'identified/mapped = linked to an active canonical item; pending_review/rejected = never issuable and never promoted to an opening balance.';

create table if not exists public.physical_inventory_photos (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  capture_id uuid references public.physical_inventory_captures(id),
  canonical_id uuid references public.material_canonical(id),
  variant_id uuid references public.material_variants(id),
  storage_bucket text not null default 'tyre-photos' check (storage_bucket = 'tyre-photos'),
  storage_path text not null check (storage_path like 'physical_inventory/%'),
  thumb_path text check (thumb_path is null or thumb_path like 'physical_inventory/%'),
  photo_role text not null check (photo_role in ('item','label','location','packaging','damage','other')),
  purpose text not null check (purpose in ('identification','count_proof')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer check (byte_size is null or byte_size > 0),
  client_uuid uuid not null,
  uploaded_by uuid not null default auth.uid(), uploaded_at timestamptz not null default now(),
  unique (organisation_id, client_uuid),
  check (capture_id is not null or canonical_id is not null or variant_id is not null)
);
create unique index if not exists physical_inventory_photos_dedupe_uq on public.physical_inventory_photos
  (organisation_id, sha256, coalesce(capture_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(canonical_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists physical_inventory_photos_capture_idx on public.physical_inventory_photos (capture_id);
create index if not exists physical_inventory_photos_canonical_idx on public.physical_inventory_photos (canonical_id);
select public._inv_secure_table('physical_inventory_photos', false, false);

-- Photos and captures are evidence: no delete; a capture's counted facts never change.
create or replace function public._inv_pi_evidence_guard()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'Physical inventory evidence cannot be deleted.' using errcode = '42501';
  end if;
  if tg_table_name = 'physical_inventory_photos' then
    if new.storage_path is distinct from old.storage_path or new.sha256 is distinct from old.sha256
       or new.purpose is distinct from old.purpose or new.uploaded_by is distinct from old.uploaded_by
       or new.capture_id is distinct from old.capture_id
       or (old.canonical_id is not null and new.canonical_id is distinct from old.canonical_id)
       or (old.variant_id is not null and new.variant_id is distinct from old.variant_id)
       or (old.thumb_path is not null and new.thumb_path is distinct from old.thumb_path) then
      raise exception 'A stored photo link is permanent.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'physical_inventory_captures' then
    if new.quantity is distinct from old.quantity or new.captured_by is distinct from old.captured_by
       or new.captured_at is distinct from old.captured_at or new.session_id is distinct from old.session_id
       or new.site is distinct from old.site or new.country is distinct from old.country
       or new.condition is distinct from old.condition or new.ownership is distinct from old.ownership
       or new.scanned_code is distinct from old.scanned_code or new.temp_ref is distinct from old.temp_ref
       or new.client_uuid is distinct from old.client_uuid then
      raise exception 'Counted evidence (quantity, who, when, where, condition) cannot be changed; record a new capture.' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $fn$;
drop trigger if exists trg_inv_pi_evidence_guard on public.physical_inventory_photos;
create trigger trg_inv_pi_evidence_guard before update or delete on public.physical_inventory_photos
  for each row execute function public._inv_pi_evidence_guard();
drop trigger if exists trg_inv_pi_evidence_guard on public.physical_inventory_captures;
create trigger trg_inv_pi_evidence_guard before update or delete on public.physical_inventory_captures
  for each row execute function public._inv_pi_evidence_guard();

-- ---------------------------------------------------------------------------
-- 3. Corrections and transfer requests
-- ---------------------------------------------------------------------------
create table if not exists public.material_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  target_kind text not null check (target_kind in ('canonical','variant')),
  target_id uuid not null,
  action text not null check (action in ('field_update','add_reference','retire_reference','duplicate')),
  topic text not null check (topic in ('company_sku','oem','aftermarket','description','brand','manufacturer',
    'classification','uom','category','specs','country_of_manufacture','part_number','duplicate','reference')),
  old_value jsonb not null,
  new_value jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  photo_ids uuid[] not null default '{}',
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','cancelled')),
  requested_by uuid not null default auth.uid(), requested_at timestamptz not null default now(),
  decided_by uuid, decided_at timestamptz, decision_note text,
  check (decided_by is null or decided_by <> requested_by)
);
create index if not exists material_correction_requests_open_idx on public.material_correction_requests (organisation_id, status);
create index if not exists material_correction_requests_target_idx on public.material_correction_requests (target_kind, target_id);
select public._inv_secure_table('material_correction_requests', false, false);

create table if not exists public.material_correction_events (
  id bigserial primary key,
  organisation_id uuid not null references public.organisations(id),
  request_id uuid not null references public.material_correction_requests(id),
  event text not null check (event in ('submitted','approved','rejected','cancelled','applied')),
  actor_id uuid not null default auth.uid(),
  at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
create index if not exists material_correction_events_req_idx on public.material_correction_events (request_id);
select public._inv_secure_table('material_correction_events', false, false);

create or replace function public._inv_pi_append_only()
returns trigger language plpgsql set search_path = public as $fn$
begin
  raise exception 'This history is append-only.' using errcode = '42501';
end $fn$;
drop trigger if exists trg_inv_pi_append_only on public.material_correction_events;
create trigger trg_inv_pi_append_only before update or delete on public.material_correction_events
  for each row execute function public._inv_pi_append_only();

create table if not exists public.inventory_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text not null,
  site text not null,                 -- the requesting (receiving) site
  from_site text not null,
  item_id uuid not null references public.material_master(id),
  qty numeric not null check (qty > 0),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','cancelled','dispatched')),
  requested_by uuid not null default auth.uid(), requested_at timestamptz not null default now(),
  decided_by uuid, decided_at timestamptz, decision_note text,
  transfer_id uuid,
  check (upper(btrim(site)) <> upper(btrim(from_site))),
  check (decided_by is null or decided_by <> requested_by)
);
create index if not exists inventory_transfer_requests_open_idx on public.inventory_transfer_requests (organisation_id, status);
select public._inv_secure_table('inventory_transfer_requests', true, true);

-- ---------------------------------------------------------------------------
-- 4. Duplicate detection over ALL company records (never other companies)
-- ---------------------------------------------------------------------------
create or replace function public._inv_pi_dup_candidates(p_org uuid, p_refs jsonb, p_description text, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare v_vals text[]; v_desc text := lower(btrim(coalesce(p_description, ''))); v_out jsonb;
begin
  select coalesce(array_agg(distinct public.material_ref_norm(v)) filter (where public.material_ref_norm(v) is not null), '{}')
    into v_vals
    from (select value as v from jsonb_each_text(coalesce(p_refs, '{}'::jsonb))
          where key in ('company_sku','erp_sku','oem','aftermarket','barcode','part_number','scanned_code')) x;
  with hits as (
    select c.id as canonical_id, 'company_sku'::text as reason, 1 as rank from public.material_canonical c
     where c.organisation_id = p_org and c.company_sku_normalized = any (v_vals) and c.status in ('proposed','active')
    union all
    select coalesce(a.canonical_id, v.canonical_id, ci.canonical_id), 'reference:' || a.alias_type, 1
      from public.material_aliases a
      left join public.material_variants v on v.id = a.variant_id
      left join public.material_canonical_items ci on ci.item_id = a.item_id
     where a.organisation_id = p_org and a.value_normalized = any (v_vals) and a.ref_status = 'active'
    union all
    select v.canonical_id, 'variant_part_number', 1 from public.material_variants v
     where v.organisation_id = p_org and v.part_number_normalized = any (v_vals) and v.status in ('proposed','active')
    union all
    select ci.canonical_id, 'erp_sku', 1 from public.material_master m
      join public.material_canonical_items ci on ci.item_id = m.id
     where m.organisation_id = p_org and (public.material_ref_norm(m.item_code) = any (v_vals) or public.material_ref_norm(m.barcode) = any (v_vals))
    union all
    select c.id, 'similar_description', 2 from public.material_canonical c
     where length(v_desc) >= 4 and c.organisation_id = p_org and c.status in ('proposed','active')
       and (lower(c.description) = v_desc or lower(c.description) like '%' || v_desc || '%' or v_desc like '%' || lower(c.description) || '%')
  )
  select coalesce(jsonb_agg(jsonb_build_object('canonical_id', c.id, 'company_sku', c.company_sku, 'description', c.description,
           'status', c.status, 'reasons', h.reasons, 'strength', case when h.best = 1 then 'reference' else 'description_only' end)
           order by h.best, c.description), '[]'::jsonb)
    into v_out
    from (select canonical_id, min(rank) as best, array_agg(distinct reason) as reasons from hits
           where canonical_id is not null and canonical_id is distinct from p_exclude group by canonical_id) h
    join public.material_canonical c on c.id = h.canonical_id
   where c.organisation_id = p_org;
  -- ERP items of the company that are not linked yet (any country) are candidates too,
  -- reported by code only: no stock, no cost.
  return v_out || coalesce((select jsonb_agg(jsonb_build_object('item_id', m.id, 'erp_sku', m.item_code, 'country', m.country,
      'description', m.item_name, 'reasons', jsonb_build_array('erp_sku_unlinked'), 'strength', 'reference'))
    from public.material_master m
   where m.organisation_id = p_org and cardinality(v_vals) > 0
     and (public.material_ref_norm(m.item_code) = any (v_vals) or public.material_ref_norm(m.barcode) = any (v_vals))
     and not exists (select 1 from public.material_canonical_items ci where ci.item_id = m.id)), '[]'::jsonb);
end $fn$;

-- How many ERP items of the session country could stand for a canonical / variant.
create or replace function public._inv_pi_country_item_candidates(p_org uuid, p_country text, p_canonical uuid, p_variant uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.material_canonical_items ci join public.material_master m on m.id = ci.item_id
   where ci.organisation_id = p_org and lower(coalesce(m.country, '')) = lower(coalesce(p_country, ''))
     and ((p_variant is not null and ci.variant_id = p_variant)
          or (p_variant is null and ci.canonical_id = p_canonical))
$$;

-- Resolve the session-country ERP item for a canonical / variant ONLY when exactly one
-- candidate exists. Several candidates (e.g. a material without a variant whose
-- variants carry different ERP SKUs) are ambiguous: NULL, and the caller flags the
-- capture 'ambiguous_erp_sku' for a person to choose. Never pick one silently.
create or replace function public._inv_pi_country_item(p_org uuid, p_country text, p_canonical uuid, p_variant uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then (array_agg(ci.item_id))[1] end
    from public.material_canonical_items ci join public.material_master m on m.id = ci.item_id
   where ci.organisation_id = p_org and lower(coalesce(m.country, '')) = lower(coalesce(p_country, ''))
     and ((p_variant is not null and ci.variant_id = p_variant)
          or (p_variant is null and ci.canonical_id = p_canonical))
$$;

-- ---------------------------------------------------------------------------
-- 5. Canonical, variant and ERP mapping writes
-- ---------------------------------------------------------------------------
create or replace function public.inv_material_canonical_propose(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); v_id uuid; v_dups jsonb; v_ref jsonb;
begin
  r := public._inv_req_begin('inv_material_canonical_propose', p_payload); if r is not null then return r; end if;
  if not (public._inv_pi_can_capture() or public._inv_pi_can_master()) then
    raise exception 'Not authorised to propose a material.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_payload->>'description', ''))) < 2 then
    raise exception 'A description is required.' using errcode = '22023';
  end if;
  v_dups := public._inv_pi_dup_candidates(v_org, coalesce(p_payload->'refs', '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object('company_sku', p_payload->>'company_sku')), p_payload->>'description');
  insert into public.material_canonical(organisation_id, company_sku, description, category, base_uom, manufacturer, brand, specs,
    duplicate_candidates, proposed_from_site)
  values (v_org, nullif(btrim(p_payload->>'company_sku'), ''), btrim(p_payload->>'description'), nullif(p_payload->>'category', ''),
    nullif(p_payload->>'base_uom', ''), nullif(p_payload->>'manufacturer', ''), nullif(p_payload->>'brand', ''),
    coalesce(p_payload->'specs', '{}'::jsonb), v_dups, upper(nullif(btrim(p_payload->>'site'), '')))
  returning id into v_id;
  -- proposed references (unverified until the canonical is approved)
  for v_ref in select value from jsonb_array_elements(coalesce(p_payload->'references', '[]'::jsonb)) loop
    insert into public.material_aliases(organisation_id, canonical_id, alias_type, value, manufacturer, brand, source, evidence, verified)
    values (v_org, v_id, v_ref->>'alias_type', btrim(v_ref->>'value'), v_ref->>'manufacturer', v_ref->>'brand',
      coalesce(v_ref->>'source', 'proposal'), coalesce(v_ref->'evidence', '[]'::jsonb), false)
    on conflict do nothing;
  end loop;
  return public._inv_req_end('inv_material_canonical_propose', p_payload,
    jsonb_build_object('id', v_id, 'duplicates', v_dups, 'duplicate_count', jsonb_array_length(v_dups)));
end $fn$;

create or replace function public.inv_material_canonical_decide(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v public.material_canonical%rowtype; v_dec text := p_payload->>'decision';
begin
  r := public._inv_req_begin('inv_material_canonical_decide', p_payload); if r is not null then return r; end if;
  if not public._inv_pi_can_master() then
    raise exception 'Master-data approval needs stock:engineering_approve or an elevated role.' using errcode = '42501';
  end if;
  select * into v from public.material_canonical where id = (p_payload->>'canonical_id')::uuid for update;
  if not found or v.organisation_id is distinct from public.app_current_org() then
    raise exception 'Material not found.' using errcode = 'P0002';
  end if;
  if v.status <> 'proposed' then raise exception 'This proposal was already decided.' using errcode = '22023'; end if;
  if v.proposed_by = auth.uid() then
    raise exception 'The proposer cannot approve their own material.' using errcode = '42501';
  end if;
  if v_dec not in ('approve','reject') then raise exception 'Decision must be approve or reject.' using errcode = '22023'; end if;
  if v_dec = 'reject' and nullif(btrim(p_payload->>'note'), '') is null then
    raise exception 'A rejection needs a note.' using errcode = '22023';
  end if;
  if v_dec = 'approve' and jsonb_array_length(v.duplicate_candidates) > 0
     and nullif(btrim(p_payload->>'not_duplicate_reason'), '') is null then
    raise exception 'Possible duplicates exist. Confirm why this is a new material (not_duplicate_reason) or reject it.' using errcode = '22023';
  end if;
  update public.material_canonical set status = case v_dec when 'approve' then 'active' else 'rejected' end,
    approved_by = auth.uid(), approved_at = now(), decision_note = nullif(btrim(p_payload->>'note'), ''),
    not_duplicate_reason = nullif(btrim(p_payload->>'not_duplicate_reason'), ''), updated_at = now()
  where id = v.id;
  if v_dec = 'approve' then
    update public.material_aliases set verified = true, approved_by = auth.uid(), approved_at = now()
     where canonical_id = v.id and not verified;
    -- captures waiting on this proposal become identified
    update public.physical_inventory_captures set identification_status = 'identified'
     where canonical_id = v.id and identification_status = 'pending_review' and capture_kind = 'identified';
  end if;
  return public._inv_req_end('inv_material_canonical_decide', p_payload,
    jsonb_build_object('id', v.id, 'status', case v_dec when 'approve' then 'active' else 'rejected' end));
end $fn$;

create or replace function public.inv_material_variant_propose(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); v_id uuid; v_cls text := coalesce(nullif(p_payload->>'part_classification', ''), 'unknown');
begin
  r := public._inv_req_begin('inv_material_variant_propose', p_payload); if r is not null then return r; end if;
  if not (public._inv_pi_can_capture() or public._inv_pi_can_master()) then
    raise exception 'Not authorised to propose a variant.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.material_canonical where id = (p_payload->>'canonical_id')::uuid
                 and organisation_id = v_org and status in ('proposed','active')) then
    raise exception 'Canonical material not found in your company.' using errcode = 'P0002';
  end if;
  if v_cls not in ('genuine','oes','aftermarket','unknown') then
    raise exception 'part_classification must be genuine, oes, aftermarket or unknown.' using errcode = '22023';
  end if;
  insert into public.material_variants(organisation_id, canonical_id, manufacturer, brand, part_number, part_classification,
    country_of_manufacture, classification_evidence)
  values (v_org, (p_payload->>'canonical_id')::uuid, nullif(p_payload->>'manufacturer', ''), nullif(p_payload->>'brand', ''),
    nullif(btrim(p_payload->>'part_number'), ''), v_cls, nullif(p_payload->>'country_of_manufacture', ''),
    coalesce(p_payload->'evidence', '[]'::jsonb))
  returning id into v_id;
  return public._inv_req_end('inv_material_variant_propose', p_payload, jsonb_build_object('id', v_id));
end $fn$;

create or replace function public.inv_material_variant_decide(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v public.material_variants%rowtype; v_dec text := p_payload->>'decision';
begin
  r := public._inv_req_begin('inv_material_variant_decide', p_payload); if r is not null then return r; end if;
  if not public._inv_pi_can_master() then
    raise exception 'Master-data approval needs stock:engineering_approve or an elevated role.' using errcode = '42501';
  end if;
  select * into v from public.material_variants where id = (p_payload->>'variant_id')::uuid for update;
  if not found or v.organisation_id is distinct from public.app_current_org() then
    raise exception 'Variant not found.' using errcode = 'P0002';
  end if;
  if v.status <> 'proposed' then raise exception 'This variant was already decided.' using errcode = '22023'; end if;
  if v.proposed_by = auth.uid() then raise exception 'The proposer cannot approve their own variant.' using errcode = '42501'; end if;
  if v_dec not in ('approve','reject') then raise exception 'Decision must be approve or reject.' using errcode = '22023'; end if;
  if v_dec = 'approve' and v.part_classification in ('genuine','oes') and jsonb_array_length(v.classification_evidence) = 0 then
    raise exception 'A genuine or OES classification needs evidence (invoice, OEM catalogue, manufacturer confirmation). Packaging alone is not evidence.' using errcode = '22023';
  end if;
  if v_dec = 'reject' and nullif(btrim(p_payload->>'note'), '') is null then
    raise exception 'A rejection needs a note.' using errcode = '22023';
  end if;
  update public.material_variants set status = case v_dec when 'approve' then 'active' else 'rejected' end,
    approved_by = auth.uid(), approved_at = now(), decision_note = nullif(btrim(p_payload->>'note'), ''), updated_at = now()
  where id = v.id;
  return public._inv_req_end('inv_material_variant_decide', p_payload,
    jsonb_build_object('id', v.id, 'status', case v_dec when 'approve' then 'active' else 'rejected' end));
end $fn$;

create or replace function public.inv_material_link_item(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); v_item public.material_master%rowtype; v_can uuid; v_var uuid; v_id uuid;
begin
  r := public._inv_req_begin('inv_material_link_item', p_payload); if r is not null then return r; end if;
  if not public._inv_pi_can_master() then
    raise exception 'Linking an ERP SKU needs stock:engineering_approve or an elevated role.' using errcode = '42501';
  end if;
  select * into v_item from public.material_master where id = (p_payload->>'item_id')::uuid;
  if not found or v_item.organisation_id is distinct from v_org then raise exception 'ERP item not found in your company.' using errcode = 'P0002'; end if;
  if not public.app_write_country_ok(v_item.country) then raise exception 'ERP item is outside your country scope.' using errcode = '42501'; end if;
  v_var := nullif(p_payload->>'variant_id', '')::uuid;
  if v_var is not null then
    select canonical_id into v_can from public.material_variants where id = v_var and organisation_id = v_org and status = 'active';
    if v_can is null then raise exception 'Variant not found or not approved.' using errcode = 'P0002'; end if;
  else
    select id into v_can from public.material_canonical where id = (p_payload->>'canonical_id')::uuid and organisation_id = v_org and status = 'active';
    if v_can is null then raise exception 'Canonical material not found or not approved.' using errcode = 'P0002'; end if;
  end if;
  if exists (select 1 from public.material_canonical_items where item_id = v_item.id) then
    raise exception 'This ERP SKU is already linked. Use a correction request to move it.' using errcode = '23505';
  end if;
  insert into public.material_canonical_items(organisation_id, country, canonical_id, variant_id, item_id, note)
  values (v_org, v_item.country, v_can, v_var, v_item.id, nullif(p_payload->>'note', '')) returning id into v_id;
  return public._inv_req_end('inv_material_link_item', p_payload, jsonb_build_object('id', v_id));
end $fn$;

-- ---------------------------------------------------------------------------
-- 6. Sessions and captures
-- ---------------------------------------------------------------------------
create or replace function public.inv_pi_session_start(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); v_id uuid := gen_random_uuid();
  v_country text := nullif(btrim(p_payload->>'country'), ''); v_site text := upper(nullif(btrim(p_payload->>'site'), ''));
  v_loc uuid := nullif(p_payload->>'location_id', '')::uuid; v_ref text;
begin
  r := public._inv_req_begin('inv_pi_session_start', p_payload); if r is not null then return r; end if;
  if not public._inv_pi_can_capture() then
    raise exception 'Starting a physical inventory needs stock:count, stock:receive or an elevated role.' using errcode = '42501';
  end if;
  if v_country is null or v_site is null then raise exception 'Country and store are required.' using errcode = '22023'; end if;
  if not public._inv_scope_ok(v_country, v_site) then
    raise exception 'This store is outside your country or site scope.' using errcode = '42501';
  end if;
  if v_loc is not null and not exists (select 1 from public.inventory_locations where id = v_loc and organisation_id = v_org
       and site = v_site and lower(country) = lower(v_country) and active) then
    raise exception 'Location not found in this store.' using errcode = 'P0002';
  end if;
  if nullif(p_payload->>'audit_id', '') is not null and not exists (select 1 from public.inventory_audits
       where id = (p_payload->>'audit_id')::uuid and organisation_id = v_org) then
    raise exception 'Audit not found in your company.' using errcode = 'P0002';
  end if;
  v_ref := 'PI-' || to_char(now(), 'YYYYMMDD') || '-' || upper(left(replace(v_id::text, '-', ''), 6));
  insert into public.physical_inventory_sessions(id, organisation_id, country, site, location_id, audit_id, reference, notes)
  values (v_id, v_org, v_country, v_site, v_loc, nullif(p_payload->>'audit_id', '')::uuid, v_ref, nullif(p_payload->>'notes', ''));
  return public._inv_req_end('inv_pi_session_start', p_payload, jsonb_build_object('id', v_id, 'reference', v_ref));
end $fn$;

create or replace function public.inv_pi_session_close(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v public.physical_inventory_sessions%rowtype; v_cancel boolean := coalesce((p_payload->>'cancel')::boolean, false);
begin
  r := public._inv_req_begin('inv_pi_session_close', p_payload); if r is not null then return r; end if;
  select * into v from public.physical_inventory_sessions where id = (p_payload->>'session_id')::uuid for update;
  if not found or v.organisation_id is distinct from public.app_current_org() then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v.started_by <> auth.uid() and not public.app_is_elevated() then
    raise exception 'Only the person who started the session or a manager may close it.' using errcode = '42501';
  end if;
  if v.status <> 'open' then raise exception 'Session is already %.', v.status using errcode = '22023'; end if;
  if v_cancel and nullif(btrim(p_payload->>'reason'), '') is null then raise exception 'A cancellation needs a reason.' using errcode = '22023'; end if;
  update public.physical_inventory_sessions set status = case when v_cancel then 'cancelled' else 'closed' end,
    closed_by = auth.uid(), closed_at = now(), close_note = nullif(btrim(p_payload->>'reason'), '') where id = v.id;
  return public._inv_req_end('inv_pi_session_close', p_payload,
    jsonb_build_object('id', v.id, 'status', case when v_cancel then 'cancelled' else 'closed' end));
end $fn$;

-- A capture is idempotent on client_uuid (offline queues replay captures, not calls),
-- so the outer idempotency_key is optional.
create or replace function public.inv_pi_capture(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); s public.physical_inventory_sessions%rowtype;
  v_cu uuid := nullif(p_payload->>'client_uuid', '')::uuid; v_ex public.physical_inventory_captures%rowtype;
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'unidentified');
  v_can uuid := nullif(p_payload->>'canonical_id', '')::uuid; v_var uuid := nullif(p_payload->>'variant_id', '')::uuid;
  v_item uuid := nullif(p_payload->>'item_id', '')::uuid; v_loc uuid := nullif(p_payload->>'location_id', '')::uuid;
  v_status text; v_can_status text; v_temp text; v_dups jsonb := '[]'::jsonb; v_id uuid := gen_random_uuid(); v_qty numeric;
  v_flags text[] := '{}';
begin
  if not public._inv_pi_can_capture() then
    raise exception 'Recording a physical inventory capture needs stock:count, stock:receive or an elevated role.' using errcode = '42501';
  end if;
  if v_cu is null then raise exception 'client_uuid is required.' using errcode = '22023'; end if;
  -- The capture is keyed by client_uuid: a replay returns the stored row even when the
  -- retried payload differs (e.g. a new device timestamp), before the request store
  -- could refuse it as a different request. The FIRST payload is the evidence.
  select * into v_ex from public.physical_inventory_captures where organisation_id = v_org and client_uuid = v_cu;
  if found then
    return jsonb_build_object('id', v_ex.id, 'temp_ref', v_ex.temp_ref, 'identification_status', v_ex.identification_status,
      'item_id', v_ex.item_id, 'review_flags', to_jsonb(v_ex.review_flags), 'duplicate', true);
  end if;
  r := public._inv_req_begin('inv_pi_capture', p_payload, true); if r is not null then return r; end if;
  select * into s from public.physical_inventory_sessions where id = (p_payload->>'session_id')::uuid;
  if not found or s.organisation_id is distinct from v_org then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if s.status <> 'open' then raise exception 'This physical inventory session is %.', s.status using errcode = '22023'; end if;
  if not public._inv_scope_ok(s.country, s.site) then raise exception 'Store outside your scope.' using errcode = '42501'; end if;
  begin v_qty := (p_payload->>'quantity')::numeric; exception when others then v_qty := null; end;
  if v_qty is null or v_qty < 0 then raise exception 'Quantity must be zero or more.' using errcode = '22023'; end if;
  if v_loc is not null and not exists (select 1 from public.inventory_locations where id = v_loc and organisation_id = v_org
       and site = s.site and lower(country) = lower(s.country) and active) then
    raise exception 'Location not found in this store.' using errcode = 'P0002';
  end if;
  if v_kind not in ('identified','proposed_new','unidentified') then
    raise exception 'kind must be identified, proposed_new or unidentified.' using errcode = '22023';
  end if;
  if v_kind = 'identified' then
    if v_var is not null then
      select canonical_id into v_can from public.material_variants where id = v_var and organisation_id = v_org and status in ('proposed','active');
      if v_can is null then raise exception 'Variant not found in your company.' using errcode = 'P0002'; end if;
    elsif v_can is null and v_item is not null then
      select canonical_id, variant_id into v_can, v_var from public.material_canonical_items where item_id = v_item and organisation_id = v_org;
    end if;
    if v_item is not null and not exists (select 1 from public.material_master where id = v_item and organisation_id = v_org
         and lower(coalesce(country, '')) = lower(s.country)) then
      raise exception 'ERP item not found for this country.' using errcode = 'P0002';
    end if;
    if v_can is null and v_item is null then
      raise exception 'An identified capture needs a material, variant or ERP item.' using errcode = '22023';
    end if;
    if v_can is not null then
      select status into v_can_status from public.material_canonical where id = v_can and organisation_id = v_org;
      if v_can_status is null then raise exception 'Material not found in your company.' using errcode = 'P0002'; end if;
      if v_can_status not in ('proposed','active') then raise exception 'This material is %; pick the replacement.', v_can_status using errcode = '22023'; end if;
      v_item := coalesce(v_item, public._inv_pi_country_item(v_org, s.country, v_can, v_var));
      if v_item is null and public._inv_pi_country_item_candidates(v_org, s.country, v_can, v_var) > 1 then
        v_flags := array['ambiguous_erp_sku'];
      end if;
    end if;
    v_status := case when v_can is null or v_can_status = 'active' then 'identified' else 'pending_review' end;
  else
    v_status := 'pending_review';
    v_can := null; v_var := null; v_item := null;
    v_dups := public._inv_pi_dup_candidates(v_org, coalesce(p_payload->'refs', '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object('scanned_code', p_payload->>'scanned_code')), p_payload->'refs'->>'description');
  end if;
  if v_status <> 'identified' then
    v_temp := 'UNK-' || to_char(now(), 'YYMMDD') || '-' || upper(left(replace(v_id::text, '-', ''), 8));
  end if;
  insert into public.physical_inventory_captures(id, organisation_id, session_id, country, site, location_id, location_hint,
    capture_kind, temp_ref, canonical_id, variant_id, item_id, scanned_code, scanned_code_type, entered_refs, quantity, uom,
    condition, ownership, remarks, duplicate_candidates, review_flags, identification_status, captured_at, device_id, client_uuid)
  values (v_id, v_org, s.id, s.country, s.site, coalesce(v_loc, s.location_id), nullif(btrim(p_payload->>'location_hint'), ''),
    v_kind, v_temp, v_can, v_var, v_item, nullif(btrim(p_payload->>'scanned_code'), ''), nullif(p_payload->>'scanned_code_type', ''),
    coalesce(p_payload->'refs', '{}'::jsonb), v_qty, nullif(p_payload->>'uom', ''),
    coalesce(nullif(p_payload->>'condition', ''), 'unknown'), coalesce(nullif(p_payload->>'ownership', ''), 'owned'),
    nullif(btrim(p_payload->>'remarks'), ''), v_dups, v_flags, v_status,
    least(coalesce(nullif(p_payload->>'captured_at', '')::timestamptz, now()), now()), nullif(p_payload->>'device_id', ''), v_cu);
  return public._inv_req_end('inv_pi_capture', p_payload, jsonb_build_object('id', v_id, 'temp_ref', v_temp,
    'identification_status', v_status, 'item_id', v_item, 'review_flags', to_jsonb(v_flags), 'duplicates', v_dups, 'duplicate', false));
end $fn$;

create or replace function public.inv_pi_photo_attach(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_org uuid := public.app_current_org(); v_cu uuid := nullif(p_payload->>'client_uuid', '')::uuid; v_id uuid;
  v_cap uuid := nullif(p_payload->>'capture_id', '')::uuid; v_can uuid := nullif(p_payload->>'canonical_id', '')::uuid;
  v_var uuid := nullif(p_payload->>'variant_id', '')::uuid; v_path text := p_payload->>'storage_path';
begin
  if not public.is_approved_and_unlocked() or v_org is null then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_cu is null then raise exception 'client_uuid is required.' using errcode = '22023'; end if;
  select id into v_id from public.physical_inventory_photos where organisation_id = v_org and client_uuid = v_cu;
  if v_id is not null then return jsonb_build_object('id', v_id, 'duplicate', true); end if;
  if v_path is null or v_path not like 'physical_inventory/' || v_org::text || '/%' then
    raise exception 'Photos must be stored under physical_inventory/<your company>/.' using errcode = '22023';
  end if;
  if v_cap is not null then
    if not exists (select 1 from public.physical_inventory_captures c where c.id = v_cap and c.organisation_id = v_org
         and (c.captured_by = auth.uid() or public._inv_pi_can_master())) then
      raise exception 'Capture not found or not yours.' using errcode = '42501';
    end if;
  elsif v_var is not null then
    if not public._inv_pi_can_capture() or not exists (select 1 from public.material_variants where id = v_var and organisation_id = v_org) then
      raise exception 'Variant not found.' using errcode = 'P0002';
    end if;
  elsif v_can is not null then
    if not public._inv_pi_can_capture() or not exists (select 1 from public.material_canonical where id = v_can and organisation_id = v_org) then
      raise exception 'Material not found.' using errcode = 'P0002';
    end if;
  else
    raise exception 'A photo needs a capture, a material or a variant.' using errcode = '22023';
  end if;
  select id into v_id from public.physical_inventory_photos where organisation_id = v_org and sha256 = lower(p_payload->>'sha256')
     and capture_id is not distinct from v_cap and canonical_id is not distinct from v_can and variant_id is not distinct from v_var;
  if v_id is not null then return jsonb_build_object('id', v_id, 'duplicate', true); end if;
  insert into public.physical_inventory_photos(organisation_id, capture_id, canonical_id, variant_id, storage_path, thumb_path,
    photo_role, purpose, sha256, byte_size, client_uuid)
  values (v_org, v_cap, v_can, v_var, v_path, nullif(p_payload->>'thumb_path', ''), coalesce(nullif(p_payload->>'photo_role', ''), 'item'),
    coalesce(nullif(p_payload->>'purpose', ''), case when v_cap is null then 'identification' else 'count_proof' end),
    lower(p_payload->>'sha256'), nullif(p_payload->>'byte_size', '')::int, v_cu)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $fn$;

-- Engineering / master-data review of an unidentified or proposed capture.
create or replace function public.inv_pi_capture_map(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); c public.physical_inventory_captures%rowtype;
  v_dec text := p_payload->>'decision'; v_can uuid; v_var uuid; v_item uuid; n jsonb;
begin
  r := public._inv_req_begin('inv_pi_capture_map', p_payload); if r is not null then return r; end if;
  if not public._inv_pi_can_master() then
    raise exception 'Identifying a capture needs stock:engineering_approve or an elevated role.' using errcode = '42501';
  end if;
  select * into c from public.physical_inventory_captures where id = (p_payload->>'capture_id')::uuid for update;
  if not found or c.organisation_id is distinct from v_org then raise exception 'Capture not found.' using errcode = 'P0002'; end if;
  if c.captured_by = auth.uid() then
    raise exception 'The person who counted the item cannot identify their own capture.' using errcode = '42501';
  end if;
  if c.identification_status not in ('pending_review') then
    raise exception 'This capture is already %.', c.identification_status using errcode = '22023';
  end if;
  if v_dec = 'reject' then
    if nullif(btrim(p_payload->>'note'), '') is null then raise exception 'A rejection needs a note.' using errcode = '22023'; end if;
    update public.physical_inventory_captures set identification_status = 'rejected', mapped_by = auth.uid(), mapped_at = now(),
      mapping_note = btrim(p_payload->>'note') where id = c.id;
    return public._inv_req_end('inv_pi_capture_map', p_payload, jsonb_build_object('id', c.id, 'identification_status', 'rejected'));
  elsif v_dec = 'map_existing' then
    v_var := nullif(p_payload->>'variant_id', '')::uuid;
    if v_var is not null then
      select canonical_id into v_can from public.material_variants where id = v_var and organisation_id = v_org and status = 'active';
    else
      select id into v_can from public.material_canonical where id = (p_payload->>'canonical_id')::uuid and organisation_id = v_org and status = 'active';
    end if;
    if v_can is null then raise exception 'Pick an approved material or variant.' using errcode = 'P0002'; end if;
  elsif v_dec = 'create_new' then
    n := coalesce(p_payload->'canonical', '{}'::jsonb);
    if length(btrim(coalesce(n->>'description', ''))) < 2 then raise exception 'A description is required.' using errcode = '22023'; end if;
    if nullif(btrim(p_payload->>'not_duplicate_reason'), '') is null and jsonb_array_length(public._inv_pi_dup_candidates(v_org,
         coalesce(c.entered_refs, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('company_sku', n->>'company_sku')), n->>'description')) > 0 then
      raise exception 'Possible duplicates exist. Map to the existing material or give not_duplicate_reason.' using errcode = '22023';
    end if;
    -- The capture was proposed by the counter; the reviewer approves it here, so the
    -- canonical carries the counter as proposer and the reviewer as approver.
    insert into public.material_canonical(organisation_id, company_sku, description, category, base_uom, manufacturer, brand, specs,
      status, proposed_by, proposed_from_site, approved_by, approved_at, not_duplicate_reason, decision_note)
    values (v_org, nullif(btrim(n->>'company_sku'), ''), btrim(n->>'description'), nullif(n->>'category', ''), nullif(n->>'base_uom', ''),
      nullif(n->>'manufacturer', ''), nullif(n->>'brand', ''), coalesce(n->'specs', '{}'::jsonb), 'active', c.captured_by, c.site,
      auth.uid(), now(), nullif(btrim(p_payload->>'not_duplicate_reason'), ''), 'created from physical inventory capture ' || coalesce(c.temp_ref, c.id::text))
    returning id into v_can;
    if p_payload ? 'variant' then
      if coalesce(p_payload->'variant'->>'part_classification', 'unknown') in ('genuine','oes')
         and jsonb_array_length(coalesce(p_payload->'variant'->'evidence', '[]'::jsonb)) = 0 then
        raise exception 'A genuine or OES classification needs evidence. Packaging alone is not evidence.' using errcode = '22023';
      end if;
      insert into public.material_variants(organisation_id, canonical_id, manufacturer, brand, part_number, part_classification,
        country_of_manufacture, classification_evidence, status, proposed_by, approved_by, approved_at)
      values (v_org, v_can, nullif(p_payload->'variant'->>'manufacturer', ''), nullif(p_payload->'variant'->>'brand', ''),
        nullif(btrim(p_payload->'variant'->>'part_number'), ''), coalesce(nullif(p_payload->'variant'->>'part_classification', ''), 'unknown'),
        nullif(p_payload->'variant'->>'country_of_manufacture', ''), coalesce(p_payload->'variant'->'evidence', '[]'::jsonb),
        'active', c.captured_by, auth.uid(), now())
      returning id into v_var;
    end if;
  else
    raise exception 'decision must be map_existing, create_new or reject.' using errcode = '22023';
  end if;
  v_item := nullif(p_payload->>'item_id', '')::uuid;
  if v_item is not null then
    if not exists (select 1 from public.material_master where id = v_item and organisation_id = v_org
                   and lower(coalesce(country, '')) = lower(c.country)) then
      raise exception 'ERP item not found for this country.' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.material_canonical_items where item_id = v_item) then
      insert into public.material_canonical_items(organisation_id, country, canonical_id, variant_id, item_id, note)
      values (v_org, c.country, v_can, v_var, v_item, 'linked while identifying ' || coalesce(c.temp_ref, c.id::text));
    elsif not exists (select 1 from public.material_canonical_items where item_id = v_item and canonical_id = v_can) then
      raise exception 'This ERP SKU belongs to another material. Raise a correction request.' using errcode = '23505';
    end if;
  end if;
  v_item := coalesce(v_item, public._inv_pi_country_item(v_org, c.country, v_can, v_var));
  update public.physical_inventory_captures set canonical_id = v_can, variant_id = v_var, item_id = v_item,
    review_flags = case when v_item is null and public._inv_pi_country_item_candidates(v_org, c.country, v_can, v_var) > 1
                        then array['ambiguous_erp_sku'] else '{}'::text[] end,
    identification_status = 'mapped', mapped_by = auth.uid(), mapped_at = now(), mapping_note = nullif(btrim(p_payload->>'note'), '')
  where id = c.id;
  -- identification photos of this capture become reusable photos of the material (count proof stays on the capture)
  insert into public.physical_inventory_photos(organisation_id, canonical_id, variant_id, storage_path, thumb_path, photo_role,
    purpose, sha256, byte_size, client_uuid, uploaded_by)
  select p.organisation_id, v_can, v_var, p.storage_path, p.thumb_path, p.photo_role, 'identification', p.sha256, p.byte_size,
         gen_random_uuid(), p.uploaded_by
    from public.physical_inventory_photos p
   where p.capture_id = c.id and p.purpose = 'identification'
  on conflict do nothing;
  return public._inv_req_end('inv_pi_capture_map', p_payload, jsonb_build_object('id', c.id, 'identification_status', 'mapped',
    'canonical_id', v_can, 'variant_id', v_var, 'item_id', v_item));
end $fn$;

-- ---------------------------------------------------------------------------
-- 7. Correction centre
-- ---------------------------------------------------------------------------
create or replace function public._inv_pi_target_snapshot(p_kind text, p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'canonical' then (select jsonb_build_object('company_sku', company_sku, 'description', description, 'category', category,
        'base_uom', base_uom, 'manufacturer', manufacturer, 'brand', brand, 'specs', specs, 'status', status, 'updated_at', updated_at)
        from public.material_canonical where id = p_id)
    when 'variant' then (select jsonb_build_object('manufacturer', manufacturer, 'brand', brand, 'part_number', part_number,
        'part_classification', part_classification, 'country_of_manufacture', country_of_manufacture, 'status', status, 'updated_at', updated_at)
        from public.material_variants where id = p_id)
  end
$$;

create or replace function public.inv_correction_request(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); v_kind text := p_payload->>'target_kind'; v_tid uuid := (p_payload->>'target_id')::uuid;
  v_action text := p_payload->>'action'; v_new jsonb := coalesce(p_payload->'new_value', '{}'::jsonb); v_old jsonb; v_id uuid; v_k text;
  v_allowed text[];
begin
  r := public._inv_req_begin('inv_correction_request', p_payload); if r is not null then return r; end if;
  if not (public._inv_pi_can_capture() or public._inv_pi_can_master()) then
    raise exception 'Not authorised to propose master-data corrections.' using errcode = '42501';
  end if;
  if v_kind not in ('canonical','variant') then
    raise exception 'target_kind must be canonical or variant. Country ERP item fields are corrected through the master review.' using errcode = '22023';
  end if;
  if (v_kind = 'canonical' and not exists (select 1 from public.material_canonical where id = v_tid and organisation_id = v_org))
     or (v_kind = 'variant' and not exists (select 1 from public.material_variants where id = v_tid and organisation_id = v_org)) then
    raise exception 'Target not found in your company.' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_payload->>'reason'), '') is null then raise exception 'A reason is required.' using errcode = '22023'; end if;
  v_old := public._inv_pi_target_snapshot(v_kind, v_tid);
  if v_action = 'field_update' then
    v_allowed := case v_kind when 'canonical' then array['company_sku','description','category','base_uom','manufacturer','brand','specs']
                             else array['manufacturer','brand','part_number','part_classification','country_of_manufacture'] end;
    if v_new = '{}'::jsonb then raise exception 'Nothing to change.' using errcode = '22023'; end if;
    for v_k in select jsonb_object_keys(v_new) loop
      if not v_k = any (v_allowed) then raise exception 'Field % cannot be corrected here.', v_k using errcode = '22023'; end if;
    end loop;
    if v_new ? 'part_classification' and v_new->>'part_classification' in ('genuine','oes')
       and jsonb_array_length(coalesce(p_payload->'evidence', '[]'::jsonb)) = 0 then
      raise exception 'A genuine or OES classification needs evidence. Packaging alone is not evidence.' using errcode = '22023';
    end if;
  elsif v_action = 'add_reference' then
    if coalesce(v_new->>'alias_type', '') not in ('oem','alternative','superseded','barcode','aftermarket','company_sku','erp_legacy')
       or nullif(btrim(v_new->>'value'), '') is null then
      raise exception 'A reference needs alias_type and value.' using errcode = '22023';
    end if;
  elsif v_action = 'retire_reference' then
    if not exists (select 1 from public.material_aliases where id = (v_new->>'alias_id')::uuid and organisation_id = v_org
                   and ref_status = 'active' and (canonical_id = v_tid or variant_id = v_tid)) then
      raise exception 'Reference not found on this record.' using errcode = 'P0002';
    end if;
  elsif v_action = 'duplicate' then
    if v_kind <> 'canonical' or not exists (select 1 from public.material_canonical where id = (v_new->>'keep_canonical_id')::uuid
         and organisation_id = v_org and status = 'active' and id <> v_tid) then
      raise exception 'A duplicate request names the approved material to keep (keep_canonical_id).' using errcode = '22023';
    end if;
  else
    raise exception 'action must be field_update, add_reference, retire_reference or duplicate.' using errcode = '22023';
  end if;
  insert into public.material_correction_requests(organisation_id, target_kind, target_id, action, topic, old_value, new_value,
    evidence, photo_ids, reason)
  values (v_org, v_kind, v_tid, v_action, coalesce(nullif(p_payload->>'topic', ''), case v_action when 'duplicate' then 'duplicate' else 'reference' end),
    v_old, v_new, coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_payload->'photo_ids', '[]'::jsonb)) x), '{}'),
    btrim(p_payload->>'reason'))
  returning id into v_id;
  insert into public.material_correction_events(organisation_id, request_id, event, detail)
  values (v_org, v_id, 'submitted', jsonb_build_object('old', v_old, 'new', v_new));
  return public._inv_req_end('inv_correction_request', p_payload, jsonb_build_object('id', v_id));
end $fn$;

create or replace function public.inv_correction_decide(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v public.material_correction_requests%rowtype; v_dec text := p_payload->>'decision'; v_now jsonb;
  v_k text; v_set text := ''; v_tbl text;
begin
  r := public._inv_req_begin('inv_correction_decide', p_payload); if r is not null then return r; end if;
  select * into v from public.material_correction_requests where id = (p_payload->>'request_id')::uuid for update;
  if not found or v.organisation_id is distinct from public.app_current_org() then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if v.status <> 'submitted' then raise exception 'Request already %.', v.status using errcode = '22023'; end if;
  if v_dec = 'cancel' then
    if v.requested_by <> auth.uid() then raise exception 'Only the requester can cancel.' using errcode = '42501'; end if;
    update public.material_correction_requests set status = 'cancelled' where id = v.id;
    insert into public.material_correction_events(organisation_id, request_id, event) values (v.organisation_id, v.id, 'cancelled');
    return public._inv_req_end('inv_correction_decide', p_payload, jsonb_build_object('id', v.id, 'status', 'cancelled'));
  end if;
  if not public._inv_pi_can_master() then
    raise exception 'Deciding a correction needs stock:engineering_approve or an elevated role.' using errcode = '42501';
  end if;
  if v.requested_by = auth.uid() then raise exception 'The requester cannot approve their own correction.' using errcode = '42501'; end if;
  if v_dec not in ('approve','reject') then raise exception 'Decision must be approve, reject or cancel.' using errcode = '22023'; end if;
  if v_dec = 'reject' then
    if nullif(btrim(p_payload->>'note'), '') is null then raise exception 'A rejection needs a note.' using errcode = '22023'; end if;
    update public.material_correction_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = btrim(p_payload->>'note') where id = v.id;
    insert into public.material_correction_events(organisation_id, request_id, event, detail)
    values (v.organisation_id, v.id, 'rejected', jsonb_build_object('note', p_payload->>'note'));
    return public._inv_req_end('inv_correction_decide', p_payload, jsonb_build_object('id', v.id, 'status', 'rejected'));
  end if;
  -- stale guard: the record must still look the way the requester saw it
  v_now := public._inv_pi_target_snapshot(v.target_kind, v.target_id);
  if v_now is distinct from v.old_value then
    raise exception 'record_changed: the record changed after this request was made; ask for a new request.' using errcode = 'PT409';
  end if;
  v_tbl := case v.target_kind when 'canonical' then 'material_canonical' else 'material_variants' end;
  if v.action = 'field_update' then
    -- the old company SKU / part number stays findable as a historical reference
    if v.target_kind = 'canonical' and v.new_value ? 'company_sku' and nullif(v.old_value->>'company_sku', '') is not null then
      insert into public.material_aliases(organisation_id, canonical_id, alias_type, value, source, ref_status, verified, approved_by, approved_at, effective_to)
      values (v.organisation_id, v.target_id, 'superseded', v.old_value->>'company_sku', 'correction ' || v.id, 'historical', true, auth.uid(), now(), current_date)
      on conflict do nothing;
    end if;
    if v.target_kind = 'variant' and v.new_value ? 'part_number' and nullif(v.old_value->>'part_number', '') is not null then
      insert into public.material_aliases(organisation_id, variant_id, alias_type, value, source, ref_status, verified, approved_by, approved_at, effective_to)
      values (v.organisation_id, v.target_id, 'superseded', v.old_value->>'part_number', 'correction ' || v.id, 'historical', true, auth.uid(), now(), current_date)
      on conflict do nothing;
    end if;
    if v.target_kind = 'variant' and v.new_value ? 'part_classification' then
      update public.material_variants set classification_evidence = classification_evidence || v.evidence where id = v.target_id;
    end if;
    for v_k in select jsonb_object_keys(v.new_value) loop
      v_set := v_set || format('%I = (jsonb_populate_record(null::public.%I, $1)).%I, ', v_k, v_tbl, v_k);
    end loop;
    execute format('update public.%I set %s updated_at = now() where id = $2', v_tbl, v_set) using v.new_value, v.target_id;
  elsif v.action = 'add_reference' then
    insert into public.material_aliases(organisation_id, canonical_id, variant_id, alias_type, value, manufacturer, brand, source,
      evidence, verified, approved_by, approved_at, review_id)
    values (v.organisation_id, case when v.target_kind = 'canonical' then v.target_id end,
      case when v.target_kind = 'variant' then v.target_id end, v.new_value->>'alias_type', btrim(v.new_value->>'value'),
      v.new_value->>'manufacturer', v.new_value->>'brand', 'correction ' || v.id, v.evidence, true, auth.uid(), now(), v.id);
  elsif v.action = 'retire_reference' then
    update public.material_aliases set ref_status = 'historical', effective_to = current_date
     where id = (v.new_value->>'alias_id')::uuid and organisation_id = v.organisation_id;
  elsif v.action = 'duplicate' then
    -- Non-destructive: the duplicate is marked obsolete and points at the material kept.
    -- Nothing is deleted or re-pointed; history, captures and ERP links stay as recorded.
    update public.material_canonical set status = 'obsolete', superseded_by = (v.new_value->>'keep_canonical_id')::uuid, updated_at = now()
     where id = v.target_id;
  end if;
  update public.material_correction_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_payload->>'note'), '') where id = v.id;
  insert into public.material_correction_events(organisation_id, request_id, event, detail)
  values (v.organisation_id, v.id, 'approved', jsonb_build_object('note', p_payload->>'note')),
         (v.organisation_id, v.id, 'applied', jsonb_build_object('after', public._inv_pi_target_snapshot(v.target_kind, v.target_id)));
  return public._inv_req_end('inv_correction_decide', p_payload, jsonb_build_object('id', v.id, 'status', 'approved'));
end $fn$;

-- ---------------------------------------------------------------------------
-- 8. Search (SECURITY INVOKER: RLS decides what the caller may see)
-- ---------------------------------------------------------------------------
create or replace function public.inv_material_search(p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $fn$
declare v_q text := btrim(coalesce(p_payload->>'query', '')); v_n text; v_lim int := least(greatest(coalesce((p_payload->>'limit')::int, 25), 1), 50);
  v_out jsonb;
begin
  if length(v_q) < 2 then return jsonb_build_object('query', v_q, 'results', '[]'::jsonb); end if;
  v_n := public.material_ref_norm(v_q);
  with hits as (
    select c.id as canonical_id, null::uuid as variant_id, 1 as rank, 'company_sku' as matched_on from material_canonical c
     where v_n is not null and c.company_sku_normalized = v_n
    union all
    select coalesce(a.canonical_id, v.canonical_id, ci.canonical_id), coalesce(a.variant_id, ci.variant_id), 1,
           a.alias_type || case when a.ref_status = 'historical' then '_historical' else '' end
      from material_aliases a
      left join material_variants v on v.id = a.variant_id
      left join material_canonical_items ci on ci.item_id = a.item_id
     where v_n is not null and a.value_normalized = v_n
    union all
    select v.canonical_id, v.id, 1, 'part_number' from material_variants v where v_n is not null and v.part_number_normalized = v_n
    union all
    select ci.canonical_id, ci.variant_id, 1, 'erp_sku' from material_master m join material_canonical_items ci on ci.item_id = m.id
     where v_n is not null and (public.material_ref_norm(m.item_code) = v_n or public.material_ref_norm(m.barcode) = v_n)
    union all
    select c.id, null, 2, 'company_sku_prefix' from material_canonical c
     where v_n is not null and length(v_n) >= 3 and c.company_sku_normalized like v_n || '%'
    union all
    select v.canonical_id, v.id, 2, 'part_number_prefix' from material_variants v
     where v_n is not null and length(v_n) >= 3 and v.part_number_normalized like v_n || '%'
    union all
    select c.id, null, 3, 'description' from material_canonical c
     where c.description ilike '%' || v_q || '%' or c.manufacturer ilike '%' || v_q || '%' or c.brand ilike '%' || v_q || '%'
    union all
    select v.canonical_id, v.id, 3, 'manufacturer' from material_variants v
     where v.manufacturer ilike '%' || v_q || '%' or v.brand ilike '%' || v_q || '%'
    union all
    select f.item_id_canonical, null, 3, 'compatibility' from (
      select ci.canonical_id as item_id_canonical from equipment_fitments f join material_canonical_items ci on ci.item_id = f.item_id
       where f.status = 'approved' and (f.make ilike '%' || v_q || '%' or f.model ilike '%' || v_q || '%' or f.model_code ilike '%' || v_q || '%')) f
  ), best as (
    select canonical_id, min(rank) as rank, array_agg(distinct matched_on) as matched_on,
           array_agg(distinct variant_id) filter (where variant_id is not null) as variant_ids
      from hits where canonical_id is not null group by canonical_id order by min(rank) limit v_lim
  ), avail as (
    select ci.canonical_id, ci.variant_id, sr.site,
           sum(case when coalesce(l.location_type, 'warehouse') not in ('in_transit','quarantine','damaged','scrap')
                     and coalesce(sr.condition, '') not in ('damaged','scrap')
                    then greatest(sr.qty_on_hand - sr.qty_reserved, 0) else 0 end) as available,
           sum(sr.qty_reserved) as reserved,
           sum(case when l.location_type = 'in_transit' then sr.qty_on_hand else 0 end) as in_transit,
           sum(case when l.location_type in ('damaged','scrap') or sr.condition in ('damaged','scrap') then sr.qty_on_hand else 0 end) as damaged,
           sum(case when l.location_type = 'quarantine' then sr.qty_on_hand else 0 end) as quarantined
      from material_canonical_items ci
      join stock_records sr on sr.item_id = ci.item_id
      left join inventory_locations l on l.id = sr.location_id
     where ci.canonical_id in (select canonical_id from best)
     group by ci.canonical_id, ci.variant_id, sr.site
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'canonical_id', c.id, 'company_sku', c.company_sku, 'description', c.description, 'category', c.category,
      'base_uom', c.base_uom, 'manufacturer', c.manufacturer, 'brand', c.brand, 'status', c.status,
      'superseded_by', c.superseded_by, 'matched_on', b.matched_on, 'rank', b.rank,
      'references', (select coalesce(jsonb_agg(jsonb_build_object('type', a.alias_type, 'value', a.value, 'status', a.ref_status,
                       'verified', a.verified, 'manufacturer', a.manufacturer) order by a.alias_type, a.value), '[]'::jsonb)
                       from material_aliases a where a.canonical_id = c.id),
      'erp_skus', (select coalesce(jsonb_agg(jsonb_build_object('item_id', m.id, 'item_code', m.item_code, 'country', m.country,
                     'variant_id', ci.variant_id)), '[]'::jsonb)
                     from material_canonical_items ci join material_master m on m.id = ci.item_id where ci.canonical_id = c.id),
      'variants', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'manufacturer', v.manufacturer, 'brand', v.brand,
                     'part_number', v.part_number, 'classification', v.part_classification, 'status', v.status,
                     'country_of_manufacture', v.country_of_manufacture, 'matched', v.id = any (coalesce(b.variant_ids, '{}')),
                     'availability', (select coalesce(jsonb_agg(jsonb_build_object('site', x.site, 'available', x.available,
                         'reserved', x.reserved, 'in_transit', x.in_transit, 'damaged', x.damaged, 'quarantined', x.quarantined)), '[]'::jsonb)
                         from avail x where x.canonical_id = c.id and x.variant_id = v.id))
                     order by case v.part_classification when 'genuine' then 1 when 'oes' then 2 when 'aftermarket' then 3 else 4 end), '[]'::jsonb)
                     from material_variants v where v.canonical_id = c.id and v.status in ('proposed','active')),
      'availability_unassigned', (select coalesce(jsonb_agg(jsonb_build_object('site', x.site, 'available', x.available,
                     'reserved', x.reserved, 'in_transit', x.in_transit, 'damaged', x.damaged, 'quarantined', x.quarantined)), '[]'::jsonb)
                     from avail x where x.canonical_id = c.id and x.variant_id is null)
    ) order by b.rank, c.description), '[]'::jsonb)
    into v_out
    from best b join material_canonical c on c.id = b.canonical_id;
  return jsonb_build_object('query', v_q, 'results', v_out);
end $fn$;

-- ---------------------------------------------------------------------------
-- 9. Transfer request instead of re-purchasing
-- ---------------------------------------------------------------------------
create or replace function public.inv_transfer_request(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); v_item public.material_master%rowtype; v_id uuid; v_qty numeric;
begin
  r := public._inv_req_begin('inv_transfer_request', p_payload); if r is not null then return r; end if;
  if not public.is_approved_and_unlocked() or not public.inv_can('view') then raise exception 'Not authorised.' using errcode = '42501'; end if;
  select * into v_item from public.material_master where id = (p_payload->>'item_id')::uuid;
  if not found or v_item.organisation_id is distinct from v_org then raise exception 'Item not found.' using errcode = 'P0002'; end if;
  if not public._inv_scope_ok(v_item.country, p_payload->>'site') then raise exception 'Requesting store outside your scope.' using errcode = '42501'; end if;
  begin v_qty := (p_payload->>'qty')::numeric; exception when others then v_qty := null; end;
  if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be more than zero.' using errcode = '22023'; end if;
  if nullif(btrim(p_payload->>'reason'), '') is null then raise exception 'A reason is required.' using errcode = '22023'; end if;
  insert into public.inventory_transfer_requests(organisation_id, country, site, from_site, item_id, qty, reason)
  values (v_org, v_item.country, upper(btrim(p_payload->>'site')), upper(btrim(p_payload->>'from_site')), v_item.id, v_qty, btrim(p_payload->>'reason'))
  returning id into v_id;
  return public._inv_req_end('inv_transfer_request', p_payload, jsonb_build_object('id', v_id));
end $fn$;

create or replace function public.inv_transfer_request_decide(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v public.inventory_transfer_requests%rowtype; v_dec text := p_payload->>'decision';
begin
  r := public._inv_req_begin('inv_transfer_request_decide', p_payload); if r is not null then return r; end if;
  select * into v from public.inventory_transfer_requests where id = (p_payload->>'request_id')::uuid for update;
  if not found or v.organisation_id is distinct from public.app_current_org() then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if v.status <> 'requested' then raise exception 'Request already %.', v.status using errcode = '22023'; end if;
  if v_dec = 'cancel' then
    if v.requested_by <> auth.uid() then raise exception 'Only the requester can cancel.' using errcode = '42501'; end if;
  else
    if not (public.inv_can('transfer') or public.app_is_elevated()) or not public._inv_scope_ok(v.country, v.from_site) then
      raise exception 'Deciding needs stock:transfer at the sending store.' using errcode = '42501';
    end if;
    if v.requested_by = auth.uid() then raise exception 'The requester cannot approve their own transfer request.' using errcode = '42501'; end if;
    if v_dec not in ('approve','reject') then raise exception 'Decision must be approve, reject or cancel.' using errcode = '22023'; end if;
    if v_dec = 'reject' and nullif(btrim(p_payload->>'note'), '') is null then raise exception 'A rejection needs a note.' using errcode = '22023'; end if;
  end if;
  update public.inventory_transfer_requests set status = case v_dec when 'approve' then 'approved' when 'reject' then 'rejected' else 'cancelled' end,
    decided_by = case when v_dec = 'cancel' then null else auth.uid() end, decided_at = now(), decision_note = nullif(btrim(p_payload->>'note'), '')
  where id = v.id;
  return public._inv_req_end('inv_transfer_request_decide', p_payload, jsonb_build_object('id', v.id,
    'status', case v_dec when 'approve' then 'approved' when 'reject' then 'rejected' else 'cancelled' end,
    'next_step', case when v_dec = 'approve' then 'Dispatch through Stock flows > Transfer (inv_transfer_dispatch).' end));
end $fn$;

-- ---------------------------------------------------------------------------
-- 10. Discovery -> opening balance (through the existing governed batch)
-- ---------------------------------------------------------------------------
create or replace function public.inv_pi_to_opening_batch(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); s public.physical_inventory_sessions%rowtype; v_lines jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb; c record; v_batch jsonb; v_batch_id uuid; v_legacy int; v_line record;
begin
  r := public._inv_req_begin('inv_pi_to_opening_batch', p_payload); if r is not null then return r; end if;
  select * into s from public.physical_inventory_sessions where id = (p_payload->>'session_id')::uuid for update;
  if not found or s.organisation_id is distinct from v_org then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if s.status <> 'closed' then raise exception 'Close the session before preparing its opening balance.' using errcode = '22023'; end if;
  if s.opening_batch_id is not null then raise exception 'This session already has an opening-balance batch.' using errcode = '23505'; end if;
  for c in select * from public.physical_inventory_captures where session_id = s.id order by captured_at, id loop
    if c.identification_status not in ('identified','mapped') then
      v_skipped := v_skipped || jsonb_build_object('capture_id', c.id, 'temp_ref', c.temp_ref, 'reason', 'not_identified');
    elsif c.item_id is null then
      v_skipped := v_skipped || jsonb_build_object('capture_id', c.id, 'reason',
        case when 'ambiguous_erp_sku' = any (c.review_flags) then 'ambiguous_erp_sku' else 'no_erp_sku_for_country' end);
    elsif c.ownership <> 'owned' then
      -- Customer, supplier, consignment or unknown ownership is never posted as owned
      -- stock. Those need an explicit ownership decision (supplier agreement / consignment
      -- receipt through Supply) and stay out of the opening balance.
      v_skipped := v_skipped || jsonb_build_object('capture_id', c.id, 'reason', 'ownership_needs_decision', 'ownership', c.ownership);
    elsif c.opening_line_id is not null then
      v_skipped := v_skipped || jsonb_build_object('capture_id', c.id, 'reason', 'already_promoted');
    elsif c.quantity = 0 then
      v_skipped := v_skipped || jsonb_build_object('capture_id', c.id, 'reason', 'zero_quantity');
    else
      v_lines := v_lines || jsonb_strip_nulls(jsonb_build_object('item_id', c.item_id, 'location_id', c.location_id, 'qty', c.quantity,
        'condition', c.condition, 'ownership', 'owned',
        'uom', c.uom, 'source_ref', 'capture:' || c.id, 'description', coalesce(c.location_hint, ''),
        'notes', 'physical inventory ' || s.reference));
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'No identified captures with an ERP SKU to prepare.' using errcode = '22023';
  end if;
  -- the existing governed batch (preparer = caller; approval by someone else posts through the ledger)
  v_batch := public.inv_opening_batch_create(jsonb_build_object('idempotency_key', 'pi-ob-' || s.id, 'country', s.country,
    'site', s.site, 'source', 'manual', 'reference', 'OB-' || s.reference, 'source_filename', s.reference, 'lines', v_lines));
  v_batch_id := (v_batch->>'batch_id')::uuid;
  select count(*) into v_legacy from public.stock_records where organisation_id = v_org and upper(btrim(site)) = s.site
     and lower(coalesce(country, '')) = lower(s.country) and item_id is null and (qty_on_hand > 0 or coalesce(stock_qty, 0) > 0);
  for v_line in select id, item_id, location_id, condition, ownership, source_ref from public.opening_balance_lines where batch_id = v_batch_id loop
    update public.physical_inventory_captures set opening_line_id = v_line.id
     where id = substring(v_line.source_ref from 9)::uuid;
    -- no double counting: an item already holding a ledger balance here, or a site with unmapped
    -- legacy balances, must be reconciled by the approver before posting.
    if exists (select 1 from public.stock_records sr where sr.organisation_id = v_org and sr.item_id = v_line.item_id
                and sr.location_id is not distinct from v_line.location_id and sr.qty_on_hand > 0) then
      update public.opening_balance_lines set mapping_status = 'needs_review',
        issues = issues || '["existing_balance_at_location"]'::jsonb where id = v_line.id;
    elsif v_legacy > 0 then
      update public.opening_balance_lines set mapping_status = 'needs_review',
        issues = issues || '["site_has_unmapped_legacy_balances"]'::jsonb where id = v_line.id;
    end if;
  end loop;
  update public.physical_inventory_sessions set opening_batch_id = v_batch_id where id = s.id;
  return public._inv_req_end('inv_pi_to_opening_batch', p_payload, jsonb_build_object('id', v_batch_id,
    'lines', jsonb_array_length(v_lines), 'skipped', v_skipped, 'legacy_unmapped_balances_at_site', v_legacy));
end $fn$;

-- ---------------------------------------------------------------------------
-- 11. Management dashboard (SECURITY INVOKER: scope from RLS)
-- ---------------------------------------------------------------------------
create or replace function public.inv_pi_dashboard(p_payload jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $fn$
  with cap as (
    select c.*, v.part_classification as cls, cn.company_sku, cn.status as canonical_status,
           exists (select 1 from material_aliases a where a.canonical_id = c.canonical_id and a.alias_type = 'oem' and a.ref_status = 'active') as has_oem,
           exists (select 1 from material_aliases a where (a.canonical_id = c.canonical_id or a.variant_id = c.variant_id)
                    and a.alias_type = 'aftermarket' and a.ref_status = 'active')
             or v.part_classification = 'aftermarket' and v.part_number is not null as has_aftermarket,
           ol.missing_cost, ob.status as batch_status
      from physical_inventory_captures c
      left join material_variants v on v.id = c.variant_id
      left join material_canonical cn on cn.id = c.canonical_id
      left join opening_balance_lines ol on ol.id = c.opening_line_id
      left join opening_balance_batches ob on ob.id = ol.batch_id
     where (nullif(p_payload->>'country', '') is null or lower(c.country) = lower(p_payload->>'country'))
       and (nullif(p_payload->>'site', '') is null or upper(p_payload->>'site') = 'ALL' or c.site = upper(btrim(p_payload->>'site')))
       and (nullif(p_payload->>'session_id', '') is null or c.session_id = (p_payload->>'session_id')::uuid)
  )
  select jsonb_build_object(
    'captures', (select count(*) from cap),
    'quantity', (select coalesce(sum(quantity), 0) from cap),
    'identified', (select count(*) from cap where identification_status in ('identified','mapped')),
    'pending_review', (select count(*) from cap where identification_status = 'pending_review'),
    'rejected', (select count(*) from cap where identification_status = 'rejected'),
    'missing_company_sku', (select count(*) from cap where identification_status in ('identified','mapped') and company_sku is null),
    'missing_erp_sku', (select count(*) from cap where identification_status in ('identified','mapped') and item_id is null),
    'ambiguous_erp_sku', (select count(*) from cap where 'ambiguous_erp_sku' = any (review_flags)),
    'ownership_needs_decision', (select count(*) from cap where ownership <> 'owned'),
    'missing_oem', (select count(*) from cap where identification_status in ('identified','mapped') and not has_oem),
    'missing_aftermarket', (select count(*) from cap where cls = 'aftermarket' and not has_aftermarket),
    'duplicate_candidates', (select count(*) from cap where jsonb_array_length(duplicate_candidates) > 0 and identification_status = 'pending_review'),
    'pending_corrections', (select count(*) from material_correction_requests where status = 'submitted'),
    'pending_materials', (select count(*) from material_canonical where status = 'proposed'),
    'classification', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(cls, 'not_identified') k, count(*) n from cap group by 1) x),
    'condition', (select coalesce(jsonb_object_agg(condition, n), '{}'::jsonb) from (select condition, count(*) n from cap group by 1) x),
    'valuation', jsonb_build_object(
      'promoted', (select count(*) from cap where opening_line_id is not null),
      'unvalued', (select count(*) from cap where missing_cost is true),
      'not_promoted', (select count(*) from cap where opening_line_id is null and identification_status in ('identified','mapped'))),
    'approval', (select coalesce(jsonb_object_agg(coalesce(batch_status, 'not_prepared'), n), '{}'::jsonb)
                   from (select batch_status, count(*) n from cap group by 1) x),
    'by_employee', (select coalesce(jsonb_agg(x order by x.captures desc), '[]'::jsonb) from (
        select c.captured_by as user_id, p.full_name, count(*) as captures,
               count(*) filter (where c.identification_status in ('identified','mapped')) as identified
          from cap c left join profiles p on p.id = c.captured_by group by 1, 2) x),
    'by_location', (select coalesce(jsonb_agg(x order by x.site, x.location), '[]'::jsonb) from (
        select c.site, coalesce(l.code, c.location_hint, '-') as location, count(*) as captures,
               count(*) filter (where c.identification_status = 'pending_review') as pending
          from cap c left join inventory_locations l on l.id = c.location_id group by 1, 2) x)
  )
$fn$;

-- ---------------------------------------------------------------------------
-- 12. Read view for list screens (security invoker)
-- ---------------------------------------------------------------------------
create or replace view public.v_inv_pi_captures with (security_invoker = on) as
select c.id, c.organisation_id, c.session_id, s.reference as session_reference, c.country, c.site, c.location_id,
       l.code as location_code, c.location_hint, c.capture_kind, c.temp_ref, c.canonical_id, cn.company_sku,
       cn.description as canonical_description, c.variant_id, v.part_number, v.manufacturer as variant_manufacturer,
       v.part_classification, c.item_id, m.item_code as erp_sku, c.scanned_code, c.scanned_code_type, c.entered_refs,
       c.quantity, c.uom, c.condition, c.ownership, c.remarks, c.duplicate_candidates, c.review_flags, c.identification_status,
       c.identification_status in ('identified','mapped') as issuable_identity,
       c.mapped_by, c.mapped_at, c.mapping_note, c.captured_by, p.full_name as captured_by_name, c.captured_at,
       c.device_id, c.opening_line_id,
       (select count(*) from physical_inventory_photos ph where ph.capture_id = c.id) as photo_count
  from public.physical_inventory_captures c
  join public.physical_inventory_sessions s on s.id = c.session_id
  left join public.inventory_locations l on l.id = c.location_id
  left join public.material_canonical cn on cn.id = c.canonical_id
  left join public.material_variants v on v.id = c.variant_id
  left join public.material_master m on m.id = c.item_id
  left join public.profiles p on p.id = c.captured_by;
revoke all on public.v_inv_pi_captures from anon;
grant select on public.v_inv_pi_captures to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------------
revoke all on function public._inv_pi_can_capture(), public._inv_pi_can_master(),
  public._inv_pi_dup_candidates(uuid, jsonb, text, uuid), public._inv_pi_country_item(uuid, text, uuid, uuid),
  public._inv_pi_country_item_candidates(uuid, text, uuid, uuid),
  public._inv_pi_target_snapshot(text, uuid), public._inv_pi_evidence_guard(), public._inv_pi_append_only()
  from public, anon, authenticated;
revoke all on function public.material_ref_norm(text) from public, anon;
grant execute on function public.material_ref_norm(text) to authenticated;
do $$ declare f text; begin
  foreach f in array array['inv_material_canonical_propose','inv_material_canonical_decide','inv_material_variant_propose',
    'inv_material_variant_decide','inv_material_link_item','inv_pi_session_start','inv_pi_session_close','inv_pi_capture',
    'inv_pi_photo_attach','inv_pi_capture_map','inv_correction_request','inv_correction_decide','inv_material_search',
    'inv_transfer_request','inv_transfer_request_decide','inv_pi_to_opening_batch','inv_pi_dashboard'] loop
    execute format('revoke all on function public.%I(jsonb) from public, anon', f);
    execute format('grant execute on function public.%I(jsonb) to authenticated', f);
  end loop;
end $$;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
