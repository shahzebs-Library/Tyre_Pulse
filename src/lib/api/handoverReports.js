/**
 * Vehicle Handover / Condition Reports service — the single seam between the
 * Vehicle Handover page (/vehicle-handover) and Supabase (table
 * `handover_reports`, V181). Keeps an explicit column list (least-privilege
 * selects), null-safe country scoping, input validation, and enum
 * whitelisting. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors odometerLogs.js. A missing `handover_reports` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../handoverReports'
import { safeHref } from '../safeUrl'

/** Scheme-guard a URL on write: safe → the string, anything unsafe/blank → null. */
const asUrl = (v) => { const s = safeHref(v); return s === undefined ? null : s }

export const COLS =
  'id,organisation_id,country,report_no,asset_no,handover_type,from_driver,' +
  'to_driver,handover_at,odometer_km,fuel_level_pct,condition_rating,damages,' +
  'damage_count,cleanliness,signature_url,photo_url,notes,created_by,' +
  'created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('handover_reports'))
  )
}

// ── Allowed enum values (whitelist; anything else becomes null) ──────────────
const HANDOVER_TYPES = new Set(['checkout', 'checkin'])
const CONDITION_RATINGS = new Set(['excellent', 'good', 'fair', 'poor'])
const CLEANLINESS = new Set(['clean', 'acceptable', 'dirty'])

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asEnum = (v, allowed) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return allowed.has(s) ? s : null
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Non-negative numeric coercion with a field-named error. Returns null when blank. */
function asNonNegative(v, label) {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/** Store damages as-is when it's an array/object, else null. */
function asDamages(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') return v
  return null
}

/** Derive a damage count from an explicit value or the damages payload. */
function deriveDamageCount(explicit, damages) {
  const n = toFiniteNumber(explicit)
  if (n != null && n >= 0) return Math.trunc(n)
  if (Array.isArray(damages)) return damages.length
  return null
}

/**
 * List handover reports (newest first by handover_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listHandoverReports({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('handover_reports').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('handover_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getHandoverReport(id) {
  return unwrap(await supabase.from('handover_reports').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Record a handover. Requires an asset number (which vehicle). Numerics are
 * validated non-negative; enum fields are whitelisted; handover_at defaults to
 * now when omitted. Damages are stored as provided (array/object) or null.
 */
export async function createHandoverReport(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const odometer_km = asNonNegative(values.odometer_km, 'Odometer reading (km)')
  const fuel_level_pct = asNonNegative(values.fuel_level_pct, 'Fuel level (%)')
  const damages = asDamages(values.damages)

  const payload = {
    asset_no,
    report_no: asText(values.report_no, 120),
    handover_type: asEnum(values.handover_type, HANDOVER_TYPES),
    from_driver: asText(values.from_driver, 200),
    to_driver: asText(values.to_driver, 200),
    handover_at: asTimestamp(values.handover_at) || new Date().toISOString(),
    odometer_km,
    fuel_level_pct,
    condition_rating: asEnum(values.condition_rating, CONDITION_RATINGS),
    damages,
    damage_count: deriveDamageCount(values.damage_count, damages),
    cleanliness: asEnum(values.cleanliness, CLEANLINESS),
    signature_url: asUrl(asText(values.signature_url, 2000)),
    photo_url: asUrl(asText(values.photo_url, 2000)),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('handover_reports').insert(payload).select(COLS).single())
}

/**
 * Patch a handover report. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateHandoverReport(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.report_no !== undefined) clean.report_no = asText(patch.report_no, 120)
  if (patch.handover_type !== undefined) clean.handover_type = asEnum(patch.handover_type, HANDOVER_TYPES)
  if (patch.from_driver !== undefined) clean.from_driver = asText(patch.from_driver, 200)
  if (patch.to_driver !== undefined) clean.to_driver = asText(patch.to_driver, 200)
  if (patch.handover_at !== undefined) clean.handover_at = asTimestamp(patch.handover_at)
  if (patch.odometer_km !== undefined) clean.odometer_km = asNonNegative(patch.odometer_km, 'Odometer reading (km)')
  if (patch.fuel_level_pct !== undefined) clean.fuel_level_pct = asNonNegative(patch.fuel_level_pct, 'Fuel level (%)')
  if (patch.condition_rating !== undefined) clean.condition_rating = asEnum(patch.condition_rating, CONDITION_RATINGS)
  if (patch.damages !== undefined) {
    clean.damages = asDamages(patch.damages)
    // Keep damage_count consistent with the new damages payload unless caller
    // supplies an explicit count below.
    clean.damage_count = deriveDamageCount(patch.damage_count, clean.damages)
  } else if (patch.damage_count !== undefined) {
    clean.damage_count = deriveDamageCount(patch.damage_count, null)
  }
  if (patch.cleanliness !== undefined) clean.cleanliness = asEnum(patch.cleanliness, CLEANLINESS)
  if (patch.signature_url !== undefined) clean.signature_url = asUrl(asText(patch.signature_url, 2000))
  if (patch.photo_url !== undefined) clean.photo_url = asUrl(asText(patch.photo_url, 2000))
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('handover_reports').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteHandoverReport(id) {
  return unwrap(await supabase.from('handover_reports').delete().eq('id', id))
}
