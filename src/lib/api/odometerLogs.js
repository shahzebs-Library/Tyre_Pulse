/**
 * Odometer Logs service — the single seam between the Odometer Logs page
 * (/odometer-logs) and Supabase (table `odometer_logs`, V162). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and input
 * validation. RLS enforces org isolation; this layer never trusts client input
 * blindly.
 *
 * Mirrors coldChain.js / journeys.js. A missing `odometer_logs` relation (org
 * has not run the migration) degrades listing to an empty array so the page can
 * render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../odometerLogs'

export const COLS =
  'id,organisation_id,country,asset_no,odometer_km,reading_date,source,site,' +
  'notes,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('odometer_logs'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/**
 * List readings (newest first by reading_date, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listOdometerLogs({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('odometer_logs').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('reading_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getOdometerLog(id) {
  return unwrap(await supabase.from('odometer_logs').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Log a reading. Requires an asset number (which vehicle) and a numeric
 * odometer value (km). Reading date defaults to today when omitted.
 */
export async function createOdometerLog(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')
  const odometer_km = toFiniteNumber(values.odometer_km)
  if (odometer_km == null) throw new Error('A numeric odometer reading (km) is required.')
  if (odometer_km < 0) throw new Error('Odometer reading cannot be negative.')

  const payload = {
    asset_no,
    odometer_km,
    reading_date: asDate(values.reading_date) || new Date().toISOString().slice(0, 10),
    source: asText(values.source, 120),
    site: asText(values.site, 200),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('odometer_logs').insert(payload).select(COLS).single())
}

/**
 * Patch a reading. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateOdometerLog(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.odometer_km !== undefined) {
    const odometer_km = toFiniteNumber(patch.odometer_km)
    if (odometer_km == null) throw new Error('A numeric odometer reading (km) is required.')
    if (odometer_km < 0) throw new Error('Odometer reading cannot be negative.')
    clean.odometer_km = odometer_km
  }
  if (patch.reading_date !== undefined) clean.reading_date = asDate(patch.reading_date)
  if (patch.source !== undefined) clean.source = asText(patch.source, 120)
  if (patch.site !== undefined) clean.site = asText(patch.site, 200)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('odometer_logs').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteOdometerLog(id) {
  return unwrap(await supabase.from('odometer_logs').delete().eq('id', id))
}
