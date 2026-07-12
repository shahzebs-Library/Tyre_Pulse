/**
 * Breakdown Callouts service — the single seam between the Roadside Assistance /
 * Breakdown Callouts page (/breakdown-callouts) and Supabase (table
 * `breakdown_callouts`, V176). Keeps an explicit column list (least-privilege
 * selects), null-safe country scoping, enum whitelisting, and input validation.
 * RLS enforces org isolation; this layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `breakdown_callouts` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../breakdownCallouts'

export const COLS =
  'id,organisation_id,country,callout_no,asset_no,driver_name,location,' +
  'breakdown_type,severity,reported_at,dispatched_at,resolved_at,provider,' +
  'cost,currency,status,resolution,notes,created_by,created_at,updated_at'

const BREAKDOWN_TYPES = ['tyre', 'engine', 'electrical', 'brakes', 'transmission', 'accident', 'fuel', 'other']
const SEVERITIES = ['low', 'medium', 'high', 'critical']
const STATUSES = ['reported', 'dispatched', 'on_site', 'resolved', 'cancelled']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('breakdown_callouts'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asEnum = (v, allowed) => {
  if (v == null || v === '') return null
  const s = String(v).trim().toLowerCase()
  return allowed.includes(s) ? s : null
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * List callouts (newest first by reported_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listBreakdownCallouts({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('breakdown_callouts').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('reported_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getBreakdownCallout(id) {
  return unwrap(await supabase.from('breakdown_callouts').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Log a breakdown callout. Requires an asset number (which vehicle). Cost, when
 * provided, must be non-negative. Enum fields are whitelisted; unknown values are
 * dropped to null rather than rejected so partial field data still saves.
 */
export async function createBreakdownCallout(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  let cost = null
  if (values.cost !== undefined && values.cost !== '' && values.cost != null) {
    cost = toFiniteNumber(values.cost)
    if (cost == null) throw new Error('Cost must be a number.')
    if (cost < 0) throw new Error('Cost cannot be negative.')
  }

  const payload = {
    asset_no,
    callout_no: asText(values.callout_no, 80),
    driver_name: asText(values.driver_name, 160),
    location: asText(values.location, 300),
    breakdown_type: asEnum(values.breakdown_type, BREAKDOWN_TYPES),
    severity: asEnum(values.severity, SEVERITIES),
    reported_at: asTimestamp(values.reported_at) || new Date().toISOString(),
    dispatched_at: asTimestamp(values.dispatched_at),
    resolved_at: asTimestamp(values.resolved_at),
    provider: asText(values.provider, 200),
    cost,
    currency: asText(values.currency, 8),
    status: asEnum(values.status, STATUSES) || 'reported',
    resolution: values.resolution ? String(values.resolution).slice(0, 8000) : null,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('breakdown_callouts').insert(payload).select(COLS).single())
}

/**
 * Patch a callout. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateBreakdownCallout(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.callout_no !== undefined) clean.callout_no = asText(patch.callout_no, 80)
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 160)
  if (patch.location !== undefined) clean.location = asText(patch.location, 300)
  if (patch.breakdown_type !== undefined) clean.breakdown_type = asEnum(patch.breakdown_type, BREAKDOWN_TYPES)
  if (patch.severity !== undefined) clean.severity = asEnum(patch.severity, SEVERITIES)
  if (patch.reported_at !== undefined) clean.reported_at = asTimestamp(patch.reported_at)
  if (patch.dispatched_at !== undefined) clean.dispatched_at = asTimestamp(patch.dispatched_at)
  if (patch.resolved_at !== undefined) clean.resolved_at = asTimestamp(patch.resolved_at)
  if (patch.provider !== undefined) clean.provider = asText(patch.provider, 200)
  if (patch.cost !== undefined) {
    if (patch.cost === '' || patch.cost == null) {
      clean.cost = null
    } else {
      const cost = toFiniteNumber(patch.cost)
      if (cost == null) throw new Error('Cost must be a number.')
      if (cost < 0) throw new Error('Cost cannot be negative.')
      clean.cost = cost
    }
  }
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.status !== undefined) clean.status = asEnum(patch.status, STATUSES) || 'reported'
  if (patch.resolution !== undefined) clean.resolution = patch.resolution ? String(patch.resolution).slice(0, 8000) : null
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('breakdown_callouts').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteBreakdownCallout(id) {
  return unwrap(await supabase.from('breakdown_callouts').delete().eq('id', id))
}
