/**
 * Vehicle Check In/Out service (V144). Logs vehicle handovers — a driver checks
 * a vehicle OUT (odometer, fuel, condition) and later back IN. Any authenticated
 * member of the org reads and writes; RLS enforces org isolation. Mirrors
 * fuelCards.js / support.js: explicit column list, null-safe country scoping,
 * validation/clamps at the boundary, and graceful degradation when the table is
 * absent so the page can prompt for the migration instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,asset_no,driver_name,direction,odometer_km,' +
  'fuel_level,condition_notes,site,checked_at,status,created_by,created_at,updated_at'

export const DIRECTIONS = ['out', 'in']
export const STATUSES = ['open', 'closed']

/**
 * True when a Supabase/PostgREST error means the `vehicle_checkinout` relation
 * does not exist yet (migration not applied). Covers Postgres 42P01,
 * PostgREST PGRST205, and the message-text fallbacks.
 */
export function isMissingCheckInOutTable(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42P01' || code === 'PGRST205') return true
  const msg = String(error.message || '').toLowerCase()
  return (
    /relation .* does not exist/.test(msg) ||
    (msg.includes('does not exist') && msg.includes('relation')) ||
    (msg.includes('could not find the table') && msg.includes('schema cache'))
  )
}

/**
 * List handover entries (newest first). Optional direction/status/country
 * filters. When the table is missing the query degrades to an empty array so
 * the page can surface the "apply migration" state without a hard failure.
 * @param {{ direction?:string, status?:string, country?:string, limit?:number }} [opts]
 * @returns {Promise<Array>}
 */
export async function listCheckInOut({ direction, status, country, limit = 500 } = {}) {
  let q = supabase.from('vehicle_checkinout').select(COLS)
  if (direction && DIRECTIONS.includes(direction)) q = q.eq('direction', direction)
  if (status && STATUSES.includes(status)) q = q.eq('status', status)
  q = applyCountry(q, country)
  const { data, error } = await q.order('checked_at', { ascending: false }).limit(limit)
  if (error) {
    if (isMissingCheckInOutTable(error)) return []
    throw error
  }
  return data || []
}

export async function getEntry(id) {
  return unwrap(await supabase.from('vehicle_checkinout').select(COLS).eq('id', id).maybeSingle())
}

function normalizeOdometer(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Create a handover entry. Requires an asset number; clamps free-text and
 * normalises direction/status/odometer.
 */
export async function createEntry(values = {}) {
  const assetNo = String(values.asset_no || '').trim()
  if (!assetNo) throw new Error('An asset number is required.')
  const direction = DIRECTIONS.includes(values.direction) ? values.direction : 'out'
  const status = STATUSES.includes(values.status) ? values.status : 'open'
  const payload = {
    asset_no: assetNo.slice(0, 120),
    driver_name: values.driver_name ? String(values.driver_name).slice(0, 200) : null,
    direction,
    odometer_km: normalizeOdometer(values.odometer_km),
    fuel_level: values.fuel_level ? String(values.fuel_level).slice(0, 40) : null,
    condition_notes: values.condition_notes ? String(values.condition_notes).slice(0, 4000) : null,
    site: values.site ? String(values.site).slice(0, 200) : null,
    country: values.country ?? null,
    status,
  }
  if (values.checked_at) payload.checked_at = values.checked_at
  return unwrap(await supabase.from('vehicle_checkinout').insert(payload).select(COLS).single())
}

/** Patch a handover entry. Immutable identity/ownership columns are stripped. */
export async function updateEntry(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id; delete clean.created_at; delete clean.organisation_id; delete clean.created_by
  if ('direction' in clean && !DIRECTIONS.includes(clean.direction)) delete clean.direction
  if ('status' in clean && !STATUSES.includes(clean.status)) delete clean.status
  if ('odometer_km' in clean) clean.odometer_km = normalizeOdometer(clean.odometer_km)
  if ('asset_no' in clean) {
    const a = String(clean.asset_no || '').trim()
    if (!a) throw new Error('An asset number is required.')
    clean.asset_no = a.slice(0, 120)
  }
  return unwrap(await supabase.from('vehicle_checkinout').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteEntry(id) {
  return unwrap(await supabase.from('vehicle_checkinout').delete().eq('id', id))
}
