/**
 * Fleet Optimizer service — the single seam between the Fleet Optimizer page
 * (/fleet-optimizer) and Supabase (table `fleet_optimizer_scenarios`, V192).
 * Keeps an explicit column list (least-privilege selects), null-safe country
 * scoping, whitelisted enum inputs and non-negative numeric validation. RLS
 * enforces org isolation; this layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `fleet_optimizer_scenarios` relation (org
 * has not run the migration) degrades listing to an empty array so the page can
 * render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../fleetOptimizer'

export const COLS =
  'id,organisation_id,country,scenario_name,asset_no,asset_type,utilization_pct,' +
  'annual_km,annual_cost,downtime_days,age_years,resale_value,currency,' +
  'recommendation,projected_saving,confidence,rationale,notes,' +
  'created_by,created_at,updated_at'

const RECOMMENDATIONS = new Set(['keep', 'replace', 'redeploy', 'dispose', 'review'])
const CONFIDENCE = new Set(['low', 'medium', 'high'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('fleet_optimizer_scenarios'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

/** Coerce & validate a non-negative numeric field; throws on a negative value. */
function asNonNegNumber(v, label) {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

const asRecommendation = (v) => {
  const s = asText(v, 20)
  if (s == null) return null
  const low = s.toLowerCase()
  return RECOMMENDATIONS.has(low) ? low : null
}
const asConfidence = (v) => {
  const s = asText(v, 20)
  if (s == null) return null
  const low = s.toLowerCase()
  return CONFIDENCE.has(low) ? low : null
}

/**
 * List scenarios (newest first by created_at). Optional `country` filter.
 * Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listOptimizerScenarios({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('fleet_optimizer_scenarios').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getOptimizerScenario(id) {
  return unwrap(
    await supabase.from('fleet_optimizer_scenarios').select(COLS).eq('id', id).maybeSingle(),
  )
}

/**
 * Create a scenario. Requires an asset number. Numeric fields are coerced and
 * must be non-negative; recommendation/confidence are whitelisted against the
 * allowed enum values (an unrecognised value is dropped, never stored).
 */
export async function createOptimizerScenario(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    scenario_name: asText(values.scenario_name, 200),
    asset_type: asText(values.asset_type, 120),
    utilization_pct: asNonNegNumber(values.utilization_pct, 'Utilisation %'),
    annual_km: asNonNegNumber(values.annual_km, 'Annual km'),
    annual_cost: asNonNegNumber(values.annual_cost, 'Annual cost'),
    downtime_days: asNonNegNumber(values.downtime_days, 'Downtime days'),
    age_years: asNonNegNumber(values.age_years, 'Age (years)'),
    resale_value: asNonNegNumber(values.resale_value, 'Resale value'),
    currency: asText(values.currency, 12),
    recommendation: asRecommendation(values.recommendation),
    projected_saving: toFiniteNumber(values.projected_saving),
    confidence: asConfidence(values.confidence),
    rationale: values.rationale ? String(values.rationale).slice(0, 8000) : null,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(
    await supabase.from('fleet_optimizer_scenarios').insert(payload).select(COLS).single(),
  )
}

/**
 * Patch a scenario. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateOptimizerScenario(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.scenario_name !== undefined) clean.scenario_name = asText(patch.scenario_name, 200)
  if (patch.asset_type !== undefined) clean.asset_type = asText(patch.asset_type, 120)
  if (patch.utilization_pct !== undefined) clean.utilization_pct = asNonNegNumber(patch.utilization_pct, 'Utilisation %')
  if (patch.annual_km !== undefined) clean.annual_km = asNonNegNumber(patch.annual_km, 'Annual km')
  if (patch.annual_cost !== undefined) clean.annual_cost = asNonNegNumber(patch.annual_cost, 'Annual cost')
  if (patch.downtime_days !== undefined) clean.downtime_days = asNonNegNumber(patch.downtime_days, 'Downtime days')
  if (patch.age_years !== undefined) clean.age_years = asNonNegNumber(patch.age_years, 'Age (years)')
  if (patch.resale_value !== undefined) clean.resale_value = asNonNegNumber(patch.resale_value, 'Resale value')
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 12)
  if (patch.recommendation !== undefined) clean.recommendation = asRecommendation(patch.recommendation)
  if (patch.projected_saving !== undefined) clean.projected_saving = toFiniteNumber(patch.projected_saving)
  if (patch.confidence !== undefined) clean.confidence = asConfidence(patch.confidence)
  if (patch.rationale !== undefined) clean.rationale = patch.rationale ? String(patch.rationale).slice(0, 8000) : null
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(
    await supabase.from('fleet_optimizer_scenarios').update(clean).eq('id', id).select(COLS).single(),
  )
}

export async function deleteOptimizerScenario(id) {
  return unwrap(await supabase.from('fleet_optimizer_scenarios').delete().eq('id', id))
}
