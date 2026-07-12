/**
 * EV Charging Sessions service — the single seam between the Charging Sessions
 * page (/charging-sessions) and Supabase (table `charging_sessions`, V166).
 * Keeps an explicit column list (least-privilege selects), null-safe country
 * scoping, and input validation. RLS enforces org isolation; this layer never
 * trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `charging_sessions` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../chargingSessions'

export const COLS =
  'id,organisation_id,country,asset_no,station_name,connector_type,started_at,' +
  'ended_at,energy_kwh,cost,currency,start_soc,end_soc,duration_min,status,' +
  'notes,created_by,created_at,updated_at'

const STATUSES = ['in_progress', 'completed', 'interrupted', 'failed']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('charging_sessions'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asStatus = (v) => {
  const s = asText(v, 20)
  return s && STATUSES.includes(s) ? s : null
}

/**
 * Coerce and validate a non-negative numeric field. Returns null when absent;
 * throws when present but invalid or negative.
 */
function nonNegNumber(v, label) {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List sessions (newest first by started_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listChargingSessions({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('charging_sessions').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('started_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getChargingSession(id) {
  return unwrap(await supabase.from('charging_sessions').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Log a charging session. Requires an asset number (which vehicle). Numeric
 * fields (energy, cost, SoC, duration) are validated non-negative when present.
 */
export async function createChargingSession(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    station_name: asText(values.station_name, 200),
    connector_type: asText(values.connector_type, 60),
    started_at: asTimestamp(values.started_at),
    ended_at: asTimestamp(values.ended_at),
    energy_kwh: nonNegNumber(values.energy_kwh, 'Energy (kWh)'),
    cost: nonNegNumber(values.cost, 'Cost'),
    currency: asText(values.currency, 8),
    start_soc: nonNegNumber(values.start_soc, 'Start SoC'),
    end_soc: nonNegNumber(values.end_soc, 'End SoC'),
    duration_min: nonNegNumber(values.duration_min, 'Duration (min)'),
    status: asStatus(values.status),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('charging_sessions').insert(payload).select(COLS).single())
}

/**
 * Patch a session. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateChargingSession(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.station_name !== undefined) clean.station_name = asText(patch.station_name, 200)
  if (patch.connector_type !== undefined) clean.connector_type = asText(patch.connector_type, 60)
  if (patch.started_at !== undefined) clean.started_at = asTimestamp(patch.started_at)
  if (patch.ended_at !== undefined) clean.ended_at = asTimestamp(patch.ended_at)
  if (patch.energy_kwh !== undefined) clean.energy_kwh = nonNegNumber(patch.energy_kwh, 'Energy (kWh)')
  if (patch.cost !== undefined) clean.cost = nonNegNumber(patch.cost, 'Cost')
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.start_soc !== undefined) clean.start_soc = nonNegNumber(patch.start_soc, 'Start SoC')
  if (patch.end_soc !== undefined) clean.end_soc = nonNegNumber(patch.end_soc, 'End SoC')
  if (patch.duration_min !== undefined) clean.duration_min = nonNegNumber(patch.duration_min, 'Duration (min)')
  if (patch.status !== undefined) clean.status = asStatus(patch.status)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('charging_sessions').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteChargingSession(id) {
  return unwrap(await supabase.from('charging_sessions').delete().eq('id', id))
}
