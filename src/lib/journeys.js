/**
 * Journeys — pure, dependency-free domain logic for the Journey Log module.
 *
 * Keeping duration + aggregation here (no Supabase, no React) makes them
 * unit-testable and reusable across the service layer, the page and any future
 * reporting pipeline. The service (`src/lib/api/journeys.js`) and page
 * (`src/pages/JourneyLog.jsx`) both build on these primitives.
 */

/** Canonical journey statuses (mirrors the CHECK constraint in V139). */
export const JOURNEY_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled']

export const JOURNEY_STATUS_META = {
  planned: { label: 'Planned', tint: 'text-sky-400' },
  in_progress: { label: 'In progress', tint: 'text-amber-400' },
  completed: { label: 'Completed', tint: 'text-emerald-400' },
  cancelled: { label: 'Cancelled', tint: 'text-red-400' },
}

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Duration of a journey in hours (2 decimals), derived from end_time - start_time.
 * Returns null when either bound is missing/unparseable or the span is negative
 * (a data inconsistency the caller can flag rather than silently trust).
 */
export function journeyDurationHours(journey) {
  const startRaw = journey?.start_time
  const endRaw = journey?.end_time
  if (!startRaw || !endRaw) return null
  const start = new Date(startRaw)
  const end = new Date(endRaw)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const ms = end.getTime() - start.getTime()
  if (ms < 0) return null
  return Math.round((ms / 3_600_000) * 100) / 100
}

/**
 * Aggregate a list of journeys into fleet KPIs: counts by status, total trips,
 * total distance (km) and average distance per trip. Non-numeric distances are
 * ignored for the total/average so one bad row cannot poison the KPI.
 */
export function summarizeJourneys(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { planned: 0, in_progress: 0, completed: 0, cancelled: 0 }
  let totalDistance = 0
  let distanceN = 0
  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    const km = toFiniteNumber(r?.distance_km)
    if (km != null) { totalDistance += km; distanceN += 1 }
  }
  const totalTrips = list.length
  totalDistance = Math.round(totalDistance * 100) / 100
  const avgDistance = distanceN > 0 ? Math.round((totalDistance / distanceN) * 100) / 100 : 0
  return { byStatus, totalTrips, totalDistance, avgDistance }
}

// ── Deeper journey intelligence (pure, testable) ─────────────────────────────

/** Default early/on-time/late tolerance, in minutes, around scheduled arrival. */
export const ON_TIME_TOLERANCE_MIN = 15

/** On-time classification buckets in a stable, display-friendly order. */
export const ON_TIME_CLASSES = ['early', 'on_time', 'late', 'unknown']
export const ON_TIME_META = {
  early: { label: 'Early', tint: 'text-sky-400' },
  on_time: { label: 'On time', tint: 'text-emerald-400' },
  late: { label: 'Late', tint: 'text-red-400' },
  unknown: { label: 'Not evaluated', tint: 'text-[var(--text-muted)]' },
}

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100
const parseDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

// Scheduled arrival can arrive under several field names as the schema grows;
// read them all so the metric lights up the moment the data is captured, and
// stays honestly "unknown" until then (no fabrication).
const SCHEDULED_ARRIVAL_KEYS = ['scheduled_end', 'scheduled_arrival', 'planned_end', 'planned_arrival', 'eta']

/** The scheduled arrival Date for a journey, or null when none is recorded. */
export function journeyScheduledArrival(journey) {
  for (const k of SCHEDULED_ARRIVAL_KEYS) {
    const d = parseDate(journey?.[k])
    if (d) return d
  }
  return null
}

/**
 * On-time performance for a single journey: compares actual arrival (end_time)
 * against the scheduled arrival with a +/- tolerance.
 *   deltaMinutes > 0  => arrived late,  < 0 => early,  within tolerance => on_time.
 * Returns class 'unknown' (deltaMinutes null) when either time is missing, so a
 * trip with no scheduled arrival never counts for or against the on-time rate.
 */
export function journeyOnTime(journey, { toleranceMinutes = ON_TIME_TOLERANCE_MIN } = {}) {
  const scheduled = journeyScheduledArrival(journey)
  const actual = parseDate(journey?.end_time)
  if (!scheduled || !actual) return { class: 'unknown', deltaMinutes: null }
  const deltaMinutes = round2((actual.getTime() - scheduled.getTime()) / 60000)
  const tol = Math.abs(toFiniteNumber(toleranceMinutes) ?? ON_TIME_TOLERANCE_MIN)
  let cls = 'on_time'
  if (deltaMinutes > tol) cls = 'late'
  else if (deltaMinutes < -tol) cls = 'early'
  return { class: cls, deltaMinutes }
}

/**
 * Average speed (km/h) for a journey = distance / duration. Returns null when the
 * distance is missing/non-positive or the duration is missing/zero (guards divide
 * by zero and nonsensical readings rather than emitting a fake number).
 */
export function journeyAvgSpeedKmh(journey) {
  const km = toFiniteNumber(journey?.distance_km)
  const hours = journeyDurationHours(journey)
  if (km == null || km <= 0 || hours == null || hours <= 0) return null
  return round2(km / hours)
}

/**
 * Data-quality flags for one journey (array of { code, label }). Empty array =
 * clean row. Detects the inconsistencies an operator should fix: an actual end
 * before its start, a completed trip with a non-positive distance, and a
 * completed trip missing its start or end timestamp.
 */
export function journeyDataQualityFlags(journey) {
  const flags = []
  const start = parseDate(journey?.start_time)
  const end = parseDate(journey?.end_time)
  const km = toFiniteNumber(journey?.distance_km)
  const completed = journey?.status === 'completed'
  if (start && end && end.getTime() < start.getTime()) {
    flags.push({ code: 'end_before_start', label: 'End time is before start time' })
  }
  if (completed && km != null && km <= 0) {
    flags.push({ code: 'nonpositive_distance', label: 'Completed trip has zero or negative distance' })
  }
  if (completed && (!start || !end)) {
    flags.push({ code: 'missing_times', label: 'Completed trip is missing a start or end time' })
  }
  return flags
}

/** The 12 months ending with `now`, oldest first: [{ key:'YYYY-MM', label:'Mon YY' }]. */
export function months12(now = new Date()) {
  const base = now instanceof Date ? now : new Date(now)
  const out = []
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
    out.push({ key, label })
  }
  return out
}

const monthKeyOf = (dateStr) => {
  const s = String(dateStr || '')
  return s.length >= 7 ? s.slice(0, 7) : null
}

/**
 * Sum a value across rows into the 12 month buckets aligned to months12(). The
 * bucket date comes from start_time (falling back to end_time / created_at), so
 * a trip lands in the month it ran. valueFn defaults to a per-row count.
 */
export function bucketMonthly(rows, valueFn = () => 1, now = new Date()) {
  const slots = months12(now)
  const idx = Object.fromEntries(slots.map((m, i) => [m.key, i]))
  const out = new Array(12).fill(0)
  for (const r of rows || []) {
    const k = monthKeyOf(r?.start_time || r?.end_time || r?.created_at)
    if (k != null && idx[k] != null) out[idx[k]] += (toFiniteNumber(valueFn(r)) ?? 0)
  }
  return out.map(round2)
}

/**
 * Distance per month over the trailing 12 months, plus the 12-month total.
 * Returns { labels, distance, total }.
 */
export function monthlyDistance(rows = [], now = new Date()) {
  const slots = months12(now)
  const distance = bucketMonthly(rows, (r) => toFiniteNumber(r?.distance_km) ?? 0, now)
  const total = round2(distance.reduce((s, v) => s + v, 0))
  return { labels: slots.map((m) => m.label), distance, total }
}

/** Status funnel counts (planned -> in_progress -> completed / cancelled) with share of total. */
export function statusFunnel(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = { planned: 0, in_progress: 0, completed: 0, cancelled: 0 }
  for (const r of list) if (counts[r?.status] != null) counts[r.status] += 1
  const total = list.length
  return JOURNEY_STATUSES.map((status) => ({
    status,
    label: JOURNEY_STATUS_META[status]?.label || status,
    count: counts[status],
    pct: total > 0 ? Math.round((counts[status] / total) * 100) : 0,
  }))
}

/** On-time breakdown across a set of journeys: { early, on_time, late, unknown, evaluated }. */
export function onTimeBreakdown(rows = [], opts = {}) {
  const out = { early: 0, on_time: 0, late: 0, unknown: 0 }
  for (const r of Array.isArray(rows) ? rows : []) out[journeyOnTime(r, opts).class] += 1
  const evaluated = out.early + out.on_time + out.late
  return { ...out, evaluated }
}

// Shared reducer for a per-key rollup (driver or asset).
function rollupBy(rows, keyFn, keyLabel, opts = {}) {
  const groups = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = String(keyFn(r) || '').trim()
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const out = []
  for (const [key, list] of groups) {
    let distance = 0
    let durationSum = 0
    let durationN = 0
    let completed = 0
    for (const r of list) {
      const km = toFiniteNumber(r?.distance_km)
      if (km != null) distance += km
      const dur = journeyDurationHours(r)
      if (dur != null) { durationSum += dur; durationN += 1 }
      if (r?.status === 'completed') completed += 1
    }
    const trips = list.length
    const ot = onTimeBreakdown(list, opts)
    out.push({
      [keyLabel]: key,
      trips,
      distance: round2(distance),
      completed,
      completionRate: trips > 0 ? Math.round((completed / trips) * 100) : 0,
      avgDurationHours: durationN > 0 ? round2(durationSum / durationN) : null,
      onTimeEvaluated: ot.evaluated,
      onTimeRate: ot.evaluated > 0 ? Math.round((ot.on_time / ot.evaluated) * 100) : null,
    })
  }
  return out.sort((a, b) => b.distance - a.distance)
}

/** Per-driver rollup: trips, distance, completion rate, on-time rate, avg duration. */
export function driverRollups(rows = [], opts = {}) {
  return rollupBy(rows, (r) => r?.driver_name, 'driver', opts)
}

/** Per-asset rollup: trips, distance, completion rate, on-time rate, avg duration. */
export function assetRollups(rows = [], opts = {}) {
  return rollupBy(rows, (r) => r?.asset_no, 'asset', opts)
}

/**
 * One consolidated analytics object for the page: headline KPIs, the monthly
 * distance trend, status + on-time breakdowns, per-driver / per-asset rollups
 * and a fleet-wide data-quality summary. Every figure is honest: values that
 * cannot be computed are null (rendered as N/A), never guessed.
 */
export function buildJourneyAnalytics(rows = [], { now = new Date(), toleranceMinutes = ON_TIME_TOLERANCE_MIN } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const summary = summarizeJourneys(list)
  const monthly = monthlyDistance(list, now)
  const funnel = statusFunnel(list)
  const ot = onTimeBreakdown(list, { toleranceMinutes })

  let durationSum = 0
  let durationN = 0
  let speedSum = 0
  let speedN = 0
  let dqRows = 0
  const dqCounts = {}
  for (const r of list) {
    const dur = journeyDurationHours(r)
    if (dur != null) { durationSum += dur; durationN += 1 }
    const spd = journeyAvgSpeedKmh(r)
    if (spd != null) { speedSum += spd; speedN += 1 }
    const flags = journeyDataQualityFlags(r)
    if (flags.length) {
      dqRows += 1
      for (const f of flags) dqCounts[f.code] = (dqCounts[f.code] || 0) + 1
    }
  }

  const completedTrips = summary.byStatus.completed
  const activeTrips = summary.byStatus.planned + summary.byStatus.in_progress

  return {
    kpis: {
      totalTrips: summary.totalTrips,
      completedTrips,
      inProgress: summary.byStatus.in_progress,
      activeTrips,
      totalDistance: summary.totalDistance,
      avgDistance: summary.avgDistance,
      distance12mo: monthly.total,
      avgDurationHours: durationN > 0 ? round2(durationSum / durationN) : null,
      avgSpeedKmh: speedN > 0 ? round2(speedSum / speedN) : null,
      onTimePct: ot.evaluated > 0 ? Math.round((ot.on_time / ot.evaluated) * 100) : null,
      onTimeEvaluated: ot.evaluated,
    },
    monthly,
    funnel,
    onTime: ot,
    drivers: driverRollups(list, { toleranceMinutes }),
    assets: assetRollups(list, { toleranceMinutes }),
    dataQuality: { rowsFlagged: dqRows, byCode: dqCounts, total: list.length },
  }
}
