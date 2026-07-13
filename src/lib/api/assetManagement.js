/**
 * Asset Management page reads/writes - the exact selects/RPCs/mutations the
 * Fleet Asset Management screen consumes (registry, overview, work orders,
 * per-asset tyre drawer, inspections, accidents, meter logs, add/edit form).
 *
 * SOURCE OF TRUTH: `vehicle_fleet` is the fleet registry (604+ live assets).
 * The legacy `fleet_master` table is empty and MUST NOT be read — doing so
 * showed an empty registry while real assets existed. Reads alias `is_active`
 * → `active` so the page keeps its `active` field contract; writes map the
 * page's `active` back to `is_active` (+ mirror `status`).
 *
 * Read-only pass-throughs return the raw Supabase query builder (thenable) or
 * RPC result the page reads via `.data` / `.error` (consumed through
 * `Promise.allSettled` / `.then`). Country filtering stays client-side in the
 * page (unchanged). Additive only.
 */
import { supabase, fetchAllPages } from './_client'

// Explicit column list (no SELECT *) — least-privilege + stable shape. `is_active`
// is surfaced as `active` so the registry/detail keep their existing field name.
const FLEET_COLS =
  'id,asset_no,fleet_number,make,model,vehicle_type,year,department,operator_name,' +
  'site,country,region,tyre_size,tyre_brand_preferred,monthly_tyre_budget,current_km,' +
  'registration_no,registration_date,status,notes,custom_data,image_path,' +
  'active:is_active,created_at,updated_at'

/** Rename the page's `active` field back to the table's `is_active`, mirror status. */
function toFleetRow(payload = {}) {
  const row = { ...payload }
  if ('active' in row) {
    row.is_active = row.active === true || row.active == null
    delete row.active
  }
  return row
}

/** All fleet assets from vehicle_fleet, ordered by asset number. Paged past the 1000-row cap. */
export function listFleetMaster() {
  return fetchAllPages((from, to) =>
    supabase.from('vehicle_fleet').select(FLEET_COLS).order('asset_no').order('id').range(from, to))
}

/** Per-asset overview aggregates via RPC (country passed straight through). */
export function reportAssetOverview({ country } = {}) {
  return supabase.rpc('report_asset_overview', { p_country: country })
}

/** Work orders feeding the asset registry cost/health columns. Paged past the 1000-row cap. */
export function listAssetWorkOrders() {
  return fetchAllPages((from, to) =>
    supabase.from('work_orders').select('id,asset_no,status,total_cost,created_at,work_type,work_order_no,priority,labour_cost,parts_cost,completed_at')
      .order('id').range(from, to))
}

/** Tyres for a single asset (detail drawer), keyed by asset number. */
export function listAssetTyres(assetNo) {
  return supabase
    .from('tyre_records')
    .select('id,asset_no,serial_number,serial_no,position,tyre_position,brand,size,cost_per_tyre,qty,issue_date,fitment_date,removal_date,km_at_fitment,km_at_removal,total_km,risk_level,tread_depth,pressure_reading,status,site,country')
    .eq('asset_no', assetNo)
    .order('issue_date', { ascending: false, nullsFirst: false })
}

/** Recent inspections for one asset (detail Inspections tab). */
export function listAssetInspections(assetNo) {
  return supabase
    .from('inspections')
    .select('id,asset_no,inspection_type,title,site,inspector,status,approval_status,severity,findings,notes,odometer_km,hour_meter,pressure_reading,inspection_date,scheduled_date,completed_date,created_at')
    .eq('asset_no', assetNo)
    .order('inspection_date', { ascending: false, nullsFirst: false })
    .limit(50)
}

/** Recorded accidents/incidents for one asset (detail Incidents tab). */
export function listAssetAccidents(assetNo) {
  return supabase
    .from('accidents')
    .select('id,asset_no,incident_date,incident_time,accident_type,severity,location,description,driver_name,status,claim_status,estimated_damage_cost,repair_cost,created_at')
    .eq('asset_no', assetNo)
    .order('incident_date', { ascending: false, nullsFirst: false })
    .limit(50)
}

/** Latest odometer reading logged for an asset (no-telematics meter capture). */
export function latestOdometer(assetNo) {
  return supabase
    .from('odometer_logs')
    .select('asset_no,odometer_km,reading_date,source,site,created_at')
    .eq('asset_no', assetNo)
    .order('reading_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
}

/** Latest engine-hour reading logged for an asset. */
export function latestEngineHours(assetNo) {
  return supabase
    .from('engine_hours_logs')
    .select('asset_no,engine_hours,reading_date,source,site,created_at')
    .eq('asset_no', assetNo)
    .order('reading_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
}

/** Update an existing vehicle_fleet asset by id. Pass-through (page reads `.error`). */
export function updateAsset(id, payload) {
  const row = toFleetRow(payload)
  if ('is_active' in row) row.status = row.is_active ? 'active' : 'inactive'
  return supabase.from('vehicle_fleet').update(row).eq('id', id)
}

/** Insert a new vehicle_fleet asset. Pass-through (page reads `.error`). */
export function insertAsset(payload) {
  const row = toFleetRow(payload)
  if (!('is_active' in row)) row.is_active = true
  row.status = row.is_active ? 'active' : 'inactive'
  return supabase.from('vehicle_fleet').insert([row])
}
