/**
 * Supabase boundary for `accident_dispatches` - one row per dispatch leg of a
 * vehicle to a workshop (mock M2: dispatch details, outgoing handover
 * condition, vendor receipt + custody acceptance). Direct RLS-governed
 * read/write, same class as accidentHandover.js / accidentDowntime.js: the
 * table has no dedicated RPC.
 *
 * SHIP-BEFORE-MIGRATE: the table is created by
 * supabase/migrations/20260916130000_accident_mock_field_parity.sql, which is
 * NOT yet applied to the live database. Reads therefore report
 * `provisioned:false` (never a thrown error) so the tab can render an honest
 * "not provisioned" note, and writes fail with a plain sentence.
 */
import { supabase, unwrap, isMissingRelation, isMissingColumn } from './_client'
import { DISPATCH_LIVE_STATES } from '../accidentCaseVocab'

export const DISPATCH_COLS =
  'id,accident_id,repair_order_id,country,site,' +
  'sent_by_id,sent_by_name,departure_at,carrier,driver_name,recovery_vehicle,origin,destination,eta_at,live_status,' +
  'out_odometer_km,out_engine_hours,out_fuel_pct,keys_count,documents_sent,accessories,outgoing_photos,' +
  'outgoing_signed_by,outgoing_signed_at,outgoing_signature,' +
  'arrived_at,received_by_name,received_by_designation,in_odometer_km,in_engine_hours,in_fuel_pct,' +
  'condition_matches,additional_damage_remarks,receiving_photos,handover_paper_ref,receiver_signature,sender_signature,' +
  'custody_accepted,accepted_at,accepted_by_id,created_by,created_at,updated_at'

const LIVE_STATUS_TOKENS = DISPATCH_LIVE_STATES.map((s) => s.key)

export const NOT_PROVISIONED_MESSAGE =
  'Dispatch records are not provisioned on this database yet. Ask an administrator to apply the accident mock field parity migration.'

/** Every column a caller may write. Anything else is dropped so a form draft
 *  cannot smuggle a key the table does not have. */
const WRITABLE = new Set(DISPATCH_COLS.split(',').filter((c) =>
  !['id', 'accident_id', 'created_by', 'created_at', 'updated_at', 'accepted_by_id'].includes(c)))

function pickWritable(patch) {
  const out = {}
  for (const [k, v] of Object.entries(patch || {})) {
    if (WRITABLE.has(k)) out[k] = v === '' ? null : v
  }
  return out
}

function notProvisioned(err) {
  // Column first: a missing-column message also contains "does not exist",
  // which isMissingRelation's text fallback would otherwise swallow.
  return !isMissingColumn(err) && isMissingRelation(err)
}

/**
 * Dispatch legs for a case, newest first.
 * @returns {Promise<{rows:object[], provisioned:boolean}>}
 */
export async function listDispatches(accidentId) {
  if (!accidentId) return { rows: [], provisioned: true }
  try {
    const rows = unwrap(
      await supabase
        .from('accident_dispatches')
        .select(DISPATCH_COLS)
        .eq('accident_id', accidentId)
        .order('created_at', { ascending: false }),
    ) || []
    return { rows, provisioned: true }
  } catch (err) {
    if (notProvisioned(err)) return { rows: [], provisioned: false }
    throw err
  }
}

/** The current (latest) dispatch leg, or null, plus whether the table exists. */
export async function getLatestDispatch(accidentId) {
  const { rows, provisioned } = await listDispatches(accidentId)
  return { row: rows[0] || null, provisioned }
}

/**
 * Insert or update a dispatch leg. Pass `existingId` to update in place; the
 * same leg is edited as details firm up (carrier, ETA, outgoing condition),
 * while a genuinely new leg (return trip) is a new row.
 */
export async function saveDispatch(accidentId, patch, { existingId } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  const row = pickWritable(patch)
  if (row.live_status && !LIVE_STATUS_TOKENS.includes(row.live_status)) {
    throw new Error(`Invalid dispatch status "${row.live_status}".`)
  }
  for (const k of ['out_fuel_pct', 'in_fuel_pct']) {
    if (row[k] != null && (Number(row[k]) < 0 || Number(row[k]) > 100)) throw new Error('Fuel level must be between 0 and 100 percent.')
  }
  try {
    if (existingId) {
      return unwrap(
        await supabase.from('accident_dispatches').update(row).eq('id', existingId).select(DISPATCH_COLS).single(),
      )
    }
    return unwrap(
      await supabase.from('accident_dispatches').insert({ accident_id: accidentId, ...row }).select(DISPATCH_COLS).single(),
    )
  } catch (err) {
    if (notProvisioned(err)) throw new Error(NOT_PROVISIONED_MESSAGE)
    throw err
  }
}

/**
 * The vendor signs and accepts the vehicle: live_status -> accepted,
 * custody_accepted -> true, accepted_at -> now, plus any last receipt fields
 * carried in `patch`. The caller (HandoverPanel) ALSO records the legacy
 * accident_handover_inspections row so the older flow stays consistent.
 */
export async function acceptCustody(dispatchId, patch = {}) {
  if (!dispatchId) throw new Error('A dispatch record is required.')
  const row = {
    ...pickWritable(patch),
    live_status: 'accepted',
    custody_accepted: true,
    accepted_at: new Date().toISOString(),
  }
  try {
    return unwrap(
      await supabase.from('accident_dispatches').update(row).eq('id', dispatchId).select(DISPATCH_COLS).single(),
    )
  } catch (err) {
    if (notProvisioned(err)) throw new Error(NOT_PROVISIONED_MESSAGE)
    throw err
  }
}
