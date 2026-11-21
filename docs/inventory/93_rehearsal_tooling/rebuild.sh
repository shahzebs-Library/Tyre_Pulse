#!/bin/bash
# rebuild.sh : recreate snap_base from the production extracts
set -e
cd "$(dirname "$0")"
python3 -c "
t='vehicle_fleet tyre_records tyre_service_events tpms_readings suppliers inspections inspection_schedules tyre_status_marks tyre_spec_catalog tyre_rotations tyre_tread_readings tyre_disposals retread_jobs odometer_logs engine_hours_logs cpk_asset_meter sites checklist_submissions checklist_templates work_orders work_order_line_items parts_consumption workshop_status_records workshop_status_events wash_records accidents accident_damage_assessments production_logs'.split()
open('snap_data_extra.sql','w').write('-- anum_integration.reader_tables (28 table names, read 2026-11-20; no personal data)\n'+'\n'.join(\"insert into anum_integration.reader_tables(table_name) values ('%s');\" % x for x in t)+'\n')
"
P="psql -h localhost -p 54417 -U supabase_admin -v ON_ERROR_STOP=1 -q -X"
for d in rh_a rh_b rh_c rh_t snap_base; do $P -d postgres -c "drop database if exists $d with (force)"; done
$P -d postgres -c "create database snap_base owner postgres"
$P -d snap_base -f snap_schema_pre.sql
$P -d snap_base -f snap_data.sql
$P -d snap_base -f snap_data_extra.sql
$P -d snap_base -f snap_schema_post.sql 2>&1 | grep -c "SKIPPED POLICY" || true
