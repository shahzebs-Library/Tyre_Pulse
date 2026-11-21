\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
-- Business-data fingerprints over the columns that existed BEFORE the migrations (snapshot column set).
select 'stock_records (43 source rows, original columns)', count(*), md5(string_agg(concat_ws('|', id, site, description, stock_qty, min_level, critical_level, stock_status, reorder_qty, management_action, region, updated_by, updated_at, country, organisation_id, custom_data, unit_cost, currency, brand, tyre_size, last_counted_at), ',' order by id)) from stock_records;
select 'stock_movements (78 source rows, original columns, qty as numeric text)', count(*), md5(string_agg(concat_ws('|', id, stock_id, site, description, movement_type, qty_before::numeric, qty_change::numeric, qty_after::numeric, reason, reference_no, created_by, created_at, organisation_id), ',' order by id)) from stock_movements;
select 'tyre_records (all columns)', count(*), md5(string_agg(to_jsonb(t)::text, ',' order by id)) from tyre_records t;
select 'tyre_records cost/CPK inputs (cost_per_tyre, km, dates)', count(*), md5(string_agg(concat_ws('|', id, cost_per_tyre, km_at_fitment, km_at_removal, total_km, issue_date, removal_date, status, serial_no, asset_no, tyre_position), ',' order by id)) from tyre_records;
select 'tyre_status_marks', count(*), md5(string_agg(to_jsonb(m)::text, ',' order by id)) from tyre_status_marks m;
select 'parts_consumption sample (ERP expense)', count(*)||' rows, line_cost '||coalesce(sum(line_cost),0)::text, md5(string_agg(to_jsonb(p)::text, ',' order by id)) from parts_consumption p;
select 'profiles (permissions: role/country/sites/approved/locked/super)', count(*), md5(string_agg(concat_ws('|', id, role, country, sites, approved, locked, is_super_admin, organisation_id, org_id), ',' order by id)) from profiles;
select 'module_permissions', count(*), md5(string_agg(to_jsonb(m)::text, ',' order by id)) from module_permissions m;
select 'user_access_grants', count(*), md5(string_agg(to_jsonb(g)::text, ',' order by id)) from user_access_grants g;
select 'approval_policies', count(*), md5(string_agg(to_jsonb(a)::text, ',' order by id)) from approval_policies a;
select 'custom_roles (pre-existing names)', count(*), md5(string_agg(to_jsonb(c)::text, ',' order by id)) from custom_roles c where name not in ('Inventory Controller','Finance Manager');
select 'metric_registry (pre-existing ids)', count(*), md5(string_agg(to_jsonb(m)::text, ',' order by metric_id)) from metric_registry m where metric_id not like 'inv\_%';
select 'report_schedules', count(*), md5(string_agg(to_jsonb(r)::text, ',' order by id)) from report_schedules r;
select 'organisations', count(*), md5(string_agg(to_jsonb(o)::text, ',' order by id)) from organisations o;
select 'material_master (original columns except updated_at)', count(*), md5(string_agg(concat_ws('|', id, organisation_id, item_code, item_name, category, subcategory, brand, uom, is_tyre, is_spare, is_lubricant, is_fuel, is_service, is_capital, reviewed, reviewed_by, reviewed_at, conflicting, proposed_from, txn_rows, txn_value, notes, created_at, country), ',' order by id)) from material_master;
select 'material_master updated_at', count(*), md5(string_agg(updated_at::text, ',' order by id)) from material_master;
