-- =============================================================================
-- 20261120102000_inv_physical_audits.sql
-- STATUS: AUTHORED, NOT APPLIED. Inventory WP3 (P1). Requires 20261120100000/101000.
--         Rollback: 20261120102000_inv_physical_audits_ROLLBACK.sql
--
-- WHAT
--   inventory_audits (full|partial|cycle|category|high_value|surprise|bin|
--   tyre_serial|vehicle_tyre), inventory_audit_snapshot_lines, inventory_count_lines,
--   inventory_discrepancies, inventory_adjustments.
--
--   BLIND COUNTING IS ENFORCED IN THE DATABASE, not the UI:
--     * inv_blind_hides_balance() (replaces the P0 stub) is true for the counter
--       of an open blind audit for every balance in that audit's scope. It drives
--       RESTRICTIVE SELECT policies on stock_records, stock_movements,
--       stock_exceptions and opening_balance_lines (and v_stock_balance_reconcile,
--       which is security_invoker), and _inv_post / the legacy writers refuse that
--       counter, so neither a read nor a write response reveals a quantity.
--     * snapshot lines, discrepancies and adjustments are readable only through
--       _inv_audit_can_see_expected(): never by an assigned counter while the
--       audit is open.
--     * inv_audit_counter_view(p_audit_id) returns locations and items only; serial
--       audits return locations only (an expected-serial list would be the answer key).
--     * inv_count_submit(p_audit_id, p_device_id, p_lines) answers accepted /
--       duplicates / rejected client_uuids only (shape agreed with the Flutter lane,
--       tyre_pulse_flutter/docs/inventory_reserved_patch.md).
--   Live counting with cutoff reconciliation (no freeze): inv_audit_start stores
--   cutoff_seq = the org's current max movement_seq; reconcile adds every
--   movement on the balance with movement_seq > cutoff_seq posted before the
--   line was counted. Late offline counts (counted_at <= counting_completed_at)
--   are accepted and flagged until reconciliation is decided.
--   Segregation of duties: counter <> reviewer <> approver at create; a recount
--   is assigned to a different person; inv_adjustment_approve refuses the audit
--   creator, any counter and the proposer. Adjustments post only through _inv_post.
--
-- Discrepancy vocabulary is provisional (owner list not in the repo):
--   variance_type: shortage, excess, unexpected_item, not_counted,
--     missing_serial, unexpected_serial, condition_mismatch
--   root_cause_category: counting_error, unrecorded_issue, unrecorded_receipt,
--     unrecorded_transfer, wrong_location, wrong_item_code, damage,
--     theft_suspected, supplier_short_delivery, data_entry_error, timing_cutoff,
--     unknown
-- =============================================================================
begin;

create table if not exists public.inventory_audits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  ref text not null,
  country text not null,
  site text,
  audit_type text not null check (audit_type in ('full','partial','cycle','category','high_value','surprise','bin',
    'tyre_serial','vehicle_tyre')),
  scope jsonb not null default '{}'::jsonb,
  location_ids uuid[] not null default '{}',
  item_ids uuid[] not null default '{}',
  blind boolean not null default true,
  status text not null default 'draft' check (status in ('draft','scheduled','assigned','in_progress',
    'counting_completed','reconciliation','recount','investigation','approval','adjustment_posted','closed',
    'cancelled','rejected')),
  created_by uuid not null default auth.uid(),
  counter_id uuid references public.profiles(id),
  recount_counter_id uuid references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  approver_id uuid references public.profiles(id),
  due_at timestamptz, instructions text,
  tolerance_qty numeric not null default 0 check (tolerance_qty >= 0),
  tolerance_pct numeric not null default 0 check (tolerance_pct >= 0),
  snapshot_at timestamptz, cutoff_seq bigint,
  current_round integer not null default 1 check (current_round between 1 and 3),
  started_at timestamptz, counting_completed_at timestamptz, reconciled_at timestamptz,
  closed_at timestamptz, closed_by uuid, close_note text, cancel_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (counter_id is null or (counter_id <> coalesce(reviewer_id, '00000000-0000-0000-0000-000000000000'::uuid)
         and counter_id <> coalesce(approver_id, '00000000-0000-0000-0000-000000000000'::uuid)))
);
create unique index if not exists inventory_audits_org_ref_uq on public.inventory_audits (organisation_id, ref);
create index if not exists inventory_audits_open_idx on public.inventory_audits (organisation_id, status);
create index if not exists inventory_audits_counter_idx on public.inventory_audits (counter_id);
create index if not exists inventory_audits_recount_idx on public.inventory_audits (recount_counter_id);
select public._inv_secure_table('inventory_audits', true, true);

create table if not exists public.inventory_audit_snapshot_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  audit_id uuid not null references public.inventory_audits(id),
  stock_id uuid references public.stock_records(id),
  location_id uuid references public.inventory_locations(id),
  item_id uuid references public.material_master(id),
  site text, condition text, ownership text,
  serial text,
  expected_qty numeric not null,
  expected_reserved numeric not null default 0,
  unit_cost numeric, currency text, expected_value numeric,
  description text
);
create index if not exists inventory_audit_snapshot_lines_audit_idx on public.inventory_audit_snapshot_lines (audit_id);
select public._inv_secure_table('inventory_audit_snapshot_lines', false, false);

create table if not exists public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  audit_id uuid not null references public.inventory_audits(id),
  round integer not null check (round between 1 and 3),
  location_id uuid references public.inventory_locations(id),
  item_id uuid references public.material_master(id),
  stock_id uuid references public.stock_records(id),
  serial text,
  counted_qty numeric check (counted_qty is null or counted_qty >= 0),
  confirmed_zero boolean not null default false,
  condition text,
  photos jsonb not null default '[]'::jsonb,
  remarks text,
  counter_id uuid not null,
  counted_at timestamptz not null,
  received_at timestamptz not null default now(),
  device_id text,
  client_uuid uuid not null unique,
  unexpected boolean not null default false,
  late boolean not null default false,
  check (serial is not null or counted_qty is not null or confirmed_zero),
  check (not confirmed_zero or coalesce(counted_qty, 0) = 0)
);
create index if not exists inventory_count_lines_audit_idx on public.inventory_count_lines (audit_id, round);
select public._inv_secure_table('inventory_count_lines', false, false);

create table if not exists public.inventory_discrepancies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  audit_id uuid not null references public.inventory_audits(id),
  round integer not null,
  country text, site text,
  stock_id uuid references public.stock_records(id),
  location_id uuid references public.inventory_locations(id),
  item_id uuid references public.material_master(id),
  serial text,
  variance_type text not null check (variance_type in ('shortage','excess','unexpected_item','not_counted',
    'missing_serial','unexpected_serial','condition_mismatch')),
  root_cause_category text check (root_cause_category is null or root_cause_category in ('counting_error',
    'unrecorded_issue','unrecorded_receipt','unrecorded_transfer','wrong_location','wrong_item_code','damage',
    'theft_suspected','supplier_short_delivery','data_entry_error','timing_cutoff','unknown')),
  snapshot_qty numeric, cutoff_adjustment_qty numeric not null default 0,
  expected_qty numeric, counted_qty numeric, variance_qty numeric,
  unit_cost numeric, currency text, value_impact numeric,
  investigator_id uuid, evidence jsonb not null default '[]'::jsonb, investigation_notes text,
  proposed_correction_qty numeric,
  status text not null default 'open' check (status in ('open','investigating','recount_requested','proposed',
    'approved','rejected','posted','written_off','closed','superseded')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists inventory_discrepancies_audit_idx on public.inventory_discrepancies (audit_id, status);
select public._inv_secure_table('inventory_discrepancies', true, true);

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  audit_id uuid not null references public.inventory_audits(id),
  discrepancy_id uuid not null unique references public.inventory_discrepancies(id),
  stock_id uuid references public.stock_records(id),
  location_id uuid references public.inventory_locations(id),
  item_id uuid references public.material_master(id),
  qty_change numeric not null check (qty_change <> 0),
  unit_cost numeric, currency text, value_impact numeric,
  reason text not null,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','posted')),
  proposed_by uuid not null, proposed_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz, decision_note text,
  movement_id uuid references public.stock_movements(id)
);
create index if not exists inventory_adjustments_audit_idx on public.inventory_adjustments (audit_id, status);
select public._inv_secure_table('inventory_adjustments', false, false);

-- ---------------------------------------------------------------------------
-- Blind enforcement helpers
-- ---------------------------------------------------------------------------
create or replace function public._inv_audit_open_for_counter(p_status text)
returns boolean language sql immutable set search_path = public as $$
  select p_status not in ('draft','adjustment_posted','closed','cancelled','rejected')
$$;

create or replace function public.inv_blind_hides_balance(p_org uuid, p_site text, p_location uuid, p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.inventory_audits a
     where a.organisation_id = p_org and a.blind
       and auth.uid() in (a.counter_id, a.recount_counter_id)
       and public._inv_audit_open_for_counter(a.status)
       and (a.site is null or upper(btrim(coalesce(p_site, ''))) = a.site)
       and (cardinality(a.location_ids) = 0 or p_location = any (a.location_ids))
       and (cardinality(a.item_ids) = 0 or p_item = any (a.item_ids)))
$$;

create or replace function public._inv_audit_can_see_expected(p_audit uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when public.is_super_admin() then true
      when auth.uid() in (a.counter_id, a.recount_counter_id) then not public._inv_audit_open_for_counter(a.status)
      when exists (select 1 from public.inventory_count_lines c where c.audit_id = a.id and c.counter_id = auth.uid())
        then not public._inv_audit_open_for_counter(a.status)
      else auth.uid() in (a.created_by, a.reviewer_id, a.approver_id)
        or public.inv_can('discrepancy_review') or public.inv_can('audit_history') or public.inv_can('adjustment_approve')
    end
    from public.inventory_audits a where a.id = p_audit), false)
$$;

drop policy if exists stock_records_blind_count on public.stock_records;
create policy stock_records_blind_count on public.stock_records as restrictive for select to authenticated
  using (not public.inv_blind_hides_balance(organisation_id, site, location_id, item_id));
drop policy if exists stock_movements_blind_count on public.stock_movements;
create policy stock_movements_blind_count on public.stock_movements as restrictive for select to authenticated
  using (not public.inv_blind_hides_balance(organisation_id, site, location_id, item_id));
drop policy if exists stock_exceptions_blind_count on public.stock_exceptions;
create policy stock_exceptions_blind_count on public.stock_exceptions as restrictive for select to authenticated
  using (not public.inv_blind_hides_balance(organisation_id, site, location_id, item_id));
drop policy if exists opening_balance_lines_blind_count on public.opening_balance_lines;
create policy opening_balance_lines_blind_count on public.opening_balance_lines as restrictive for select to authenticated
  using (not public.inv_blind_hides_balance(organisation_id,
    (select b.site from public.opening_balance_batches b where b.id = batch_id), location_id, item_id));

create policy inventory_audit_snapshot_lines_blind on public.inventory_audit_snapshot_lines as restrictive for select
  to authenticated using (public._inv_audit_can_see_expected(audit_id));
create policy inventory_discrepancies_blind on public.inventory_discrepancies as restrictive for select
  to authenticated using (public._inv_audit_can_see_expected(audit_id));
create policy inventory_adjustments_blind on public.inventory_adjustments as restrictive for select
  to authenticated using (public._inv_audit_can_see_expected(audit_id));
create policy inventory_count_lines_own_or_reviewer on public.inventory_count_lines as restrictive for select
  to authenticated using (counter_id = auth.uid() or public._inv_audit_can_see_expected(audit_id));

-- ---------------------------------------------------------------------------
-- Workflow RPCs
-- ---------------------------------------------------------------------------
create or replace function public._inv_audit_lock(p_audit uuid)
returns public.inventory_audits language plpgsql security definer set search_path = public as $fn$
declare v public.inventory_audits%rowtype;
begin
  select * into v from public.inventory_audits where id = p_audit for update;
  if not found or v.organisation_id is distinct from public.app_current_org() then
    raise exception 'Audit not found.' using errcode = 'P0002';
  end if;
  if not public._inv_scope_ok(v.country, v.site) then
    raise exception 'Audit is outside your country or site scope.' using errcode = '42501';
  end if;
  return v;
end $fn$;

create or replace function public.inv_audit_create(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_org uuid := public.app_current_org(); v_id uuid := gen_random_uuid(); v_locs uuid[]; v_items uuid[];
  v_site text := upper(btrim(nullif(p->>'site', ''))); v_blind boolean := coalesce((p->>'blind')::boolean, true);
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('audit_create') then
    raise exception 'Stock permission "audit_create" is required.' using errcode = '42501';
  end if;
  if nullif(btrim(p->>'country'), '') is null or not public._inv_scope_ok(p->>'country', v_site) then
    raise exception 'Choose a permitted country and site.' using errcode = '42501';
  end if;
  if not v_blind and not public.app_is_elevated() then
    raise exception 'Only an Admin, Manager or Director may create a non-blind count.' using errcode = '42501';
  end if;
  -- Expand chosen locations to their descendants so a parent-level audit hides every bin.
  with recursive tree as (
    select l.id from public.inventory_locations l
     where l.organisation_id = v_org and l.id in (select (jsonb_array_elements_text(coalesce(p->'scope'->'location_ids', '[]'::jsonb)))::uuid)
    union
    select c.id from public.inventory_locations c join tree t on c.parent_id = t.id
  ) select coalesce(array_agg(id), '{}') into v_locs from tree;
  if jsonb_array_length(coalesce(p->'scope'->'location_ids', '[]'::jsonb)) > 0 and cardinality(v_locs) = 0 then
    raise exception 'None of the chosen locations belong to your company.' using errcode = '42501';
  end if;
  select coalesce(array_agg(m.id), '{}') into v_items from public.material_master m
   where m.organisation_id = v_org
     and (m.id in (select (jsonb_array_elements_text(coalesce(p->'scope'->'item_ids', '[]'::jsonb)))::uuid)
          or (p->'scope' ? 'categories' and m.category in (select jsonb_array_elements_text(p->'scope'->'categories'))));
  if nullif(p->>'counter_id', '') is not null and not exists (select 1 from public.profiles where id = (p->>'counter_id')::uuid
       and (organisation_id = v_org or org_id = v_org)) then
    raise exception 'The counter must belong to your company.' using errcode = '22023';
  end if;
  insert into public.inventory_audits(id, organisation_id, ref, country, site, audit_type, scope, location_ids, item_ids,
    blind, counter_id, reviewer_id, approver_id, due_at, instructions, tolerance_qty, tolerance_pct)
  values (v_id, v_org, 'AUD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(left(v_id::text, 8)), p->>'country', v_site,
    p->>'audit_type', coalesce(p->'scope', '{}'::jsonb), v_locs, v_items, v_blind,
    nullif(p->>'counter_id', '')::uuid, nullif(p->>'reviewer_id', '')::uuid, nullif(p->>'approver_id', '')::uuid,
    nullif(p->>'due_at', '')::timestamptz, p->>'instructions',
    coalesce((p->>'tolerance_qty')::numeric, 0),
    case when p->>'audit_type' = 'tyre_serial' then 0 else coalesce((p->>'tolerance_pct')::numeric, 0) end);
  return v_id;
end $fn$;

create or replace function public.inv_audit_schedule(p_audit uuid, p_due_at timestamptz, p_counter uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.inventory_audits%rowtype;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('audit_create') then
    raise exception 'Stock permission "audit_create" is required.' using errcode = '42501';
  end if;
  v := public._inv_audit_lock(p_audit);
  if v.status not in ('draft','scheduled','assigned') then raise exception 'Audit already started.' using errcode = '22023'; end if;
  if p_counter is not null and p_counter in (v.reviewer_id, v.approver_id) then
    raise exception 'The counter cannot also review or approve this audit.' using errcode = '42501';
  end if;
  update public.inventory_audits set due_at = coalesce(p_due_at, due_at), counter_id = coalesce(p_counter, counter_id),
    status = case when coalesce(p_counter, counter_id) is null then 'scheduled' else 'assigned' end, updated_at = now()
  where id = v.id returning * into v;
  return jsonb_build_object('id', v.id, 'status', v.status);
end $fn$;

-- Snapshot + cutoff. The counter never starts their own audit.
create or replace function public.inv_audit_start(p_audit uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.inventory_audits%rowtype; v_cut bigint; v_n int; v_s int := 0;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('audit_create') then
    raise exception 'Stock permission "audit_create" is required.' using errcode = '42501';
  end if;
  v := public._inv_audit_lock(p_audit);
  if v.status not in ('assigned','scheduled') or v.counter_id is null then
    raise exception 'Assign a counter before starting.' using errcode = '22023';
  end if;
  if v.counter_id = auth.uid() then
    raise exception 'The counter cannot start their own audit.' using errcode = '42501';
  end if;
  select coalesce(max(movement_seq), 0) into v_cut from public.stock_movements where organisation_id = v.organisation_id;
  if v.audit_type not in ('tyre_serial','vehicle_tyre') then
    insert into public.inventory_audit_snapshot_lines(organisation_id, audit_id, stock_id, location_id, item_id, site,
      condition, ownership, expected_qty, expected_reserved, unit_cost, currency, expected_value, description)
    select s.organisation_id, v.id, s.id, s.location_id, s.item_id, s.site, s.condition, s.ownership, s.qty_on_hand,
      s.qty_reserved, s.avg_unit_cost, s.currency, s.qty_on_hand * s.avg_unit_cost, s.description
    from public.stock_records s
    where s.organisation_id = v.organisation_id and lower(coalesce(s.country, '')) = lower(v.country)
      and (v.site is null or upper(btrim(s.site)) = v.site)
      and (cardinality(v.location_ids) = 0 or s.location_id = any (v.location_ids))
      and (cardinality(v.item_ids) = 0 or s.item_id = any (v.item_ids));
    get diagnostics v_n = row_count;
  else
    v_n := 0;
    if to_regclass('public.tyre_items') is not null then
      execute $q$
        insert into public.inventory_audit_snapshot_lines(organisation_id, audit_id, location_id, item_id, site, serial,
          expected_qty, unit_cost, currency, expected_value, description)
        select t.organisation_id, $1, t.location_id, t.item_id, t.site, t.serial, 1, t.purchase_cost, t.currency,
               t.purchase_cost, t.custody_state
          from public.tyre_items t
         where t.organisation_id = $2 and lower(coalesce(t.country, '')) = lower($3)
           and ($4 is null or upper(btrim(coalesce(t.site, ''))) = $4)
           and (cardinality($5) = 0 or t.location_id = any ($5))
           and (($6 = 'tyre_serial' and t.custody_state in ('new_stock','reserved','reusable','under_repair','warranty','quarantine','removed_pending'))
             or ($6 = 'vehicle_tyre' and t.custody_state = 'fitted'))$q$
        using v.id, v.organisation_id, v.country, v.site, v.location_ids, v.audit_type;
      get diagnostics v_s = row_count;
    end if;
  end if;
  update public.inventory_audits set status = 'in_progress', snapshot_at = clock_timestamp(), cutoff_seq = v_cut,
    started_at = clock_timestamp(), updated_at = now() where id = v.id;
  -- Return counts only: the starter is not the counter, but keep responses lean.
  return jsonb_build_object('id', v.id, 'status', 'in_progress', 'cutoff_seq', v_cut, 'snapshot_lines', v_n + v_s);
end $fn$;

create or replace function public.inv_canon_serial(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g')), '')
$$;
-- What the counter may see: where to count and what to look for, never how many.
-- Shape agreed with the Flutter lane (tyre_pulse_flutter/docs/inventory_reserved_patch.md).
-- p_audit_id NULL = the open audits assigned to me.
create or replace function public.inv_audit_counter_view(p_audit_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare v public.inventory_audits%rowtype; v_round int;
begin
  if not public.is_approved_and_unlocked() then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if p_audit_id is null then
    return jsonb_build_object('audits', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'ref', a.ref,
        'audit_type', a.audit_type, 'status', a.status, 'site', a.site, 'due_at', a.due_at, 'instructions', a.instructions,
        'round', case when auth.uid() = a.recount_counter_id then a.current_round else 1 end,
        'location_count', (select count(*) from public.inventory_locations l where l.organisation_id = a.organisation_id
           and ((cardinality(a.location_ids) > 0 and l.id = any (a.location_ids))
             or (cardinality(a.location_ids) = 0 and (a.site is null or l.site = a.site))))) order by a.due_at nulls last)
      from public.inventory_audits a
      where a.organisation_id = public.app_current_org()
        and ((auth.uid() = a.counter_id and a.status in ('assigned','in_progress'))
          or (auth.uid() = a.recount_counter_id and a.status = 'recount'))), '[]'::jsonb));
  end if;
  select * into v from public.inventory_audits where id = p_audit_id;
  if not found or v.organisation_id is distinct from public.app_current_org()
     or auth.uid() not in (coalesce(v.counter_id, '00000000-0000-0000-0000-000000000000'::uuid),
                           coalesce(v.recount_counter_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'You are not assigned to count this audit.' using errcode = '42501';
  end if;
  v_round := case when auth.uid() = v.recount_counter_id then v.current_round else 1 end;
  return jsonb_build_object(
    'audit', jsonb_build_object('id', v.id, 'ref', v.ref, 'audit_type', v.audit_type, 'status', v.status, 'site', v.site,
      'round', v_round, 'blind', v.blind, 'instructions', v.instructions, 'due_at', v.due_at),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'name', l.name,
        'label_code', l.label_code, 'location_type', l.location_type) order by l.code)
      from public.inventory_locations l
      where l.organisation_id = v.organisation_id
        and ((cardinality(v.location_ids) > 0 and l.id = any (v.location_ids))
          or (cardinality(v.location_ids) = 0 and (v.site is null or l.site = v.site)))), '[]'::jsonb),
    -- Serial audits list no items: an expected-serial list would be the answer key.
    'items', case when v.audit_type in ('tyre_serial','vehicle_tyre') then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('location_id', x.location_id, 'item_id', m.id, 'item_code', m.item_code,
          'description', m.item_name, 'uom', coalesce(m.base_uom, m.uom), 'serial_tracked', m.serial_tracked))
      from (select distinct sl.location_id, sl.item_id from public.inventory_audit_snapshot_lines sl
             where sl.audit_id = v.id and sl.item_id is not null) x
      join public.material_master m on m.id = x.item_id), '[]'::jsonb) end,
    'submitted', coalesce((select jsonb_agg(c.client_uuid) from public.inventory_count_lines c
      where c.audit_id = v.id and c.counter_id = auth.uid()), '[]'::jsonb));
end $fn$;

-- Blind count submission. Idempotent per client_uuid. Answers ids only - never
-- an expected quantity, a variance or a value.
create or replace function public.inv_count_submit(p_audit_id uuid, p_device_id text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.inventory_audits%rowtype; l jsonb; v_round int; v_at timestamptz; v_late boolean; v_cu uuid;
  v_acc jsonb := '[]'; v_dup jsonb := '[]'; v_rej jsonb := '[]'; v_existing public.inventory_count_lines%rowtype;
  v_unexpected boolean; v_loc uuid; v_item uuid; v_serial text; v_stock uuid; v_code text;
begin
  if not public.is_approved_and_unlocked() then raise exception 'Not authorised.' using errcode = '42501'; end if;
  v := public._inv_audit_lock(p_audit_id);
  if auth.uid() = v.recount_counter_id then v_round := v.current_round;
  elsif auth.uid() = v.counter_id then v_round := 1;
  else raise exception 'You are not assigned to count this audit.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'Send between 1 and 500 count lines.' using errcode = '22023';
  end if;
  for l in select value from jsonb_array_elements(p_lines) loop
    begin
      v_cu := nullif(l->>'client_uuid', '')::uuid;
    exception when others then v_cu := null;
    end;
    if v_cu is null then
      v_rej := v_rej || jsonb_build_array(jsonb_build_object('client_uuid', l->>'client_uuid', 'reason', 'client_uuid is required'));
      continue;
    end if;
    select * into v_existing from public.inventory_count_lines where client_uuid = v_cu;
    if found then
      if v_existing.audit_id <> v.id or v_existing.counter_id <> auth.uid() then
        v_rej := v_rej || jsonb_build_array(jsonb_build_object('client_uuid', v_cu, 'reason', 'client_uuid already used elsewhere'));
      else
        v_dup := v_dup || jsonb_build_array(v_cu);
      end if;
      continue;
    end if;
    v_at := coalesce(nullif(l->>'counted_at', '')::timestamptz, clock_timestamp());
    v_late := false;
    if (v_round = 1 and v.status = 'in_progress') or (v_round > 1 and v.status = 'recount') then
      null;
    elsif v.status in ('counting_completed','reconciliation') and v.counting_completed_at is not null
          and v_at <= v.counting_completed_at then
      v_late := true;  -- offline line captured before counting closed
    else
      v_rej := v_rej || jsonb_build_array(jsonb_build_object('client_uuid', v_cu,
        'reason', case when v.status in ('closed','cancelled','rejected','adjustment_posted') then 'Audit is closed'
                       else 'Counting is not open for this line' end));
      continue;
    end if;
    v_loc := nullif(l->>'location_id', '')::uuid; v_item := nullif(l->>'item_id', '')::uuid;
    v_serial := public.inv_canon_serial(coalesce(nullif(l->>'serial_no', ''), nullif(l->>'serial', '')));
    v_stock := nullif(l->>'stock_id', '')::uuid;
    v_code := upper(btrim(coalesce(l->>'scanned_code', '')));
    if v_stock is null and v_code like 'TP:STK:%' then
      begin v_stock := substr(v_code, 8)::uuid; exception when others then v_stock := null; end;
    end if;
    if v_loc is null and v_code like 'TP:LOC:%' then
      begin v_loc := substr(v_code, 8)::uuid; exception when others then v_loc := null; end;
    end if;
    if (v_loc is not null and not exists (select 1 from public.inventory_locations where id = v_loc and organisation_id = v.organisation_id))
       or (v_item is not null and not exists (select 1 from public.material_master where id = v_item and organisation_id = v.organisation_id)) then
      v_rej := v_rej || jsonb_build_array(jsonb_build_object('client_uuid', v_cu, 'reason', 'Unknown location or item'));
      continue;
    end if;
    if v_stock is not null and not exists (select 1 from public.inventory_audit_snapshot_lines where audit_id = v.id and stock_id = v_stock) then
      v_stock := null;
    end if;
    if v_serial is null and v_item is null and v_stock is null then
      v_rej := v_rej || jsonb_build_array(jsonb_build_object('client_uuid', v_cu, 'reason', 'A count line needs an item, a stock label or a serial'));
      continue;
    end if;
    if v_serial is null and nullif(l->>'counted_qty', '') is null and not coalesce((l->>'confirmed_zero')::boolean, false) then
      v_rej := v_rej || jsonb_build_array(jsonb_build_object('client_uuid', v_cu, 'reason', 'Enter a quantity or confirm zero'));
      continue;
    end if;
    -- the server, not the phone, decides whether a line was expected
    v_unexpected := case
      when v_serial is not null then not exists (select 1 from public.inventory_audit_snapshot_lines where audit_id = v.id and serial = v_serial)
      when v_stock is not null then false
      else not exists (select 1 from public.inventory_audit_snapshot_lines where audit_id = v.id and item_id = v_item
                        and location_id is not distinct from v_loc) end;
    insert into public.inventory_count_lines(organisation_id, audit_id, round, location_id, item_id, stock_id, serial,
      counted_qty, confirmed_zero, condition, photos, remarks, counter_id, counted_at, device_id, client_uuid, unexpected, late)
    values (v.organisation_id, v.id, v_round, v_loc, v_item, v_stock, v_serial,
      case when v_serial is not null then coalesce(nullif(l->>'counted_qty', '')::numeric, 1)
           when coalesce((l->>'confirmed_zero')::boolean, false) then 0 else nullif(l->>'counted_qty', '')::numeric end,
      coalesce((l->>'confirmed_zero')::boolean, false), lower(nullif(l->>'condition', '')), coalesce(l->'photos', '[]'::jsonb),
      left(l->>'remarks', 1000), auth.uid(), v_at, left(coalesce(p_device_id, l->>'device_id'), 120), v_cu, v_unexpected, v_late);
    v_acc := v_acc || jsonb_build_array(v_cu);
  end loop;
  return jsonb_build_object('accepted', v_acc, 'duplicates', v_dup, 'rejected', v_rej);
end $fn$;


create or replace function public.inv_audit_complete_counting(p_audit uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.inventory_audits%rowtype;
begin
  if not public.is_approved_and_unlocked() then raise exception 'Not authorised.' using errcode = '42501'; end if;
  v := public._inv_audit_lock(p_audit);
  if not (auth.uid() in (v.counter_id, v.recount_counter_id, v.created_by) or public.inv_can('audit_create')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if v.status not in ('in_progress','recount') then raise exception 'Counting is not open.' using errcode = '22023'; end if;
  update public.inventory_audits set status = 'counting_completed', counting_completed_at = clock_timestamp(), updated_at = now()
   where id = v.id;
  return jsonb_build_object('id', v.id, 'status', 'counting_completed');
end $fn$;

-- Cutoff reconciliation. Re-runnable until approval; earlier open results are superseded.
create or replace function public.inv_audit_reconcile(p_audit uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.inventory_audits%rowtype; r record; v_n int := 0; v_m int := 0; v_tol numeric;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('discrepancy_review') then
    raise exception 'Stock permission "discrepancy_review" is required.' using errcode = '42501';
  end if;
  v := public._inv_audit_lock(p_audit);
  if auth.uid() in (v.counter_id, v.recount_counter_id)
     or exists (select 1 from public.inventory_count_lines where audit_id = v.id and counter_id = auth.uid()) then
    raise exception 'A counter cannot reconcile their own count.' using errcode = '42501';
  end if;
  if v.status not in ('counting_completed','reconciliation','investigation') then
    raise exception 'Complete counting before reconciling.' using errcode = '22023';
  end if;
  if exists (select 1 from public.inventory_adjustments where audit_id = v.id and status in ('approved','posted')) then
    raise exception 'Adjustments were already approved; reconciliation is closed.' using errcode = '22023';
  end if;
  update public.inventory_discrepancies set status = 'superseded', updated_at = now()
   where audit_id = v.id and status in ('open','investigating','recount_requested','proposed');
  delete from public.inventory_adjustments where audit_id = v.id and status = 'proposed';

  if v.audit_type in ('tyre_serial','vehicle_tyre') then
    for r in
      with latest as (select distinct on (serial) serial, counted_qty, location_id, round
                        from public.inventory_count_lines where audit_id = v.id and serial is not null
                       order by serial, round desc, counted_at desc)
      select s.serial, s.location_id, s.item_id, s.site, s.unit_cost, s.currency, l.serial as found, l.location_id as found_loc
        from public.inventory_audit_snapshot_lines s left join latest l on l.serial = s.serial
       where s.audit_id = v.id and s.serial is not null
      union all
      select l.serial, l.location_id, null, v.site, null, null, l.serial, l.location_id
        from latest l where not exists (select 1 from public.inventory_audit_snapshot_lines s where s.audit_id = v.id and s.serial = l.serial)
    loop
      if r.found is null then
        insert into public.inventory_discrepancies(organisation_id, audit_id, round, country, site, location_id, item_id, serial,
          variance_type, snapshot_qty, expected_qty, counted_qty, variance_qty, unit_cost, currency, value_impact)
        values (v.organisation_id, v.id, v.current_round, v.country, r.site, r.location_id, r.item_id, r.serial,
          'missing_serial', 1, 1, 0, -1, r.unit_cost, r.currency, -r.unit_cost);
        v_n := v_n + 1;
      elsif r.item_id is null and not exists (select 1 from public.inventory_audit_snapshot_lines s where s.audit_id = v.id and s.serial = r.serial) then
        insert into public.inventory_discrepancies(organisation_id, audit_id, round, country, site, location_id, serial,
          variance_type, snapshot_qty, expected_qty, counted_qty, variance_qty)
        values (v.organisation_id, v.id, v.current_round, v.country, r.site, r.found_loc, r.serial,
          'unexpected_serial', 0, 0, 1, 1);
        v_n := v_n + 1;
      elsif r.found_loc is distinct from r.location_id and r.location_id is not null and r.found_loc is not null then
        insert into public.inventory_discrepancies(organisation_id, audit_id, round, country, site, location_id, serial,
          variance_type, root_cause_category, snapshot_qty, expected_qty, counted_qty, variance_qty)
        values (v.organisation_id, v.id, v.current_round, v.country, r.site, r.found_loc, r.serial,
          'unexpected_serial', 'wrong_location', 1, 1, 1, 0);
        v_n := v_n + 1;
      else
        v_m := v_m + 1;
      end if;
    end loop;
  else
    for r in
      with keyed as (
        select coalesce(c.stock_id, s.stock_id) as stock_id, c.location_id, c.item_id, c.round, c.counted_qty, c.confirmed_zero,
               c.counted_at, c.unexpected
          from public.inventory_count_lines c
          left join lateral (select sl.stock_id from public.inventory_audit_snapshot_lines sl
                              where sl.audit_id = c.audit_id and c.stock_id is null and sl.item_id = c.item_id
                                and sl.location_id is not distinct from c.location_id limit 1) s on true
         where c.audit_id = v.id and c.serial is null),
      maxround as (select stock_id, location_id, item_id, max(round) as rnd from keyed group by 1, 2, 3),
      counted as (select k.stock_id, k.location_id, k.item_id, sum(coalesce(k.counted_qty, 0)) as qty, max(k.counted_at) as at
                    from keyed k join maxround m on m.stock_id is not distinct from k.stock_id
                     and m.location_id is not distinct from k.location_id and m.item_id is not distinct from k.item_id
                     and m.rnd = k.round
                   group by 1, 2, 3)
      select s.stock_id, s.location_id, s.item_id, s.site, s.expected_qty, s.unit_cost, s.currency,
             c.qty as counted, c.at as counted_at, (c.stock_id is not null or c.item_id is not null) as was_counted,
             coalesce((select sum(m.qty_change) from public.stock_movements m
                        where m.stock_id = s.stock_id and m.movement_seq > v.cutoff_seq
                          and m.posted_at <= coalesce(c.at, v.counting_completed_at, clock_timestamp())), 0) as cutoff_adj,
             false as unexpected
        from public.inventory_audit_snapshot_lines s
        left join counted c on c.stock_id = s.stock_id
       where s.audit_id = v.id and s.serial is null
      union all
      select c.stock_id, c.location_id, c.item_id, v.site, 0, null, null, c.qty, c.at, true, 0, true
        from counted c
       where c.stock_id is null or not exists (select 1 from public.inventory_audit_snapshot_lines s
                                                where s.audit_id = v.id and s.stock_id = c.stock_id)
    loop
      v_tol := greatest(v.tolerance_qty, abs(r.expected_qty + r.cutoff_adj) * v.tolerance_pct / 100);
      if not r.was_counted then
        insert into public.inventory_discrepancies(organisation_id, audit_id, round, country, site, stock_id, location_id,
          item_id, variance_type, snapshot_qty, cutoff_adjustment_qty, expected_qty, counted_qty, variance_qty, unit_cost,
          currency, value_impact)
        values (v.organisation_id, v.id, v.current_round, v.country, r.site, r.stock_id, r.location_id, r.item_id,
          'not_counted', r.expected_qty, r.cutoff_adj, r.expected_qty + r.cutoff_adj, null, null, r.unit_cost, r.currency, null);
        v_n := v_n + 1;
      elsif r.unexpected then
        insert into public.inventory_discrepancies(organisation_id, audit_id, round, country, site, stock_id, location_id,
          item_id, variance_type, snapshot_qty, expected_qty, counted_qty, variance_qty)
        values (v.organisation_id, v.id, v.current_round, v.country, r.site, r.stock_id, r.location_id, r.item_id,
          'unexpected_item', 0, 0, r.counted, r.counted);
        v_n := v_n + 1;
      elsif abs(r.counted - (r.expected_qty + r.cutoff_adj)) > v_tol then
        insert into public.inventory_discrepancies(organisation_id, audit_id, round, country, site, stock_id, location_id,
          item_id, variance_type, snapshot_qty, cutoff_adjustment_qty, expected_qty, counted_qty, variance_qty, unit_cost,
          currency, value_impact)
        values (v.organisation_id, v.id, v.current_round, v.country, r.site, r.stock_id, r.location_id, r.item_id,
          case when r.counted < r.expected_qty + r.cutoff_adj then 'shortage' else 'excess' end,
          r.expected_qty, r.cutoff_adj, r.expected_qty + r.cutoff_adj, r.counted,
          r.counted - (r.expected_qty + r.cutoff_adj), r.unit_cost, r.currency,
          (r.counted - (r.expected_qty + r.cutoff_adj)) * r.unit_cost);
        v_n := v_n + 1;
      else
        v_m := v_m + 1;
      end if;
    end loop;
  end if;
  update public.inventory_audits set status = case when v_n > 0 then 'investigation' else 'reconciliation' end,
    reconciled_at = clock_timestamp(), updated_at = now() where id = v.id;
  return jsonb_build_object('id', v.id, 'discrepancies', v_n, 'matched', v_m);
end $fn$;

create or replace function public.inv_recount_assign(p_audit uuid, p_counter uuid, p_discrepancies uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.inventory_audits%rowtype;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('recount') then
    raise exception 'Stock permission "recount" is required.' using errcode = '42501';
  end if;
  v := public._inv_audit_lock(p_audit);
  if v.status not in ('investigation','reconciliation') then raise exception 'Reconcile before a recount.' using errcode = '22023'; end if;
  if v.current_round >= 3 then raise exception 'At most three counting rounds.' using errcode = '22023'; end if;
  if p_counter is null or p_counter in (v.counter_id, coalesce(v.recount_counter_id, '00000000-0000-0000-0000-000000000000'::uuid),
       coalesce(v.approver_id, '00000000-0000-0000-0000-000000000000'::uuid), auth.uid())
     or exists (select 1 from public.inventory_count_lines where audit_id = v.id and counter_id = p_counter) then
    raise exception 'A recount must be done by a different person who has not counted this audit.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_counter and (organisation_id = v.organisation_id or org_id = v.organisation_id)) then
    raise exception 'The recount counter must belong to your company.' using errcode = '22023';
  end if;
  update public.inventory_discrepancies set status = 'recount_requested', updated_at = now()
   where audit_id = v.id and id = any (p_discrepancies) and status in ('open','investigating');
  update public.inventory_audits set status = 'recount', recount_counter_id = p_counter, current_round = current_round + 1,
    updated_at = now() where id = v.id returning * into v;
  return jsonb_build_object('id', v.id, 'status', v.status, 'round', v.current_round);
end $fn$;

create or replace function public.inv_discrepancy_update(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare d public.inventory_discrepancies%rowtype; v public.inventory_audits%rowtype; v_qty numeric;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('discrepancy_review') then
    raise exception 'Stock permission "discrepancy_review" is required.' using errcode = '42501';
  end if;
  select * into d from public.inventory_discrepancies where id = p_id for update;
  if not found or d.organisation_id is distinct from public.app_current_org() then
    raise exception 'Discrepancy not found.' using errcode = 'P0002';
  end if;
  v := public._inv_audit_lock(d.audit_id);
  if auth.uid() in (v.counter_id, v.recount_counter_id)
     or exists (select 1 from public.inventory_count_lines where audit_id = v.id and counter_id = auth.uid()) then
    raise exception 'A counter cannot investigate their own count.' using errcode = '42501';
  end if;
  if d.status not in ('open','investigating','proposed') then raise exception 'Discrepancy is not open.' using errcode = '22023'; end if;
  if coalesce(p->>'status', 'investigating') not in ('investigating','proposed','written_off','closed') then
    raise exception 'Status must be investigating, proposed, written_off or closed.' using errcode = '22023';
  end if;
  if p->>'status' in ('proposed','written_off','closed') and nullif(coalesce(p->>'root_cause_category', d.root_cause_category), '') is null then
    raise exception 'Record a root cause before proposing or closing.' using errcode = '22023';
  end if;
  v_qty := coalesce(nullif(p->>'proposed_correction_qty', '')::numeric, d.variance_qty);
  update public.inventory_discrepancies set
    root_cause_category = coalesce(nullif(p->>'root_cause_category', ''), root_cause_category),
    evidence = case when p ? 'evidence' then p->'evidence' else evidence end,
    investigation_notes = coalesce(p->>'investigation_notes', investigation_notes),
    proposed_correction_qty = case when p->>'status' = 'proposed' then v_qty else proposed_correction_qty end,
    investigator_id = auth.uid(), status = coalesce(p->>'status', 'investigating'), updated_at = now()
  where id = d.id returning * into d;
  if d.status = 'proposed' then
    if coalesce(v_qty, 0) = 0 or d.serial is not null then
      raise exception 'Only a non-zero quantity correction on a stocked item can become an adjustment (serials reconcile through tyre custody).'
        using errcode = '22023';
    end if;
    insert into public.inventory_adjustments(organisation_id, audit_id, discrepancy_id, stock_id, location_id, item_id,
      qty_change, unit_cost, currency, value_impact, reason, proposed_by)
    values (d.organisation_id, d.audit_id, d.id, d.stock_id, d.location_id, d.item_id, v_qty, d.unit_cost, d.currency,
      v_qty * d.unit_cost, 'Audit ' || v.ref || ': ' || d.variance_type || ' / ' || d.root_cause_category, auth.uid())
    on conflict (discrepancy_id) do update set qty_change = excluded.qty_change, value_impact = excluded.value_impact,
      proposed_by = excluded.proposed_by, proposed_at = now()
      where public.inventory_adjustments.status = 'proposed';
    update public.inventory_audits set status = 'approval', updated_at = now() where id = v.id and status in ('investigation','reconciliation');
  end if;
  return to_jsonb(d);
end $fn$;

create or replace function public.inv_adjustment_approve(p_adjustment uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare a public.inventory_adjustments%rowtype; v public.inventory_audits%rowtype; v_r jsonb;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('adjustment_approve') then
    raise exception 'Stock permission "adjustment_approve" is required.' using errcode = '42501';
  end if;
  select * into a from public.inventory_adjustments where id = p_adjustment for update;
  if not found or a.organisation_id is distinct from public.app_current_org() then
    raise exception 'Adjustment not found.' using errcode = 'P0002';
  end if;
  v := public._inv_audit_lock(a.audit_id);
  if auth.uid() in (v.created_by, a.proposed_by) or auth.uid() in (v.counter_id, v.recount_counter_id)
     or exists (select 1 from public.inventory_count_lines where audit_id = v.id and counter_id = auth.uid()) then
    raise exception 'Segregation of duties: the audit creator, a counter or the proposer cannot approve this adjustment.'
      using errcode = '42501';
  end if;
  if a.status <> 'proposed' then raise exception 'Adjustment already decided.' using errcode = '22023'; end if;
  if p_decision = 'reject' then
    if nullif(btrim(p_note), '') is null then raise exception 'A rejection needs a note.' using errcode = '22023'; end if;
    update public.inventory_adjustments set status = 'rejected', approved_by = auth.uid(), approved_at = now(),
      decision_note = btrim(p_note) where id = a.id;
    update public.inventory_discrepancies set status = 'rejected', updated_at = now() where id = a.discrepancy_id;
    return jsonb_build_object('status', 'rejected');
  elsif p_decision <> 'approve' then
    raise exception 'Decision must be approve or reject.' using errcode = '22023';
  end if;
  v_r := public._inv_post(jsonb_strip_nulls(jsonb_build_object('idempotency_key', 'adjustment:' || a.id::text,
    'stock_id', a.stock_id, 'item_id', case when a.stock_id is null then a.item_id end,
    'location_id', case when a.stock_id is null then a.location_id end,
    'movement_type', case when a.qty_change > 0 then 'adjustment_up' else 'adjustment_down' end,
    'qty_change', a.qty_change, 'reason', a.reason, 'source_doc_type', 'inventory_adjustment',
    'source_doc_id', a.id::text, 'approval_ref', v.ref)), false);
  if v_r->>'status' = 'refused_shortage' then
    raise exception 'Posting would drive stock below zero or below reservations; investigate movements since the count.'
      using errcode = '23514';
  end if;
  update public.inventory_adjustments set status = 'posted', approved_by = auth.uid(), approved_at = now(),
    decision_note = nullif(btrim(p_note), ''), movement_id = (v_r->>'movement_id')::uuid where id = a.id;
  update public.inventory_discrepancies set status = 'posted', updated_at = now() where id = a.discrepancy_id;
  if not exists (select 1 from public.inventory_adjustments where audit_id = v.id and status = 'proposed') then
    update public.inventory_audits set status = 'adjustment_posted', updated_at = now() where id = v.id;
  end if;
  return jsonb_build_object('status', 'posted', 'movement_id', v_r->'movement_id');
end $fn$;

create or replace function public.inv_audit_close(p_audit uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.inventory_audits%rowtype;
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('adjustment_approve') or public.inv_can('audit_create')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  v := public._inv_audit_lock(p_audit);
  if auth.uid() in (v.counter_id, v.recount_counter_id) then
    raise exception 'A counter cannot close their own audit.' using errcode = '42501';
  end if;
  if v.status not in ('reconciliation','adjustment_posted','investigation','approval') then
    raise exception 'Reconcile the audit before closing.' using errcode = '22023';
  end if;
  if exists (select 1 from public.inventory_discrepancies where audit_id = v.id
              and status in ('open','investigating','recount_requested','proposed','approved')) then
    raise exception 'Every discrepancy must be posted, written off, rejected or closed first.' using errcode = '22023';
  end if;
  update public.inventory_audits set status = 'closed', closed_at = now(), closed_by = auth.uid(),
    close_note = nullif(btrim(p_note), ''), updated_at = now() where id = v.id;
  return jsonb_build_object('id', v.id, 'status', 'closed');
end $fn$;

create or replace function public.inv_audit_cancel(p_audit uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.inventory_audits%rowtype;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('audit_create') then
    raise exception 'Stock permission "audit_create" is required.' using errcode = '42501';
  end if;
  v := public._inv_audit_lock(p_audit);
  if v.status in ('closed','cancelled','adjustment_posted') or nullif(btrim(p_reason), '') is null then
    raise exception 'Give a reason; a closed or posted audit cannot be cancelled.' using errcode = '22023';
  end if;
  if exists (select 1 from public.inventory_adjustments where audit_id = v.id and status = 'posted') then
    raise exception 'Adjustments were posted; close the audit instead.' using errcode = '22023';
  end if;
  update public.inventory_audits set status = 'cancelled', cancel_reason = btrim(p_reason), updated_at = now() where id = v.id;
  return jsonb_build_object('id', v.id, 'status', 'cancelled');
end $fn$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public._inv_audit_lock(uuid), public._inv_audit_can_see_expected(uuid),
  public._inv_audit_open_for_counter(text) from public, anon;
revoke all on function public._inv_audit_lock(uuid) from authenticated;
grant execute on function public._inv_audit_can_see_expected(uuid), public._inv_audit_open_for_counter(text) to authenticated;
-- RLS policies evaluate it as the caller; it answers only for the caller's own assignments.
grant execute on function public.inv_blind_hides_balance(uuid, text, uuid, uuid) to authenticated;
revoke all on function public.inv_audit_create(jsonb), public.inv_audit_schedule(uuid, timestamptz, uuid),
  public.inv_audit_start(uuid), public.inv_audit_counter_view(uuid), public.inv_count_submit(uuid, text, jsonb),
  public.inv_audit_complete_counting(uuid), public.inv_audit_reconcile(uuid), public.inv_recount_assign(uuid, uuid, uuid[]),
  public.inv_discrepancy_update(uuid, jsonb), public.inv_adjustment_approve(uuid, text, text),
  public.inv_audit_close(uuid, text), public.inv_audit_cancel(uuid, text) from public, anon;
grant execute on function public.inv_audit_create(jsonb), public.inv_audit_schedule(uuid, timestamptz, uuid),
  public.inv_audit_start(uuid), public.inv_audit_counter_view(uuid), public.inv_count_submit(uuid, text, jsonb),
  public.inv_audit_complete_counting(uuid), public.inv_audit_reconcile(uuid), public.inv_recount_assign(uuid, uuid, uuid[]),
  public.inv_discrepancy_update(uuid, jsonb), public.inv_adjustment_approve(uuid, text, text),
  public.inv_audit_close(uuid, text), public.inv_audit_cancel(uuid, text) to authenticated;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
