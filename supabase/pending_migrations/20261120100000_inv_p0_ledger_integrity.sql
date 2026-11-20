-- =============================================================================
-- 20261120100000_inv_p0_ledger_integrity.sql
-- STATUS: AUTHORED, NOT APPLIED. Inventory Control & Audit, WP1 (P0).
--         Tested in PGlite only (supabase/tests/inventory_*.test.mjs).
--         Rollback: 20261120100000_inv_p0_ledger_integrity_ROLLBACK.sql
--         Contract: docs/inventory/07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md
--
-- WHY (measured live 2026-11-19, docs/inventory/02_database_audit.md)
--   * stock_movements is editable by any active user (permissive FOR ALL policy
--     stock_movements_authenticated) and is CASCADE-deleted with its balance.
--   * stock_records.stock_qty can be updated in place with no movement.
--   * post_stock_movement / set_stock_count have no idempotency; an elevated
--     adjustment_down may drive stock negative (owner: NO negative stock, NO
--     override - shortages are exception records).
--   * reserve_work_order_stock deducts the empty legacy `stock` table.
--   * goods_receipts / materials / requisitions / suppliers / purchase_orders
--     accept writes from ANY signed-in user; po_number is unique across ALL
--     companies.
--
-- WHAT
--   1. stock_records = THE balance: + item_id, location_id, condition, ownership,
--      owner_supplier_id, qty_on_hand numeric (>= 0), qty_reserved (>= 0, <= on
--      hand), avg_unit_cost, uom, version. stock_qty stays as a legacy integer
--      mirror (floor(qty_on_hand)) so every existing reader keeps working.
--   2. stock_movements = append-only valued ledger: numeric qty, country, item,
--      location, movement_seq, posted/effective_at, unit_cost, value_change,
--      currency, ownership, source doc, idempotency_key (unique per org),
--      payload_hash, reverses_movement_id (one reversal per movement), actor,
--      approval_ref, reserved_change. UPDATE/DELETE/TRUNCATE raise; INSERT only
--      from the posting function. FK to stock_records is RESTRICT.
--   3. stock_exceptions: shortages are recorded, never a negative balance.
--   4. ONE balance writer: _inv_post (internal) behind inv_post_movement(jsonb).
--      Row lock, version check (PT409), idempotency (replay / 23505), org +
--      country + site scope, capability (module `stock`), perpetual weighted
--      average cost per balance row in the row's own currency (no FX ever).
--      inv_reverse_movement, inv_exception_resolve.
--   5. Legacy writers keep their signatures and become wrappers:
--      post_stock_movement, set_stock_count, save_stock_entry,
--      transfer_stock_entry, reserve/release_work_order_stock (now on
--      stock_records.qty_reserved, never on the legacy `stock` table).
--   6. Server-side write gates: goods_receipts (receive), requisitions (own
--      draft or procure), suppliers + purchase_orders (procure), materials
--      frozen read-only. po_number unique per (organisation_id, po_number).
--
-- NOT CHANGED: parts_consumption (the ERP cost ledger) is never read or written.
-- Stock value lives only in stock_movements / stock_records.
--
-- VERIFY (expected after apply)
--   select count(*) from pg_policies where tablename='stock_movements'
--     and policyname in ('stock_movements_authenticated','stock_movements_insert'); -- 0
--   select has_table_privilege('authenticated','public.stock_movements','UPDATE'); -- f
--   select count(*) from stock_records where qty_on_hand <> stock_qty;            -- 0
--   select count(*) from stock_movements where idempotency_key is null;           -- 0
--   update stock_movements set reason = reason where false;  -- (no-op) ; a real
--     update raises 'stock_movements is append-only'.
--   select conname from pg_constraint where conname='purchase_orders_org_po_number_key'; -- 1 row
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Rollback snapshot. Everything this migration REPLACES is copied from the
--    catalog before it is touched, so the ROLLBACK file restores the exact live
--    definitions (nothing is transcribed by hand). Kept in _bak (no client grant).
-- ---------------------------------------------------------------------------
create schema if not exists _bak;
revoke all on schema _bak from public;
create table if not exists _bak.inv_p0_snapshot (
  kind text not null, name text not null, definition text not null,
  captured_at timestamptz not null default now(), primary key (kind, name));
do $$
declare r record;
begin
  delete from _bak.inv_p0_snapshot;
  for r in select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('public','post_stock_movement'),('public','set_stock_count'),
              ('public','save_stock_entry'),('public','transfer_stock_entry'),
              ('private','reserve_work_order_stock_internal'),('private','release_work_order_stock_internal')) loop
    insert into _bak.inv_p0_snapshot values ('function', r.sig, r.def);
    insert into _bak.inv_p0_snapshot values ('function_acl', r.sig,
      format('revoke all on function %s from public, anon, authenticated', r.sig) || coalesce((
        select string_agg(format('; grant execute on function %s to %s', r.sig,
                 case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end), '')
          from pg_proc p2, aclexplode(coalesce(p2.proacl, acldefault('f', p2.proowner))) a
         where p2.oid = to_regprocedure(r.sig) and a.privilege_type = 'EXECUTE' and a.grantee <> p2.proowner), ''));
  end loop;
  for r in select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
             from pg_policies where schemaname = 'public' and tablename in ('stock_records','stock_movements','stock',
               'goods_receipts','requisitions','suppliers','purchase_orders','materials') loop
    insert into _bak.inv_p0_snapshot values ('policy', r.tablename || '.' || r.policyname,
      format('create policy %I on public.%I as %s for %s to %s%s%s', r.policyname, r.tablename, r.permissive, r.cmd,
        array_to_string(r.roles, ', '),
        case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
        case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end));
  end loop;
  for r in select table_name, string_agg(privilege_type, ', ') as privs from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'authenticated'
              and ((table_name in ('stock_records','stock_movements','stock','materials')
                    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'))
                   or table_name = 'v_stock_balance_reconcile') group by table_name loop
    insert into _bak.inv_p0_snapshot values ('grant', r.table_name,
      format('grant %s on public.%I to authenticated', r.privs, r.table_name));
  end loop;
  for r in select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c
            where c.conname in ('stock_movements_stock_id_fkey','stock_movements_movement_type_check',
              'purchase_orders_po_number_key','work_order_stock_reservation_lines_stock_id_fkey') loop
    insert into _bak.inv_p0_snapshot values ('constraint', r.tbl || '.' || r.conname,
      format('alter table %s add constraint %I %s', r.tbl, r.conname, r.def));
  end loop;
  for r in select c.relname, pg_get_viewdef(c.oid) as def, coalesce(array_to_string(c.reloptions, ', '), '') as opts
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and c.relname = 'v_stock_balance_reconcile' loop
    insert into _bak.inv_p0_snapshot values ('view', r.relname,
      format('create view public.%I%s as %s', r.relname, case when r.opts <> '' then ' with (' || r.opts || ')' else '' end, r.def));
  end loop;
  insert into _bak.inv_p0_snapshot
  select 'nullable', 'stock_movements.organisation_id', 'alter table public.stock_movements alter column organisation_id drop not null'
    from pg_attribute a where a.attrelid = 'public.stock_movements'::regclass and a.attname = 'organisation_id' and not a.attnotnull;
  for r in select c.relname, a.attname, format_type(a.atttypid, a.atttypmod) as typ
             from pg_attribute a join pg_class c on c.oid = a.attrelid
            where c.relname = 'stock_movements' and c.relnamespace = 'public'::regnamespace
              and a.attname in ('qty_before','qty_change','qty_after') loop
    insert into _bak.inv_p0_snapshot values ('column_type', r.relname || '.' || r.attname, r.typ);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 0. Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.inv_can(p_cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_user_can('stock', p_cap), false)
$$;

create or replace function public._inv_scope_ok(p_country text, p_site text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_write_country_ok(p_country), false)
     and (p_site is null or btrim(p_site) = ''
          or coalesce(public.app_sees_all_sites(), false)
          or upper(btrim(p_site)) = any (coalesce(public.app_site_scope(), '{}'::text[])))
$$;

create or replace function public._inv_posting_on()
returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('inv.posting', true), '') = 'on'
$$;

-- Blind-count hook. Replaced by the real body in 20261120102000 (audits):
-- true when the caller is the counter of an open blind audit covering this
-- balance, so no read or write path can reveal the expected quantity.
create or replace function public.inv_blind_hides_balance(p_org uuid, p_site text, p_location uuid, p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$ select false $$;

-- Movement kind: in / out / signed / reserve. NULL = unknown token.
create or replace function public.inv_movement_kind(p_type text)
returns text language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p_type, '')))
    when 'receipt' then 'in' when 'consignment_receipt' then 'in' when 'return' then 'in'
    when 'transfer_in' then 'in' when 'adjustment_up' then 'in' when 'opening' then 'signed'
    when 'in' then 'in' when 'initial' then 'in' when 'issue_return' then 'in'
    when 'issue' then 'out' when 'transfer_out' then 'out' when 'adjustment_down' then 'out'
    when 'scrap' then 'out' when 'out' then 'out' when 'supplier_return' then 'out'
    when 'landed_cost' then 'value' when 'supplier_credit' then 'value' when 'cost_assignment' then 'value'
    when 'cost_allocation' then 'value'
    when 'stocktake' then 'signed' when 'adjustment' then 'signed' when 'reversal' then 'signed'
    when 'reserve' then 'reserve' when 'release' then 'reserve'
  end
$$;

-- Capability (module `stock`) needed to post a movement type from the public RPC.
create or replace function public._inv_cap_for(p_type text)
returns text language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p_type, '')))
    when 'receipt' then 'receive' when 'consignment_receipt' then 'receive'
    when 'issue' then 'issue' when 'return' then 'issue' when 'issue_return' then 'issue'
    when 'supplier_return' then 'receive'
    when 'landed_cost' then 'financial_post' when 'supplier_credit' then 'financial_post'
    when 'cost_assignment' then 'financial_post' when 'cost_allocation' then 'financial_post'
    when 'reserve' then 'issue' when 'release' then 'issue'
    when 'transfer_in' then 'transfer' when 'transfer_out' then 'transfer'
    when 'scrap' then 'scrap_approve'
    else 'adjustment_approve'
  end
$$;

-- Secure-table template used by every inventory table in this programme:
-- RESTRICTIVE org isolation, country/site SELECT scoping, active-user read,
-- no client writes (writes only through SECURITY DEFINER inv_* RPCs).
create or replace function public._inv_secure_table(p_table text, p_country boolean, p_site boolean)
returns void language plpgsql set search_path = public as $fn$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_org_isolation', p_table);
  execute format($p$create policy %I on public.%I as restrictive for all to authenticated
    using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
    with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))$p$,
    p_table || '_org_isolation', p_table);
  if p_country then
    execute format('drop policy if exists %I on public.%I', p_table || '_country_isolation', p_table);
    execute format($p$create policy %I on public.%I as restrictive for select to authenticated
      using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
        or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))))$p$,
      p_table || '_country_isolation', p_table);
  end if;
  if p_site then
    execute format('drop policy if exists %I on public.%I', p_table || '_site_isolation', p_table);
    execute format($p$create policy %I on public.%I as restrictive for select to authenticated
      using ((site is null) or (btrim(site) = '') or (select public.app_sees_all_sites())
        or (upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))))$p$,
      p_table || '_site_isolation', p_table);
  end if;
  execute format('drop policy if exists %I on public.%I', p_table || '_read', p_table);
  execute format($p$create policy %I on public.%I for select to authenticated
    using ((select public.app_is_active()) is true)$p$, p_table || '_read', p_table);
  execute format('revoke all on public.%I from anon', p_table);
  execute format('revoke insert, update, delete, truncate, trigger, references on public.%I from authenticated', p_table);
  execute format('grant select on public.%I to authenticated', p_table);
end $fn$;
revoke all on function public._inv_secure_table(text, boolean, boolean) from public;

-- ---------------------------------------------------------------------------
-- 1. stock_records = THE balance
-- ---------------------------------------------------------------------------
alter table public.stock_records
  add column if not exists item_id uuid references public.material_master(id),
  add column if not exists location_id uuid,
  add column if not exists condition text not null default 'unspecified',
  add column if not exists ownership text not null default 'owned',
  add column if not exists owner_supplier_id uuid references public.suppliers(id),
  add column if not exists qty_on_hand numeric not null default 0,
  add column if not exists qty_reserved numeric not null default 0,
  add column if not exists avg_unit_cost numeric,
  add column if not exists valued_qty numeric not null default 0,
  add column if not exists valued_value numeric not null default 0,
  add column if not exists unvalued_qty numeric not null default 0,
  -- Owner decision 2026-11-20: units whose valued/unvalued split is undecided.
  -- out: left this balance, still inside valued_qty / unvalued_qty until resolved;
  -- in:  arrived by transfer, in neither bucket until the upstream split is resolved.
  add column if not exists pending_allocation_out_qty numeric not null default 0,
  add column if not exists pending_allocation_in_qty numeric not null default 0,
  add column if not exists last_receipt_at timestamptz,
  add column if not exists last_issue_at timestamptz,
  add column if not exists uom text,
  add column if not exists version integer not null default 1;

-- Backfill BEFORE the guard exists. The 43 live rows keep their quantity; they
-- are NOT treated as approved opening balances (owner correction 2) - the
-- opening-balance batch in 20261120101000 reviews them.
update public.stock_records s set
  qty_on_hand   = greatest(coalesce(s.stock_qty, 0), 0),
  condition     = case lower(btrim(coalesce(s.custom_data->'stock_item'->>'condition', '')))
                    when 'new' then 'new' when 'serviceable' then 'serviceable'
                    when 'retread' then 'retread' else 'unspecified' end,
  uom           = coalesce(s.uom, nullif(s.custom_data->'stock_item'->>'unit', '')),
  avg_unit_cost = case when s.unit_cost is not null and coalesce(s.stock_qty, 0) > 0 then round(s.unit_cost, 4) end,
  -- priced legacy rows are valued at their recorded unit cost; unpriced stock is UNVALUED, never 0
  valued_qty    = case when s.unit_cost is not null then greatest(coalesce(s.stock_qty, 0), 0) else 0 end,
  valued_value  = case when s.unit_cost is not null then round(greatest(coalesce(s.stock_qty, 0), 0) * s.unit_cost, 2) else 0 end,
  unvalued_qty  = case when s.unit_cost is null then greatest(coalesce(s.stock_qty, 0), 0) else 0 end;

alter table public.stock_records
  add constraint stock_records_condition_chk check (condition in
    ('new','good','serviceable','used','retread','repairable','damaged','quarantine','scrap','unspecified')),
  add constraint stock_records_ownership_chk check (ownership in ('owned','consignment','supplier')),
  add constraint stock_records_owner_supplier_chk check (ownership = 'owned' or owner_supplier_id is not null),
  add constraint stock_records_qty_on_hand_nonneg check (qty_on_hand >= 0),
  add constraint stock_records_qty_reserved_bounds check (qty_reserved >= 0 and qty_reserved <= qty_on_hand),
  add constraint stock_records_avg_cost_nonneg check (avg_unit_cost is null or avg_unit_cost >= 0),
  add constraint stock_records_value_buckets_chk check (valued_qty >= 0 and unvalued_qty >= 0 and valued_value >= 0
    and pending_allocation_out_qty >= 0 and pending_allocation_in_qty >= 0
    and qty_on_hand + pending_allocation_out_qty - pending_allocation_in_qty = valued_qty + unvalued_qty
    and (valued_qty > 0 or valued_value = 0));

create unique index if not exists stock_records_item_balance_uq
  on public.stock_records (organisation_id, item_id, location_id, condition, ownership,
     coalesce(owner_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where item_id is not null and location_id is not null;
create index if not exists stock_records_item_idx on public.stock_records (item_id);
create index if not exists stock_records_location_idx on public.stock_records (location_id);

-- Quantity / value / identity columns change only inside the posting function.
create or replace function public.inv_balance_guard()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if public._inv_posting_on() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.qty_on_hand, 0) <> 0 or coalesce(new.stock_qty, 0) <> 0 or coalesce(new.qty_reserved, 0) <> 0
       or coalesce(new.valued_qty, 0) <> 0 or coalesce(new.unvalued_qty, 0) <> 0 or coalesce(new.valued_value, 0) <> 0
       or coalesce(new.pending_allocation_out_qty, 0) <> 0 or coalesce(new.pending_allocation_in_qty, 0) <> 0 then
      raise exception 'Stock quantity can only be set by a posted movement (inv_post_movement or an approved opening balance).'
        using errcode = '42501';
    end if;
    new.qty_on_hand := 0; new.stock_qty := 0; new.qty_reserved := 0; new.version := 1;
    new.valued_qty := 0; new.valued_value := 0; new.unvalued_qty := 0; new.avg_unit_cost := null; new.unit_cost := null;
    new.pending_allocation_out_qty := 0; new.pending_allocation_in_qty := 0;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.qty_on_hand is distinct from old.qty_on_hand or new.stock_qty is distinct from old.stock_qty
       or new.qty_reserved is distinct from old.qty_reserved or new.avg_unit_cost is distinct from old.avg_unit_cost
       or new.valued_qty is distinct from old.valued_qty or new.valued_value is distinct from old.valued_value
       or new.unvalued_qty is distinct from old.unvalued_qty
       or new.pending_allocation_out_qty is distinct from old.pending_allocation_out_qty
       or new.pending_allocation_in_qty is distinct from old.pending_allocation_in_qty
       or new.unit_cost is distinct from old.unit_cost or new.currency is distinct from old.currency
       or new.version is distinct from old.version or new.item_id is distinct from old.item_id
       or new.location_id is distinct from old.location_id or new.condition is distinct from old.condition
       or new.ownership is distinct from old.ownership or new.owner_supplier_id is distinct from old.owner_supplier_id
       or new.organisation_id is distinct from old.organisation_id or new.country is distinct from old.country
       or upper(btrim(coalesce(new.site, ''))) is distinct from upper(btrim(coalesce(old.site, ''))) then
      raise exception 'Stock quantity, cost, ownership and location change only through a posted movement.'
        using errcode = '42501';
    end if;
    return new;
  else
    if coalesce(old.qty_on_hand, 0) <> 0 or coalesce(old.qty_reserved, 0) <> 0 then
      raise exception 'A balance that still holds stock cannot be deleted. Post an approved adjustment first.'
        using errcode = '42501';
    end if;
    return old;
  end if;
end $fn$;
drop trigger if exists trg_zz_inv_balance_guard on public.stock_records;
create trigger trg_zz_inv_balance_guard before insert or update or delete on public.stock_records
  for each row execute function public.inv_balance_guard();

-- Client write surface: no direct quantity writes; only planning settings.
drop policy if exists stock_records_insert on public.stock_records;
drop policy if exists stock_records_update on public.stock_records;
drop policy if exists stock_records_delete on public.stock_records;
drop policy if exists stock_records_cap_insert on public.stock_records;
drop policy if exists stock_records_cap_update on public.stock_records;
drop policy if exists stock_records_cap_delete on public.stock_records;
revoke insert, update, delete, truncate on public.stock_records from authenticated, anon;
grant update (min_level, critical_level, reorder_qty, management_action) on public.stock_records to authenticated;
create policy stock_records_settings_update on public.stock_records for update to authenticated
  using (public.app_user_can('stock', 'edit')) with check (public.app_user_can('stock', 'edit'));

-- ---------------------------------------------------------------------------
-- 2. stock_movements = append-only valued ledger
-- ---------------------------------------------------------------------------
drop view if exists public.v_stock_balance_reconcile;

alter table public.stock_movements
  alter column qty_before type numeric,
  alter column qty_change type numeric,
  alter column qty_after  type numeric;

alter table public.stock_movements
  add column if not exists country text,
  add column if not exists item_id uuid references public.material_master(id),
  add column if not exists location_id uuid,
  add column if not exists movement_seq bigint,
  add column if not exists posted_at timestamptz default now(),
  add column if not exists effective_at timestamptz,
  add column if not exists unit_cost numeric,
  add column if not exists value_change numeric,
  add column if not exists unvalued_qty_change numeric not null default 0,
  add column if not exists valuation_status text,
  add column if not exists variance_kind text,
  add column if not exists variance_amount numeric,
  add column if not exists currency text,
  add column if not exists ownership text default 'owned',
  add column if not exists source_doc_type text,
  add column if not exists source_doc_id text,
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text,
  add column if not exists reverses_movement_id uuid references public.stock_movements(id),
  add column if not exists actor_id uuid,
  add column if not exists approval_ref text,
  add column if not exists reserved_change numeric not null default 0,
  -- magnitudes of the quantity this movement moved at a KNOWN cost and at an UNKNOWN
  -- cost; value_change is the value of the valued part only (owner decision 2026-11-20)
  add column if not exists valued_qty numeric not null default 0,
  add column if not exists unvalued_qty numeric not null default 0,
  -- signed changes of the balance's pending allocation (out / in); an outbound movement
  -- whose valued/unvalued split cannot be proved posts its ambiguous qty here and NO value
  add column if not exists pending_out_change numeric not null default 0,
  add column if not exists pending_in_change numeric not null default 0,
  -- serial / lot-tracked items: the receipt whose actual cost this outbound used
  add column if not exists source_receipt_movement_id uuid references public.stock_movements(id);

-- Backfill legacy rows (78 live) BEFORE the append-only trigger exists.
update public.stock_movements m set
  organisation_id = coalesce(m.organisation_id, r.organisation_id),
  country         = coalesce(m.country, r.country),
  currency        = coalesce(m.currency, r.currency)
from public.stock_records r where r.id = m.stock_id;
update public.stock_movements m set
  posted_at       = coalesce(m.created_at, now()),
  effective_at    = coalesce(m.effective_at, m.created_at, now()),
  actor_id        = coalesce(m.actor_id, m.created_by),
  idempotency_key = coalesce(m.idempotency_key, 'legacy:' || m.id::text),
  source_doc_type = coalesce(m.source_doc_type, 'legacy');
update public.stock_movements m set movement_seq = x.rn
from (select id, row_number() over (order by created_at nulls first, id) as rn from public.stock_movements) x
where x.id = m.id;

create sequence if not exists public.stock_movements_movement_seq_seq owned by public.stock_movements.movement_seq;
select setval('public.stock_movements_movement_seq_seq',
  greatest(coalesce((select max(movement_seq) from public.stock_movements), 0), 1),
  (select count(*) > 0 from public.stock_movements));
alter table public.stock_movements
  alter column movement_seq set default nextval('public.stock_movements_movement_seq_seq'),
  alter column movement_seq set not null,
  alter column idempotency_key set not null,
  alter column posted_at set not null;
create unique index if not exists stock_movements_movement_seq_uq on public.stock_movements (movement_seq);
create unique index if not exists stock_movements_org_idempotency_uq on public.stock_movements (organisation_id, idempotency_key);
create unique index if not exists stock_movements_one_reversal_uq on public.stock_movements (reverses_movement_id)
  where reverses_movement_id is not null;
create index if not exists stock_movements_item_idx on public.stock_movements (item_id);
create index if not exists stock_movements_org_seq_idx on public.stock_movements (organisation_id, movement_seq);

do $$ begin
  if not exists (select 1 from public.stock_movements where organisation_id is null) then
    alter table public.stock_movements alter column organisation_id set not null;
  else
    raise notice 'stock_movements has rows without organisation_id; NOT NULL deferred (review them)';
  end if;
end $$;

alter table public.stock_movements drop constraint if exists stock_movements_stock_id_fkey;
alter table public.stock_movements add constraint stock_movements_stock_id_fkey
  foreign key (stock_id) references public.stock_records(id) on delete restrict;

alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check check (movement_type = any (array[
  'In','Out','Adjustment','Initial','Reorder','Scrap',
  'receipt','return','transfer_in','adjustment_up','issue','transfer_out','scrap','adjustment_down','stocktake',
  'opening','reversal','reserve','release','consignment_receipt','issue_return','supplier_return',
  'supplier_credit','landed_cost','cost_assignment','cost_allocation']));
alter table public.stock_movements add constraint stock_movements_qty_after_nonneg check (qty_after >= 0) not valid;
do $$ begin
  alter table public.stock_movements validate constraint stock_movements_qty_after_nonneg;
exception when check_violation then
  raise notice 'legacy stock_movements rows carry a negative qty_after; constraint left NOT VALID (new rows are checked)';
end $$;
alter table public.stock_movements add constraint stock_movements_ownership_chk
  check (ownership is null or ownership in ('owned','consignment','supplier'));

create or replace function public.inv_ledger_guard()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    if not public._inv_posting_on() then
      raise exception 'stock_movements rows are written only by the inventory posting function (inv_post_movement).'
        using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'stock_movements is append-only; post a reversal (inv_reverse_movement) instead of % .', lower(tg_op)
    using errcode = '42501';
end $fn$;
drop trigger if exists trg_inv_ledger_append_only on public.stock_movements;
create trigger trg_inv_ledger_append_only before insert or update or delete on public.stock_movements
  for each row execute function public.inv_ledger_guard();
drop trigger if exists trg_inv_ledger_no_truncate on public.stock_movements;
create trigger trg_inv_ledger_no_truncate before truncate on public.stock_movements
  for each statement execute function public.inv_ledger_guard();

drop policy if exists stock_movements_authenticated on public.stock_movements;
drop policy if exists stock_movements_insert on public.stock_movements;
drop policy if exists stock_movements_active_user_insert on public.stock_movements;
drop policy if exists stock_movements_active_user_update on public.stock_movements;
revoke insert, update, delete, truncate on public.stock_movements from authenticated, anon;
revoke all on public.stock_movements, public.stock_records from anon;  -- V281 already holds this live; restated
drop policy if exists stock_movements_country_isolation on public.stock_movements;
create policy stock_movements_country_isolation on public.stock_movements as restrictive for select to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
    or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));

create view public.v_stock_balance_reconcile with (security_invoker = on) as
select s.id as stock_id, s.site, s.description, s.organisation_id,
       s.qty_on_hand as recorded_qty,
       coalesce(l.ledger_qty, 0) as ledger_qty,
       s.qty_on_hand - coalesce(l.ledger_qty, 0) as drift,
       s.qty_on_hand <> coalesce(l.ledger_qty, 0) as has_drift
from public.stock_records s
left join (select stock_id, sum(qty_change) as ledger_qty from public.stock_movements group by stock_id) l
  on l.stock_id = s.id;
revoke all on public.v_stock_balance_reconcile from anon;
grant select on public.v_stock_balance_reconcile to authenticated;

-- ---------------------------------------------------------------------------
-- 3. stock_exceptions (never a negative balance)
-- ---------------------------------------------------------------------------
create table if not exists public.stock_exceptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text, site text,
  exception_type text not null check (exception_type in ('shortage','backorder','pending_receipt','reconciliation')),
  stock_id uuid references public.stock_records(id),
  item_id uuid references public.material_master(id),
  location_id uuid,
  qty numeric not null check (qty >= 0),
  qty_requested numeric, qty_available numeric,
  movement_type text, source_doc_type text, source_doc_id text,
  idempotency_key text, payload_hash text,
  status text not null default 'open' check (status in ('open','resolved','cancelled')),
  notes text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  resolved_by uuid, resolved_at timestamptz
);
create unique index if not exists stock_exceptions_org_idempotency_uq on public.stock_exceptions (organisation_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists stock_exceptions_open_idx on public.stock_exceptions (organisation_id, status, exception_type);
select public._inv_secure_table('stock_exceptions', true, true);

-- ---------------------------------------------------------------------------
-- 4. The ONE balance writer
-- ---------------------------------------------------------------------------
create or replace function public._inv_movement_json(m public.stock_movements)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('status','posted','movement_id',m.id,'movement_seq',m.movement_seq,
    'stock_id',m.stock_id,'movement_type',m.movement_type,'qty_before',m.qty_before,'qty_change',m.qty_change,
    'qty_after',m.qty_after,'reserved_change',m.reserved_change,'unit_cost',m.unit_cost,
    'value_change',m.value_change,'unvalued_qty_change',m.unvalued_qty_change,'valuation_status',m.valuation_status,
    'valued_qty_moved',m.valued_qty,'unvalued_qty_moved',m.unvalued_qty,
    'pending_allocation_qty',greatest(abs(m.pending_out_change),abs(m.pending_in_change)),
    'pending_out_change',m.pending_out_change,'pending_in_change',m.pending_in_change,
    'source_receipt_movement_id',m.source_receipt_movement_id,
    'variance_kind',m.variance_kind,'variance_amount',m.variance_amount,
    'currency',m.currency,'idempotency_key',m.idempotency_key)
$$;

-- Cost-reconciliation hook (same pattern as inv_blind_hides_balance): replaced by
-- the real body in 20261120104000_inv_valuation.sql.
create or replace function public._inv_cost_rec_track(p_mov public.stock_movements, p jsonb)
returns void language plpgsql security definer set search_path = public as $fn$ begin return; end $fn$;
revoke all on function public._inv_cost_rec_track(public.stock_movements, jsonb) from public, anon, authenticated;

create or replace function public._inv_post(p jsonb, p_check_cap boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
-- SQL mirror of src/lib/inventory/valuation.js applyMovement() / transfer()
-- (docs/inventory/20_VALUATION_RULES.md). Change both together.
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.app_current_org();
  v_key text := nullif(btrim(coalesce(p->>'idempotency_key', '')), '');
  v_type text := lower(btrim(coalesce(p->>'movement_type', '')));
  v_kind text;
  v_hash text;
  v_chg numeric; v_rchg numeric; v_unit numeric; v_value_in numeric; v_qty_val numeric;
  v_rec public.stock_records%rowtype;
  v_mov public.stock_movements%rowtype;
  v_exc public.stock_exceptions%rowtype;
  v_item public.material_master%rowtype;
  v_loc_id2 uuid; v_loc_org uuid; v_loc_country text; v_loc_site text; v_loc_active boolean;
  v_stock uuid; v_cond text; v_own text; v_sup uuid; v_item_id uuid; v_loc_id uuid;
  v_before numeric; v_after numeric; v_rbefore numeric; v_rafter numeric;
  v_cur text; v_exc_id uuid; v_status text;
  -- valuation buckets (valued_qty + valued_value carry the average; unvalued_qty is never priced at 0)
  v_vq numeric; v_vv numeric; v_uq numeric;
  v_val_chg numeric; v_unv_chg numeric := 0; v_unit_applied numeric; v_val_status text;
  v_var_kind text; v_var_amt numeric;
  v_out_unv numeric; v_out_val numeric; v_out_value numeric; v_avg numeric;
  v_m_vq numeric := 0; v_m_uq numeric := 0;  -- movement magnitudes: valued / unvalued quantity moved
  -- pending allocation (owner decision 2026-11-20: no order is assumed on a mixed balance)
  v_po numeric; v_pi numeric; v_po_chg numeric := 0; v_pi_chg numeric := 0; v_amb numeric := 0;
  v_maxv numeric; v_maxu numeric; v_q numeric; v_a numeric; v_alloc_val numeric;
  v_tracked boolean := false; v_src_mov public.stock_movements%rowtype; v_src_left numeric; v_src_unit numeric;
begin
  if v_uid is null or v_org is null then
    raise exception 'Sign in with an organisation to post stock.' using errcode = '42501';
  end if;
  if v_key is null or length(v_key) > 200 then
    raise exception 'An idempotency_key (1-200 chars) is required for every stock posting.' using errcode = '22023';
  end if;
  v_kind := public.inv_movement_kind(v_type);
  if v_kind is null then
    raise exception 'Unknown movement_type "%".', p->>'movement_type' using errcode = '22023';
  end if;
  begin
    v_chg  := coalesce((p->>'qty_change')::numeric, 0);
    v_rchg := coalesce((p->>'reserved_change')::numeric, 0);
    v_unit := (p->>'unit_cost')::numeric;
    v_value_in := (p->>'value')::numeric;
    v_qty_val := (p->>'qty')::numeric;
  exception when others then
    raise exception 'Quantities, unit cost and value must be numbers.' using errcode = '22023';
  end;
  if v_unit is not null and v_unit < 0 then
    raise exception 'Unit cost cannot be negative.' using errcode = '22023';
  end if;
  if (v_kind = 'in' and (v_chg <= 0 or v_rchg <> 0))
     or (v_kind = 'out' and (v_chg >= 0 or v_rchg > 0))
     or (v_kind = 'signed' and v_chg = 0 and v_type <> 'opening')
     or (v_kind = 'signed' and v_type not in ('reversal') and v_rchg <> 0)
     or (v_kind = 'value' and (v_chg <> 0 or v_rchg <> 0))
     or (v_type = 'reserve' and (v_chg <> 0 or v_rchg <= 0))
     or (v_type = 'release' and (v_chg <> 0 or v_rchg >= 0)) then
    raise exception 'qty_change / reserved_change do not fit movement_type %.', v_type using errcode = '22023';
  end if;
  if v_type = 'reversal' and nullif(p->>'reverses_movement_id', '') is null then
    raise exception 'A reversal must name the movement it reverses.' using errcode = '22023';
  end if;
  if v_type in ('landed_cost', 'supplier_credit') and (v_value_in is null or v_value_in < 0) then
    raise exception 'A % needs a value of zero or more.', v_type using errcode = '22023';
  end if;
  if v_type = 'cost_assignment' and (v_qty_val is null or v_qty_val <= 0 or v_unit is null) then
    raise exception 'A cost assignment needs qty > 0 and a unit_cost.' using errcode = '22023';
  end if;

  v_hash := md5(p::text);
  -- Serialise the same key (concurrent retries) before the replay check.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':inv:' || v_key, 0));
  select * into v_mov from public.stock_movements where organisation_id = v_org and idempotency_key = v_key;
  if found then
    if v_mov.payload_hash is distinct from v_hash then
      raise exception 'This idempotency_key was already used for a different posting.' using errcode = '23505';
    end if;
    return public._inv_movement_json(v_mov) || jsonb_build_object('replayed', true);
  end if;
  select * into v_exc from public.stock_exceptions where organisation_id = v_org and idempotency_key = v_key;
  if found then
    if v_exc.payload_hash is distinct from v_hash then
      raise exception 'This idempotency_key was already used for a different posting.' using errcode = '23505';
    end if;
    return jsonb_build_object('status','refused_shortage','exception_id',v_exc.id,'stock_id',v_exc.stock_id,
      'qty_available',v_exc.qty_available,'qty_requested',v_exc.qty_requested,'replayed',true);
  end if;

  -- Resolve the balance row.
  v_stock := nullif(p->>'stock_id', '')::uuid;
  if v_stock is not null then
    select * into v_rec from public.stock_records where id = v_stock for update;
    if not found then raise exception 'Stock balance % not found.', v_stock using errcode = 'P0002'; end if;
  else
    v_item_id := nullif(p->>'item_id', '')::uuid;
    v_loc_id  := nullif(p->>'location_id', '')::uuid;
    if v_item_id is null or v_loc_id is null then
      raise exception 'Give stock_id, or item_id and location_id.' using errcode = '22023';
    end if;
    v_cond := lower(coalesce(nullif(btrim(p->>'condition'), ''), 'new'));
    v_own  := lower(coalesce(nullif(btrim(p->>'ownership'), ''), 'owned'));
    v_sup  := nullif(p->>'owner_supplier_id', '')::uuid;
    if v_type = 'consignment_receipt' and v_own = 'owned' then
      raise exception 'A consignment receipt must name ownership consignment and the owning supplier.' using errcode = '22023';
    end if;
    select * into v_item from public.material_master where id = v_item_id;
    if not found or v_item.organisation_id is distinct from v_org then
      raise exception 'Item not found in your organisation.' using errcode = '42501';
    end if;
    select l.id, l.organisation_id, l.country, l.site, l.active
      into v_loc_id2, v_loc_org, v_loc_country, v_loc_site, v_loc_active
      from public.inventory_locations l where l.id = v_loc_id;
    if v_loc_id2 is null or v_loc_org is distinct from v_org then
      raise exception 'Location not found in your organisation.' using errcode = '42501';
    end if;
    if not v_loc_active then
      raise exception 'Location is inactive.' using errcode = '22023';
    end if;
    if v_item.country is not null and v_loc_country is not null
       and lower(btrim(v_item.country)) <> lower(btrim(v_loc_country)) then
      raise exception 'Item master country differs from the location country.' using errcode = '22023';
    end if;
    select * into v_rec from public.stock_records
     where organisation_id = v_org and item_id = v_item_id and location_id = v_loc_id
       and condition = v_cond and ownership = v_own
       and coalesce(owner_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_sup, '00000000-0000-0000-0000-000000000000'::uuid)
     for update;
    if not found and (v_kind = 'in' or (v_kind = 'signed' and v_chg > 0)) then
      perform set_config('inv.posting', 'on', true);
      insert into public.stock_records(organisation_id, country, region, site, description, brand, item_id, location_id,
        condition, ownership, owner_supplier_id, qty_on_hand, stock_qty, qty_reserved, uom, currency, min_level, critical_level)
      values (v_org, v_loc_country, v_loc_country, v_loc_site, coalesce(v_item.item_name, v_item.item_code), v_item.brand,
        v_item_id, v_loc_id, v_cond, v_own, v_sup, 0, 0, 0, v_item.uom,
        public.currency_for_country(v_loc_country), 0, 0)
      on conflict do nothing;
      perform set_config('inv.posting', '', true);
      select * into v_rec from public.stock_records
       where organisation_id = v_org and item_id = v_item_id and location_id = v_loc_id
         and condition = v_cond and ownership = v_own
         and coalesce(owner_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(v_sup, '00000000-0000-0000-0000-000000000000'::uuid)
       for update;
    end if;
  end if;

  if v_rec.id is not null then
    if v_rec.organisation_id is distinct from v_org then
      raise exception 'Cross-organisation stock posting denied.' using errcode = '42501';
    end if;
    if not public._inv_scope_ok(v_rec.country, v_rec.site) then
      raise exception 'This stock is outside your country or site scope.' using errcode = '42501';
    end if;
    if public.inv_blind_hides_balance(v_rec.organisation_id, v_rec.site, v_rec.location_id, v_rec.item_id) then
      raise exception 'You are counting this stock in an open blind audit; another person must post its movements.'
        using errcode = '42501';
    end if;
  elsif v_loc_id2 is not null and not public._inv_scope_ok(v_loc_country, v_loc_site) then
    raise exception 'This location is outside your country or site scope.' using errcode = '42501';
  end if;
  if p_check_cap and not public.inv_can(public._inv_cap_for(v_type)) then
    raise exception 'Stock permission "%" is required.', public._inv_cap_for(v_type) using errcode = '42501';
  end if;
  if v_rec.id is not null and p ? 'expected_version' and (p->>'expected_version')::int is distinct from v_rec.version then
    raise exception 'Stock changed since you loaded it. Refresh and review the latest balance.' using errcode = 'PT409';
  end if;

  -- Currency: never converted inside inventory (refuse, balance unchanged).
  v_cur := coalesce(nullif(upper(btrim(p->>'currency')), ''), v_rec.currency, public.currency_for_country(coalesce(v_rec.country, v_loc_country)));
  if v_rec.currency is not null and v_cur is distinct from v_rec.currency then
    raise exception 'Currency % differs from this balance (%); inventory never converts currencies.', v_cur, v_rec.currency
      using errcode = '22023';
  end if;

  v_vq := coalesce(v_rec.valued_qty, 0); v_vv := coalesce(v_rec.valued_value, 0); v_uq := coalesce(v_rec.unvalued_qty, 0);
  v_po := coalesce(v_rec.pending_allocation_out_qty, 0); v_pi := coalesce(v_rec.pending_allocation_in_qty, 0);
  v_before  := coalesce(v_rec.qty_on_hand, 0);
  if v_type = 'opening' and v_rec.id is not null and v_po + v_pi > 0 then
    raise exception 'This balance has an undecided issue allocation; resolve it before an opening correction.' using errcode = '22023';
  end if;
  v_rbefore := coalesce(v_rec.qty_reserved, 0);

  -- ---- valuation (mirror of applyMovement) ----
  if v_type = 'reversal' then
    -- exact negation of the original (quantity, value, unvalued quantity)
    v_chg := -coalesce((p->>'orig_qty_change')::numeric, 0);
    v_unv_chg := -coalesce((p->>'orig_unvalued_qty_change')::numeric, 0);
    v_val_chg := -coalesce((p->>'orig_value_change')::numeric, 0);
    v_po_chg := -coalesce((p->>'orig_pending_out_change')::numeric, 0);
    v_pi_chg := -coalesce((p->>'orig_pending_in_change')::numeric, 0);
    -- qty_on_hand + out - in = valued + unvalued
    if v_vq + (v_chg - v_unv_chg + v_po_chg - v_pi_chg) < 0 or v_uq + v_unv_chg < 0
       or v_po + v_po_chg < 0 or v_pi + v_pi_chg < 0 then
      v_vq := null;  -- marks refusal below
    else
      v_vq := v_vq + (v_chg - v_unv_chg + v_po_chg - v_pi_chg); v_uq := v_uq + v_unv_chg; v_vv := round(v_vv + v_val_chg, 2);
      v_po := v_po + v_po_chg; v_pi := v_pi + v_pi_chg;
      if v_vq = 0 and v_vv <> 0 then
        v_var_kind := 'reversal_residual'; v_var_amt := v_vv; v_vv := 0;
      elsif v_vv < 0 then
        v_var_kind := 'reversal_negative_value'; v_var_amt := v_vv; v_vv := 0;
      end if;
      v_val_chg := round(v_vv - coalesce(v_rec.valued_value, 0), 2);
    end if;
    v_val_status := 'valued';
  elsif v_type = 'cost_allocation' then
    -- Approved split of an issue allocation (inv_cost_reconcile only). allocation_side
    -- 'source': the units left here undecided; 'holder': they arrived here by transfer.
    v_q := (p->>'qty')::numeric; v_a := (p->>'valued_qty')::numeric;
    if v_q is null or v_q <= 0 or v_a is null or v_a < 0 or v_a > v_q then
      raise exception 'A cost allocation needs qty > 0 and 0 <= valued_qty <= qty.' using errcode = '22023';
    end if;
    if p->>'allocation_side' = 'source' then
      -- The decided units must fit the buckets that still hold them. Units that
      -- arrived here undecided (pending_allocation_in_qty) are in neither bucket, so
      -- a split that needs them waits for that upstream allocation to be decided.
      if v_q > v_po or v_a > v_vq or v_q - v_a > v_uq then
        raise exception 'This split is not possible on the balance now (valued %, unvalued %, pending out %, pending in %); decide any upstream allocation first.',
          v_vq, v_uq, v_po, v_pi using errcode = '22023';
      end if;
      if v_a = 0 then v_alloc_val := null;
      elsif v_a = v_vq then v_alloc_val := v_vv; v_vq := 0; v_vv := 0;
      else v_alloc_val := round(v_a * v_vv / v_vq, 2); v_vq := v_vq - v_a; v_vv := round(v_vv - v_alloc_val, 2);
      end if;
      v_unit_applied := case when v_a > 0 then round(v_alloc_val / v_a, 4) end;
      v_val_chg := -v_alloc_val; v_uq := v_uq - (v_q - v_a); v_unv_chg := -(v_q - v_a);
      v_po := v_po - v_q; v_po_chg := -v_q;
    elsif p->>'allocation_side' = 'holder' then
      if v_q > v_pi then
        raise exception 'This balance does not hold % undecided units.', v_q using errcode = '22023';
      end if;
      v_alloc_val := case when v_a > 0 then round(coalesce((p->>'carried_value')::numeric, 0), 2) end;
      v_val_chg := v_alloc_val; v_vq := v_vq + v_a; v_vv := round(v_vv + coalesce(v_alloc_val, 0), 2);
      v_uq := v_uq + (v_q - v_a); v_unv_chg := v_q - v_a; v_pi := v_pi - v_q; v_pi_chg := -v_q;
      v_unit_applied := case when v_a > 0 then round(v_alloc_val / v_a, 4) end;
    else
      raise exception 'allocation_side must be source or holder.' using errcode = '22023';
    end if;
    v_val_status := 'valued';
  elsif v_kind = 'value' then
    if v_type = 'cost_assignment' then
      if v_po + v_pi > 0 then
        raise exception 'This balance has an undecided issue allocation; resolve it before assigning a cost.' using errcode = '22023';
      end if;
      if v_qty_val > v_uq then
        raise exception 'Cost assignment exceeds the unvalued quantity (%).', v_uq using errcode = '22023';
      end if;
      v_val_chg := round(v_qty_val * v_unit, 2);
      v_uq := v_uq - v_qty_val; v_vq := v_vq + v_qty_val; v_vv := round(v_vv + v_val_chg, 2);
      v_unv_chg := -v_qty_val; v_unit_applied := round(v_unit, 4);
    elsif v_vq <= 0 then
      -- nothing valued left to carry it: a variance against consumed stock, not inventory value
      v_val_chg := 0; v_var_kind := v_type || '_on_consumed_stock';
      v_var_amt := round(case when v_type = 'landed_cost' then v_value_in else -v_value_in end, 2);
    elsif v_type = 'landed_cost' then
      v_val_chg := round(v_value_in, 2); v_vv := round(v_vv + v_val_chg, 2);
    else -- supplier_credit: never below zero, excess is a variance
      v_val_chg := -round(least(v_value_in, v_vv), 2); v_vv := round(v_vv + v_val_chg, 2);
      if v_value_in > -v_val_chg then
        v_var_kind := 'supplier_credit_exceeds_stock_value'; v_var_amt := -round(v_value_in + v_val_chg, 2);
      end if;
    end if;
    v_val_status := 'valued';
  elsif v_chg > 0 then
    if v_type = 'transfer_in' and p ? 'carried_value' then
      -- cost travels with the units; unvalued units stay unvalued
      -- undecided units arrive in neither bucket (pending_allocation_in_qty)
      v_amb := least(greatest(coalesce((p->>'carried_pending_qty')::numeric, 0), 0), v_chg);
      v_unv_chg := least(coalesce((p->>'carried_unvalued_qty')::numeric, 0), v_chg - v_amb);
      v_val_chg := case when v_chg - v_unv_chg - v_amb > 0 then round(coalesce((p->>'carried_value')::numeric, 0), 2) end;
      v_vq := v_vq + (v_chg - v_unv_chg - v_amb); v_vv := round(v_vv + coalesce(v_val_chg, 0), 2); v_uq := v_uq + v_unv_chg;
      v_pi := v_pi + v_amb; v_pi_chg := v_amb;
      v_unit_applied := (p->>'unit_cost')::numeric;
    else
      if v_unit is null and v_type in ('issue_return', 'return', 'adjustment_up', 'stocktake', 'adjustment') then
        v_unit := case when v_vq > 0 then round(v_vv / v_vq, 4) end;
      end if;
      if v_unit is null then
        v_uq := v_uq + v_chg; v_unv_chg := v_chg; v_val_chg := null;
      else
        v_val_chg := round(v_chg * v_unit, 2); v_vq := v_vq + v_chg; v_vv := round(v_vv + v_val_chg, 2);
        v_unit_applied := round(v_unit, 4);
      end if;
    end if;
    v_val_status := case when v_amb > 0 then 'pending_allocation' when v_val_chg is null then 'unvalued' else 'valued' end;
  elsif v_chg < 0 then
    if -v_chg <= v_before then
      -- Owner decision 2026-11-20: no order is assumed on a balance holding BOTH valued
      -- and unvalued units (not priced-first, not unpriced-first, not proportional).
      -- maxv / maxu = the most units of each kind that can be on the shelf. Only what
      -- arithmetic proves moves now: the certainly valued part at the weighted
      -- average, the certainly unvalued part with a cost reconciliation. The rest is
      -- AMBIGUOUS: no value change, pending_allocation_out_qty += it, and
      -- _inv_cost_rec_track opens an 'issue_allocation' record for a person to decide.
      v_q := -v_chg;
      select coalesce((to_jsonb(mm)->>'serial_tracked')::boolean, false) or coalesce((to_jsonb(mm)->>'lot_tracked')::boolean, false)
        into v_tracked from public.material_master mm where mm.id = v_rec.item_id;
      v_tracked := coalesce(v_tracked, false);
      v_maxv := least(v_before, v_vq + v_pi); v_maxu := least(v_before, v_uq + v_pi);
      if nullif(p->>'source_receipt_movement_id', '') is not null then
        -- specific identification (serial / lot-tracked): the named receipt's actual cost
        select * into v_src_mov from public.stock_movements where id = (p->>'source_receipt_movement_id')::uuid;
        if v_src_mov.id is null or v_src_mov.stock_id is distinct from v_rec.id or v_src_mov.qty_change <= 0
           or v_src_mov.pending_in_change <> 0
           or exists (select 1 from public.stock_movements x where x.reverses_movement_id = v_src_mov.id) then
          raise exception 'The named receipt is not a live receipt of this balance.' using errcode = '22023';
        end if;
        select v_src_mov.qty_change - coalesce(sum(-x.qty_change), 0) into v_src_left from public.stock_movements x
         where x.source_receipt_movement_id = v_src_mov.id
           and not exists (select 1 from public.stock_movements y where y.reverses_movement_id = x.id);
        if v_q > v_src_left then
          raise exception 'Only % unit(s) of the named receipt remain.', v_src_left using errcode = '22023';
        end if;
        v_src_unit := case when v_src_mov.value_change is not null and v_src_mov.unvalued_qty_change = 0
                           then coalesce(v_src_mov.unit_cost, round(v_src_mov.value_change / v_src_mov.qty_change, 4)) end;
        if (v_src_unit is not null and v_q > v_vq) or (v_src_unit is null and v_q > v_uq) then
          raise exception 'The named receipt does not fit what this balance holds.' using errcode = '22023';
        end if;
        v_out_val := case when v_src_unit is not null then v_q else 0 end;
        v_out_unv := v_q - v_out_val; v_amb := 0;
      else
        if v_tracked and v_maxv > 0 and v_maxu > 0 then
          raise exception 'This item is serial or lot tracked: name the receipt the units come from (source_receipt_movement_id).'
            using errcode = '22023';
        end if;
        v_out_val := greatest(0, v_q - v_maxu); v_out_unv := greatest(0, v_q - v_maxv);
        v_amb := v_q - v_out_val - v_out_unv;
      end if;
      v_unit_applied := case when v_out_val > 0 then coalesce(v_src_unit, case when v_vq > 0 then round(v_vv / v_vq, 4) end) end;
      v_uq := v_uq - v_out_unv; v_unv_chg := -v_out_unv;
      v_po := v_po + v_amb; v_po_chg := v_amb;
      if v_out_val > 0 then
        if v_out_val = v_vq then v_out_value := v_vv; v_vq := 0; v_vv := 0;
        elsif v_src_unit is not null then
          v_out_value := least(round(v_out_val * v_src_unit, 2), v_vv); v_vq := v_vq - v_out_val; v_vv := round(v_vv - v_out_value, 2);
        else v_out_value := round(v_out_val * v_vv / v_vq, 2); v_vq := v_vq - v_out_val; v_vv := round(v_vv - v_out_value, 2);
        end if;
        v_val_chg := -v_out_value;
      else
        v_val_chg := null;
      end if;
      v_val_status := case when v_amb > 0 then 'pending_allocation'
                           when v_out_unv > 0 and v_val_chg is null then 'unvalued'
                           when v_out_unv > 0 then 'partially_valued' else 'valued' end;
      if v_type = 'supplier_return' and (p->>'credit_unit_cost') is not null and v_val_chg is not null then
        v_var_kind := 'supplier_return_price_variance';
        v_var_amt := round((p->>'credit_unit_cost')::numeric * v_out_val + v_val_chg, 2);
      end if;
    end if;
  else
    v_val_chg := case when v_rchg <> 0 then null else 0 end;
    v_val_status := 'valued';
  end if;
  if v_type = 'cost_allocation' then
    v_m_vq := v_a; v_m_uq := v_q - v_a;
  elsif v_kind = 'value' then
    v_m_vq := case when v_type = 'cost_assignment' then coalesce(v_qty_val, 0) else 0 end;
  elsif v_vq is not null then
    v_m_uq := abs(coalesce(v_unv_chg, 0));
    v_m_vq := greatest(abs(v_chg) - v_m_uq - abs(coalesce(v_po_chg, 0)) - abs(coalesce(v_pi_chg, 0)), 0);
  end if;
  -- Approved opening with a line cost also prices units still unvalued on the balance.
  if v_type = 'opening' and v_unit is not null and v_uq > 0 and v_vq is not null then
    v_val_chg := coalesce(v_val_chg, 0) + round(v_uq * v_unit, 2);
    v_m_vq := v_m_vq + v_uq;
    v_vq := v_vq + v_uq; v_vv := round(v_vv + v_uq * v_unit, 2); v_unv_chg := v_unv_chg - v_uq; v_uq := 0;
    v_unit_applied := round(v_unit, 4); v_val_status := 'valued';
  end if;

  v_after  := v_before + v_chg;
  v_rafter := v_rbefore + v_rchg;
  if v_rafter < 0 then
    raise exception 'Cannot release or consume more than is reserved (reserved %).', v_rbefore using errcode = '22023';
  end if;

  -- No negative physical stock and no admin override (owner correction 1).
  if v_rec.id is null or v_vq is null or v_after < 0 or v_rafter > v_after then
    insert into public.stock_exceptions(organisation_id, country, site, exception_type, stock_id, item_id, location_id,
      qty, qty_requested, qty_available, movement_type, source_doc_type, source_doc_id, idempotency_key, payload_hash, notes)
    values (v_org, coalesce(v_rec.country, v_loc_country), coalesce(v_rec.site, v_loc_site), 'shortage', v_rec.id,
      coalesce(v_rec.item_id, v_item_id), coalesce(v_rec.location_id, v_loc_id),
      greatest(v_rafter - v_after, -v_after, 0), abs(v_chg) + abs(v_rchg), greatest(v_before - v_rbefore, 0), v_type,
      nullif(p->>'source_doc_type', ''), nullif(p->>'source_doc_id', ''), v_key, v_hash, nullif(btrim(p->>'reason'), ''))
    returning id into v_exc_id;
    return jsonb_build_object('status','refused_shortage','exception_id',v_exc_id,'stock_id',v_rec.id,
      'qty_on_hand',v_before,'qty_reserved',v_rbefore,'qty_available',greatest(v_before - v_rbefore, 0),
      'qty_requested',abs(v_chg) + abs(v_rchg));
  end if;

  v_avg := case when v_vq > 0 then round(v_vv / v_vq, 4) end;
  v_status := case when v_after <= coalesce(v_rec.critical_level, 0) then 'Critical'
                   when v_after <= coalesce(v_rec.min_level, 0) then 'Low' else 'OK' end;

  perform set_config('inv.posting', 'on', true);
  insert into public.stock_movements(stock_id, site, description, movement_type, qty_before, qty_change, qty_after,
    reason, reference_no, created_by, organisation_id, country, item_id, location_id, posted_at, effective_at,
    unit_cost, value_change, unvalued_qty_change, valuation_status, variance_kind, variance_amount, currency, ownership,
    source_doc_type, source_doc_id, idempotency_key, payload_hash, reverses_movement_id, actor_id, approval_ref, reserved_change,
    valued_qty, unvalued_qty, pending_out_change, pending_in_change, source_receipt_movement_id)
  values (v_rec.id, v_rec.site, v_rec.description, v_type, v_before, v_chg, v_after,
    nullif(btrim(p->>'reason'), ''), nullif(btrim(p->>'reference_no'), ''), v_uid, v_org, v_rec.country,
    v_rec.item_id, v_rec.location_id, clock_timestamp(),
    coalesce(nullif(p->>'effective_at', '')::timestamptz, clock_timestamp()),
    v_unit_applied, v_val_chg, v_unv_chg, v_val_status, v_var_kind, v_var_amt, v_cur, v_rec.ownership,
    nullif(p->>'source_doc_type', ''), nullif(p->>'source_doc_id', ''),
    v_key, v_hash, nullif(p->>'reverses_movement_id', '')::uuid, v_uid, nullif(p->>'approval_ref', ''), v_rchg,
    v_m_vq, v_m_uq, coalesce(v_po_chg, 0), coalesce(v_pi_chg, 0), v_src_mov.id)
  returning * into v_mov;
  -- Unknown cost is never silently valued: open / move / consume cost reconciliations
  -- (no-op stub here; the real body arrives with 20261120104000_inv_valuation).
  perform public._inv_cost_rec_track(v_mov, p);

  update public.stock_records set
    qty_on_hand = v_after, stock_qty = floor(v_after)::integer, qty_reserved = v_rafter,
    valued_qty = v_vq, valued_value = v_vv, unvalued_qty = v_uq,
    pending_allocation_out_qty = v_po, pending_allocation_in_qty = v_pi,
    avg_unit_cost = v_avg, unit_cost = v_avg, currency = coalesce(currency, v_cur),
    stock_status = v_status, version = version + 1, updated_by = v_uid, updated_at = clock_timestamp(),
    last_counted_at = case when v_type = 'stocktake' then clock_timestamp() else last_counted_at end,
    last_receipt_at = case when v_chg > 0 and v_type not in ('transfer_in','stocktake','adjustment','adjustment_up','reversal')
                           then clock_timestamp() else last_receipt_at end,
    last_issue_at = case when v_type in ('issue','supplier_return','scrap') then clock_timestamp() else last_issue_at end
  where id = v_rec.id;
  perform set_config('inv.posting', '', true);

  return public._inv_movement_json(v_mov) || jsonb_build_object('qty_on_hand', v_after, 'qty_reserved', v_rafter,
    'valued_qty', v_vq, 'valued_value', v_vv, 'unvalued_qty', v_uq,
    'pending_allocation_out_qty', v_po, 'pending_allocation_in_qty', v_pi,
    'avg_unit_cost', v_avg, 'version', v_rec.version + 1, 'stock_status', v_status);
end $fn$;
revoke all on function public._inv_post(jsonb, boolean) from public, anon, authenticated;

create or replace function public.inv_post_movement(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not public.is_approved_and_unlocked() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p->>'movement_type', ''))) in ('reversal', 'opening') then
    raise exception 'Use inv_reverse_movement or an approved opening balance batch for this movement type.' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p->>'movement_type', ''))) in ('cost_assignment', 'cost_allocation') then
    -- Owner decision 2026-11-20: nothing becomes valued without an approved cost reconciliation.
    raise exception 'Unvalued stock is valued only through an approved cost reconciliation (inv_cost_reconcile).' using errcode = '22023';
  end if;
  return public._inv_post(p - 'reverses_movement_id' - 'orig_qty_change' - 'orig_unvalued_qty_change' - 'orig_value_change'
    - 'orig_pending_out_change' - 'orig_pending_in_change' - 'carried_value' - 'carried_unvalued_qty' - 'carried_pending_qty'
    - 'carried_from_stock_id' - 'carried_movement_id', true);
end $fn$;

create or replace function public.inv_reverse_movement(p_movement_id uuid, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_m public.stock_movements%rowtype; v_r public.stock_movements%rowtype;
  v_unv numeric; v_val numeric; v_po numeric;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('adjustment_approve') then
    raise exception 'Stock permission "adjustment_approve" is required to reverse a movement.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reversal needs a reason.' using errcode = '22023';
  end if;
  select * into v_m from public.stock_movements where id = p_movement_id;
  if not found or v_m.organisation_id is distinct from public.app_current_org() then
    raise exception 'Movement not found.' using errcode = 'P0002';
  end if;
  if v_m.movement_type = 'reversal' then
    raise exception 'A reversal cannot itself be reversed; post a new correcting movement.' using errcode = '22023';
  end if;
  if v_m.movement_type = 'cost_allocation' then
    raise exception 'An approved cost allocation is undone by reversing the original movement.' using errcode = '22023';
  end if;
  if v_m.movement_type in ('transfer_out', 'transfer_in') and (v_m.pending_out_change <> 0 or v_m.pending_in_change <> 0) then
    raise exception 'This transfer carried units with an undecided split; transfer them back instead of reversing.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_movements where reverses_movement_id = p_movement_id) then
    raise exception 'This movement was already reversed.' using errcode = '23505';
  end if;
  if v_m.qty_change = 0 and v_m.reserved_change = 0 then
    raise exception 'A value-only movement is corrected by a new value movement, not reversed.' using errcode = '22023';
  end if;
  if v_m.qty_change = 0 then
    return public._inv_post(jsonb_build_object('idempotency_key', p_idempotency_key, 'stock_id', v_m.stock_id,
      'movement_type', case when v_m.reserved_change > 0 then 'release' else 'reserve' end,
      'qty_change', 0, 'reserved_change', -v_m.reserved_change, 'reason', 'Reversal: ' || p_reason,
      'source_doc_type', 'reversal', 'source_doc_id', v_m.id::text), false);
  end if;
  -- An undecided issue allocation: reverse the movement together with its approved
  -- split when there is one, else take the pending units back.
  v_unv := v_m.unvalued_qty_change; v_val := v_m.value_change; v_po := v_m.pending_out_change;
  if v_m.pending_out_change > 0 then
    select * into v_r from public.stock_movements where movement_type = 'cost_allocation'
       and source_doc_type = 'issue_allocation' and source_doc_id = v_m.id::text and stock_id = v_m.stock_id;
    if v_r.id is not null then
      v_unv := v_unv + v_r.unvalued_qty_change; v_po := v_po + v_r.pending_out_change;
      v_val := case when v_val is null and v_r.value_change is null then null
                    else coalesce(v_val, 0) + coalesce(v_r.value_change, 0) end;
    end if;
  end if;
  return public._inv_post(jsonb_build_object('idempotency_key', p_idempotency_key, 'stock_id', v_m.stock_id,
    'movement_type', 'reversal', 'qty_change', -v_m.qty_change, 'reserved_change', -v_m.reserved_change,
    'orig_qty_change', v_m.qty_change, 'orig_unvalued_qty_change', v_unv,
    'orig_pending_out_change', v_po, 'orig_pending_in_change', v_m.pending_in_change,
    'orig_value_change', v_val, 'currency', v_m.currency,
    'reverses_movement_id', v_m.id, 'reason', 'Reversal: ' || p_reason,
    'source_doc_type', 'reversal', 'source_doc_id', v_m.id::text), false);
end $fn$;

create or replace function public.inv_exception_resolve(p_id uuid, p_status text, p_notes text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.stock_exceptions%rowtype;
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('discrepancy_review') or public.inv_can('adjustment_approve')) then
    raise exception 'Stock permission "discrepancy_review" is required.' using errcode = '42501';
  end if;
  if p_status not in ('resolved', 'cancelled') or nullif(btrim(p_notes), '') is null then
    raise exception 'Choose resolved or cancelled and give a note.' using errcode = '22023';
  end if;
  update public.stock_exceptions set status = p_status, notes = concat_ws(E'\n', notes, btrim(p_notes)),
    resolved_by = auth.uid(), resolved_at = now()
   where id = p_id and organisation_id = public.app_current_org() and status = 'open'
  returning * into v;
  if not found then raise exception 'Open exception not found.' using errcode = 'P0002'; end if;
  return to_jsonb(v);
end $fn$;

-- ---------------------------------------------------------------------------
-- 5. Legacy writers -> wrappers (signatures unchanged for old web/Flutter)
-- ---------------------------------------------------------------------------
create or replace function public.post_stock_movement(p_stock_id uuid, p_type text, p_qty numeric,
  p_reason text default null, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_type text := lower(btrim(p_type)); v_kind text; v_r jsonb;
begin
  if not public.is_approved_and_unlocked() then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if p_stock_id is null then raise exception 'stock_id is required.' using errcode = '22004'; end if;
  v_kind := public.inv_movement_kind(v_type);
  if v_kind not in ('in', 'out') or v_type in ('opening', 'consignment_receipt') then
    raise exception 'Unknown movement_type "%".', p_type using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be a positive magnitude (got %).', p_qty using errcode = '22023';
  end if;
  -- Legacy callers send no idempotency key: each call is a new posting (as before).
  v_r := public._inv_post(jsonb_build_object('idempotency_key', 'legacy-psm:' || gen_random_uuid()::text,
    'stock_id', p_stock_id, 'movement_type', v_type,
    'qty_change', case when v_kind = 'in' then p_qty else -p_qty end,
    'reason', p_reason, 'reference_no', p_reference, 'source_doc_type', 'post_stock_movement'), false);
  if v_r->>'status' = 'refused_shortage' then
    raise exception 'Movement would drive stock negative (on hand %, available %). Negative stock is not allowed; a shortage was not recorded because this call was refused.',
      v_r->>'qty_on_hand', v_r->>'qty_available' using errcode = '23514';
  end if;
  return jsonb_build_object('status','posted','movement_id',v_r->'movement_id','stock_id',p_stock_id,
    'qty_before',v_r->'qty_before','qty_change',v_r->'qty_change','qty_after',v_r->'qty_after',
    'stock_status',v_r->'stock_status');
end $fn$;

-- A direct count is an unreviewed adjustment, so it now needs the count
-- capability or an elevated role (blind audits replace it: 20261120102000).
create or replace function public.set_stock_count(p_stock_id uuid, p_count numeric, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_rec public.stock_records%rowtype; v_r jsonb; v_change numeric;
begin
  if not public.is_approved_and_unlocked() then raise exception 'Not authorised.' using errcode = '42501'; end if;
  if not (public.app_is_elevated() or public.inv_can('count')) then
    raise exception 'Stock count permission is required. Use a physical audit session.' using errcode = '42501';
  end if;
  if p_stock_id is null then raise exception 'stock_id is required.' using errcode = '22004'; end if;
  if p_count is null or p_count < 0 then
    raise exception 'Count must be zero or positive (got %).', p_count using errcode = '22023';
  end if;
  select * into v_rec from public.stock_records where id = p_stock_id for update;
  if not found then raise exception 'Stock record % not found.', p_stock_id using errcode = 'P0002'; end if;
  if v_rec.organisation_id is distinct from public.app_current_org() then
    raise exception 'Cross-organisation stock update denied.' using errcode = '42501';
  end if;
  if not public._inv_scope_ok(v_rec.country, v_rec.site)
     or public.inv_blind_hides_balance(v_rec.organisation_id, v_rec.site, v_rec.location_id, v_rec.item_id) then
    raise exception 'Cross-country stock update denied.' using errcode = '42501';
  end if;
  if p_count < v_rec.qty_reserved then
    raise exception 'Count % is below the reserved quantity %; release the reservation first.', p_count, v_rec.qty_reserved
      using errcode = '23514';
  end if;
  v_change := p_count - v_rec.qty_on_hand;
  if v_change = 0 then
    perform set_config('inv.posting', 'on', true);
    update public.stock_records set last_counted_at = clock_timestamp(), updated_by = auth.uid() where id = p_stock_id;
    perform set_config('inv.posting', '', true);
    return jsonb_build_object('status','counted','movement_id',null,'stock_id',p_stock_id,'qty_before',v_rec.qty_on_hand,
      'qty_change',0,'qty_after',v_rec.qty_on_hand,'stock_status',v_rec.stock_status);
  end if;
  v_r := public._inv_post(jsonb_build_object('idempotency_key', 'legacy-count:' || gen_random_uuid()::text,
    'stock_id', p_stock_id, 'movement_type', 'stocktake', 'qty_change', v_change, 'reason', p_reason,
    'source_doc_type', 'set_stock_count'), false);
  return jsonb_build_object('status','counted','movement_id',v_r->'movement_id','stock_id',p_stock_id,
    'qty_before',v_r->'qty_before','qty_change',v_r->'qty_change','qty_after',v_r->'qty_after','stock_status',v_r->'stock_status');
end $fn$;

-- save_stock_entry: live body (md5 964c2e8c...) kept line for line; only the
-- direct INSERT into stock_movements + UPDATE of stock_qty became one
-- _inv_post call keyed on the request id.
create or replace function public.save_stock_entry(p_request_id uuid, p_country text, p_site text, p_mode text,
  p_reference text, p_notes text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
DECLARE v_org uuid:=app_current_org(); v_uid uuid:=auth.uid(); l jsonb; d jsonb; meta jsonb; r stock_records%ROWTYPE;
 req stock_entry_requests%ROWTYPE; fingerprint text; out jsonb:='[]'; seen text[]:='{}'; key text;
 qty numeric; before_qty numeric; after_qty numeric; change_qty numeric; movement uuid; v_post jsonb;
BEGIN
 IF v_uid IS NULL OR v_org IS NULL OR (is_approved_and_unlocked() IS NOT TRUE) OR (app_user_can('stock','view') IS NOT TRUE) THEN RAISE EXCEPTION 'Stock access is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR nullif(btrim(p_country),'') IS NULL OR p_country='All' OR (app_write_country_ok(p_country) IS NOT TRUE)
 OR nullif(btrim(p_site),'') IS NULL OR NOT (coalesce(app_sees_all_sites(),false) OR upper(btrim(p_site))=ANY(coalesce(app_site_scope(),'{}'::text[]))) THEN RAISE EXCEPTION 'Choose a permitted country and site.' USING ERRCODE='42501'; END IF;
 IF p_mode NOT IN ('count','receipt') OR p_mode IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid entry.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR length(coalesce(p_notes,''))>1000 OR length(coalesce(p_reference,''))>200
 OR (p_mode='receipt' AND nullif(btrim(p_reference),'') IS NULL) THEN RAISE EXCEPTION 'Check item count and receipt reference.' USING ERRCODE='22023'; END IF;
 fingerprint:=md5(jsonb_build_array(p_country,btrim(p_site),p_mode,p_reference,p_notes,p_lines)::text);
 INSERT INTO stock_entry_requests(id,organisation_id,country,site,created_by,payload_hash) VALUES(p_request_id,v_org,p_country,btrim(p_site),v_uid,fingerprint) ON CONFLICT DO NOTHING;
 SELECT * INTO req FROM stock_entry_requests WHERE id=p_request_id FOR UPDATE;
 IF req.organisation_id IS DISTINCT FROM v_org OR req.created_by IS DISTINCT FROM v_uid OR req.payload_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'This request identifier was already used. Review the entry again.' USING ERRCODE='23505'; END IF;
 IF req.result IS NOT NULL THEN RETURN req.result||jsonb_build_object('replayed',true); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text||p_country||upper(btrim(p_site)),0));
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY coalesce(value->>'stock_id',value->>'source_id',value->>'name') LOOP
  IF coalesce(l->>'quantity','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Enter a whole quantity.' USING ERRCODE='22023'; END IF;
  qty:=(l->>'quantity')::numeric;
  IF qty>2147483647 OR (p_mode='receipt' AND qty=0) THEN RAISE EXCEPTION 'Quantity is outside the allowed range.' USING ERRCODE='22023'; END IF;
  IF l->>'unit' IS NULL OR l->>'unit' NOT IN ('PCS','SET','PAIR','BOX','KG','L') THEN RAISE EXCEPTION 'Confirm the unit of measure.' USING ERRCODE='22023'; END IF;
  r:=NULL;
  IF nullif(l->>'stock_id','') IS NOT NULL THEN
   IF (app_user_can('stock','edit') IS NOT TRUE) THEN RAISE EXCEPTION 'Stock edit permission is required.' USING ERRCODE='42501'; END IF;
   SELECT * INTO r FROM stock_records WHERE id=(l->>'stock_id')::uuid FOR UPDATE;
   IF r.id IS NULL OR r.organisation_id IS DISTINCT FROM v_org OR r.country IS DISTINCT FROM p_country OR upper(btrim(r.site)) IS DISTINCT FROM upper(btrim(p_site)) THEN RAISE EXCEPTION 'Stock item is outside this store.' USING ERRCODE='42501'; END IF;
   IF inv_blind_hides_balance(r.organisation_id,r.site,r.location_id,r.item_id) THEN RAISE EXCEPTION 'Stock item is outside this store.' USING ERRCODE='42501'; END IF;
   IF (l->>'expected_qty')::numeric IS DISTINCT FROM r.qty_on_hand OR (l->>'expected_updated_at')::timestamptz IS DISTINCT FROM r.updated_at THEN RAISE EXCEPTION 'Stock changed while you were counting. Refresh and review the latest balance.' USING ERRCODE='PT409'; END IF;
   meta:=coalesce(r.custom_data->'stock_item','{}');
   IF nullif(meta->>'unit','') IS NOT NULL AND meta->>'unit'<>l->>'unit' THEN RAISE EXCEPTION 'The recorded unit cannot be changed during a count.' USING ERRCODE='22023'; END IF;
   key:='stock:'||r.id;
  ELSE
   IF (app_user_can('stock','create') IS NOT TRUE) THEN RAISE EXCEPTION 'Stock create permission is required.' USING ERRCODE='42501'; END IF;
   IF l->>'source'='manual' THEN
    IF l->>'kind' IS NULL OR l->>'kind' NOT IN ('tyre','rim','accessory') OR nullif(btrim(l->>'name'),'') IS NULL OR l->>'name' ~* '\m(filter|lubricant|coolant|engine oil|hydraulic oil|labour|labor|service|fitting charge)\M' OR length(l->>'name')>500 OR length(coalesce(l->>'code',''))>100 THEN RAISE EXCEPTION 'Check the manual item details.' USING ERRCODE='22023'; END IF;
    d:=l||jsonb_build_object('key',CASE WHEN nullif(btrim(l->>'code'),'') IS NOT NULL THEN 'code:'||upper(btrim(l->>'code')) ELSE 'manual:'||md5(upper(jsonb_build_array(btrim(l->>'name'),l->>'brand',l->>'size',l->>'kind')::text)) END);
   ELSE d:=stock_entry_resolve(l->>'source',l->>'source_id',p_country,p_site);
   END IF;
   IF d IS NULL THEN RAISE EXCEPTION 'This MIS/DTR item is unavailable in your scope. Search again.' USING ERRCODE='42501'; END IF;
   IF coalesce(l->>'condition','') NOT IN ('New','Serviceable','Retread','Unspecified') OR length(coalesce(l->>'bin',''))>80 THEN RAISE EXCEPTION 'Check condition and bin.' USING ERRCODE='22023'; END IF;
   key:=(d->>'key')||'|'||coalesce(l->>'condition','Unspecified')||'|'||upper(btrim(coalesce(l->>'bin','')));
   IF EXISTS(SELECT 1 FROM stock_records s WHERE s.organisation_id=v_org AND s.country=p_country AND upper(btrim(s.site))=upper(btrim(p_site)) AND
    (s.custom_data->'stock_item'->>'key'=key OR (s.custom_data->'stock_item' IS NULL AND lower(btrim(s.description))=lower(btrim(d->>'name'))))) THEN
    RAISE EXCEPTION 'This item already has a stock record. Select it from Existing stock and review its balance.' USING ERRCODE='23505'; END IF;
   meta:=jsonb_build_object('key',key,'code',d->>'code','kind',d->>'kind','unit',l->>'unit','condition',l->>'condition','bin',btrim(coalesce(l->>'bin','')),'source',d);
   INSERT INTO stock_records(organisation_id,country,region,site,description,brand,tyre_size,stock_qty,min_level,critical_level,custom_data,updated_by,condition,uom)
    VALUES(v_org,p_country,p_country,btrim(p_site),d->>'name',coalesce(d->>'brand',l->>'brand'),coalesce(d->>'size',l->>'size'),0,0,0,jsonb_build_object('stock_item',meta),v_uid,
      lower(coalesce(l->>'condition','Unspecified')),l->>'unit') RETURNING * INTO r;
  END IF;
  IF key=ANY(seen) THEN RAISE EXCEPTION 'Duplicate item in this batch.' USING ERRCODE='23505'; END IF;
  seen:=array_append(seen,key);
  IF EXISTS(SELECT 1 FROM workflow_instances w WHERE w.organisation_id=v_org AND w.entity_type='stock_issue' AND w.entity_id=r.id::text AND w.status IN ('pending','in_review','returned','approved')) THEN
   RAISE EXCEPTION 'An approval workflow protects this stock record.' USING ERRCODE='PT423'; END IF;
  before_qty:=coalesce(r.qty_on_hand,0); after_qty:=CASE WHEN p_mode='count' THEN qty ELSE before_qty+qty END;
  change_qty:=after_qty-before_qty;
  movement:=NULL;
  IF change_qty<>0 THEN
   v_post:=_inv_post(jsonb_build_object('idempotency_key','save_stock_entry:'||p_request_id::text||':'||r.id::text,
     'stock_id',r.id,'movement_type',CASE WHEN p_mode='count' THEN 'stocktake' ELSE 'receipt' END,'qty_change',change_qty,
     'reason',concat_ws(': ',CASE WHEN p_mode='count' THEN 'Physical stock count' ELSE 'Stock receipt' END,nullif(btrim(p_notes),'')),
     'reference_no',coalesce(nullif(btrim(p_reference),''),'COUNT-'||p_request_id::text),
     'source_doc_type','save_stock_entry','source_doc_id',p_request_id::text),false);
   IF v_post->>'status'='refused_shortage' THEN RAISE EXCEPTION 'Count is below the reserved quantity for this item.' USING ERRCODE='23514'; END IF;
   movement:=(v_post->>'movement_id')::uuid;
  END IF;
  PERFORM set_config('inv.posting','on',true);
  UPDATE stock_records SET custom_data=jsonb_set(coalesce(custom_data,'{}'),'{stock_item}',meta||jsonb_build_object('unit',l->>'unit')),
   updated_by=v_uid,updated_at=clock_timestamp(),last_counted_at=CASE WHEN p_mode='count' THEN clock_timestamp() ELSE last_counted_at END WHERE id=r.id;
  PERFORM set_config('inv.posting','',true);
  PERFORM record_audit_event('stock_quick_entry','stock_records',r.id::text,jsonb_build_object('qty_before',before_qty),jsonb_build_object('request_id',p_request_id,'movement_id',movement,'mode',p_mode,'qty_after',after_qty,'source',meta->'source'));
  out:=out||jsonb_build_array(jsonb_build_object('stock_id',r.id,'movement_id',movement,'qty_before',before_qty,'qty_after',after_qty,'qty_change',change_qty));
 END LOOP;
 UPDATE stock_entry_requests SET result=jsonb_build_object('status','posted','request_id',p_request_id,'items',out) WHERE id=p_request_id RETURNING result INTO d;
 RETURN d;
END;
$function$;

-- transfer_stock_entry: live body (md5 34faec25...) kept; the two inserts +
-- update became two _inv_post legs; the receiving leg carries the sending
-- leg's unit cost so value moves with the goods.
create or replace function public.transfer_stock_entry(p_request_id uuid, p_from uuid, p_to uuid, p_qty integer,
  p_expected_from integer, p_expected_to integer, p_notes text default ''::text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
DECLARE a stock_records%ROWTYPE; b stock_records%ROWTYPE; req stock_entry_requests%ROWTYPE; h text; ma jsonb; mb jsonb; v_result jsonb; v_out jsonb; v_in jsonb;
BEGIN
 IF auth.uid() IS NULL OR app_current_org() IS NULL OR (is_approved_and_unlocked() IS NOT TRUE) OR (app_user_can('stock','edit') IS NOT TRUE) THEN RAISE EXCEPTION 'Stock edit permission is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from=p_to OR p_qty IS NULL OR p_qty<=0 OR length(coalesce(p_notes,''))>1000 THEN RAISE EXCEPTION 'Check transfer items and quantity.' USING ERRCODE='22023'; END IF;
 PERFORM id FROM stock_records WHERE id IN (p_from,p_to) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM stock_records WHERE id=p_from; SELECT * INTO b FROM stock_records WHERE id=p_to;
 IF a.id IS NULL OR b.id IS NULL OR a.organisation_id IS DISTINCT FROM app_current_org() OR b.organisation_id IS DISTINCT FROM app_current_org()
 OR a.country IS NULL OR b.country IS NULL OR nullif(btrim(a.site),'') IS NULL OR nullif(btrim(b.site),'') IS NULL OR a.country IS DISTINCT FROM b.country OR (app_write_country_ok(a.country) IS NOT TRUE) OR (app_write_country_ok(b.country) IS NOT TRUE)
 OR NOT (coalesce(app_sees_all_sites(),false) OR (upper(btrim(a.site))=ANY(coalesce(app_site_scope(),'{}'::text[])) AND upper(btrim(b.site))=ANY(coalesce(app_site_scope(),'{}'::text[])))) THEN RAISE EXCEPTION 'Transfer items are outside your scope.' USING ERRCODE='42501'; END IF;
 IF upper(btrim(a.site))=upper(btrim(b.site)) THEN RAISE EXCEPTION 'Choose different source and destination sites.' USING ERRCODE='22023'; END IF;
 IF inv_blind_hides_balance(a.organisation_id,a.site,a.location_id,a.item_id) OR inv_blind_hides_balance(b.organisation_id,b.site,b.location_id,b.item_id) THEN RAISE EXCEPTION 'Transfer items are outside your scope.' USING ERRCODE='42501'; END IF;
 h:=md5(jsonb_build_array('transfer',p_from,p_to,p_qty,p_expected_from,p_expected_to,p_notes)::text);
 INSERT INTO stock_entry_requests(id,organisation_id,country,site,created_by,payload_hash) VALUES(p_request_id,app_current_org(),a.country,a.site,auth.uid(),h) ON CONFLICT DO NOTHING;
 SELECT * INTO req FROM stock_entry_requests WHERE id=p_request_id FOR UPDATE;
 IF req.organisation_id IS DISTINCT FROM app_current_org() OR req.created_by IS DISTINCT FROM auth.uid() OR req.payload_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'Transfer request identifier was already used.' USING ERRCODE='23505'; END IF;
 IF req.result IS NOT NULL THEN RETURN req.result||jsonb_build_object('replayed',true); END IF;
 ma:=coalesce(a.custom_data->'stock_item','{}'); mb:=coalesce(b.custom_data->'stock_item','{}');
 IF coalesce(ma->>'unit','')<>coalesce(mb->>'unit','') OR coalesce(ma->>'condition','Unspecified')<>coalesce(mb->>'condition','Unspecified')
 OR (CASE WHEN nullif(ma->>'code','') IS NOT NULL AND nullif(mb->>'code','') IS NOT NULL THEN upper(ma->>'code')<>upper(mb->>'code')
 ELSE regexp_replace(upper(coalesce(a.description,'')),'[^A-Z0-9]','','g')<>regexp_replace(upper(coalesce(b.description,'')),'[^A-Z0-9]','','g')
  OR coalesce(a.brand,'')<>coalesce(b.brand,'') OR coalesce(a.tyre_size,'')<>coalesce(b.tyre_size,'') END) THEN
 RAISE EXCEPTION 'Select the same item, condition and unit at the destination.' USING ERRCODE='22023'; END IF;
 IF a.stock_qty IS DISTINCT FROM p_expected_from OR b.stock_qty IS DISTINCT FROM p_expected_to THEN RAISE EXCEPTION 'Stock changed. Refresh and review the transfer.' USING ERRCODE='PT409'; END IF;
 IF p_qty>(a.qty_on_hand-a.qty_reserved) OR b.stock_qty::bigint+p_qty>2147483647 THEN RAISE EXCEPTION 'Insufficient stock or quantity outside the allowed range.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM workflow_instances WHERE organisation_id=app_current_org() AND entity_type IN ('tyre_transfer','stock_issue') AND entity_id IN (p_from::text,p_to::text) AND status IN ('pending','in_review','returned','approved')) THEN RAISE EXCEPTION 'An approval workflow protects this transfer.' USING ERRCODE='PT423'; END IF;
 v_out:=_inv_post(jsonb_build_object('idempotency_key','transfer:'||p_request_id::text||':out','stock_id',a.id,'movement_type','transfer_out',
   'qty_change',-p_qty,'reason',concat('Transfer to ',b.site,': ',p_notes),'reference_no','TRANSFER-'||p_request_id::text,
   'source_doc_type','transfer_stock_entry','source_doc_id',p_request_id::text),false);
 v_in:=_inv_post(jsonb_build_object('idempotency_key','transfer:'||p_request_id::text||':in','stock_id',b.id,'movement_type','transfer_in',
   'qty_change',p_qty,'unit_cost',v_out->'unit_cost','currency',v_out->>'currency',
   'carried_value',-coalesce((v_out->>'value_change')::numeric,0),'carried_unvalued_qty',-coalesce((v_out->>'unvalued_qty_change')::numeric,0),'carried_from_stock_id',a.id,
   'carried_pending_qty',coalesce((v_out->>'pending_out_change')::numeric,0),'carried_movement_id',v_out->>'movement_id','reason',concat('Transfer from ',a.site,': ',p_notes),
   'reference_no','TRANSFER-'||p_request_id::text,'source_doc_type','transfer_stock_entry','source_doc_id',p_request_id::text),false);
 PERFORM record_audit_event('stock_transfer','stock_records',p_from::text,jsonb_build_object('from_qty',a.stock_qty,'to_qty',b.stock_qty),jsonb_build_object('from_id',p_from,'to_id',p_to,'qty',p_qty,'request_id',p_request_id));
 v_result:=jsonb_build_object('status','posted','from_stock_id',p_from,'to_stock_id',p_to,'qty',p_qty);
 UPDATE stock_entry_requests SET result=v_result WHERE id=p_request_id;
 RETURN v_result;
END;
$function$;

-- Reservations now hold qty_reserved on stock_records (never consume on hand,
-- never touch the legacy `stock` table). 0 live rows, so the FK repoint is safe.
alter table public.work_order_stock_reservation_lines drop constraint if exists work_order_stock_reservation_lines_stock_id_fkey;
alter table public.work_order_stock_reservation_lines add constraint work_order_stock_reservation_lines_stock_id_fkey
  foreign key (stock_id) references public.stock_records(id) on delete restrict;

create or replace function private.reserve_work_order_stock_internal(p_work_order_id uuid, p_lines jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_reservation public.work_order_stock_reservations;
  v_line record; v_post jsonb;
begin
  if v_actor is null or v_org is null then
    raise exception 'Authentication and organisation membership are required' using errcode = '42501';
  end if;
  if p_work_order_id is null or nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 160 then
    raise exception 'A work order and valid idempotency key are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one stock item is required' using errcode = '22023';
  end if;
  perform 1 from public.work_orders where id = p_work_order_id and organisation_id = v_org for update;
  if not found then raise exception 'Work order not found or inaccessible' using errcode = 'P0002'; end if;
  select * into v_reservation from public.work_order_stock_reservations
   where organisation_id = v_org and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reservation_id', v_reservation.id, 'work_order_id', v_reservation.work_order_id,
      'status', v_reservation.status, 'idempotent', true);
  end if;
  if exists (select 1 from public.work_order_stock_reservations
             where organisation_id = v_org and work_order_id = p_work_order_id and status = 'reserved') then
    raise exception 'This work order already has an active stock reservation' using errcode = '23505';
  end if;
  insert into public.work_order_stock_reservations(organisation_id, work_order_id, idempotency_key, reserved_by)
  values (v_org, p_work_order_id, btrim(p_idempotency_key), v_actor) returning * into v_reservation;
  for v_line in
    select (x->>'stock_id')::uuid as stock_id, sum((x->>'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) x group by (x->>'stock_id')::uuid order by (x->>'stock_id')::uuid
  loop
    if v_line.qty is null or v_line.qty <> trunc(v_line.qty) or v_line.qty <= 0 or v_line.qty > 100000 then
      raise exception 'Reservation quantity must be a whole number between 1 and 100000' using errcode = '22023';
    end if;
    v_post := public._inv_post(jsonb_build_object('idempotency_key', 'wo-reserve:' || v_reservation.id::text || ':' || v_line.stock_id::text,
      'stock_id', v_line.stock_id, 'movement_type', 'reserve', 'qty_change', 0, 'reserved_change', v_line.qty,
      'source_doc_type', 'work_order', 'source_doc_id', p_work_order_id::text), false);
    if v_post->>'status' = 'refused_shortage' then
      raise exception 'Insufficient stock for item % (available %, requested %)', v_line.stock_id,
        v_post->>'qty_available', v_line.qty using errcode = '23514';
    end if;
    insert into public.work_order_stock_reservation_lines(reservation_id, stock_id, quantity)
      values (v_reservation.id, v_line.stock_id, v_line.qty::integer);
  end loop;
  return jsonb_build_object('reservation_id', v_reservation.id, 'work_order_id', p_work_order_id, 'status', 'reserved',
    'idempotent', false, 'line_count', (select count(*) from public.work_order_stock_reservation_lines where reservation_id = v_reservation.id));
exception when unique_violation then
  select * into v_reservation from public.work_order_stock_reservations
   where organisation_id = v_org and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reservation_id', v_reservation.id, 'work_order_id', v_reservation.work_order_id,
      'status', v_reservation.status, 'idempotent', true);
  end if;
  raise;
end $function$;

create or replace function private.release_work_order_stock_internal(p_work_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_org uuid := public.app_current_org(); v_actor uuid := auth.uid();
  v_reservation public.work_order_stock_reservations; v_line record;
begin
  if v_actor is null or v_org is null then
    raise exception 'Authentication and organisation membership are required' using errcode = '42501';
  end if;
  select * into v_reservation from public.work_order_stock_reservations
   where organisation_id = v_org and work_order_id = p_work_order_id and status = 'reserved' for update;
  if not found then
    return jsonb_build_object('work_order_id', p_work_order_id, 'status', 'not_reserved', 'released', false);
  end if;
  for v_line in select stock_id, quantity from public.work_order_stock_reservation_lines
                 where reservation_id = v_reservation.id order by stock_id loop
    perform public._inv_post(jsonb_build_object('idempotency_key', 'wo-release:' || v_reservation.id::text || ':' || v_line.stock_id::text,
      'stock_id', v_line.stock_id, 'movement_type', 'release', 'qty_change', 0, 'reserved_change', -v_line.quantity,
      'reason', p_reason, 'source_doc_type', 'work_order', 'source_doc_id', p_work_order_id::text), false);
  end loop;
  update public.work_order_stock_reservations set status = 'released', released_by = v_actor, released_at = now(),
    release_reason = nullif(left(btrim(p_reason), 500), '') where id = v_reservation.id;
  return jsonb_build_object('reservation_id', v_reservation.id, 'work_order_id', p_work_order_id, 'status', 'released', 'released', true);
end $function$;

-- The legacy `stock` table is retired as a balance (0 rows, no remaining writer).
comment on table public.stock is 'RETIRED 2026-11-20 (inv P0): not a stock balance. stock_records is the only balance; reservations use stock_records.qty_reserved.';
drop policy if exists stock_write on public.stock;
revoke insert, update, delete, truncate on public.stock from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6. Server-side write gates on procurement / master tables
-- ---------------------------------------------------------------------------
-- goods_receipts: receive capability
drop policy if exists goods_receipts_insert on public.goods_receipts;
drop policy if exists goods_receipts_update on public.goods_receipts;
drop policy if exists goods_receipts_delete on public.goods_receipts;
create policy goods_receipts_cap_insert on public.goods_receipts for insert to authenticated with check (public.inv_can('receive'));
create policy goods_receipts_cap_update on public.goods_receipts for update to authenticated using (public.inv_can('receive')) with check (public.inv_can('receive'));
create policy goods_receipts_cap_delete on public.goods_receipts for delete to authenticated using (public.app_user_can('stock', 'delete'));

-- requisitions: anyone active may raise their own; editing beyond own draft needs procure
drop policy if exists requisitions_insert on public.requisitions;
drop policy if exists requisitions_update on public.requisitions;
drop policy if exists requisitions_delete on public.requisitions;
create policy requisitions_own_insert on public.requisitions for insert to authenticated
  with check (created_by = auth.uid() and coalesce(status, 'draft') in ('draft', 'submitted'));
create policy requisitions_cap_update on public.requisitions for update to authenticated
  using ((created_by = auth.uid() and status = 'draft') or public.inv_can('procure'))
  with check ((created_by = auth.uid() and status in ('draft', 'submitted')) or public.inv_can('procure'));
create policy requisitions_cap_delete on public.requisitions for delete to authenticated using (public.app_user_can('stock', 'delete'));

-- suppliers: procure capability; supplier_code unique per company
drop policy if exists suppliers_insert on public.suppliers;
drop policy if exists suppliers_update on public.suppliers;
drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_cap_insert on public.suppliers for insert to authenticated with check (public.inv_can('procure'));
create policy suppliers_cap_update on public.suppliers for update to authenticated using (public.inv_can('procure')) with check (public.inv_can('procure'));
create policy suppliers_cap_delete on public.suppliers for delete to authenticated using (public.app_user_can('stock', 'delete'));
create unique index if not exists suppliers_org_code_uq on public.suppliers (organisation_id, upper(btrim(supplier_code)))
  where supplier_code is not null and btrim(supplier_code) <> '';

-- purchase_orders: procure capability; po_number unique per company
drop policy if exists po_insert_authenticated on public.purchase_orders;
drop policy if exists po_update_authenticated on public.purchase_orders;
create policy purchase_orders_cap_insert on public.purchase_orders for insert to authenticated with check (public.inv_can('procure'));
create policy purchase_orders_cap_update on public.purchase_orders for update to authenticated using (public.inv_can('procure')) with check (public.inv_can('procure'));
alter table public.purchase_orders drop constraint if exists purchase_orders_po_number_key;
alter table public.purchase_orders add constraint purchase_orders_org_po_number_key unique (organisation_id, po_number);

-- materials: competing empty item master, frozen read-only (material_master is canonical)
drop policy if exists materials_insert on public.materials;
drop policy if exists materials_update on public.materials;
drop policy if exists materials_delete on public.materials;
revoke insert, update, delete, truncate on public.materials from authenticated, anon;
comment on table public.materials is 'FROZEN 2026-11-20 (inv P0): read-only. material_master is the single item master.';

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.inv_post_movement(jsonb) from public, anon;
revoke all on function public.inv_reverse_movement(uuid, text, text) from public, anon;
revoke all on function public.inv_exception_resolve(uuid, text, text) from public, anon;
revoke all on function public.inv_can(text) from public, anon;
revoke all on function public.inv_blind_hides_balance(uuid, text, uuid, uuid) from public, anon;
revoke all on function public._inv_scope_ok(text, text) from public, anon, authenticated;
revoke all on function public._inv_movement_json(public.stock_movements) from public, anon, authenticated;
grant execute on function public.inv_post_movement(jsonb), public.inv_reverse_movement(uuid, text, text),
  public.inv_exception_resolve(uuid, text, text), public.inv_can(text) to authenticated;
revoke all on function public.post_stock_movement(uuid, text, numeric, text, text) from public, anon;
revoke all on function public.set_stock_count(uuid, numeric, text) from public, anon;
grant execute on function public.post_stock_movement(uuid, text, numeric, text, text),
  public.set_stock_count(uuid, numeric, text) to authenticated;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
