// PGlite harness for the Inventory Control & Audit migrations (20261120100000..106000).
//
// It builds minimal but faithful stubs of the live platform objects these
// migrations ALTER or call, copied from production catalog reads (2026-11-19):
//   * scope helpers app_write_country_ok / app_country_scope / app_sees_all_* /
//     app_site_scope: live bodies, verbatim logic.
//   * app_user_can: stubbed from a test grants table (live reads module_permissions
//     + org overrides; Admin and super admin always true; 'delete' only Admin).
//   * stock_records / stock_movements / stock_entry_requests / work_order_stock_*:
//     live columns, constraints and the permissive policies the P0 migration removes,
//     so "direct write refused" proves the migration closed the hole.
// Synthetic data only. Two companies (ORG_A, ORG_B), KSA + UAE, sites S1/S2.
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

export const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
export const ORG_A = id(900)
export const ORG_B = id(901)
export const U = {
  admin: id(1), keeper: id(2), counter: id(3), reviewer: id(4), approver: id(5),
  viewer: id(6), adminB: id(7), super: id(8), uaeOnly: id(9), site2Only: id(10), engineer: id(11),
}

const PM = f => readFileSync(new URL(`../pending_migrations/${f}`, import.meta.url), 'utf8')
export const MIGRATIONS = [
  '20261120100000_inv_p0_ledger_integrity.sql',
  '20261120101000_inv_item_master_locations.sql',
  '20261120102000_inv_physical_audits.sql',
  '20261120103000_inv_transfers_procurement.sql',
  '20261120104000_inv_valuation.sql',
  '20261120105000_inv_tyre_items.sql',
  '20261120106000_inv_oem_fitments.sql',
]
export const ROLLBACKS = MIGRATIONS.map(f => f.replace('.sql', '_ROLLBACK.sql'))
export const sqlOf = f => PM(f)

const PLATFORM = `
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private; create schema anum_integration;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select case when auth.uid() is null then 'anon' else 'authenticated' end $$;
create function anum_integration.apply_reader_policies() returns void language sql as $$ select $$;

create table public.organisations(id uuid primary key, name text);
create table public.profiles(id uuid primary key, organisation_id uuid, org_id uuid, role text, full_name text,
  is_super_admin boolean default false, country text[], sites text[], approved boolean default true, locked boolean default false);
create table public.test_caps(user_id uuid, cap text, primary key(user_id, cap));

create function public.app_current_org() returns uuid language sql stable security definer set search_path=public as $$
  select organisation_id from public.profiles where id = auth.uid() $$;
create function public.is_super_admin() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select is_super_admin and not coalesce(locked,false) from public.profiles where id = auth.uid()), false) $$;
create function public.get_my_role() returns text language sql stable security definer set search_path=public as $$
  select role from public.profiles where id = auth.uid() $$;
create function public.app_role() returns text language sql stable security definer set search_path=public as $$
  select lower(coalesce(public.get_my_role(), '')) $$;
create function public.app_is_elevated() returns boolean language sql stable security definer set search_path=public as $$
  select public.is_super_admin() or public.app_role() in ('admin','manager','director') $$;
create function public.is_approved_and_unlocked() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved = true and coalesce(locked,false) = false from public.profiles where id = auth.uid()), false) $$;
create function public.app_is_active() returns boolean language sql stable security definer set search_path=public as $$
  select public.is_approved_and_unlocked() $$;
create function public.app_user_can(p_key text, p_cap text) returns boolean language sql stable security definer set search_path=public as $$
  select case
    when auth.uid() is null or not public.is_approved_and_unlocked() then false
    when public.is_super_admin() then true
    when public.get_my_role() = 'Admin' then true
    when p_cap = 'delete' then false
    when p_cap = 'view' then true
    else exists (select 1 from public.test_caps where user_id = auth.uid() and cap in (p_cap, p_key || ':' || p_cap)) end $$;
create function public.app_can_admin_delete() returns boolean language sql stable set search_path=public as $$
  select public.get_my_role() = 'Admin' or public.is_super_admin() $$;
-- live bodies
create function public.app_country_scope() returns text[] language sql stable security definer set search_path=public as $$
  select coalesce((select array_agg(lower(btrim(x))) from public.profiles pr, unnest(pr.country) x
    where pr.id = auth.uid() and x is not null and btrim(x) <> ''), '{}'::text[]) $$;
create function public.app_sees_all_countries() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select exists (select 1 from unnest(pr.country) x where lower(btrim(x)) = 'all')
    from public.profiles pr where pr.id = auth.uid() and pr.country is not null and cardinality(pr.country) > 0), false) $$;
create function public.app_write_country_ok(p_country text) returns boolean language sql stable security definer set search_path=public as $$
  select p_country is null or public.is_super_admin() or public.app_sees_all_countries()
      or lower(btrim(p_country)) = any (coalesce(public.app_country_scope(), '{}'::text[])) $$;
create function public.app_sees_all_sites() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select p.is_super_admin or p.role = 'Admin'
    or (p.sites is not null and exists (select 1 from unnest(p.sites) s where upper(btrim(s)) in ('ALL','*')))
    from public.profiles p where p.id = auth.uid()), false) $$;
create function public.app_site_scope() returns text[] language sql stable security definer set search_path=public as $$
  select coalesce((select array_agg(upper(btrim(s))) from public.profiles p, unnest(p.sites) s
    where p.id = auth.uid() and s is not null and btrim(s) <> ''), '{}'::text[]) $$;
create function public.currency_for_country(p text) returns text language sql immutable set search_path=public as $$
  select case upper(coalesce(p, '')) when 'KSA' then 'SAR' when 'UAE' then 'AED' when 'EGYPT' then 'EGP' end $$;
create function public.tyre_serial_is_strong(p_serial text) returns boolean language sql immutable set search_path=public as $$
  select coalesce(length(btrim(p_serial)) >= 6 and upper(btrim(p_serial)) ~ '[0-9]'
    and upper(btrim(p_serial)) !~ '^(DOT|NULL|N/?A|-)', false) $$;
create table public.audits(id bigserial primary key, event text, entity text, entity_id text, b jsonb, a jsonb);
create function public.record_audit_event(e text, t text, i text, b jsonb, a jsonb) returns void language sql as $$
  insert into public.audits(event, entity, entity_id, b, a) values (e, t, i, b, a) $$;
create function public.stock_entry_resolve(s text, i text, c text, si text) returns jsonb language sql as $$ select null::jsonb $$;

create table public.material_master(id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
  item_code text not null, item_name text, category text not null default 'unclassified', subcategory text, brand text,
  uom text, is_tyre boolean not null default false, reviewed boolean not null default false, reviewed_by uuid,
  reviewed_at timestamptz, notes text, country text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create unique index material_master_org_country_code on public.material_master(organisation_id, country, item_code);
create table public.suppliers(id uuid primary key default gen_random_uuid(), supplier_name text not null, supplier_code text,
  status text not null default 'active', country text, site text, organisation_id uuid not null,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.sites(id uuid primary key default gen_random_uuid(), name text not null, country text not null,
  organisation_id uuid, site_code text, site_type text not null default 'other', active boolean default true);
create table public.work_orders(id uuid primary key default gen_random_uuid(), organisation_id uuid, work_order_no text,
  asset_no text, country text, site text);
create table public.workflow_instances(id uuid default gen_random_uuid(), organisation_id uuid, entity_type text,
  entity_id text, status text);

-- live stock_records / stock_movements shape (2026-11-19)
create table public.stock_records(id uuid primary key default gen_random_uuid(), site text not null default 'Unassigned',
  description text, stock_qty integer default 0, min_level integer default 5, critical_level integer default 3,
  stock_status text, reorder_qty integer default 0, management_action text, region text default 'KSA',
  updated_by uuid, updated_at timestamptz default now(), country text default 'KSA',
  organisation_id uuid not null references public.organisations(id), custom_data jsonb,
  unit_cost numeric constraint stock_records_unit_cost_nonneg check (unit_cost is null or unit_cost >= 0),
  currency text, brand text, tyre_size text, last_counted_at timestamptz);
create table public.stock_movements(id uuid primary key default gen_random_uuid(),
  stock_id uuid constraint stock_movements_stock_id_fkey references public.stock_records(id) on delete cascade,
  site text not null, description text,
  movement_type text default 'Adjustment' constraint stock_movements_movement_type_check check (movement_type = any (array[
    'In','Out','Adjustment','Initial','Reorder','Scrap','receipt','return','transfer_in','adjustment_up','issue',
    'transfer_out','scrap','adjustment_down','stocktake'])),
  qty_before integer not null default 0, qty_change integer not null, qty_after integer not null,
  reason text, reference_no text, created_by uuid, created_at timestamptz default now(), organisation_id uuid);
create view public.v_stock_balance_reconcile as select s.id as stock_id, s.stock_qty as recorded_qty,
  coalesce(l.q, 0) as ledger_qty from public.stock_records s
  left join (select stock_id, sum(qty_change) q from public.stock_movements group by stock_id) l on l.stock_id = s.id;
create table public.stock_entry_requests(id uuid primary key, organisation_id uuid not null, country text not null,
  site text not null, created_by uuid not null, payload_hash text not null, result jsonb, created_at timestamptz not null default now());
create table public.stock(id uuid primary key default gen_random_uuid(), brand text, size text, quantity integer default 0,
  site text, country text, organisation_id uuid, updated_at timestamptz default now());
create table public.work_order_stock_reservations(id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
  work_order_id uuid not null references public.work_orders(id), idempotency_key text not null, status text not null default 'reserved',
  reserved_by uuid not null, reserved_at timestamptz not null default now(), released_by uuid, released_at timestamptz,
  release_reason text, unique (organisation_id, idempotency_key));
create table public.work_order_stock_reservation_lines(reservation_id uuid not null references public.work_order_stock_reservations(id),
  stock_id uuid not null constraint work_order_stock_reservation_lines_stock_id_fkey references public.stock(id),
  quantity integer not null check (quantity > 0 and quantity <= 100000), primary key (reservation_id, stock_id));
create function private.reserve_work_order_stock_internal(p_work_order_id uuid, p_lines jsonb, p_idempotency_key text) returns jsonb language sql as $$ select null::jsonb $$;
create function private.release_work_order_stock_internal(p_work_order_id uuid, p_reason text) returns jsonb language sql as $$ select null::jsonb $$;
create function public.reserve_work_order_stock(p_work_order_id uuid, p_lines jsonb, p_idempotency_key text) returns jsonb
  language sql set search_path = '' as $$ select private.reserve_work_order_stock_internal(p_work_order_id, p_lines, p_idempotency_key) $$;
create function public.release_work_order_stock(p_work_order_id uuid, p_reason text default null) returns jsonb
  language sql set search_path = '' as $$ select private.release_work_order_stock_internal(p_work_order_id, p_reason) $$;

create table public.purchase_orders(id uuid primary key default gen_random_uuid(), po_number varchar not null
  constraint purchase_orders_po_number_key unique, vendor_name varchar not null default 'x', status varchar not null default 'Draft',
  items jsonb not null default '[]', site varchar, country varchar, organisation_id uuid, created_by uuid,
  supplier_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.goods_receipts(id uuid primary key default gen_random_uuid(), organisation_id uuid, country text, grn_no text,
  po_ref text, supplier text, item text, qty_ordered numeric, qty_received numeric, site text, status text not null default 'received',
  created_by uuid, unit_cost numeric, created_at timestamptz not null default now());
create table public.requisitions(id uuid primary key default gen_random_uuid(), organisation_id uuid, country text,
  item text not null, quantity numeric, site text, status text not null default 'draft', created_by uuid);
create table public.materials(id uuid primary key default gen_random_uuid(), organisation_id uuid, country text, name text not null,
  quantity_on_hand numeric);

create table public.tyre_records(id uuid primary key default gen_random_uuid(), organisation_id uuid, country text, site text,
  serial_no text, asset_no text, tyre_position text, position text, status text, issue_date date, removal_date date,
  cost_per_tyre numeric, brand text, size text, created_at timestamptz default now());
create table public.tyre_status_marks(id uuid primary key default gen_random_uuid(), serial text not null, mark_type text not null,
  organisation_id uuid not null, country text, created_by uuid, created_at timestamptz not null default now(), reason text,
  prior_status jsonb, unique (organisation_id, serial, mark_type));

grant usage on schema public, auth, private to authenticated, anon, service_role;
grant all on all tables in schema public to authenticated, anon, service_role;
grant all on all sequences in schema public to authenticated, service_role;
revoke all on public.test_caps from authenticated, anon;

-- the live policies the P0 migration must remove / keep
alter table public.stock_movements enable row level security;
create policy stock_movements_org_isolation on public.stock_movements as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
create policy stock_movements_authenticated on public.stock_movements for all using ((select auth.role()) = 'authenticated');
create policy stock_movements_select on public.stock_movements for select using ((select auth.role()) = 'authenticated');
alter table public.stock_records enable row level security;
create policy stock_records_org_isolation on public.stock_records as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
create policy stock_records_select on public.stock_records for select using ((select auth.role()) = 'authenticated');
create policy stock_records_update on public.stock_records for update using ((select public.get_my_role()) in ('Manager','Admin'));
create policy stock_records_insert on public.stock_records for insert with check ((select public.get_my_role()) in ('Manager','Admin'));
alter table public.material_master enable row level security;
create policy material_master_org on public.material_master as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy material_master_read on public.material_master for select to authenticated using (true);
alter table public.tyre_records enable row level security;
create policy tyre_records_org on public.tyre_records as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy tyre_records_all on public.tyre_records for all to authenticated using (true) with check (true);
alter table public.tyre_status_marks enable row level security;
create policy tsm_org on public.tyre_status_marks as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()));
create policy tsm_all on public.tyre_status_marks for all to authenticated using (true) with check (true);
`

const SEED = `
insert into public.organisations values ('${ORG_A}','Company A'),('${ORG_B}','Company B');
insert into public.profiles(id, organisation_id, org_id, role, full_name, is_super_admin, country, sites) values
 ('${U.admin}',   '${ORG_A}','${ORG_A}','Admin','Admin A',false,'{KSA}','{ALL}'),
 ('${U.keeper}',  '${ORG_A}','${ORG_A}','Store Keeper','Keeper',false,'{KSA}','{S1,S2}'),
 ('${U.counter}', '${ORG_A}','${ORG_A}','Store Keeper','Counter',false,'{KSA}','{S1,S2}'),
 ('${U.reviewer}','${ORG_A}','${ORG_A}','Inventory Controller','Reviewer',false,'{KSA}','{ALL}'),
 ('${U.approver}','${ORG_A}','${ORG_A}','Manager','Approver',false,'{KSA}','{ALL}'),
 ('${U.viewer}',  '${ORG_A}','${ORG_A}','Reporter','Viewer',false,'{KSA}','{ALL}'),
 ('${U.adminB}',  '${ORG_B}','${ORG_B}','Admin','Admin B',false,'{KSA}','{ALL}'),
 ('${U.super}',   '${ORG_A}','${ORG_A}','Admin','Super',true,'{ALL}','{ALL}'),
 ('${U.uaeOnly}', '${ORG_A}','${ORG_A}','Store Keeper','UAE keeper',false,'{UAE}','{ALL}'),
 ('${U.site2Only}','${ORG_A}','${ORG_A}','Store Keeper','Site 2 keeper',false,'{KSA}','{S2}'),
 ('${U.engineer}','${ORG_A}','${ORG_A}','Tyre Engineer','Engineer',false,'{KSA}','{ALL}');
insert into public.test_caps values
 ('${U.keeper}','receive'),('${U.keeper}','issue'),('${U.keeper}','transfer'),('${U.keeper}','count'),
 ('${U.counter}','count'),('${U.counter}','receive'),('${U.counter}','adjustment_approve'),
 ('${U.reviewer}','discrepancy_review'),('${U.reviewer}','recount'),('${U.reviewer}','audit_create'),('${U.reviewer}','view_value'),
 ('${U.approver}','adjustment_approve'),('${U.approver}','audit_create'),('${U.approver}','discrepancy_review'),('${U.approver}','view_value'),
 ('${U.uaeOnly}','receive'),('${U.site2Only}','receive'),('${U.site2Only}','issue'),('${U.engineer}','engineering_approve');
insert into public.material_master(id, organisation_id, country, item_code, item_name, category, uom, reviewed) values
 ('${id(100)}','${ORG_A}','KSA','FLT-01','Oil filter 01','filter','PCS',true),
 ('${id(101)}','${ORG_A}','KSA','TYR-315','315/80R22.5 tyre','tyre','PCS',true),
 ('${id(102)}','${ORG_A}','UAE','FLT-01','Oil filter 01 UAE','filter','PCS',true),
 ('${id(103)}','${ORG_B}','KSA','FLT-01','B filter','filter','PCS',true),
 ('${id(104)}','${ORG_A}','KSA','BRK-07','Brake pad','spare_part','SET',true);
insert into public.suppliers(id, supplier_name, supplier_code, organisation_id, country) values
 ('${id(200)}','Supplier One','SUP1','${ORG_A}','KSA'),('${id(201)}','Supplier B','SUP1','${ORG_B}','KSA');
insert into public.work_orders(id, organisation_id, work_order_no, country, site) values
 ('${id(300)}','${ORG_A}','WO-1','KSA','S1'),('${id(301)}','${ORG_B}','WO-1','KSA','S1');
-- legacy balances: one with history, one with qty and no opening movement (drift)
insert into public.stock_records(id, organisation_id, country, site, description, stock_qty, unit_cost, currency, custom_data) values
 ('${id(400)}','${ORG_A}','KSA','S1','Legacy tyre 315',10,null,null,'{"stock_item":{"condition":"New","unit":"PCS"}}'),
 ('${id(401)}','${ORG_A}','KSA','S1','Legacy rim',4,null,null,null),
 ('${id(402)}','${ORG_B}','KSA','S1','B legacy',3,null,null,null);
insert into public.stock_movements(stock_id, site, description, movement_type, qty_before, qty_change, qty_after, created_by, organisation_id, created_at) values
 ('${id(400)}','S1','Legacy tyre 315','Initial',0,10,10,'${U.admin}','${ORG_A}', now() - interval '2 days');
`

export async function buildDb ({ upTo = MIGRATIONS.length } = {}) {
  const db = new PGlite()
  await db.exec(PLATFORM)
  await db.exec(SEED)
  for (const f of MIGRATIONS.slice(0, upTo)) {
    try { await db.exec(PM(f)) } catch (e) { e.message = `${f}: ${e.message}`; throw e }
  }
  return db
}

// Run fn as a signed-in user (role authenticated) and always return to superuser.
export async function asUser (db, uid, fn) {
  await db.exec('reset role')
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ''])
  await db.exec('set role authenticated')
  try { return await fn() } finally {
    await db.exec('reset role')
    await db.query("select set_config('test.uid', '', false)")
  }
}

export const q = async (db, sql, args = []) => (await db.query(sql, args)).rows
export const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]
export const rpc = async (db, uid, fn, args = []) => asUser(db, uid, async () => {
  const ph = args.map((_, i) => `$${i + 1}`).join(',')
  return (await db.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r
})
export const code = c => e => e?.code === c || String(e?.message).includes(c)

test('harness: every inventory migration applies over the live-shaped platform', async () => {
  const db = await buildDb()
  const n = await one(db, "select count(*)::int as n from pg_tables where schemaname='public' and tablename in ('inventory_locations','inventory_audits','tyre_items','oem_part_references')")
  assert.equal(n.n, 4)
  await db.close()
})
