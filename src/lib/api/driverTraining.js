/**
 * Driver Training service — the single seam between the Driver Training page
 * (/driver-training) and Supabase (table `driver_training`, V182). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping,
 * input validation, and enum whitelisting. RLS enforces org isolation; this
 * layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js / coldChain.js. A missing `driver_training` relation
 * (org has not run the migration) degrades listing to an empty array so the
 * page can render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../driverTraining'

export const COLS =
  'id,organisation_id,country,driver_name,course_name,category,provider,' +
  'completed_date,expiry_date,score,pass_mark,result,certificate_no,' +
  'certificate_url,cost,currency,notes,created_by,created_at,updated_at'

const CATEGORIES = new Set([
  'defensive', 'hazmat', 'first_aid', 'vehicle_specific', 'compliance',
  'induction', 'other',
])
const RESULTS = new Set(['pass', 'fail', 'pending'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('driver_training'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asEnum = (v, allowed) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return allowed.has(s) ? s : null
}
/** Non-negative numeric coercion; throws with `label` when invalid/negative. */
const asNonNegNumber = (v, label) => {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List training records (newest first by completed_date, then created_at).
 * Optional `country` filter. Returns [] when the table is not provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listDriverTraining({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('driver_training').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('completed_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getDriverTrainingRecord(id) {
  return unwrap(await supabase.from('driver_training').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Record a completed/planned training. Requires a driver name. Numeric fields
 * (score, pass_mark, cost) are validated non-negative; category and result are
 * whitelisted to the allowed enums (invalid values are dropped to null).
 */
export async function createDriverTrainingRecord(values = {}) {
  const driver_name = asText(values.driver_name, 200)
  if (!driver_name) throw new Error('A driver name is required.')

  const payload = {
    driver_name,
    course_name: asText(values.course_name, 200),
    category: asEnum(values.category, CATEGORIES),
    provider: asText(values.provider, 200),
    completed_date: asDate(values.completed_date),
    expiry_date: asDate(values.expiry_date),
    score: asNonNegNumber(values.score, 'Score'),
    pass_mark: asNonNegNumber(values.pass_mark, 'Pass mark'),
    result: asEnum(values.result, RESULTS),
    certificate_no: asText(values.certificate_no, 120),
    certificate_url: asText(values.certificate_url, 2000),
    cost: asNonNegNumber(values.cost, 'Cost'),
    currency: asText(values.currency, 8),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('driver_training').insert(payload).select(COLS).single())
}

/**
 * Patch a training record. Strips immutable/ownership fields; coerces each
 * field present so the stored value never drifts from the validated shape.
 */
export async function updateDriverTrainingRecord(id, patch = {}) {
  const clean = {}
  if (patch.driver_name !== undefined) {
    const driver_name = asText(patch.driver_name, 200)
    if (!driver_name) throw new Error('A driver name is required.')
    clean.driver_name = driver_name
  }
  if (patch.course_name !== undefined) clean.course_name = asText(patch.course_name, 200)
  if (patch.category !== undefined) clean.category = asEnum(patch.category, CATEGORIES)
  if (patch.provider !== undefined) clean.provider = asText(patch.provider, 200)
  if (patch.completed_date !== undefined) clean.completed_date = asDate(patch.completed_date)
  if (patch.expiry_date !== undefined) clean.expiry_date = asDate(patch.expiry_date)
  if (patch.score !== undefined) clean.score = asNonNegNumber(patch.score, 'Score')
  if (patch.pass_mark !== undefined) clean.pass_mark = asNonNegNumber(patch.pass_mark, 'Pass mark')
  if (patch.result !== undefined) clean.result = asEnum(patch.result, RESULTS)
  if (patch.certificate_no !== undefined) clean.certificate_no = asText(patch.certificate_no, 120)
  if (patch.certificate_url !== undefined) clean.certificate_url = asText(patch.certificate_url, 2000)
  if (patch.cost !== undefined) clean.cost = asNonNegNumber(patch.cost, 'Cost')
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('driver_training').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteDriverTrainingRecord(id) {
  return unwrap(await supabase.from('driver_training').delete().eq('id', id))
}
