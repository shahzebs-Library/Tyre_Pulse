/**
 * Vehicle Reservations service — the single seam between the Vehicle
 * Reservations page (/vehicle-reservations) and Supabase (table
 * `vehicle_reservations`, V175). Keeps an explicit column list (least-privilege
 * selects), null-safe country scoping, and input validation. RLS enforces org
 * isolation; this layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `vehicle_reservations` relation (org has
 * not run the migration) degrades listing to an empty array so the page can
 * render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../vehicleReservations'

export const COLS =
  'id,organisation_id,country,reference,asset_no,requester_name,department,' +
  'purpose,start_at,end_at,pickup_location,return_location,expected_km,status,' +
  'approved_by,notes,created_by,created_at,updated_at'

const STATUSES = ['requested', 'approved', 'out', 'returned', 'cancelled']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('vehicle_reservations'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asStatus = (v) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return STATUSES.includes(s) ? s : null
}

/**
 * List reservations (newest first by start_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listVehicleReservations({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('vehicle_reservations').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('start_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getVehicleReservation(id) {
  return unwrap(await supabase.from('vehicle_reservations').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a reservation. Requires an asset number (which vehicle). Validates the
 * expected distance is non-negative and whitelists the status enum (defaults to
 * 'requested').
 */
export async function createVehicleReservation(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  let expected_km = null
  if (values.expected_km !== undefined && values.expected_km !== null && values.expected_km !== '') {
    expected_km = toFiniteNumber(values.expected_km)
    if (expected_km == null) throw new Error('Expected distance must be a number (km).')
    if (expected_km < 0) throw new Error('Expected distance cannot be negative.')
  }

  const payload = {
    asset_no,
    reference: asText(values.reference, 120),
    requester_name: asText(values.requester_name, 200),
    department: asText(values.department, 200),
    purpose: asText(values.purpose, 500),
    start_at: asDate(values.start_at),
    end_at: asDate(values.end_at),
    pickup_location: asText(values.pickup_location, 200),
    return_location: asText(values.return_location, 200),
    expected_km,
    status: asStatus(values.status) || 'requested',
    approved_by: asText(values.approved_by, 200),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('vehicle_reservations').insert(payload).select(COLS).single())
}

/**
 * Patch a reservation. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateVehicleReservation(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.reference !== undefined) clean.reference = asText(patch.reference, 120)
  if (patch.requester_name !== undefined) clean.requester_name = asText(patch.requester_name, 200)
  if (patch.department !== undefined) clean.department = asText(patch.department, 200)
  if (patch.purpose !== undefined) clean.purpose = asText(patch.purpose, 500)
  if (patch.start_at !== undefined) clean.start_at = asDate(patch.start_at)
  if (patch.end_at !== undefined) clean.end_at = asDate(patch.end_at)
  if (patch.pickup_location !== undefined) clean.pickup_location = asText(patch.pickup_location, 200)
  if (patch.return_location !== undefined) clean.return_location = asText(patch.return_location, 200)
  if (patch.expected_km !== undefined) {
    if (patch.expected_km === null || patch.expected_km === '') {
      clean.expected_km = null
    } else {
      const expected_km = toFiniteNumber(patch.expected_km)
      if (expected_km == null) throw new Error('Expected distance must be a number (km).')
      if (expected_km < 0) throw new Error('Expected distance cannot be negative.')
      clean.expected_km = expected_km
    }
  }
  if (patch.status !== undefined) {
    const status = asStatus(patch.status)
    if (!status) throw new Error('Invalid reservation status.')
    clean.status = status
  }
  if (patch.approved_by !== undefined) clean.approved_by = asText(patch.approved_by, 200)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('vehicle_reservations').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteVehicleReservation(id) {
  return unwrap(await supabase.from('vehicle_reservations').delete().eq('id', id))
}
