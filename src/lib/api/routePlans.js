/**
 * Route Plans service — the single seam between the Route Optimization page
 * (/route-optimization) and Supabase (table `route_plans`, V165). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping,
 * and input validation. RLS enforces org isolation; this layer never trusts
 * client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `route_plans` relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../routePlans'

export const COLS =
  'id,organisation_id,country,plan_name,asset_no,driver_name,plan_date,' +
  'stops_count,total_distance_km,optimized_distance_km,estimated_duration_min,' +
  'savings_km,status,waypoints,notes,created_by,created_at,updated_at'

const STATUSES = ['draft', 'optimized', 'dispatched', 'completed']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('route_plans'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asStatus = (v) => {
  const s = v == null ? null : String(v).trim().toLowerCase()
  return s && STATUSES.includes(s) ? s : null
}
/** Accept an array/object of waypoints and store as-is; null when absent. */
const asWaypoints = (v) => {
  if (v == null || v === '') return null
  if (Array.isArray(v) || typeof v === 'object') return v
  return null
}
/** Validate a non-negative numeric field; throws with a field-specific message. */
const asNonNegative = (v, label) => {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List route plans (newest first by plan_date, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listRoutePlans({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('route_plans').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('plan_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getRoutePlan(id) {
  return unwrap(await supabase.from('route_plans').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a route plan. Requires a plan name. Distance/duration/stops fields are
 * validated as non-negative numerics when present. Savings is derived from the
 * total vs optimised distance when both are available so the stored figure
 * always agrees with the source distances.
 */
export async function createRoutePlan(values = {}) {
  const plan_name = asText(values.plan_name, 200)
  if (!plan_name) throw new Error('A plan name is required.')

  const total_distance_km = asNonNegative(values.total_distance_km, 'Total distance (km)')
  const optimized_distance_km = asNonNegative(values.optimized_distance_km, 'Optimized distance (km)')
  const estimated_duration_min = asNonNegative(values.estimated_duration_min, 'Estimated duration (min)')
  const stops_count = asNonNegative(values.stops_count, 'Stops')

  let savings_km = asNonNegative(values.savings_km, 'Savings (km)')
  if (savings_km == null && total_distance_km != null && optimized_distance_km != null) {
    savings_km = Math.max(0, total_distance_km - optimized_distance_km)
  }

  const payload = {
    plan_name,
    asset_no: asText(values.asset_no, 120),
    driver_name: asText(values.driver_name, 200),
    plan_date: asDate(values.plan_date) || new Date().toISOString().slice(0, 10),
    stops_count: stops_count == null ? null : Math.round(stops_count),
    total_distance_km,
    optimized_distance_km,
    estimated_duration_min,
    savings_km,
    status: asStatus(values.status) || 'draft',
    waypoints: asWaypoints(values.waypoints),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('route_plans').insert(payload).select(COLS).single())
}

/**
 * Patch a route plan. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape. Re-derives
 * savings when a distance field changes and no explicit savings is supplied.
 */
export async function updateRoutePlan(id, patch = {}) {
  const clean = {}
  if (patch.plan_name !== undefined) {
    const plan_name = asText(patch.plan_name, 200)
    if (!plan_name) throw new Error('A plan name is required.')
    clean.plan_name = plan_name
  }
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.plan_date !== undefined) clean.plan_date = asDate(patch.plan_date)
  if (patch.stops_count !== undefined) {
    const stops = asNonNegative(patch.stops_count, 'Stops')
    clean.stops_count = stops == null ? null : Math.round(stops)
  }
  if (patch.total_distance_km !== undefined) clean.total_distance_km = asNonNegative(patch.total_distance_km, 'Total distance (km)')
  if (patch.optimized_distance_km !== undefined) clean.optimized_distance_km = asNonNegative(patch.optimized_distance_km, 'Optimized distance (km)')
  if (patch.estimated_duration_min !== undefined) clean.estimated_duration_min = asNonNegative(patch.estimated_duration_min, 'Estimated duration (min)')
  if (patch.savings_km !== undefined) clean.savings_km = asNonNegative(patch.savings_km, 'Savings (km)')
  if (patch.status !== undefined) clean.status = asStatus(patch.status)
  if (patch.waypoints !== undefined) clean.waypoints = asWaypoints(patch.waypoints)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  // Re-derive savings when a distance moved and no explicit savings was given.
  if (
    clean.savings_km === undefined &&
    (clean.total_distance_km !== undefined || clean.optimized_distance_km !== undefined) &&
    clean.total_distance_km != null && clean.optimized_distance_km != null
  ) {
    clean.savings_km = Math.max(0, clean.total_distance_km - clean.optimized_distance_km)
  }

  return unwrap(await supabase.from('route_plans').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteRoutePlan(id) {
  return unwrap(await supabase.from('route_plans').delete().eq('id', id))
}
