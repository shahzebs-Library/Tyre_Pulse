/**
 * Emissions Tests service — the single seam between the Emissions / Smog
 * Compliance page (/emissions) and Supabase (table `emissions_tests`, V178).
 * Keeps an explicit column list (least-privilege selects), null-safe country
 * scoping, and input validation. RLS enforces org isolation; this layer never
 * trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `emissions_tests` relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../emissionsTests'

export const COLS =
  'id,organisation_id,country,certificate_no,asset_no,test_date,expiry_date,' +
  'test_center,standard,co_pct,hc_ppm,nox_ppm,opacity_pct,co2_pct,result,' +
  'cost,currency,notes,created_by,created_at,updated_at'

const RESULTS = new Set(['pass', 'fail', 'conditional'])

/** Numeric measurement / cost fields validated as non-negative when present. */
const NUMERIC_FIELDS = ['co_pct', 'hc_ppm', 'nox_ppm', 'opacity_pct', 'co2_pct', 'cost']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('emissions_tests'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asResult = (v) => {
  if (v == null || v === '') return null
  const s = String(v).trim().toLowerCase()
  if (!RESULTS.has(s)) throw new Error('Result must be one of: pass, fail, conditional.')
  return s
}

/**
 * Coerce a numeric field, enforcing a non-negative value. Returns null when the
 * field is empty/omitted. Throws when the value is non-numeric or negative.
 */
function asMeasurement(v, label) {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

const FIELD_LABELS = {
  co_pct: 'CO (%)', hc_ppm: 'HC (ppm)', nox_ppm: 'NOx (ppm)',
  opacity_pct: 'Opacity (%)', co2_pct: 'CO₂ (%)', cost: 'Cost',
}

/**
 * List emissions tests (newest first by test_date, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listEmissionsTests({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('emissions_tests').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('test_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getEmissionsTest(id) {
  return unwrap(await supabase.from('emissions_tests').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Record an emissions test. Requires an asset number (which vehicle). Gas
 * readings and cost are validated non-negative; the result is whitelisted to the
 * pass/fail/conditional enum. Test date defaults to today when omitted.
 */
export async function createEmissionsTest(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    certificate_no: asText(values.certificate_no, 120),
    test_date: asDate(values.test_date) || new Date().toISOString().slice(0, 10),
    expiry_date: asDate(values.expiry_date),
    test_center: asText(values.test_center, 200),
    standard: asText(values.standard, 120),
    result: asResult(values.result),
    currency: asText(values.currency, 8),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  for (const f of NUMERIC_FIELDS) payload[f] = asMeasurement(values[f], FIELD_LABELS[f])

  return unwrap(await supabase.from('emissions_tests').insert(payload).select(COLS).single())
}

/**
 * Patch a test. Strips immutable/ownership fields; coerces each field present so
 * the stored value never drifts from the validated shape.
 */
export async function updateEmissionsTest(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.certificate_no !== undefined) clean.certificate_no = asText(patch.certificate_no, 120)
  if (patch.test_date !== undefined) clean.test_date = asDate(patch.test_date)
  if (patch.expiry_date !== undefined) clean.expiry_date = asDate(patch.expiry_date)
  if (patch.test_center !== undefined) clean.test_center = asText(patch.test_center, 200)
  if (patch.standard !== undefined) clean.standard = asText(patch.standard, 120)
  if (patch.result !== undefined) clean.result = asResult(patch.result)
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null
  for (const f of NUMERIC_FIELDS) {
    if (patch[f] !== undefined) clean[f] = asMeasurement(patch[f], FIELD_LABELS[f])
  }

  return unwrap(await supabase.from('emissions_tests').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteEmissionsTest(id) {
  return unwrap(await supabase.from('emissions_tests').delete().eq('id', id))
}
