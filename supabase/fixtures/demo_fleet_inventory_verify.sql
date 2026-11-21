-- supabase/fixtures/demo_fleet_inventory_verify.sql
-- READ ONLY. (1) Fingerprint of the REAL company (Default Organisation) inventory and
-- tyre data: run before and after the fixture; every value must be identical
-- (allowing only for real staff activity, which shows up with created_by/actor_id of
-- a Default Organisation user). (2) What the Demo company now holds.
with real as (select '00000000-0000-0000-0000-000000000001'::uuid o),
demo as (select 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7'::uuid o)
select jsonb_build_object(
  'real_company', jsonb_build_object(
    'stock_records',   (select jsonb_build_array(count(*), md5(coalesce(string_agg(concat_ws('|', id, qty_on_hand, qty_reserved, valued_qty, valued_value, unvalued_qty, version, item_id, location_id), ',' order by id), ''))) from public.stock_records, real where organisation_id = real.o),
    'stock_movements', (select jsonb_build_array(count(*), max(movement_seq), md5(coalesce(string_agg(id::text, ',' order by id), ''))) from public.stock_movements, real where organisation_id = real.o),
    'material_master', (select jsonb_build_array(count(*), md5(coalesce(string_agg(concat_ws('|', id, item_code, category, serial_tracked, status), ',' order by id), ''))) from public.material_master, real where organisation_id = real.o),
    'inventory_locations', (select jsonb_build_array(count(*), md5(coalesce(string_agg(concat_ws('|', id, code, site, active), ',' order by id), ''))) from public.inventory_locations, real where organisation_id = real.o),
    'inventory_audits', (select jsonb_build_array(count(*), md5(coalesce(string_agg(concat_ws('|', id, status, counter_id), ',' order by id), ''))) from public.inventory_audits, real where organisation_id = real.o),
    'inventory_count_lines', (select count(*) from public.inventory_count_lines, real where organisation_id = real.o),
    'stock_transfers', (select jsonb_build_array(count(*), md5(coalesce(string_agg(concat_ws('|', id, status), ',' order by id), ''))) from public.stock_transfers, real where organisation_id = real.o),
    'goods_receipts', (select count(*) from public.goods_receipts, real where organisation_id = real.o),
    'tyre_items', (select jsonb_build_array(count(*), md5(coalesce(string_agg(concat_ws('|', id, custody_state, location_id, item_id), ',' order by id), ''))) from public.tyre_items, real where organisation_id = real.o),
    'tyre_store_holdings', (select count(*) from public.tyre_store_holdings, real where organisation_id = real.o),
    'tyre_records', (select jsonb_build_array(count(*), md5(coalesce(string_agg(concat_ws('|', id, serial_no, asset_no, status, cost_per_tyre, removal_date), ',' order by id), ''))) from public.tyre_records, real where organisation_id = real.o),
    'profiles', (select jsonb_build_array(count(*), md5(coalesce(string_agg(concat_ws('|', id, role, approved, org_id, organisation_id, country, sites), ',' order by id), ''))) from public.profiles, real where org_id = real.o),
    'user_access_grants', (select jsonb_build_array(count(*), md5(coalesce(string_agg(concat_ws('|', id, user_id, module_key, capability, effect), ',' order by id), ''))) from public.user_access_grants, real where org_id = real.o)),
  'demo_company', jsonb_build_object(
    'items', (select jsonb_agg(item_code order by item_code) from public.material_master, demo where organisation_id = demo.o),
    'locations', (select jsonb_agg(code order by code) from public.inventory_locations, demo where organisation_id = demo.o),
    'balances', (select jsonb_agg(concat_ws(' ', l.code, m.item_code, s.qty_on_hand) order by l.code, m.item_code)
                   from public.stock_records s join public.material_master m on m.id = s.item_id
                   join public.inventory_locations l on l.id = s.location_id, demo where s.organisation_id = demo.o),
    'tyre_items', (select jsonb_agg(concat_ws(' ', serial, custody_state) order by serial) from public.tyre_items, demo where organisation_id = demo.o and serial like 'DEMOST%'),
    'audits', (select jsonb_agg(concat_ws(' | ', ref, audit_type, status, left(instructions, 30)) order by instructions) from public.inventory_audits, demo where organisation_id = demo.o),
    'transfers', (select jsonb_agg(concat_ws(' | ', ref, status) order by ref) from public.stock_transfers, demo where organisation_id = demo.o),
    'accounts', (select jsonb_agg(concat_ws(' | ', username, role, approved, sites) order by username) from public.profiles, demo where org_id = demo.o)));
