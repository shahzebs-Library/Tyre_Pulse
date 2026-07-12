/**
 * Weighbridge Tickets service — the single seam between the Weighbridge page
 * (/weighbridge) and Supabase (table `weighbridge_tickets`, V177). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping,
 * and input validation. RLS enforces org isolation; this layer never trusts
 * client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `weighbridge_tickets` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../weighbridgeTickets'

export const COLS =
  'id,organisation_id,country,ticket_no,asset_no,driver_name,site,weighed_at,' +
  'gross_weight_kg,tare_weight_kg,net_weight_kg,axle_weights,gross_limit_kg,' +
  'cargo_type,status,notes,created_by,created_at,updated_at'

const STATUSES = ['draft', 'recorded', 'overweight', 'disputed', 'cleared']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('weighbridge_tickets'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asStatus = (v) => {
  const s = asText(v, 40)
  return s && STATUSES.includes(s) ? s : null
}
/** Accept an array/object as-is (stored as jsonb); anything else → null. */
const asAxleWeights = (v) => {
  if (v == null || v === '') return null
  if (Array.isArray(v) || typeof v === 'object') return v
  return null
}
/** Coerce a non-negative weight, or throw with a field-specific message. */
const asWeight = (v, label) => {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List tickets (newest first by weighed_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listWeighbridgeTickets({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('weighbridge_tickets').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('weighed_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getWeighbridgeTicket(id) {
  return unwrap(await supabase.from('weighbridge_tickets').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Record a ticket. Requires an asset number (which vehicle). Weight fields are
 * validated non-negative; status is whitelisted; axle_weights is stored as-is
 * (array/object) or null. weighed_at defaults to now when omitted.
 */
export async function createWeighbridgeTicket(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    ticket_no: asText(values.ticket_no, 120),
    driver_name: asText(values.driver_name, 200),
    site: asText(values.site, 200),
    weighed_at: asTimestamp(values.weighed_at) || new Date().toISOString(),
    gross_weight_kg: asWeight(values.gross_weight_kg, 'Gross weight'),
    tare_weight_kg: asWeight(values.tare_weight_kg, 'Tare weight'),
    net_weight_kg: asWeight(values.net_weight_kg, 'Net weight'),
    axle_weights: asAxleWeights(values.axle_weights),
    gross_limit_kg: asWeight(values.gross_limit_kg, 'Gross limit'),
    cargo_type: asText(values.cargo_type, 200),
    status: asStatus(values.status),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('weighbridge_tickets').insert(payload).select(COLS).single())
}

/**
 * Patch a ticket. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateWeighbridgeTicket(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.ticket_no !== undefined) clean.ticket_no = asText(patch.ticket_no, 120)
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.site !== undefined) clean.site = asText(patch.site, 200)
  if (patch.weighed_at !== undefined) clean.weighed_at = asTimestamp(patch.weighed_at)
  if (patch.gross_weight_kg !== undefined) clean.gross_weight_kg = asWeight(patch.gross_weight_kg, 'Gross weight')
  if (patch.tare_weight_kg !== undefined) clean.tare_weight_kg = asWeight(patch.tare_weight_kg, 'Tare weight')
  if (patch.net_weight_kg !== undefined) clean.net_weight_kg = asWeight(patch.net_weight_kg, 'Net weight')
  if (patch.axle_weights !== undefined) clean.axle_weights = asAxleWeights(patch.axle_weights)
  if (patch.gross_limit_kg !== undefined) clean.gross_limit_kg = asWeight(patch.gross_limit_kg, 'Gross limit')
  if (patch.cargo_type !== undefined) clean.cargo_type = asText(patch.cargo_type, 200)
  if (patch.status !== undefined) clean.status = asStatus(patch.status)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('weighbridge_tickets').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteWeighbridgeTicket(id) {
  return unwrap(await supabase.from('weighbridge_tickets').delete().eq('id', id))
}
