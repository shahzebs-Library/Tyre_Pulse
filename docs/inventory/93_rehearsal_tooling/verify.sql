\pset format unaligned
\pset fieldsep ' | '
select '1 neg/over-reserved', count(*) from stock_records where qty_on_hand < 0 or qty_reserved > qty_on_hand;
select '1 auth UPDATE on stock_movements', has_table_privilege('authenticated','public.stock_movements','UPDATE');
select '1 null key/seq', count(*) from stock_movements where idempotency_key is null or movement_seq is null;
select '1 null org movements', count(*) from stock_movements where organisation_id is null;
select '2 material_master null status', count(*) from material_master where status is null;
select '2 auth INSERT inventory_locations', has_table_privilege('authenticated','public.inventory_locations','INSERT');
select '3 rls on audit tables', string_agg(relname||'='||relrowsecurity, ',') from pg_class where relname in ('inventory_audits','inventory_audit_snapshot_lines','inventory_count_lines','inventory_discrepancies','inventory_adjustments');
select '4 per-org PO key', count(*) from pg_constraint where conname='purchase_orders_org_po_number_key';
select '4 stock_transfers', to_regclass('public.stock_transfers') is not null;
select '5 unvalued w/o open reconciliation', count(*) from stock_records s where s.unvalued_qty > 0 and not exists (select 1 from inventory_cost_reconciliations r where r.stock_id = s.id and r.status='open');
select '5 legacy reconciliations', count(*) from inventory_cost_reconciliations where kind='legacy';
select '7 v_validated_compatibility', to_regclass('public.v_validated_compatibility') is not null;
select '8 _inv_ helpers exec by authenticated (expect 0)', count(*) from pg_proc where proname like '\_inv\_%' and has_function_privilege('authenticated', oid, 'EXECUTE') and proname not in ('_inv_audit_can_see_expected','_inv_approval_block_reason','_inv_audit_open_for_counter','_inv_posting_on','_inv_cap_for');
select '9 approval type check', pg_get_constraintdef(oid) from pg_constraint where conname='approval_policies_entity_type_check';
select '10 erp view rows', count(*) from v_inv_erp_reconciliation;
select '11 inv metrics', count(*) from metric_registry where metric_id like 'inv\_%';
select '12 report type has inventory', position('inventory' in pg_get_constraintdef(oid))>0 from pg_constraint where conrelid='public.report_schedules'::regclass and conname like '%report_type%';
select '13 source_receipt in _inv_issue', position('source_receipt_movement_id' in pg_get_functiondef('public._inv_issue(jsonb)'::regprocedure)) > 0, position('source_receipt_movement_id' in pg_get_functiondef('public._inv_transfer_dispatch(jsonb)'::regprocedure)) > 0;
select '13 _bak.inv_112000_snapshot rows', count(*) from _bak.inv_112000_snapshot;
select '14 validate_policy md5 changed', md5(replace(pg_get_functiondef('approval_private.validate_policy(approval_policies)'::regprocedure), chr(13), '')) <> 'b76c1c97d59bc5b384041b5f8b67c867', position('inv_approver_roles' in pg_get_functiondef('approval_private.validate_policy(approval_policies)'::regprocedure))>0;
select '14 live policies validate', count(*) from (select approval_private.validate_policy(p) from approval_policies p) x;
select '14 new roles per org', count(*), count(distinct organisation_id) from custom_roles where name in ('Inventory Controller','Finance Manager');
select '15 conflicts not open', count(*) from tyre_custody_conflicts where investigation_status <> 'open';
select '16 anon exec helpers', has_function_privilege('anon','public.inv_canon_serial(text)','EXECUTE'), has_function_privilege('anon','public._inv_posting_on()','EXECUTE'), has_function_privilege('anon','public._inv_cap_for(text)','EXECUTE'), has_function_privilege('anon','public.inv_movement_kind(text)','EXECUTE');
select '16 lifecycle guard triggers', count(*) from pg_trigger where tgname='trg_inv_lifecycle_guard';
