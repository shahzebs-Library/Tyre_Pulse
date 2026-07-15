-- V240: reseed the standard roles' module matrix to the app's canonical ROLE_DEFAULTS so
-- strict nav/route enforcement is CORRECT (no role loses core modules after the V239 dedup
-- exposed unreliable surviving values). Admin=all on; Manager/Director=all except
-- user_management/erp_sync/data_cleaning/audit_trail; Reporter/Tyre Man/Inspector/Driver/
-- Integration Admin/Data Engineer/Automation/DMO = their canonical allow-lists. Custom/other
-- roles left as-is. Admins re-customize from here and it sticks. Applied live 2026-07-14.
UPDATE public.module_permissions SET enabled=true, updated_at=now() WHERE org_id IS NULL AND role='Admin';
UPDATE public.module_permissions SET enabled=(module_key <> ALL(ARRAY['user_management','erp_sync','data_cleaning','audit_trail'])), updated_at=now() WHERE org_id IS NULL AND role IN ('Manager','Director');
UPDATE public.module_permissions SET enabled=(module_key = ANY(ARRAY['dashboard','analytics','kpi_scorecard','reports','executive_report','tyre_records'])), updated_at=now() WHERE org_id IS NULL AND role='Reporter';
UPDATE public.module_permissions SET enabled=(module_key = ANY(ARRAY['dashboard','tyre_records','inspections','alerts','stock','work_orders','gate_pass'])), updated_at=now() WHERE org_id IS NULL AND role='Tyre Man';
UPDATE public.module_permissions SET enabled=(module_key = ANY(ARRAY['dashboard','tyre_records','inspections','alerts','fleet_master','gate_pass','daily_ops'])), updated_at=now() WHERE org_id IS NULL AND role='Inspector';
UPDATE public.module_permissions SET enabled=(module_key = ANY(ARRAY['dashboard','inspections','alerts'])), updated_at=now() WHERE org_id IS NULL AND role='Driver';
UPDATE public.module_permissions SET enabled=(module_key = ANY(ARRAY['dashboard','alerts','erp_sync','data_cleaning','upload_data','custom_data','audit_trail'])), updated_at=now() WHERE org_id IS NULL AND role='Integration Admin';
UPDATE public.module_permissions SET enabled=(module_key = ANY(ARRAY['dashboard','alerts','erp_sync','data_cleaning','upload_data','custom_data','tyre_records','fleet_master','analytics'])), updated_at=now() WHERE org_id IS NULL AND role='Data Engineer';
UPDATE public.module_permissions SET enabled=(module_key = ANY(ARRAY['dashboard','alerts','erp_sync','upload_data','custom_data'])), updated_at=now() WHERE org_id IS NULL AND role='Automation';
UPDATE public.module_permissions SET enabled=(module_key = ANY(ARRAY['accidents'])), updated_at=now() WHERE org_id IS NULL AND role='Data Monitor Officer';
