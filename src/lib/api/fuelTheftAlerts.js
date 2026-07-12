/**
 * Fuel Theft Alerts service — the single seam between the Fuel Theft / Fuel
 * Anomaly Alerts page (/fuel-theft-alerts) and Supabase (table
 * `fuel_theft_alerts`, V180). Keeps an explicit column list (least-privilege
 * selects), null-safe country scoping, and input validation. RLS enforces org
 * isolation; this layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `fuel_theft_alerts` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../fuelTheftAlerts'

export const COLS =
  'id,organisation_id,country,alert_no,asset_no,driver_name,location,detected_at,' +
  'drop_litres,expected_litres,fuel_price_per_litre,estimated_loss,currency,' +
  'severity,status,resolution,notes,created_by,created_at,updated_at'

const SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const STATUSES = new Set(['open', 'investigating', 'confirmed', 'dismissed', 'resolved'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('fuel_theft_alerts'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asEnum = (v, allowed) => {
  const s = v == null || v === '' ? null : String(v).trim().toLowerCase()
  return s && allowed.has(s) ? s : null
}
/** Coerce a numeric field, rejecting negatives. Returns null when absent/blank. */
const asNonNegative = (v, label) => {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List alerts (newest first by detected_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listFuelTheftAlerts({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('fuel_theft_alerts').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('detected_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getFuelTheftAlert(id) {
  return unwrap(await supabase.from('fuel_theft_alerts').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Raise an alert. Requires an asset number (which vehicle). Numeric fields are
 * validated non-negative; severity/status are whitelisted against their enums.
 * Detected time defaults to now when omitted.
 */
export async function createFuelTheftAlert(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    alert_no: asText(values.alert_no, 60),
    driver_name: asText(values.driver_name, 200),
    location: asText(values.location, 200),
    detected_at: asTimestamp(values.detected_at) || new Date().toISOString(),
    drop_litres: asNonNegative(values.drop_litres, 'Drop (litres)'),
    expected_litres: asNonNegative(values.expected_litres, 'Expected (litres)'),
    fuel_price_per_litre: asNonNegative(values.fuel_price_per_litre, 'Fuel price per litre'),
    estimated_loss: asNonNegative(values.estimated_loss, 'Estimated loss'),
    currency: asText(values.currency, 8),
    severity: asEnum(values.severity, SEVERITIES),
    status: asEnum(values.status, STATUSES) || 'open',
    resolution: values.resolution ? String(values.resolution).slice(0, 8000) : null,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('fuel_theft_alerts').insert(payload).select(COLS).single())
}

/**
 * Patch an alert. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateFuelTheftAlert(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.alert_no !== undefined) clean.alert_no = asText(patch.alert_no, 60)
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.location !== undefined) clean.location = asText(patch.location, 200)
  if (patch.detected_at !== undefined) clean.detected_at = asTimestamp(patch.detected_at)
  if (patch.drop_litres !== undefined) clean.drop_litres = asNonNegative(patch.drop_litres, 'Drop (litres)')
  if (patch.expected_litres !== undefined) clean.expected_litres = asNonNegative(patch.expected_litres, 'Expected (litres)')
  if (patch.fuel_price_per_litre !== undefined) clean.fuel_price_per_litre = asNonNegative(patch.fuel_price_per_litre, 'Fuel price per litre')
  if (patch.estimated_loss !== undefined) clean.estimated_loss = asNonNegative(patch.estimated_loss, 'Estimated loss')
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.severity !== undefined) clean.severity = asEnum(patch.severity, SEVERITIES)
  if (patch.status !== undefined) clean.status = asEnum(patch.status, STATUSES) || 'open'
  if (patch.resolution !== undefined) clean.resolution = patch.resolution ? String(patch.resolution).slice(0, 8000) : null
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('fuel_theft_alerts').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteFuelTheftAlert(id) {
  return unwrap(await supabase.from('fuel_theft_alerts').delete().eq('id', id))
}
