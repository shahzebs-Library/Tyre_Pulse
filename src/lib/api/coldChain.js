/**
 * Cold-Chain service — the single seam between the Cold-Chain Monitor page
 * (/cold-chain) and Supabase (table `cold_chain_logs`, V143). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and status
 * classification via the pure `src/lib/coldChain.js` helpers. RLS enforces org
 * isolation; this layer never trusts client input blindly.
 *
 * Mirrors journeys.js / support.js. A missing `cold_chain_logs` relation (org
 * has not run the migration) degrades listing to an empty array so the page can
 * render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { classifyTemp, toFiniteNumber, COLD_CHAIN_STATUSES } from '../coldChain'

export const COLS =
  'id,organisation_id,country,asset_no,site,temperature_c,min_threshold_c,' +
  'max_threshold_c,status,recorded_at,notes,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('cold_chain_logs'))
  )
}

/**
 * List readings (newest first by recorded_at, then created_at). Optional
 * `status` and `country` filters. Returns [] when the table has not been
 * provisioned yet.
 */
export async function listReadings({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('cold_chain_logs').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('recorded_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getReading(id) {
  return unwrap(await supabase.from('cold_chain_logs').select(COLS).eq('id', id).maybeSingle())
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Derive the stored status from the reading + thresholds (single source of truth). */
function statusFor(values) {
  return classifyTemp(values.temperature_c, values.min_threshold_c, values.max_threshold_c)
}

/**
 * Log a reading. Requires an asset number (which unit) and a numeric
 * temperature. Status is computed server-of-record here from the range so the
 * badge never drifts from the data.
 */
export async function createReading(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset (unit) number is required.')
  const temperature_c = toFiniteNumber(values.temperature_c)
  if (temperature_c == null) throw new Error('A numeric temperature (°C) is required.')

  const min_threshold_c = toFiniteNumber(values.min_threshold_c)
  const max_threshold_c = toFiniteNumber(values.max_threshold_c)
  const payload = {
    asset_no,
    site: asText(values.site, 200),
    temperature_c,
    min_threshold_c,
    max_threshold_c,
    status: statusFor({ temperature_c, min_threshold_c, max_threshold_c }),
    recorded_at: asTimestamp(values.recorded_at) || new Date().toISOString(),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('cold_chain_logs').insert(payload).select(COLS).single())
}

/**
 * Patch a reading. Strips immutable/ownership fields; coerces each field present
 * and re-derives status whenever the temperature or either bound changes.
 */
export async function updateReading(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset (unit) number is required.')
    clean.asset_no = asset_no
  }
  if (patch.site !== undefined) clean.site = asText(patch.site, 200)

  const touchesTemp =
    patch.temperature_c !== undefined ||
    patch.min_threshold_c !== undefined ||
    patch.max_threshold_c !== undefined

  if (patch.temperature_c !== undefined) {
    const temperature_c = toFiniteNumber(patch.temperature_c)
    if (temperature_c == null) throw new Error('A numeric temperature (°C) is required.')
    clean.temperature_c = temperature_c
  }
  if (patch.min_threshold_c !== undefined) clean.min_threshold_c = toFiniteNumber(patch.min_threshold_c)
  if (patch.max_threshold_c !== undefined) clean.max_threshold_c = toFiniteNumber(patch.max_threshold_c)
  if (patch.recorded_at !== undefined) clean.recorded_at = asTimestamp(patch.recorded_at)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  if (patch.status !== undefined && COLD_CHAIN_STATUSES.includes(patch.status)) {
    clean.status = patch.status
  }
  // Re-derive status when the reading/range moved and no explicit status given.
  if (touchesTemp && clean.status === undefined) {
    const current = await getReading(id)
    clean.status = statusFor({
      temperature_c: clean.temperature_c ?? current?.temperature_c,
      min_threshold_c: clean.min_threshold_c ?? current?.min_threshold_c,
      max_threshold_c: clean.max_threshold_c ?? current?.max_threshold_c,
    })
  }
  return unwrap(await supabase.from('cold_chain_logs').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteReading(id) {
  return unwrap(await supabase.from('cold_chain_logs').delete().eq('id', id))
}
