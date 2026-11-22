-- =============================================================================
-- 20261120104000_inv_valuation.sql
-- STATUS: APPLIED to production 2026-11-20 (ledger 20261120104000, owner order; applied text = sha256 446569816ed1575b at commit aefb9ee0 before this STATUS edit; see docs/inventory/96_PRODUCTION_RELEASE_RECORD.md). Inventory WP4 valuation. Requires 20261120100000..103000.
--         Rollback: 20261120104000_inv_valuation_ROLLBACK.sql
--
-- OWNER DECISION 2026-11-20 (binding; replaces "unpriced units leave first"):
--   * Serialised tyres: their own purchase cost (tyre_items, 20261120105000).
--   * Batch / receipt-tracked items: the recorded receipt cost where available.
--   * Ordinary stock: weighted average of PROPERLY VALUED quantity only. Unknown
--     cost is never treated as zero and never consumed first; no proportional
--     cost is invented.
--   * No order is assumed when a balance holds BOTH valued and unvalued units
--     (not priced-first, not unpriced-first, not proportional). An outbound
--     movement moves only what arithmetic proves: the certainly valued part at the
--     average (stock_movements.valued_qty, value_change) and the certainly
--     unvalued part (stock_movements.unvalued_qty, with an OPEN reconciliation).
--     The AMBIGUOUS part posts no value change (stock_movements.pending_out_change)
--     and opens ONE row of kind 'issue_allocation' holding the quantity, the
--     movement and the balance split before it (snapshot). The balance carries it
--     as pending_allocation_out_qty (a transfer destination as
--     pending_allocation_in_qty) until a person decides the split.
--   * Only an approved reconciliation (inv_cost_reconcile, 20261120108000) turns
--     unknown cost into known value or decides an issue allocation; the decision
--     posts linked cost_allocation movements (append-only).
--
-- The single writer _inv_post (20261120100000) computes the buckets and calls
-- _inv_cost_rec_track, whose real body is installed here:
--   * unvalued units IN (unpriced receipt / opening / adjustment / return):
--       open reconciliation kind unpriced_inbound (not consumed);
--   * a transfer: the transfer_out leg does nothing, the paired transfer_in leg
--       MOVES the open reconciliations with the units (split when partial), so
--       one unvalued unit never has two records;
--   * unvalued units OUT (issue, scrap, adjustment_down, supplier_return, ...):
--       the open in-stock reconciliations of that balance become consumed
--       (split when partial); a remainder with no record gets a new consumed one;
--   * an approved opening with a line cost resolves the in-stock records it
--       prices (resolution_source opening_batch: that batch had its own approval);
--   * a reversal re-opens the consumed record of the reversed issue, or cancels
--       in-stock records when it takes unvalued units back out.
--   Legacy balances already unvalued at apply time get one open reconciliation
--   each (kind legacy), so no unvalued unit is untracked.
--
-- Read surfaces:
--   * v_inv_valuation (finance view, security_invoker): per balance valued_qty,
--     unvalued_qty, valued_amount (NULL without stock:view_value), currency,
--     valuation_complete, open_reconciliations. valued_amount is the valued PART;
--     it is never labelled total while valuation_complete is false.
--   * v_inventory_valuation (kept for existing readers), v_inv_cost_reconciliations.
--   * inv_valuation_summary(country): per currency; owned value NULL while any
--     owned unit is unvalued, plus valuation_complete and open_reconciliations.
-- Separation: nothing here reads or writes parts_consumption, CPK or tyre_records
-- money columns, and no accounting posting is created.
-- =============================================================================
begin;

comment on column public.stock_movements.value_change is
  'Inventory (balance sheet) value of the VALUED part only. NEVER summed into maintenance cost, CPK or cost per m3; parts_consumption stays the cost source.';
comment on column public.stock_records.valued_value is
  'Weighted-average value of valued units only. Unvalued units (unvalued_qty) are never priced at 0.';

-- ---------------------------------------------------------------------------
-- Cost reconciliations: every unit of unknown cost has exactly one open record
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_cost_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text, site text,
  item_id uuid references public.material_master(id),
  location_id uuid,
  stock_id uuid references public.stock_records(id),
  origin_movement_id uuid references public.stock_movements(id),
  movement_id uuid references public.stock_movements(id),
  kind text not null check (kind in ('unpriced_inbound','consumed','transfer','reversal_return','legacy','issue_allocation')),
  consumed boolean not null default false,
  consumed_at timestamptz,
  unvalued_qty numeric not null check (unvalued_qty > 0),
  currency text,
  status text not null default 'open' check (status in ('open','resolved','written_off','cancelled')),
  proposed_resolution text check (proposed_resolution is null or proposed_resolution in ('resolved','written_off')),
  proposed_unit_cost numeric check (proposed_unit_cost is null or proposed_unit_cost >= 0),
  proposed_by uuid, proposed_at timestamptz,
  resolution_source text check (resolution_source is null or resolution_source in ('reconciliation','opening_batch','reversal')),
  resolved_unit_cost numeric check (resolved_unit_cost is null or resolved_unit_cost >= 0),
  resolved_value numeric,
  applied_qty numeric, not_applied_qty numeric,
  resolution_movement_id uuid references public.stock_movements(id),
  approval_request_id uuid,
  resolved_by uuid, resolved_at timestamptz,
  evidence jsonb not null default '[]'::jsonb,
  notes text,
  parent_id uuid references public.inventory_cost_reconciliations(id),
  -- issue_allocation only: the balance split before the movement, where a
  -- transfer's undecided units now sit, the proposed and decided split
  snapshot jsonb,
  holder_stock_id uuid references public.stock_records(id),
  proposed_valued_qty numeric check (proposed_valued_qty is null or proposed_valued_qty >= 0),
  resolved_valued_qty numeric, resolved_unvalued_qty numeric,
  holder_resolution_movement_id uuid references public.stock_movements(id),
  created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint inventory_cost_reconciliations_closed_chk check (status = 'open' or resolved_at is not null),
  -- Separation of duties in the database: whoever created the record (the poster
  -- of the movement) cannot be the person who resolves it.
  constraint inventory_cost_reconciliations_sod_chk check (resolution_source is distinct from 'reconciliation'
    or (resolved_by is not null and resolved_by is distinct from created_by))
);
create index if not exists inventory_cost_reconciliations_open_idx
  on public.inventory_cost_reconciliations (organisation_id, status, stock_id);
create index if not exists inventory_cost_reconciliations_movement_idx on public.inventory_cost_reconciliations (movement_id);
select public._inv_secure_table('inventory_cost_reconciliations', true, true);
-- A blind counter must not learn quantities of the balance they are counting.
drop policy if exists inventory_cost_reconciliations_blind on public.inventory_cost_reconciliations;
create policy inventory_cost_reconciliations_blind on public.inventory_cost_reconciliations as restrictive for select
  to authenticated using (not public.inv_blind_hides_balance(organisation_id, site, location_id, item_id));

-- Take p_qty from the OPEN, NOT-consumed records of a balance (oldest first),
-- splitting a record when only part of it is taken, and apply p_action to the
-- taken part: move (to p_dest), consume, resolve_opening, cancel.
-- Returns the quantity no record covered.
create or replace function public._inv_rec_take(p_stock uuid, p_qty numeric, p_action text, p_mov public.stock_movements,
  p_dest uuid default null)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r public.inventory_cost_reconciliations%rowtype; v_left numeric := p_qty; v_take numeric; v_id uuid;
  d public.stock_records%rowtype;
begin
  if p_dest is not null then select * into d from public.stock_records where id = p_dest; end if;
  for r in select * from public.inventory_cost_reconciliations
            where stock_id = p_stock and status = 'open' and not consumed and kind <> 'issue_allocation'
            order by created_at, id for update loop
    exit when v_left <= 0;
    v_take := least(r.unvalued_qty, v_left);
    if v_take < r.unvalued_qty then
      update public.inventory_cost_reconciliations set unvalued_qty = unvalued_qty - v_take, updated_at = now() where id = r.id;
      insert into public.inventory_cost_reconciliations(organisation_id, country, site, item_id, location_id, stock_id,
        origin_movement_id, movement_id, kind, consumed, unvalued_qty, currency, evidence, notes, parent_id, created_by, created_at)
      values (r.organisation_id, r.country, r.site, r.item_id, r.location_id, r.stock_id, r.origin_movement_id, r.movement_id,
        r.kind, false, v_take, r.currency, r.evidence, r.notes, r.id, r.created_by, r.created_at)
      returning id into v_id;
    else
      v_id := r.id;
    end if;
    if p_action = 'move' then
      update public.inventory_cost_reconciliations set stock_id = d.id, location_id = d.location_id, site = d.site,
        country = d.country, movement_id = p_mov.id, kind = 'transfer', updated_at = now() where id = v_id;
    elsif p_action = 'consume' then
      update public.inventory_cost_reconciliations set consumed = true, consumed_at = now(), movement_id = p_mov.id,
        updated_at = now() where id = v_id;
    elsif p_action = 'resolve_opening' then
      update public.inventory_cost_reconciliations set status = 'resolved', resolution_source = 'opening_batch',
        resolved_unit_cost = p_mov.unit_cost, resolved_value = round(unvalued_qty * p_mov.unit_cost, 2),
        applied_qty = unvalued_qty, not_applied_qty = 0, resolution_movement_id = p_mov.id,
        resolved_by = p_mov.actor_id, resolved_at = now(), updated_at = now() where id = v_id;
    else -- cancel: a reversal or an approved opening correction took the units back out
      update public.inventory_cost_reconciliations set status = 'cancelled',
        resolution_source = case when p_mov.movement_type = 'opening' then 'opening_batch' else 'reversal' end,
        resolution_movement_id = p_mov.id, resolved_by = p_mov.actor_id, resolved_at = now(), updated_at = now()
       where id = v_id;
    end if;
    v_left := v_left - v_take;
  end loop;
  return greatest(v_left, 0);
end $fn$;

create or replace function public._inv_cost_rec_track(p_mov public.stock_movements, p jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_u numeric := coalesce(p_mov.unvalued_qty_change, 0); v_left numeric; v_kind text;
  r public.inventory_cost_reconciliations%rowtype; v_take numeric; v_res_mov uuid; b public.stock_records%rowtype;
begin
  -- the approved resolution steps move their own records (inv_cost_reconcile)
  if p_mov.movement_type in ('cost_assignment', 'cost_allocation') then return; end if;
  -- the ambiguous part of an outbound: ONE issue_allocation record, snapshot of the
  -- balance before the movement (this hook runs before the balance is updated)
  if coalesce(p_mov.pending_out_change, 0) > 0 and p_mov.movement_type <> 'reversal' then
    select * into b from public.stock_records where id = p_mov.stock_id;
    insert into public.inventory_cost_reconciliations(organisation_id, country, site, item_id, location_id, stock_id,
      origin_movement_id, movement_id, kind, consumed, unvalued_qty, currency, snapshot, created_by)
    values (p_mov.organisation_id, p_mov.country, p_mov.site, p_mov.item_id, p_mov.location_id, p_mov.stock_id,
      p_mov.id, p_mov.id, 'issue_allocation', false, p_mov.pending_out_change, p_mov.currency,
      jsonb_build_object('valued_qty', b.valued_qty, 'unvalued_qty', b.unvalued_qty, 'valued_value', b.valued_value,
        'pending_allocation_out_qty', b.pending_allocation_out_qty, 'pending_allocation_in_qty', b.pending_allocation_in_qty,
        'qty_on_hand', b.qty_on_hand, 'movement_qty', -p_mov.qty_change), p_mov.actor_id);
  end if;
  -- undecided units arriving by transfer: the record now knows where they sit
  if coalesce(p_mov.pending_in_change, 0) > 0 and p_mov.movement_type = 'transfer_in'
     and nullif(p->>'carried_movement_id', '') is not null then
    update public.inventory_cost_reconciliations set holder_stock_id = p_mov.stock_id, updated_at = now()
     where origin_movement_id = (p->>'carried_movement_id')::uuid and kind = 'issue_allocation';
  end if;
  if p_mov.movement_type = 'reversal' and p_mov.reverses_movement_id is not null then
    -- an undecided allocation of the reversed movement is cancelled with it
    update public.inventory_cost_reconciliations set status = 'cancelled', resolution_source = 'reversal',
      resolution_movement_id = p_mov.id, resolved_by = p_mov.actor_id, resolved_at = now(), updated_at = now()
     where origin_movement_id = p_mov.reverses_movement_id and kind = 'issue_allocation' and status = 'open';
    select resolution_movement_id into v_res_mov from public.inventory_cost_reconciliations
     where origin_movement_id = p_mov.reverses_movement_id and kind = 'issue_allocation' and status = 'resolved';
  end if;
  if v_u = 0 then return; end if;
  if v_u > 0 then
    v_left := v_u;
    if p_mov.movement_type = 'transfer_in' and nullif(p->>'carried_from_stock_id', '') is not null then
      v_left := public._inv_rec_take((p->>'carried_from_stock_id')::uuid, v_left, 'move', p_mov, p_mov.stock_id);
    elsif p_mov.movement_type = 'reversal' and p_mov.reverses_movement_id is not null then
      -- the reversed issue's consumed records come back on the shelf, still open
      for r in select * from public.inventory_cost_reconciliations
                where (movement_id = p_mov.reverses_movement_id or movement_id = v_res_mov)
                  and consumed and status = 'open' and kind <> 'issue_allocation'
                order by created_at, id for update loop
        exit when v_left <= 0;
        v_take := least(r.unvalued_qty, v_left);
        if v_take < r.unvalued_qty then
          update public.inventory_cost_reconciliations set unvalued_qty = unvalued_qty - v_take, updated_at = now() where id = r.id;
          insert into public.inventory_cost_reconciliations(organisation_id, country, site, item_id, location_id, stock_id,
            origin_movement_id, movement_id, kind, consumed, unvalued_qty, currency, parent_id, created_by, created_at)
          values (r.organisation_id, r.country, r.site, r.item_id, r.location_id, p_mov.stock_id, r.origin_movement_id,
            p_mov.id, 'reversal_return', false, v_take, r.currency, r.id, r.created_by, r.created_at);
        else
          update public.inventory_cost_reconciliations set consumed = false, consumed_at = null, stock_id = p_mov.stock_id,
            movement_id = p_mov.id, kind = 'reversal_return', updated_at = now() where id = r.id;
        end if;
        v_left := v_left - v_take;
      end loop;
    end if;
    if v_left > 0 then
      v_kind := case p_mov.movement_type when 'transfer_in' then 'transfer' when 'reversal' then 'reversal_return'
                     else 'unpriced_inbound' end;
      insert into public.inventory_cost_reconciliations(organisation_id, country, site, item_id, location_id, stock_id,
        origin_movement_id, movement_id, kind, consumed, unvalued_qty, currency, created_by)
      values (p_mov.organisation_id, p_mov.country, p_mov.site, p_mov.item_id, p_mov.location_id, p_mov.stock_id,
        p_mov.id, p_mov.id, v_kind, false, v_left, p_mov.currency, p_mov.actor_id);
    end if;
    return;
  end if;
  -- unvalued units left this balance
  v_left := -v_u;
  if p_mov.movement_type = 'transfer_out' then
    return;  -- the paired transfer_in leg (same transaction) moves the records
  elsif p_mov.movement_type = 'opening' then
    -- units the approved opening removed are cancelled; units it priced are resolved
    if coalesce(p_mov.unvalued_qty, 0) > 0 then
      perform public._inv_rec_take(p_mov.stock_id, least(p_mov.unvalued_qty, v_left), 'cancel', p_mov);
      v_left := v_left - least(p_mov.unvalued_qty, v_left);
    end if;
    if v_left > 0 then perform public._inv_rec_take(p_mov.stock_id, v_left, 'resolve_opening', p_mov); end if;
    return;
  elsif p_mov.movement_type = 'reversal' then
    perform public._inv_rec_take(p_mov.stock_id, v_left, 'cancel', p_mov);
    return;
  end if;
  v_left := public._inv_rec_take(p_mov.stock_id, v_left, 'consume', p_mov);
  if v_left > 0 then
    insert into public.inventory_cost_reconciliations(organisation_id, country, site, item_id, location_id, stock_id,
      origin_movement_id, movement_id, kind, consumed, consumed_at, unvalued_qty, currency, created_by)
    values (p_mov.organisation_id, p_mov.country, p_mov.site, p_mov.item_id, p_mov.location_id, p_mov.stock_id,
      p_mov.id, p_mov.id, 'consumed', true, now(), v_left, p_mov.currency, p_mov.actor_id);
  end if;
end $fn$;
revoke all on function public._inv_rec_take(uuid, numeric, text, public.stock_movements, uuid),
  public._inv_cost_rec_track(public.stock_movements, jsonb) from public, anon, authenticated;

-- Legacy balances already unvalued at apply time: one open record each.
insert into public.inventory_cost_reconciliations(organisation_id, country, site, item_id, location_id, stock_id, kind,
  consumed, unvalued_qty, currency, notes)
select s.organisation_id, s.country, s.site, s.item_id, s.location_id, s.id, 'legacy', false, s.unvalued_qty, s.currency,
       'Unvalued at inventory go-live (legacy balance without a recorded cost).'
  from public.stock_records s
 where s.unvalued_qty > 0
   and not exists (select 1 from public.inventory_cost_reconciliations r where r.stock_id = s.id and r.status = 'open'
                    and r.kind <> 'issue_allocation');

-- ---------------------------------------------------------------------------
-- Read surfaces
-- ---------------------------------------------------------------------------
-- Finance view: the valued part and the unvalued part side by side, never summed.
create or replace view public.v_inv_valuation with (security_invoker = on) as
select s.id as stock_id, s.organisation_id, s.country, s.site, s.location_id, s.item_id, m.item_code, s.description,
       s.condition, s.ownership, s.owner_supplier_id, upper(s.currency) as currency,
       s.qty_on_hand, s.valued_qty, s.unvalued_qty,
       case when (select public.inv_can('view_value')) then s.valued_value end as valued_amount,
       case when (select public.inv_can('view_value')) then s.avg_unit_cost end as avg_unit_cost,
       s.unvalued_qty = 0 and s.pending_allocation_out_qty = 0 and s.pending_allocation_in_qty = 0 as valuation_complete,
       (select count(*) from public.inventory_cost_reconciliations r where r.stock_id = s.id and r.status = 'open')::int
         as open_reconciliations,
       case when s.pending_allocation_out_qty + s.pending_allocation_in_qty > 0 then 'pending_allocation'
            when s.qty_on_hand = 0 then 'empty' when s.unvalued_qty = 0 then 'valued'
            when s.valued_qty = 0 then 'unvalued' else 'partially_valued' end as valuation_status,
       -- units whose valued/unvalued split is undecided (issue allocations): out = left
       -- this balance, in = arrived here by transfer
       s.pending_allocation_out_qty + s.pending_allocation_in_qty as pending_allocation_qty,
       s.pending_allocation_out_qty, s.pending_allocation_in_qty,
       (select count(*) from public.inventory_cost_reconciliations r where r.stock_id = s.id and r.status = 'open'
         and r.kind = 'issue_allocation')::int as open_allocations
  from public.stock_records s
  left join public.material_master m on m.id = s.item_id;
revoke all on public.v_inv_valuation from anon;
grant select on public.v_inv_valuation to authenticated;

create or replace view public.v_inv_cost_reconciliations with (security_invoker = on) as
select r.id, r.organisation_id, r.country, r.site, r.item_id, m.item_code, r.location_id, r.stock_id, r.kind, r.consumed,
       r.unvalued_qty, r.currency, r.status, r.proposed_resolution,
       case when (select public.inv_can('view_value')) then r.proposed_unit_cost end as proposed_unit_cost,
       r.proposed_by, r.resolution_source,
       case when (select public.inv_can('view_value')) then r.resolved_unit_cost end as resolved_unit_cost,
       case when (select public.inv_can('view_value')) then r.resolved_value end as resolved_value,
       r.applied_qty, r.not_applied_qty, r.resolved_by, r.resolved_at, r.approval_request_id,
       r.movement_id, r.origin_movement_id, r.evidence, r.notes, r.created_by, r.created_at,
       case when r.kind = 'issue_allocation' then r.unvalued_qty end as allocation_qty,
       r.snapshot, r.holder_stock_id, r.proposed_valued_qty, r.resolved_valued_qty, r.resolved_unvalued_qty,
       r.resolution_movement_id, r.holder_resolution_movement_id
  from public.inventory_cost_reconciliations r
  left join public.material_master m on m.id = r.item_id;
revoke all on public.v_inv_cost_reconciliations from anon;
grant select on public.v_inv_cost_reconciliations to authenticated;

create or replace view public.v_inventory_valuation with (security_invoker = on) as
select s.id as stock_id, s.organisation_id, s.country, s.site, s.location_id, s.item_id, s.description,
       s.condition, s.ownership, s.owner_supplier_id, s.currency,
       s.qty_on_hand, s.qty_reserved, s.qty_on_hand - s.qty_reserved as qty_available,
       s.valued_qty, s.unvalued_qty,
       case when (select public.inv_can('view_value')) then s.valued_value end as valued_value,
       case when (select public.inv_can('view_value')) then s.avg_unit_cost end as avg_unit_cost,
       case when s.qty_on_hand = 0 then 'empty'
            when s.unvalued_qty = 0 then 'valued'
            when s.valued_qty = 0 then 'unvalued'
            else 'partially_valued' end as valuation_status,
       s.last_receipt_at, s.last_issue_at
  from public.stock_records s;
revoke all on public.v_inventory_valuation from anon;
grant select on public.v_inventory_valuation to authenticated;

create or replace function public.inv_valuation_summary(p_country text default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $fn$
declare v jsonb;
begin
  if not public.inv_can('view_value') then
    raise exception 'Stock permission "view_value" is required.' using errcode = '42501';
  end if;
  with b as (
    select s.*, upper(s.currency) as cur from public.stock_records s
     where (s.qty_on_hand > 0 or s.pending_allocation_out_qty + s.pending_allocation_in_qty > 0)
       and (p_country is null or lower(s.country) = lower(p_country))
  ), agreed as (
    select b.id, (select (a.agreed_prices ->> b.item_id::text)::numeric from public.supplier_agreements a
                   where a.organisation_id = b.organisation_id and a.supplier_id = b.owner_supplier_id
                     and a.agreement_type = 'consignment' and a.status = 'active'
                   order by a.starts_on desc nulls last limit 1) as price
      from b where b.ownership = 'consignment'
  ), per as (
    select coalesce(b.cur, 'UNKNOWN') as currency,
      sum(b.valued_value) filter (where b.ownership = 'owned') as owned_valued_value,
      sum(b.valued_qty) filter (where b.ownership = 'owned') as owned_valued_qty,
      sum(b.unvalued_qty) filter (where b.ownership = 'owned') as owned_unvalued_qty,
      sum(b.pending_allocation_out_qty + b.pending_allocation_in_qty) filter (where b.ownership = 'owned') as owned_pending_qty,
      count(*) filter (where b.ownership = 'owned' and b.unvalued_qty > 0 and b.valued_qty > 0) as partial_lines,
      count(*) filter (where b.ownership = 'owned' and b.unvalued_qty > 0 and b.valued_qty = 0) as unvalued_lines,
      sum(b.qty_on_hand) filter (where b.ownership = 'consignment') as consignment_qty,
      sum(b.qty_on_hand * a.price) filter (where b.ownership = 'consignment') as consignment_agreed_value,
      count(*) filter (where b.ownership = 'consignment' and a.price is null) as consignment_without_price,
      sum(b.qty_on_hand) filter (where b.ownership = 'supplier') as supplier_custody_qty
    from b left join agreed a on a.id = b.id group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'currency', currency,
      'owned_value', case when coalesce(owned_unvalued_qty, 0) = 0 and coalesce(owned_pending_qty, 0) = 0
        then round(coalesce(owned_valued_value, 0), 2) end,
      'owned_value_reason', case when coalesce(owned_pending_qty, 0) > 0 then 'pending_allocation_present'
        when coalesce(owned_unvalued_qty, 0) > 0 then 'unvalued_stock_present' end,
      'owned_valued_value', round(coalesce(owned_valued_value, 0), 2),
      'valuation_complete', coalesce(owned_unvalued_qty, 0) = 0 and coalesce(owned_pending_qty, 0) = 0,
      'owned_unvalued_qty', coalesce(owned_unvalued_qty, 0),
      'owned_pending_allocation_qty', coalesce(owned_pending_qty, 0),
      'priced_pct', case when coalesce(owned_valued_qty, 0) + coalesce(owned_unvalued_qty, 0) > 0
        then round(100 * coalesce(owned_valued_qty, 0) / (coalesce(owned_valued_qty, 0) + coalesce(owned_unvalued_qty, 0)), 1) end,
      'partial_lines', partial_lines, 'unvalued_lines', unvalued_lines,
      'consignment_qty', coalesce(consignment_qty, 0),
      'consignment_agreed_value', round(consignment_agreed_value, 2),
      'consignment_without_price', consignment_without_price,
      'supplier_custody_qty', coalesce(supplier_custody_qty, 0)) order by currency), '[]'::jsonb)
    into v from per;
  return jsonb_build_object('by_currency', v, 'mixed_currency', jsonb_array_length(v) > 1,
    'valuation_complete', not exists (select 1 from jsonb_array_elements(v) e
      where (e->>'owned_unvalued_qty')::numeric > 0 or (e->>'owned_pending_allocation_qty')::numeric > 0),
    'open_reconciliations', (select count(*) from public.inventory_cost_reconciliations r
                              where r.status = 'open' and (p_country is null or lower(r.country) = lower(p_country))),
    'note', 'Per currency; never summed across currencies. owned_valued_value is the valued part only and is not a total while valuation_complete is false. Inventory value is not maintenance cost.');
end $fn$;
revoke all on function public.inv_valuation_summary(text) from public, anon;
grant execute on function public.inv_valuation_summary(text) to authenticated;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
