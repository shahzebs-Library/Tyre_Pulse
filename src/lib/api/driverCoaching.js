/**
 * Driver Coaching service — the single seam between the Driver Coaching page
 * (/driver-coaching) and Supabase (table `driver_coaching`, V187). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping,
 * and input validation. RLS enforces org isolation; this layer never trusts
 * client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `driver_coaching` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../driverCoaching'

export const COLS =
  'id,organisation_id,country,driver_name,period,safety_score,fuel_score,' +
  'harsh_events,idling_min,distance_km,coaching_status,coach,coaching_notes,' +
  'improvement_pct,rank,notes,created_by,created_at,updated_at'

const COACHING_STATUSES = new Set(['none', 'recommended', 'scheduled', 'completed'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('driver_coaching'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

/** Whitelist a coaching status; unknown values become null so bad input is dropped. */
function asStatus(v) {
  if (v == null || v === '') return null
  const s = String(v).trim().toLowerCase()
  return COACHING_STATUSES.has(s) ? s : null
}

/**
 * Validate a numeric metric that must not be negative. Returns null when the
 * value is absent, or a finite number; throws when it is present but invalid or
 * negative so callers surface a clear message.
 */
function asNonNegative(v, label) {
  if (v == null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List scorecards (newest first by created_at). Optional `country` filter.
 * Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listDriverCoaching({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('driver_coaching').select(COLS)
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

export async function getDriverCoaching(id) {
  return unwrap(await supabase.from('driver_coaching').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a driver scorecard. Requires a driver name. All numeric metrics are
 * validated non-negative; the coaching status is whitelisted.
 */
export async function createDriverCoaching(values = {}) {
  const driver_name = asText(values.driver_name, 200)
  if (!driver_name) throw new Error('A driver name is required.')

  const payload = {
    driver_name,
    period: asText(values.period, 60),
    safety_score: asNonNegative(values.safety_score, 'Safety score'),
    fuel_score: asNonNegative(values.fuel_score, 'Fuel score'),
    harsh_events: asNonNegative(values.harsh_events, 'Harsh events'),
    idling_min: asNonNegative(values.idling_min, 'Idling minutes'),
    distance_km: asNonNegative(values.distance_km, 'Distance (km)'),
    coaching_status: asStatus(values.coaching_status),
    coach: asText(values.coach, 200),
    coaching_notes: values.coaching_notes ? String(values.coaching_notes).slice(0, 8000) : null,
    improvement_pct: values.improvement_pct === '' || values.improvement_pct == null
      ? null
      : toFiniteNumber(values.improvement_pct),
    rank: values.rank == null || values.rank === '' ? null : (toFiniteNumber(values.rank) ?? null),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('driver_coaching').insert(payload).select(COLS).single())
}

/**
 * Patch a scorecard. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateDriverCoaching(id, patch = {}) {
  const clean = {}
  if (patch.driver_name !== undefined) {
    const driver_name = asText(patch.driver_name, 200)
    if (!driver_name) throw new Error('A driver name is required.')
    clean.driver_name = driver_name
  }
  if (patch.period !== undefined) clean.period = asText(patch.period, 60)
  if (patch.safety_score !== undefined) clean.safety_score = asNonNegative(patch.safety_score, 'Safety score')
  if (patch.fuel_score !== undefined) clean.fuel_score = asNonNegative(patch.fuel_score, 'Fuel score')
  if (patch.harsh_events !== undefined) clean.harsh_events = asNonNegative(patch.harsh_events, 'Harsh events')
  if (patch.idling_min !== undefined) clean.idling_min = asNonNegative(patch.idling_min, 'Idling minutes')
  if (patch.distance_km !== undefined) clean.distance_km = asNonNegative(patch.distance_km, 'Distance (km)')
  if (patch.coaching_status !== undefined) clean.coaching_status = asStatus(patch.coaching_status)
  if (patch.coach !== undefined) clean.coach = asText(patch.coach, 200)
  if (patch.coaching_notes !== undefined) clean.coaching_notes = patch.coaching_notes ? String(patch.coaching_notes).slice(0, 8000) : null
  if (patch.improvement_pct !== undefined) clean.improvement_pct = patch.improvement_pct === '' || patch.improvement_pct == null ? null : toFiniteNumber(patch.improvement_pct)
  if (patch.rank !== undefined) clean.rank = patch.rank == null || patch.rank === '' ? null : (toFiniteNumber(patch.rank) ?? null)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('driver_coaching').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteDriverCoaching(id) {
  return unwrap(await supabase.from('driver_coaching').delete().eq('id', id))
}
