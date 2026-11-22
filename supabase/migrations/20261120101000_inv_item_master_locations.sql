-- =============================================================================
-- 20261120101000_inv_item_master_locations.sql
-- STATUS: APPLIED to production 2026-11-20 (ledger 20261120101000, owner order; applied text = sha256 2cfcc19bdd086e8c at commit aefb9ee0 before this STATUS edit; see docs/inventory/96_PRODUCTION_RELEASE_RECORD.md). Inventory WP2. Requires 20261120100000.
--         Rollback: 20261120101000_inv_item_master_locations_ROLLBACK.sql
--
-- WHAT
--   1. material_master becomes the single item master: + stocked, base_uom,
--      serial_tracked, lot_tracked, criticality (vital|essential|desirable),
--      status (active|inactive|obsolete), min_qty, max_qty, reorder_point,
--      safety_stock, lead_time_days, barcode (unique per org), manufacturer.
--      Category/subcategory/classification untouched. Tyres (category tyre) are
--      marked serial_tracked.
--   2. material_aliases (oem|alternative|superseded|barcode|erp_legacy) and
--      material_master_reviews: a CONTROLLED review workflow. Nothing is ever
--      auto-merged (owner correction 3); a reviewer different from the proposer
--      approves, and only then is the change applied.
--   3. inventory_locations: hierarchy below site (warehouse/zone/rack/shelf/bin
--      plus in_transit, quarantine, damaged, scrap, warranty, repairable,
--      supplier_custody, vehicle_custody, consignment), code unique per
--      (org, site), label_code TP:LOC:<id>. FKs from stock_records,
--      stock_movements, stock_exceptions.
--   4. opening_balance_batches / _lines: the 43 legacy balances are NOT assumed
--      correct (owner correction 2). A batch is prepared (seeded from legacy rows
--      or entered), mapped to item + location, flagged missing_cost and
--      uncertain history, and APPROVED by someone other than the preparer. Only
--      approval posts 'opening' movements through _inv_post. No historical
--      movement is manufactured: legacy drift is recorded on the line, not
--      posted.
--
-- VERIFY
--   select count(*) from material_master where status is null;          -- 0
--   select label_code like 'TP:LOC:%' from inventory_locations limit 1;  -- t
--   select has_table_privilege('authenticated','public.inventory_locations','INSERT'); -- f
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Item master extensions
-- ---------------------------------------------------------------------------
alter table public.material_master
  add column if not exists stocked boolean not null default false,
  add column if not exists base_uom text,
  add column if not exists serial_tracked boolean not null default false,
  add column if not exists lot_tracked boolean not null default false,
  add column if not exists criticality text,
  add column if not exists status text not null default 'active',
  add column if not exists min_qty numeric,
  add column if not exists max_qty numeric,
  add column if not exists reorder_point numeric,
  add column if not exists safety_stock numeric,
  add column if not exists lead_time_days integer,
  add column if not exists barcode text,
  add column if not exists manufacturer text;

-- Only rows whose values actually change are touched (PG17 rehearsal 2026-11-20): the
-- BEFORE UPDATE trigger set_material_master_updated_at stamps updated_at = now() on every
-- updated row, and base_uom is null on all 22,162 live rows, so the former predicate
-- rewrote every row and replaced its last-edited time. Live: 188 tyre rows change, 0 rows
-- carry a uom.
update public.material_master set
  base_uom = coalesce(base_uom, nullif(btrim(uom), '')),
  serial_tracked = (category = 'tyre')
where (base_uom is null and nullif(btrim(uom), '') is not null)
   or (serial_tracked is distinct from (category = 'tyre'));

alter table public.material_master
  add constraint material_master_status_chk check (status in ('active','inactive','obsolete')),
  add constraint material_master_criticality_chk check (criticality is null or criticality in ('vital','essential','desirable')),
  add constraint material_master_stock_levels_chk check (
    (min_qty is null or min_qty >= 0) and (max_qty is null or max_qty >= 0)
    and (reorder_point is null or reorder_point >= 0) and (safety_stock is null or safety_stock >= 0)
    and (lead_time_days is null or lead_time_days >= 0)
    and (min_qty is null or max_qty is null or min_qty <= max_qty));
create unique index if not exists material_master_org_barcode_uq on public.material_master (organisation_id, barcode)
  where barcode is not null and btrim(barcode) <> '';

create table if not exists public.material_aliases (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text,
  item_id uuid not null references public.material_master(id),
  alias_type text not null check (alias_type in ('oem','alternative','superseded','barcode','erp_legacy')),
  value text not null check (length(btrim(value)) between 1 and 200),
  value_normalized text generated always as (upper(regexp_replace(value, '[^A-Za-z0-9]', '', 'g'))) stored,
  source text,
  review_id uuid,
  approved_by uuid, approved_at timestamptz,
  effective_from date not null default current_date,
  effective_to date,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists material_aliases_uq on public.material_aliases
  (organisation_id, alias_type, value_normalized, item_id, effective_from);
create index if not exists material_aliases_lookup_idx on public.material_aliases (organisation_id, value_normalized);
select public._inv_secure_table('material_aliases', true, false);

create table if not exists public.material_master_reviews (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text,
  item_id uuid references public.material_master(id),
  target_item_id uuid references public.material_master(id),
  change_type text not null check (change_type in ('update','alias','merge','status')),
  proposed jsonb not null,
  current_snapshot jsonb,
  reason text not null,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','cancelled')),
  proposed_by uuid not null default auth.uid(), proposed_at timestamptz not null default now(),
  reviewer_id uuid, reviewed_at timestamptz, review_note text
);
create index if not exists material_master_reviews_open_idx on public.material_master_reviews (organisation_id, status);
select public._inv_secure_table('material_master_reviews', true, false);

-- Stock-control attributes the review workflow may change (nothing else).
create or replace function public._inv_master_allowed_keys()
returns text[] language sql immutable set search_path = public as $$
  select array['stocked','base_uom','serial_tracked','lot_tracked','criticality','status','min_qty','max_qty',
    'reorder_point','safety_stock','lead_time_days','barcode','manufacturer']
$$;

create or replace function public.inv_master_review_submit(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_item public.material_master%rowtype; v_id uuid; v_type text := p->>'change_type'; v_k text;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('view') then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if nullif(btrim(p->>'reason'), '') is null then
    raise exception 'A reason is required for a master-data change.' using errcode = '22023';
  end if;
  select * into v_item from public.material_master where id = (p->>'item_id')::uuid;
  if not found or v_item.organisation_id is distinct from public.app_current_org() then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  if v_type in ('update','status') then
    for v_k in select jsonb_object_keys(coalesce(p->'proposed', '{}'::jsonb)) loop
      if not v_k = any (public._inv_master_allowed_keys()) then
        raise exception 'Field % cannot be changed through inventory master-data review.', v_k using errcode = '22023';
      end if;
    end loop;
  elsif v_type = 'alias' then
    if coalesce(p->'proposed'->>'alias_type', '') not in ('oem','alternative','superseded','barcode','erp_legacy')
       or nullif(btrim(p->'proposed'->>'value'), '') is null then
      raise exception 'An alias needs alias_type and value.' using errcode = '22023';
    end if;
  elsif v_type = 'merge' then
    if nullif(p->>'target_item_id', '') is null or (p->>'target_item_id')::uuid = v_item.id
       or not exists (select 1 from public.material_master where id = (p->>'target_item_id')::uuid
                      and organisation_id = v_item.organisation_id
                      and country is not distinct from v_item.country) then
      raise exception 'A merge proposal needs a different target item in the same company and country.' using errcode = '22023';
    end if;
  else
    raise exception 'Unknown change_type.' using errcode = '22023';
  end if;
  insert into public.material_master_reviews(organisation_id, country, item_id, target_item_id, change_type, proposed,
    current_snapshot, reason)
  values (v_item.organisation_id, v_item.country, v_item.id, nullif(p->>'target_item_id', '')::uuid, v_type,
    coalesce(p->'proposed', '{}'::jsonb), to_jsonb(v_item), btrim(p->>'reason'))
  returning id into v_id;
  return v_id;
end $fn$;

create or replace function public.inv_master_review_decide(p_review uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.material_master_reviews%rowtype; v_set text := ''; v_k text;
begin
  if not public.is_approved_and_unlocked() or not public.app_is_elevated() then
    raise exception 'Only an Admin, Manager or Director may decide master-data changes.' using errcode = '42501';
  end if;
  select * into v from public.material_master_reviews where id = p_review for update;
  if not found or v.organisation_id is distinct from public.app_current_org() then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;
  if v.status <> 'submitted' then raise exception 'Review already decided.' using errcode = '22023'; end if;
  if v.proposed_by = auth.uid() then
    raise exception 'The proposer cannot approve their own master-data change.' using errcode = '42501';
  end if;
  if p_decision not in ('approve','reject') then raise exception 'Decision must be approve or reject.' using errcode = '22023'; end if;
  if p_decision = 'reject' and nullif(btrim(p_note), '') is null then
    raise exception 'A rejection needs a note.' using errcode = '22023';
  end if;
  if p_decision = 'approve' then
    if v.change_type in ('update','status') then
      for v_k in select jsonb_object_keys(v.proposed) loop
        v_set := v_set || format('%I = (jsonb_populate_record(null::public.material_master, $1)).%I, ', v_k, v_k);
      end loop;
      if v_set <> '' then
        execute format('update public.material_master set %s updated_at = now() where id = $2', v_set)
          using v.proposed, v.item_id;
      end if;
    elsif v.change_type = 'alias' then
      insert into public.material_aliases(organisation_id, country, item_id, alias_type, value, source, review_id,
        approved_by, approved_at, effective_from)
      values (v.organisation_id, v.country, v.item_id, v.proposed->>'alias_type', btrim(v.proposed->>'value'),
        coalesce(v.proposed->>'source', 'review'), v.id, auth.uid(), now(),
        coalesce((v.proposed->>'effective_from')::date, current_date));
    elsif v.change_type = 'merge' then
      -- Reviewed merge never rewrites history: the duplicate becomes obsolete and
      -- points at the target through a 'superseded' alias.
      insert into public.material_aliases(organisation_id, country, item_id, alias_type, value, source, review_id,
        approved_by, approved_at)
      select v.organisation_id, v.country, v.target_item_id, 'superseded', m.item_code, 'merge review', v.id, auth.uid(), now()
        from public.material_master m where m.id = v.item_id;
      update public.material_master set status = 'obsolete', updated_at = now() where id = v.item_id;
    end if;
  end if;
  update public.material_master_reviews set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    reviewer_id = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
  where id = v.id returning * into v;
  return to_jsonb(v);
end $fn$;

-- ---------------------------------------------------------------------------
-- 2. Locations
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text not null,
  site text not null,
  parent_id uuid references public.inventory_locations(id),
  location_type text not null check (location_type in ('warehouse','zone','rack','shelf','bin','in_transit',
    'quarantine','damaged','scrap','warranty','repairable','supplier_custody','vehicle_custody','consignment')),
  code text not null check (length(btrim(code)) between 1 and 60),
  name text,
  label_code text generated always as ('TP:LOC:' || id::text) stored,
  responsible_user_id uuid references public.profiles(id),
  active boolean not null default true,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists inventory_locations_org_site_code_uq on public.inventory_locations
  (organisation_id, upper(btrim(site)), upper(btrim(code)));
create index if not exists inventory_locations_parent_idx on public.inventory_locations (parent_id);
select public._inv_secure_table('inventory_locations', true, true);

create or replace function public.inv_location_guard()
returns trigger language plpgsql set search_path = public as $fn$
declare v_p public.inventory_locations%rowtype; v_cur uuid; v_depth int := 0;
begin
  new.site := upper(btrim(new.site));
  new.code := upper(btrim(new.code));
  if new.parent_id is not null then
    select * into v_p from public.inventory_locations where id = new.parent_id;
    if not found or v_p.organisation_id <> new.organisation_id or v_p.site <> new.site
       or lower(v_p.country) <> lower(new.country) then
      raise exception 'A parent location must be in the same company, country and site.' using errcode = '22023';
    end if;
    v_cur := new.parent_id;
    while v_cur is not null loop
      if v_cur = new.id then raise exception 'Location hierarchy cannot loop.' using errcode = '22023'; end if;
      v_depth := v_depth + 1;
      if v_depth > 12 then raise exception 'Location hierarchy is too deep.' using errcode = '22023'; end if;
      select parent_id into v_cur from public.inventory_locations where id = v_cur;
    end loop;
  end if;
  if tg_op = 'UPDATE' and (new.organisation_id <> old.organisation_id or new.site <> old.site
     or lower(new.country) <> lower(old.country)) then
    raise exception 'A location cannot move to another company, country or site.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.active and not new.active and exists (
      select 1 from public.stock_records where location_id = new.id and (qty_on_hand > 0 or qty_reserved > 0)) then
    raise exception 'A location still holding stock cannot be deactivated.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists trg_inv_location_guard on public.inventory_locations;
create trigger trg_inv_location_guard before insert or update on public.inventory_locations
  for each row execute function public.inv_location_guard();

create or replace function public.inv_location_upsert(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_org uuid := public.app_current_org();
begin
  if not public.is_approved_and_unlocked() or not public.app_is_elevated() then
    raise exception 'Only an Admin, Manager or Director may manage locations.' using errcode = '42501';
  end if;
  if not public._inv_scope_ok(p->>'country', p->>'site') then
    raise exception 'Location is outside your country or site scope.' using errcode = '42501';
  end if;
  -- id injection guard: a parent location and a responsible person must be this company's
  if nullif(p->>'parent_id', '') is not null and not exists (select 1 from public.inventory_locations
       where id = (p->>'parent_id')::uuid and organisation_id = v_org) then
    raise exception 'Parent location not found in your company.' using errcode = 'P0002';
  end if;
  if nullif(p->>'responsible_user_id', '') is not null and not exists (select 1 from public.profiles
       where id = (p->>'responsible_user_id')::uuid and (organisation_id = v_org or org_id = v_org)) then
    raise exception 'The responsible person must belong to your company.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.inventory_locations(organisation_id, country, site, parent_id, location_type, code, name,
      responsible_user_id, active)
    values (v_org, p->>'country', p->>'site', nullif(p->>'parent_id', '')::uuid, p->>'location_type', p->>'code',
      p->>'name', nullif(p->>'responsible_user_id', '')::uuid, coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update public.inventory_locations set parent_id = nullif(p->>'parent_id', '')::uuid,
      location_type = coalesce(p->>'location_type', location_type), name = coalesce(p->>'name', name),
      responsible_user_id = nullif(p->>'responsible_user_id', '')::uuid,
      active = coalesce((p->>'active')::boolean, active)
    where id = v_id and organisation_id = v_org;
    if not found then raise exception 'Location not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $fn$;

alter table public.stock_records add constraint stock_records_location_fk
  foreign key (location_id) references public.inventory_locations(id);
alter table public.stock_movements add constraint stock_movements_location_fk
  foreign key (location_id) references public.inventory_locations(id);
alter table public.stock_exceptions add constraint stock_exceptions_location_fk
  foreign key (location_id) references public.inventory_locations(id);

-- ---------------------------------------------------------------------------
-- 3. Opening balances with independent approval
-- ---------------------------------------------------------------------------
create table if not exists public.opening_balance_batches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text not null, site text,
  reference text not null,
  source text not null check (source in ('legacy_stock_records','import','manual')),
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','cancelled')),
  prepared_by uuid not null default auth.uid(),
  submitted_at timestamptz,
  approved_by uuid, approved_at timestamptz, decision_note text,
  notes text, created_at timestamptz not null default now(),
  unique (organisation_id, reference)
);
select public._inv_secure_table('opening_balance_batches', true, true);

create table if not exists public.opening_balance_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  batch_id uuid not null references public.opening_balance_batches(id),
  line_no integer not null,
  source_ref text,
  source_description text,
  target_stock_id uuid references public.stock_records(id),
  item_id uuid references public.material_master(id),
  location_id uuid references public.inventory_locations(id),
  condition text not null default 'new',
  ownership text not null default 'owned' check (ownership in ('owned','consignment','supplier')),
  owner_supplier_id uuid references public.suppliers(id),
  qty numeric not null check (qty >= 0),
  unit_cost numeric check (unit_cost is null or unit_cost >= 0),
  currency text,
  missing_cost boolean generated always as (unit_cost is null) stored,
  mapping_status text not null default 'unmapped' check (mapping_status in ('unmapped','mapped','needs_review','excluded')),
  history_certainty text not null default 'uncertain' check (history_certainty in ('known','uncertain')),
  legacy_ledger_qty numeric,
  legacy_drift numeric,
  posted_movement_id uuid references public.stock_movements(id),
  notes text,
  unique (batch_id, line_no)
);
create index if not exists opening_balance_lines_batch_idx on public.opening_balance_lines (batch_id);
select public._inv_secure_table('opening_balance_lines', false, false);

create or replace function public._inv_opening_batch_for_edit(p_batch uuid)
returns public.opening_balance_batches language plpgsql security definer set search_path = public as $fn$
declare v public.opening_balance_batches%rowtype;
begin
  select * into v from public.opening_balance_batches where id = p_batch for update;
  if not found or v.organisation_id is distinct from public.app_current_org() then
    raise exception 'Opening balance batch not found.' using errcode = 'P0002';
  end if;
  if v.status <> 'draft' then raise exception 'Only a draft batch can be edited.' using errcode = '22023'; end if;
  if v.prepared_by <> auth.uid() then raise exception 'Only the preparer edits a draft batch.' using errcode = '42501'; end if;
  return v;
end $fn$;

create or replace function public.inv_opening_batch_create(p_country text, p_site text, p_reference text, p_source text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_id uuid;
begin
  if not public.is_approved_and_unlocked() or not (public.app_is_elevated() or public.inv_can('count')) then
    raise exception 'Not authorised to prepare an opening balance.' using errcode = '42501';
  end if;
  if not public._inv_scope_ok(p_country, p_site) or nullif(btrim(p_country), '') is null then
    raise exception 'Choose a permitted country and site.' using errcode = '42501';
  end if;
  insert into public.opening_balance_batches(organisation_id, country, site, reference, source)
  values (public.app_current_org(), p_country, upper(btrim(nullif(p_site, ''))), btrim(p_reference), p_source)
  returning id into v_id;
  return v_id;
end $fn$;

create or replace function public.inv_opening_batch_add_line(p_batch uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.opening_balance_batches%rowtype; v_id uuid; v_status text;
begin
  v := public._inv_opening_batch_for_edit(p_batch);
  v_status := case when nullif(p->>'item_id', '') is not null and nullif(p->>'location_id', '') is not null then 'mapped'
                   else 'unmapped' end;
  if nullif(p->>'item_id', '') is not null and not exists (select 1 from public.material_master
       where id = (p->>'item_id')::uuid and organisation_id = v.organisation_id) then
    raise exception 'Item not found in your company.' using errcode = '42501';
  end if;
  if nullif(p->>'location_id', '') is not null and not exists (select 1 from public.inventory_locations
       where id = (p->>'location_id')::uuid and organisation_id = v.organisation_id) then
    raise exception 'Location not found in your company.' using errcode = '42501';
  end if;
  if nullif(p->>'owner_supplier_id', '') is not null and not exists (select 1 from public.suppliers
       where id = (p->>'owner_supplier_id')::uuid and organisation_id = v.organisation_id) then
    raise exception 'Supplier not found in your company.' using errcode = '42501';
  end if;
  insert into public.opening_balance_lines(organisation_id, batch_id, line_no, source_ref, source_description, item_id,
    location_id, condition, ownership, owner_supplier_id, qty, unit_cost, currency, mapping_status, history_certainty, notes)
  values (v.organisation_id, v.id, coalesce((select max(line_no) from public.opening_balance_lines where batch_id = v.id), 0) + 1,
    p->>'source_ref', p->>'source_description', nullif(p->>'item_id', '')::uuid, nullif(p->>'location_id', '')::uuid,
    lower(coalesce(nullif(p->>'condition', ''), 'new')), lower(coalesce(nullif(p->>'ownership', ''), 'owned')),
    nullif(p->>'owner_supplier_id', '')::uuid, (p->>'qty')::numeric, nullif(p->>'unit_cost', '')::numeric,
    coalesce(nullif(p->>'currency', ''), public.currency_for_country(v.country)), v_status,
    coalesce(nullif(p->>'history_certainty', ''), 'uncertain'), p->>'notes')
  returning id into v_id;
  return v_id;
end $fn$;

-- Seed lines from the legacy balances in scope. Nothing is posted; every line
-- is "needs_review" until a person maps it, and drift is recorded, not posted.
create or replace function public.inv_opening_batch_seed_legacy(p_batch uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.opening_balance_batches%rowtype; v_n integer;
begin
  v := public._inv_opening_batch_for_edit(p_batch);
  insert into public.opening_balance_lines(organisation_id, batch_id, line_no, source_ref, source_description,
    target_stock_id, item_id, location_id, condition, ownership, qty, unit_cost, currency, mapping_status,
    history_certainty, legacy_ledger_qty, legacy_drift)
  select v.organisation_id, v.id,
    coalesce((select max(line_no) from public.opening_balance_lines where batch_id = v.id), 0)
      + row_number() over (order by s.site, s.description, s.id),
    'stock_records:' || s.id::text, s.description, s.id, s.item_id, s.location_id, s.condition, s.ownership,
    s.qty_on_hand, s.avg_unit_cost, coalesce(s.currency, public.currency_for_country(s.country)),
    'needs_review',
    case when coalesce(l.q, 0) = s.qty_on_hand then 'known' else 'uncertain' end,
    coalesce(l.q, 0), s.qty_on_hand - coalesce(l.q, 0)
  from public.stock_records s
  left join (select stock_id, sum(qty_change) q from public.stock_movements group by stock_id) l on l.stock_id = s.id
  where s.organisation_id = v.organisation_id
    and lower(coalesce(s.country, '')) = lower(v.country)
    and (v.site is null or upper(btrim(s.site)) = v.site)
    and not exists (select 1 from public.opening_balance_lines ol join public.opening_balance_batches ob on ob.id = ol.batch_id
                    where ol.target_stock_id = s.id and ob.status in ('draft','submitted','approved'));
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function public.inv_opening_line_map(p_line uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_l public.opening_balance_lines%rowtype; v public.opening_balance_batches%rowtype;
begin
  select * into v_l from public.opening_balance_lines where id = p_line;
  if not found then raise exception 'Line not found.' using errcode = 'P0002'; end if;
  v := public._inv_opening_batch_for_edit(v_l.batch_id);
  if coalesce(p->>'mapping_status', '') not in ('mapped','needs_review','excluded') then
    raise exception 'mapping_status must be mapped, needs_review or excluded.' using errcode = '22023';
  end if;
  if p->>'mapping_status' = 'mapped' and (nullif(coalesce(p->>'item_id', v_l.item_id::text), '') is null
     or nullif(coalesce(p->>'location_id', v_l.location_id::text), '') is null) then
    raise exception 'A mapped line needs an item and a location.' using errcode = '22023';
  end if;
  update public.opening_balance_lines set
    item_id = coalesce(nullif(p->>'item_id', '')::uuid, item_id),
    location_id = coalesce(nullif(p->>'location_id', '')::uuid, location_id),
    qty = coalesce(nullif(p->>'qty', '')::numeric, qty),
    unit_cost = case when p ? 'unit_cost' then nullif(p->>'unit_cost', '')::numeric else unit_cost end,
    mapping_status = p->>'mapping_status', notes = coalesce(p->>'notes', notes)
  where id = p_line;
end $fn$;

create or replace function public.inv_opening_batch_submit(p_batch uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.opening_balance_batches%rowtype;
begin
  v := public._inv_opening_batch_for_edit(p_batch);
  if not exists (select 1 from public.opening_balance_lines where batch_id = v.id and mapping_status = 'mapped') then
    raise exception 'A batch needs at least one mapped line.' using errcode = '22023';
  end if;
  if exists (select 1 from public.opening_balance_lines where batch_id = v.id and mapping_status in ('unmapped','needs_review')) then
    raise exception 'Map or exclude every line before submitting.' using errcode = '22023';
  end if;
  update public.opening_balance_batches set status = 'submitted', submitted_at = now() where id = v.id;
end $fn$;

create or replace function public.inv_opening_batch_decide(p_batch uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.opening_balance_batches%rowtype; l public.opening_balance_lines%rowtype; v_rec public.stock_records%rowtype;
  v_r jsonb; v_posted int := 0;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('adjustment_approve') then
    raise exception 'Stock permission "adjustment_approve" is required.' using errcode = '42501';
  end if;
  select * into v from public.opening_balance_batches where id = p_batch for update;
  if not found or v.organisation_id is distinct from public.app_current_org() then
    raise exception 'Opening balance batch not found.' using errcode = 'P0002';
  end if;
  if v.status <> 'submitted' then raise exception 'Only a submitted batch can be decided.' using errcode = '22023'; end if;
  if v.prepared_by = auth.uid() then
    raise exception 'The preparer cannot approve their own opening balance.' using errcode = '42501';
  end if;
  if not public._inv_scope_ok(v.country, v.site) then
    raise exception 'Batch is outside your scope.' using errcode = '42501';
  end if;
  if p_decision = 'reject' then
    if nullif(btrim(p_note), '') is null then raise exception 'A rejection needs a note.' using errcode = '22023'; end if;
    update public.opening_balance_batches set status = 'rejected', approved_by = auth.uid(), approved_at = now(),
      decision_note = btrim(p_note) where id = v.id;
    return jsonb_build_object('status', 'rejected');
  elsif p_decision <> 'approve' then
    raise exception 'Decision must be approve or reject.' using errcode = '22023';
  end if;

  for l in select * from public.opening_balance_lines where batch_id = v.id and mapping_status = 'mapped' order by line_no loop
    if l.target_stock_id is not null then
      select * into v_rec from public.stock_records where id = l.target_stock_id for update;
      if v_rec.organisation_id <> v.organisation_id then raise exception 'Line % targets another company.', l.line_no using errcode = '42501'; end if;
      if v_rec.item_id is distinct from l.item_id or v_rec.location_id is distinct from l.location_id then
        begin
          perform set_config('inv.posting', 'on', true);
          update public.stock_records set item_id = l.item_id, location_id = l.location_id where id = v_rec.id;
          perform set_config('inv.posting', '', true);
        exception when unique_violation then
          raise exception 'Line %: a balance for this item and location already exists; map to it instead.', l.line_no
            using errcode = '23505';
        end;
      end if;
      v_r := public._inv_post(jsonb_build_object('idempotency_key', 'opening:' || l.id::text, 'stock_id', v_rec.id,
        'movement_type', 'opening', 'qty_change', l.qty - v_rec.qty_on_hand, 'unit_cost', l.unit_cost,
        'currency', l.currency, 'reason', 'Approved opening balance ' || v.reference,
        'source_doc_type', 'opening_balance', 'source_doc_id', l.id::text, 'approval_ref', v.id::text), false);
    else
      if l.qty = 0 then continue; end if;
      v_r := public._inv_post(jsonb_build_object('idempotency_key', 'opening:' || l.id::text, 'item_id', l.item_id,
        'location_id', l.location_id, 'condition', l.condition, 'ownership', l.ownership,
        'owner_supplier_id', l.owner_supplier_id, 'movement_type', 'opening', 'qty_change', l.qty,
        'unit_cost', l.unit_cost, 'currency', l.currency, 'reason', 'Approved opening balance ' || v.reference,
        'source_doc_type', 'opening_balance', 'source_doc_id', l.id::text, 'approval_ref', v.id::text), false);
    end if;
    if v_r->>'status' = 'refused_shortage' then
      raise exception 'Line % cannot go below reserved stock.', l.line_no using errcode = '23514';
    end if;
    update public.opening_balance_lines set posted_movement_id = (v_r->>'movement_id')::uuid where id = l.id;
    v_posted := v_posted + 1;
  end loop;
  update public.opening_balance_batches set status = 'approved', approved_by = auth.uid(), approved_at = now(),
    decision_note = nullif(btrim(p_note), '') where id = v.id;
  return jsonb_build_object('status', 'approved', 'lines_posted', v_posted);
end $fn$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public._inv_master_allowed_keys() from public, anon;
revoke all on function public._inv_opening_batch_for_edit(uuid) from public, anon, authenticated;
revoke all on function public.inv_master_review_submit(jsonb), public.inv_master_review_decide(uuid, text, text),
  public.inv_location_upsert(jsonb), public.inv_opening_batch_create(text, text, text, text),
  public.inv_opening_batch_add_line(uuid, jsonb), public.inv_opening_batch_seed_legacy(uuid),
  public.inv_opening_line_map(uuid, jsonb), public.inv_opening_batch_submit(uuid),
  public.inv_opening_batch_decide(uuid, text, text) from public, anon;
grant execute on function public.inv_master_review_submit(jsonb), public.inv_master_review_decide(uuid, text, text),
  public.inv_location_upsert(jsonb), public.inv_opening_batch_create(text, text, text, text),
  public.inv_opening_batch_add_line(uuid, jsonb), public.inv_opening_batch_seed_legacy(uuid),
  public.inv_opening_line_map(uuid, jsonb), public.inv_opening_batch_submit(uuid),
  public.inv_opening_batch_decide(uuid, text, text) to authenticated;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
