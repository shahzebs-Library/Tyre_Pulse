/**
 * Workforce work-duration estimation from HISTORICAL completed assignments.
 *
 * Pure functions, no I/O. Mirrors the database objects in
 * supabase/migrations/20261023091000_workforce_transitions_and_estimation.sql:
 *   - computeActiveMinutes()  <->  view workforce_assignment_durations
 *   - percentile()            <->  percentile_cont (linear interpolation)
 *   - pickEstimate()          decides what the screen may say about the SQL tier statistics.
 *
 * Rules (no estimate is ever invented):
 *   - A tier is usable only with at least MIN_SAMPLES completed observations.
 *   - The most specific usable tier wins: task+vehicle+role, then task+vehicle, task+role, task.
 *   - With no usable tier the answer is "insufficient history" and carries NO number.
 *   - The figure is a historical median of ACTIVE minutes (time in progress). It excludes blocked
 *     time and review waiting, so it is an effort estimate, not a delivery-date promise.
 */
export const MIN_SAMPLES = 5
export const DEFAULT_MIN_MINUTES = 1
export const DEFAULT_MAX_MINUTES = 10080

export const TIERS = Object.freeze([
  Object.freeze({ tier: 'task_vehicle_role', vehicle: true, role: true, label: 'the same task, vehicle type and role' }),
  Object.freeze({ tier: 'task_vehicle', vehicle: true, role: false, label: 'the same task and vehicle type' }),
  Object.freeze({ tier: 'task_role', vehicle: false, role: true, label: 'the same task and role' }),
  Object.freeze({ tier: 'task', vehicle: false, role: false, label: 'the same task type' }),
])

const collapse = v => String(v ?? '').trim().replace(/\s+/g, ' ')
export const normalizeTaskType = v => collapse(v).toLowerCase() || null
export const normalizeVehicleType = v => collapse(v).toUpperCase() || null
export const normalizeRole = v => collapse(v) || null
const num = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
const finite = v => Number.isFinite(num(v))
const round1 = x => Math.round(x * 10) / 10

/** Linear-interpolation percentile over an ascending array (same as SQL percentile_cont). */
export function percentile(sortedAscending, p) {
  const a = sortedAscending
  if (!Array.isArray(a) || a.length === 0 || !(p >= 0 && p <= 1)) return null
  const pos = (a.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return a[lo] + (a[hi] - a[lo]) * (pos - lo)
}

export function summarize(values) {
  const clean = (values || []).map(num).filter(Number.isFinite).sort((x, y) => x - y)
  if (!clean.length) return { n: 0, p25: null, median: null, p75: null, p90: null }
  return {
    n: clean.length,
    p25: round1(percentile(clean, 0.25)),
    median: round1(percentile(clean, 0.5)),
    p75: round1(percentile(clean, 0.75)),
    p90: round1(percentile(clean, 0.9)),
  }
}

/**
 * Active minutes for one assignment from its transition events (JS mirror of the SQL view).
 * Counts the time between an event that ENTERS in_progress and the next event, only for intervals
 * that start before the LAST 'complete'. Returns null when there is no complete event.
 */
export function computeActiveMinutes(events) {
  const list = [...(events || [])].sort((a, b) =>
    Date.parse(a.effective_at) - Date.parse(b.effective_at) ||
    Date.parse(a.occurred_at ?? a.effective_at) - Date.parse(b.occurred_at ?? b.effective_at) ||
    String(a.id ?? '').localeCompare(String(b.id ?? '')))
  const completes = list.filter(e => e.action === 'complete')
  if (!completes.length) return null
  const completedAt = Math.max(...completes.map(e => Date.parse(e.effective_at)))
  let total = 0
  let counted = false
  for (let i = 0; i < list.length - 1; i++) {
    const e = list[i]
    const start = Date.parse(e.effective_at)
    if (e.to_status === 'in_progress' && start < completedAt) {
      total += (Date.parse(list[i + 1].effective_at) - start) / 60000
      counted = true
    }
  }
  return counted ? round1(total) : null
}

/** Tier statistics from raw sample rows, shaped like workforce_duration_estimate().tiers. */
export function tiersFromSamples(samples, query = {}, { minMinutes = DEFAULT_MIN_MINUTES, maxMinutes = DEFAULT_MAX_MINUTES } = {}) {
  const t = normalizeTaskType(query.task_type)
  const v = normalizeVehicleType(query.vehicle_type)
  const r = normalizeRole(query.role)
  const base = (samples || []).filter(s =>
    normalizeTaskType(s.task_type) === t && finite(s.active_minutes) &&
    num(s.active_minutes) >= minMinutes && num(s.active_minutes) <= maxMinutes)
  return TIERS.map(def => {
    const rows = base.filter(s =>
      (!def.vehicle || (v !== null && normalizeVehicleType(s.vehicle_type) === v)) &&
      (!def.role || (r !== null && normalizeRole(s.assignee_role) === r)))
    return { tier: def.tier, ...summarize(rows.map(s => s.active_minutes)) }
  })
}

const LEVELS = ['low', 'medium', 'high']

export function confidenceFor({ n, p25, median, p75 }, { broaderThanRequested = false } = {}) {
  let level = n >= 30 ? 2 : n >= 10 ? 1 : 0
  if (finite(median) && num(median) > 0 && finite(p25) && finite(p75) && (num(p75) - num(p25)) / num(median) > 1) level -= 1
  if (broaderThanRequested) level = Math.min(level, 1)
  return LEVELS[Math.max(0, level)]
}

export function formatMinutes(minutes) {
  if (!finite(minutes)) return 'N/A'
  const m = Math.round(num(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

/**
 * Decide what may be shown. `result` is the object returned by workforce_duration_estimate()
 * ({ task_type, vehicle_type, role, tiers: [{ tier, n, p25, median, p75, p90 }] }).
 */
export function pickEstimate(result, { minSamples = MIN_SAMPLES } = {}) {
  if (!result || !result.task_type) {
    return { status: 'no_task_type', message: 'Choose a task type to see an estimate from completed work.' }
  }
  const byTier = new Map((result.tiers || []).map(t => [t.tier, t]))
  const applicable = TIERS.filter(def => (!def.vehicle || result.vehicle_type) && (!def.role || result.role))
  const seen = applicable.map(def => ({ tier: def.tier, n: Number(byTier.get(def.tier)?.n) || 0 }))
  for (const def of applicable) {
    const s = byTier.get(def.tier)
    if (s && Number(s.n) >= minSamples && finite(s.median)) {
      const broader = def.tier !== applicable[0].tier
      const confidence = confidenceFor({ n: Number(s.n), p25: s.p25, median: s.median, p75: s.p75 }, { broaderThanRequested: broader })
      return {
        status: 'estimated',
        tier: def.tier,
        basis: def.label,
        sampleSize: Number(s.n),
        medianMinutes: num(s.median),
        lowMinutes: finite(s.p25) ? num(s.p25) : null,
        highMinutes: finite(s.p75) ? num(s.p75) : null,
        p90Minutes: finite(s.p90) ? num(s.p90) : null,
        confidence,
        message: `Typically ${formatMinutes(s.median)} of active work (middle half ${formatMinutes(s.p25)} to ${formatMinutes(s.p75)}), ` +
          `from ${Number(s.n)} completed jobs with ${def.label}. ${confidence === 'low' ? 'Low confidence: use as a rough guide only.' : `${confidence === 'high' ? 'High' : 'Medium'} confidence.`}`,
      }
    }
  }
  const best = seen.reduce((m, x) => Math.max(m, x.n), 0)
  return {
    status: 'insufficient',
    sampleSize: best,
    seen,
    message: `Not enough history to estimate: ${best} completed ${best === 1 ? 'job' : 'jobs'} recorded for this task, at least ${minSamples} are needed.`,
  }
}
