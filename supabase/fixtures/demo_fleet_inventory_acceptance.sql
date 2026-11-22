-- =============================================================================
-- supabase/fixtures/demo_fleet_inventory_acceptance.sql
-- Purpose : inventory acceptance-test data for the Android device plan
--           (docs/inventory/92_MOBILE_DEVICE_TEST_PLAN.md, cases D01-D21), created
--           ONLY inside the separate company "Tyre Pulse Demo Fleet".
-- Owner   : authorised by the owner 2026-11-21 (isolated test fixtures).
-- Scope   : organisation a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7 only. Nothing here
--           reads or writes Default Organisation (00000000-...-0001) data.
--
-- How it stays inside the Demo company
--   1. Every stock write goes through the same inventory RPCs the app calls
--      (inv_location_upsert, inv_receive_goods, inv_transfer_dispatch,
--      inv_tyre_store_holding, inv_tyre_item_sync, inv_audit_create). Each of them
--      takes the company from the signed-in user (app_current_org()), never from
--      the payload. The script signs in as demo.manager (request.jwt.claims) and
--      refuses to continue unless app_current_org() is the Demo company.
--   2. The only direct inserts (material_master items, user_access_grants for
--      demo.manager) carry the Demo organisation id literally.
--   3. FINAL GUARD (exact, not statistical): before the transaction ends the
--      script looks, in every table it can touch, for any row that this
--      transaction wrote (its xmin is still "in progress") and that does NOT
--      belong to the Demo company. If one exists the script raises and the
--      whole transaction rolls back.
--
-- Idempotent: every RPC call carries a fixed idempotency key built from c_run,
-- so a second run returns the stored answers and changes nothing. Locations and
-- items are looked up first. To RESET the data see demo_fleet_inventory_teardown.sql
-- (then bump c_run below to the next value, e.g. 'r2').
--
-- Runs in one transaction. Applied on production via the pg_net fetch +
-- sha256 runner (_bak.inv_release_run); also safe to paste in the SQL editor.
-- Never edits the append-only ledger directly.
-- =============================================================================
do $fx$
declare
  c_org  constant uuid := 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7';   -- Tyre Pulse Demo Fleet
  c_real constant uuid := '00000000-0000-0000-0000-000000000001';   -- Default Organisation (never touched)
  c_mgr  constant uuid := 'c2f9a806-1d9c-4c3a-9a38-0bd7fefb087e';   -- demo.manager
  c_owner constant uuid := 'd2d43a5f-0906-4f7a-9577-e36d89164914';  -- platform owner (grant author)
  c_run  constant text := 'r1';
  c_tag  constant text := 'demo_fleet_inventory_acceptance';
  c_site constant text := 'DEMO YARD';
  k      text := 'demo-inv-acc:' || c_run || ':';
  v_r jsonb; v_loc_a uuid; v_loc_b uuid; v_loc_c uuid;
  v_q1 uuid; v_q2 uuid; v_t1 uuid; v_x1 uuid; v_stk uuid; v_aud jsonb := '{}'::jsonb;
  v_code text; v_s text; v_n int; v_t text; v_col text; v_bad text := '';
  v_epoch bigint := (txid_current() >> 32) * 4294967296;
  v_xid0  bigint := txid_current() % 4294967296;   -- this transaction's top-level xid (32-bit)
begin
  -- ---------------------------------------------------------------- guards
  if (select name from public.organisations where id = c_org) is distinct from 'Tyre Pulse Demo Fleet' then
    raise exception 'Demo company % not found or renamed - refusing.', c_org;
  end if;
  if not exists (select 1 from public.profiles where id = c_mgr and username = 'demo.manager'
                   and org_id = c_org and organisation_id = c_org and approved and not coalesce(locked, false)) then
    raise exception 'demo.manager is not an approved member of the Demo company - refusing.';
  end if;

  -- grants that let demo.manager drive the setup (Demo only, tagged, removable)
  insert into public.user_access_grants(org_id, user_id, module_key, capability, effect, granted_by, note)
  select c_org, c_mgr, 'stock', cap, 'grant', c_owner, c_tag
    from unnest(array['receive','issue','transfer','count','audit_create','recount']) cap
  on conflict (user_id, module_key, capability, effect) do nothing;

  -- sign in as demo.manager for the rest of the transaction
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', c_mgr, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if auth.uid() is distinct from c_mgr or public.app_current_org() is distinct from c_org then
    raise exception 'Session is not demo.manager in the Demo company - refusing.';
  end if;
  if not public.inv_can('receive') or not public.inv_can('transfer') or not public.inv_can('audit_create') then
    raise exception 'demo.manager lacks receive/transfer/audit_create after the grant - refusing.';
  end if;

  -- ---------------------------------------------------------------- items (Demo org, KSA)
  insert into public.material_master(organisation_id, country, item_code, item_name, category, uom, base_uom,
    stocked, serial_tracked, status, barcode, reviewed, reviewed_at, notes)
  select c_org, 'KSA', x.code, x.name, x.cat, 'EA', 'EA', true, x.ser, 'active', x.code, true, now(),
         'Acceptance-test item (' || c_tag || ')'
    from (values ('DEMO-Q-001', 'DEMO Valve cap (quantity item)',        'spare_part', false),
                 ('DEMO-Q-002', 'DEMO Tyre repair patch kit (quantity)',  'consumable', false),
                 ('DEMO-T-001', 'DEMO 315/80R22.5 tyre (serial tracked)', 'tyre',       true),
                 ('DEMO-X-001', 'DEMO Wheel nut (unexpected-item test)',  'spare_part', false)) x(code, name, cat, ser)
   where not exists (select 1 from public.material_master m where m.organisation_id = c_org
                       and m.country = 'KSA' and m.item_code = x.code);
  select id into v_q1 from public.material_master where organisation_id = c_org and country = 'KSA' and item_code = 'DEMO-Q-001';
  select id into v_q2 from public.material_master where organisation_id = c_org and country = 'KSA' and item_code = 'DEMO-Q-002';
  select id into v_t1 from public.material_master where organisation_id = c_org and country = 'KSA' and item_code = 'DEMO-T-001';
  select id into v_x1 from public.material_master where organisation_id = c_org and country = 'KSA' and item_code = 'DEMO-X-001';

  -- ---------------------------------------------------------------- locations (DEMO YARD)
  foreach v_code in array array['DEMO-WH-A','DEMO-WH-B','DEMO-WH-C'] loop
    if not exists (select 1 from public.inventory_locations where organisation_id = c_org
                     and site = c_site and code = v_code) then
      perform public.inv_location_upsert(jsonb_build_object(
        'idempotency_key', k || 'loc:' || v_code, 'country', 'KSA', 'site', c_site,
        'location_type', 'warehouse', 'code', v_code,
        'name', case v_code when 'DEMO-WH-A' then 'Demo Store A (counts, transfer source)'
                            when 'DEMO-WH-B' then 'Demo Store B (counts, transfer destination)'
                            else 'Demo Store C (audit-cancel test D10)' end,
        'active', true));
    end if;
  end loop;
  select id into v_loc_a from public.inventory_locations where organisation_id = c_org and site = c_site and code = 'DEMO-WH-A';
  select id into v_loc_b from public.inventory_locations where organisation_id = c_org and site = c_site and code = 'DEMO-WH-B';
  select id into v_loc_c from public.inventory_locations where organisation_id = c_org and site = c_site and code = 'DEMO-WH-C';
  if v_loc_a is null or v_loc_b is null or v_loc_c is null then raise exception 'Location setup failed.'; end if;

  -- ---------------------------------------------------------------- opening stock = one goods receipt
  v_r := public.inv_receive_goods(jsonb_build_object(
    'idempotency_key', k || 'grn:1', 'country', 'KSA', 'site', c_site, 'grn_no', 'DEMO-GRN-' || upper(c_run),
    'supplier', 'Demo supplier (test data)',
    'lines', jsonb_build_array(
      jsonb_build_object('item_id', v_q1, 'location_id', v_loc_a, 'qty_received', 20, 'unit_cost', 2.5,  'currency', 'SAR', 'condition', 'new', 'ownership', 'owned'),
      jsonb_build_object('item_id', v_q2, 'location_id', v_loc_a, 'qty_received', 10, 'unit_cost', 45,   'currency', 'SAR', 'condition', 'new', 'ownership', 'owned'),
      jsonb_build_object('item_id', v_q1, 'location_id', v_loc_b, 'qty_received', 8,  'unit_cost', 2.5,  'currency', 'SAR', 'condition', 'new', 'ownership', 'owned'),
      jsonb_build_object('item_id', v_q2, 'location_id', v_loc_b, 'qty_received', 6,  'unit_cost', 45,   'currency', 'SAR', 'condition', 'new', 'ownership', 'owned'),
      jsonb_build_object('item_id', v_x1, 'location_id', v_loc_b, 'qty_received', 2,  'unit_cost', 1.2,  'currency', 'SAR', 'condition', 'new', 'ownership', 'owned'),
      jsonb_build_object('item_id', v_q2, 'location_id', v_loc_c, 'qty_received', 4,  'unit_cost', 45,   'currency', 'SAR', 'condition', 'new', 'ownership', 'owned'))));
  v_aud := v_aud || jsonb_build_object('grn', v_r);

  -- ---------------------------------------------------------------- one open transfer A -> B (for D16)
  select id into v_stk from public.stock_records where organisation_id = c_org and item_id = v_q1
     and location_id = v_loc_a and condition = 'new' and ownership = 'owned';
  if v_stk is null then raise exception 'Receipt did not create the DEMO-Q-001 balance at DEMO-WH-A.'; end if;
  v_r := public.inv_transfer_dispatch(jsonb_build_object(
    'idempotency_key', k || 'trf:1', 'from_location_id', v_loc_a, 'to_location_id', v_loc_b,
    'remarks', '[demo-acceptance ' || c_run || '] open transfer for D16 (receive one line partly)',
    'lines', jsonb_build_array(jsonb_build_object('stock_id', v_stk, 'qty', 3))));
  v_aud := v_aud || jsonb_build_object('transfer', v_r);

  -- ---------------------------------------------------------------- four serial-tracked tyres in store A
  foreach v_s in array array['DEMOST0001','DEMOST0002','DEMOST0003','DEMOST0004'] loop
    if not exists (select 1 from public.tyre_store_holdings where organisation_id = c_org and serial = v_s and active) then
      perform public.inv_tyre_store_holding(jsonb_build_object(
        'idempotency_key', k || 'hold:' || v_s, 'serial', v_s, 'location_id', v_loc_a,
        'custody_state', 'new_stock', 'purchase_cost', 1150, 'currency', 'SAR'));
    end if;
  end loop;
  v_r := public.inv_tyre_item_sync(jsonb_build_object('country', 'KSA'));
  update public.tyre_items set item_id = v_t1
   where organisation_id = c_org and serial like 'DEMOST%' and item_id is null;

  -- ---------------------------------------------------------------- three audits (draft; the
  -- accounts script assigns the Store Keeper as counter and starts them)
  if not exists (select 1 from public.inventory_audits where organisation_id = c_org
                   and instructions like '[demo-acceptance ' || c_run || '] A %') then
    perform public.inv_audit_create(jsonb_build_object('idempotency_key', k || 'aud:A',
      'audit_type', 'partial', 'country', 'KSA', 'site', c_site, 'blind', true, 'reviewer_id', c_mgr,
      'scope', jsonb_build_object('location_ids', jsonb_build_array(v_loc_a, v_loc_b)),
      'instructions', '[demo-acceptance ' || c_run || '] A - quantity count, stores A and B (D04-D09, D11, D12, D14).'));
  end if;
  if not exists (select 1 from public.inventory_audits where organisation_id = c_org
                   and instructions like '[demo-acceptance ' || c_run || '] B %') then
    perform public.inv_audit_create(jsonb_build_object('idempotency_key', k || 'aud:B',
      'audit_type', 'tyre_serial', 'country', 'KSA', 'site', c_site, 'blind', true, 'reviewer_id', c_mgr,
      'scope', jsonb_build_object('location_ids', jsonb_build_array(v_loc_a)),
      'instructions', '[demo-acceptance ' || c_run || '] B - tyre serial count, store A, serials DEMOST0001-0004 (D13).'));
  end if;
  if not exists (select 1 from public.inventory_audits where organisation_id = c_org
                   and instructions like '[demo-acceptance ' || c_run || '] C %') then
    perform public.inv_audit_create(jsonb_build_object('idempotency_key', k || 'aud:C',
      'audit_type', 'partial', 'country', 'KSA', 'site', c_site, 'blind', true, 'reviewer_id', c_mgr,
      'scope', jsonb_build_object('location_ids', jsonb_build_array(v_loc_c)),
      'instructions', '[demo-acceptance ' || c_run || '] C - store C, to be cancelled on the web during D10.'));
  end if;

  -- ---------------------------------------------------------------- FINAL GUARD
  -- any row written by THIS transaction (xmin still in progress) outside the Demo company?
  perform set_config('request.jwt.claims', '', true);
  for v_t, v_col in select * from (values
      ('stock_records','organisation_id'), ('stock_movements','organisation_id'), ('stock_exceptions','organisation_id'),
      ('stock_reservations','organisation_id'), ('stock_transfers','organisation_id'), ('stock_transfer_lines','organisation_id'),
      ('goods_receipts','organisation_id'), ('goods_receipt_lines','organisation_id'), ('inventory_locations','organisation_id'),
      ('inventory_audits','organisation_id'), ('inventory_audit_snapshot_lines','organisation_id'),
      ('inventory_count_lines','organisation_id'), ('inventory_rpc_requests','organisation_id'),
      ('material_master','organisation_id'), ('tyre_items','organisation_id'), ('tyre_item_events','organisation_id'),
      ('tyre_store_holdings','organisation_id'), ('tyre_custody_conflicts','organisation_id'),
      ('inv_tyre_sync_runs','organisation_id'), ('tyre_records','organisation_id'),
      ('profiles','organisation_id'), ('user_access_grants','org_id')) x(t, c) loop
    if to_regclass('public.' || v_t) is null then continue; end if;
    execute format('select count(*) from public.%I where %I is distinct from $1
                     and (case when xmin::text::bigint >= $3
                               then pg_xact_status(($2 + xmin::text::bigint)::text::xid8) end) = %L',
                   v_t, v_col, 'in progress')
       into v_n using c_org, v_epoch, v_xid0;
    if v_n > 0 then v_bad := v_bad || v_t || '=' || v_n || ' '; end if;
  end loop;
  if v_bad <> '' then
    raise exception 'Isolation guard: this run wrote rows outside the Demo company (%). Rolled back.', v_bad;
  end if;
  raise notice 'demo fixture % ok: %', c_run, v_aud;
end
$fx$;
