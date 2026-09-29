/**
 * Vehicle Reservations service — the single seam between the Vehicle
 * Reservations page (/vehicle-reservations) and Supabase (table
 * `vehicle_reservations`, V175). Keeps an explicit column list (least-privilege
 * selects), null-safe country scoping, and input validation. RLS enforces org
 * isolation; this layer never trusts client input blindly.
 *
 * Listing preserves errors and retrieves the complete scoped register so
 * conflict checks and exports do not silently omit older bookings.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'
import { toFiniteNumber } from '../vehicleReservations'
import { escapeLike } from '../searchFilter'

export const COLS =
  'id,organisation_id,country,reference,asset_no,requester_name,department,' +
  'purpose,start_at,end_at,pickup_location,return_location,expected_km,status,' +
  'approved_by,notes,created_by,created_at,updated_at,' +
  'project,cost_centre,driver_id,driver_name,approved_by_id,approved_at,' +
  'rejected_by_id,rejected_at,rejected_reason,odometer_out,odometer_in,' +
  'actual_pickup_at,actual_return_at,gate_pass_id,handover_id'

const STATUSES = ['requested', 'approved', 'out', 'returned', 'cancelled']

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asUuid = (v) => (v && /^[0-9a-f-]{36}$/i.test(String(v)) ? String(v) : null)
const asOdo = (v, label) => {
  if (v === undefined || v === null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number (km).`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}
const asStatus = (v) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return STATUSES.includes(s) ? s : null
}

/**
 * List reservations (newest first by start_at, then created_at). Optional
 * `country` filter. Failed or incomplete reads never become an empty register.
 * @param {{ country?:string }} [opts]
 */
export async function listVehicleReservations({ country } = {}) {
  const result = await fetchAllPages((from, to) =>
    applyCountry(supabase.from('vehicle_reservations').select(COLS), country)
      .order('start_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to), { max: 100000 })
  const rows = unwrap(result) || []
  if (result.truncated) {
    throw new Error('The reservation register is too large to load completely. Conflict checks and exports are unavailable.')
  }
  return rows
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
    project: asText(values.project, 200),
    cost_centre: asText(values.cost_centre, 120),
    driver_id: asUuid(values.driver_id),
    driver_name: asText(values.driver_name, 200),
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
  if (patch.project !== undefined) clean.project = asText(patch.project, 200)
  if (patch.cost_centre !== undefined) clean.cost_centre = asText(patch.cost_centre, 120)
  if (patch.driver_id !== undefined) clean.driver_id = asUuid(patch.driver_id)
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.odometer_out !== undefined) clean.odometer_out = asOdo(patch.odometer_out, 'Odometer out')
  if (patch.odometer_in !== undefined) clean.odometer_in = asOdo(patch.odometer_in, 'Odometer in')
  if (patch.gate_pass_id !== undefined) clean.gate_pass_id = asUuid(patch.gate_pass_id)
  if (patch.handover_id !== undefined) clean.handover_id = asUuid(patch.handover_id)

  return unwrap(await supabase.from('vehicle_reservations').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteVehicleReservation(id) {
  return unwrap(await supabase.from('vehicle_reservations').delete().eq('id', id))
}

/* ── Workflow actions. The database stamps who and when; approving and
   rejecting are refused for anyone below manager. ─────────────────────────── */

const patchRow = async (id, clean) =>
  unwrap(await supabase.from('vehicle_reservations').update(clean).eq('id', id).select(COLS).single())

export async function approveReservation(id) {
  return patchRow(id, { status: 'approved' })
}

export async function rejectReservation(id, reason) {
  const r = asText(reason, 1000)
  if (!r) throw new Error('Give a reason for rejecting this reservation.')
  return patchRow(id, { rejected_at: new Date().toISOString(), rejected_reason: r })
}

export async function checkOutReservation(id, { odometerOut } = {}) {
  return patchRow(id, { status: 'out', odometer_out: asOdo(odometerOut, 'Odometer out') })
}

export async function returnReservation(id, { odometerIn, odometerOut } = {}) {
  const odometer_in = asOdo(odometerIn, 'Odometer in')
  if (odometer_in != null && odometerOut != null && odometerOut !== '' && odometer_in < Number(odometerOut)) {
    throw new Error('The return odometer cannot be lower than the pickup odometer.')
  }
  return patchRow(id, { status: 'returned', odometer_in })
}

export const EVENT_COLS = 'id,reservation_id,event_type,from_status,to_status,detail,actor_name,at'

/** Status history for one reservation, newest first. Throws on a failed read. */
export async function listReservationEvents(reservationId) {
  const rows = unwrap(await supabase.from('vehicle_reservation_events').select(EVENT_COLS)
    .eq('reservation_id', reservationId).order('at', { ascending: false }).order('id', { ascending: false }).limit(200))
  return rows || []
}

/**
 * Gate passes and handovers for the reservation's vehicle around the booking
 * window (one day either side), plus the records it is explicitly linked to.
 */
export async function listReservationLinks(r) {
  const asset = String(r?.asset_no || '').trim()
  if (!asset) return { gatePasses: [], handovers: [] }
  const start = r.start_at ? new Date(Date.parse(r.start_at) - 86400000) : null
  const end = r.end_at ? new Date(Date.parse(r.end_at) + 86400000) : null
  let gp = supabase.from('gate_passes').select('id,asset_no,site,pass_date,status,cleared_at').ilike('asset_no', escapeLike(asset))
  let ho = supabase.from('handover_reports').select('id,report_no,asset_no,handover_type,from_driver,to_driver,handover_at,odometer_km').ilike('asset_no', escapeLike(asset))
  if (start) { gp = gp.gte('pass_date', start.toISOString().slice(0, 10)); ho = ho.gte('handover_at', start.toISOString()) }
  if (end) { gp = gp.lte('pass_date', end.toISOString().slice(0, 10)); ho = ho.lte('handover_at', end.toISOString()) }
  const [g, h] = await Promise.all([
    gp.order('pass_date', { ascending: false }).order('id').limit(20),
    ho.order('handover_at', { ascending: false }).order('id').limit(20),
  ])
  return { gatePasses: unwrap(g) || [], handovers: unwrap(h) || [] }
}

/** Driver register for the driver picker (name and id only). */
export async function listReservationDrivers({ country } = {}) {
  const result = await fetchAllPages((from, to) =>
    applyCountry(supabase.from('drivers').select('id,driver_id,driver_name,site,status'), country)
      .order('driver_name').order('id').range(from, to), { max: 5000 })
  return unwrap(result) || []
}
