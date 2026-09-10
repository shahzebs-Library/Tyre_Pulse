import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'

const FLEET_COLS = 'id,organisation_id,asset_no,fleet_number,registration_no,vehicle_type,country,region,site,current_km,current_engine_hours,current_hours,updated_at'
const COMMON_COLS = 'id,organisation_id,asset_no,country,site,reading_date,source,notes,created_at,updated_at,created_by,flagged,flag_reason,reviewed'
async function all(table, columns, country) {
  const result = await fetchAllPages((from, to) => applyCountry(supabase.from(table).select(columns), country).order('id').range(from, to))
  if (result.truncated) throw new Error('Too many readings to load completely. Narrow the country selection.')
  return unwrap(result) || []
}
export async function loadVehicleMeters(country) {
  const [fleet, odometer, hours] = await Promise.all([
    all('vehicle_fleet', FLEET_COLS, country),
    all('odometer_logs', `${COMMON_COLS},odometer_km`, country),
    all('engine_hours_logs', `${COMMON_COLS},engine_hours`, country),
  ])
  return { fleet, odometer, hours }
}
function rpcResult(result) {
  if (result.error?.code === '40001') throw new Error('Another reading was saved since you opened this row. Refresh, check the latest value, and try again.')
  return unwrap(result)
}
export async function saveVehicleMeters(vehicle, draft) {
  return rpcResult(await supabase.rpc('save_vehicle_meter_readings', {
    p_vehicle_id: vehicle.id, p_reading_date: draft.date,
    p_km: draft.km === '' ? null : Number(draft.km),
    p_hours: draft.hours === '' ? null : Number(draft.hours),
    p_request_id: draft.requestId, p_expected_km: vehicle.km,
    p_expected_hours: vehicle.engineHours, p_notes: draft.notes || null,
  }))
}
export async function correctVehicleMeter(row, values) {
  return rpcResult(await supabase.rpc('correct_vehicle_meter_reading', {
    p_kind: row.kind, p_id: row.id, p_value: Number(values.value),
    p_reading_date: values.date, p_reason: values.reason,
    p_expected_updated_at: row.updated_at,
  }))
}
export async function meterCorrectionHistory(row) {
  return unwrap(await supabase.from('audit_log')
    .select('id,changed_at,changed_by,old_data,new_data,details')
    .eq('table_name', row.kind === 'km' ? 'odometer_logs' : 'engine_hours_logs')
    .eq('record_id', row.id).eq('action', 'UPDATE')
    .order('changed_at', { ascending: false }).limit(100)) || []
}
