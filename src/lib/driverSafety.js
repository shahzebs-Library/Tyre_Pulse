/**
 * Driver Safety — pure, dependency-free domain logic for the Driver Safety
 * Events module (/driver-safety). Reduces a set of telematics driver-behaviour
 * events (harsh braking / acceleration / cornering, speeding, overspeed,
 * idling, fatigue) into a fleet-level KPI summary, a per-driver risk scorecard
 * and an event-type distribution.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/driverSafety.js`) and page
 * (`src/pages/DriverSafety.jsx`) both build on these primitives so the roll-up
 * logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Clamp a number into the [lo, hi] range. */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

/** Normalise a driver name to a trimmed string, or '' when absent. */
function driverKey(r) {
  return r?.driver_name != null ? String(r.driver_name).trim() : ''
}

/**
 * Summarise a set of driver-safety events for the KPI header:
 *   • totalEvents         — number of rows
 *   • highSeverityCount   — count of rows with severity === 'high'
 *   • distinctDrivers     — count of distinct (named) drivers
 *   • totalPenaltyPoints  — sum of penalty_points across all rows
 *   • avgPenaltyPerDriver — totalPenaltyPoints / distinctDrivers (0 when none)
 *
 * @param {Array<object>} rows
 * @returns {{ totalEvents:number, highSeverityCount:number,
 *             distinctDrivers:number, totalPenaltyPoints:number,
 *             avgPenaltyPerDriver:number }}
 */
export function summariseSafety(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const drivers = new Set()
  let highSeverityCount = 0
  let totalPenaltyPoints = 0

  for (const r of list) {
    const driver = driverKey(r)
    if (driver) drivers.add(driver)
    if (String(r?.severity || '').toLowerCase() === 'high') highSeverityCount += 1
    const pts = toFiniteNumber(r?.penalty_points)
    if (pts != null) totalPenaltyPoints += pts
  }

  const distinctDrivers = drivers.size
  const avgPenaltyPerDriver = distinctDrivers > 0
    ? totalPenaltyPoints / distinctDrivers
    : 0

  return {
    totalEvents: list.length,
    highSeverityCount,
    distinctDrivers,
    totalPenaltyPoints,
    avgPenaltyPerDriver,
  }
}

/**
 * Per-driver risk scorecard. For each distinct named driver, aggregates the
 * number of events and total penalty points, then derives a safety score of
 * clamp(100 - penaltyPoints, 0, 100) — 100 is a spotless driver, 0 the worst.
 * Rows without a driver name are ignored. Sorted by safetyScore ascending so
 * the worst (highest-risk) drivers surface first; ties break by penaltyPoints
 * descending then driver name ascending for deterministic ordering.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ driver_name:string, events:number,
 *                   penaltyPoints:number, safetyScore:number }>}
 */
export function driverScorecard(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byDriver = new Map()

  for (const r of list) {
    const driver = driverKey(r)
    if (!driver) continue
    const prev = byDriver.get(driver) || { driver_name: driver, events: 0, penaltyPoints: 0 }
    prev.events += 1
    const pts = toFiniteNumber(r?.penalty_points)
    if (pts != null) prev.penaltyPoints += pts
    byDriver.set(driver, prev)
  }

  return [...byDriver.values()]
    .map((d) => ({
      ...d,
      safetyScore: clamp(100 - d.penaltyPoints, 0, 100),
    }))
    .sort((a, b) =>
      a.safetyScore - b.safetyScore ||
      b.penaltyPoints - a.penaltyPoints ||
      a.driver_name.localeCompare(b.driver_name),
    )
}

/**
 * Event-type distribution. Counts rows by `event_type`, returning an array of
 * { type, count } sorted by count descending (ties break by type ascending for
 * determinism). Rows without an event type are ignored.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ type:string, count:number }>}
 */
export function byEventType(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = new Map()
  for (const r of list) {
    const type = r?.event_type != null ? String(r.event_type).trim() : ''
    if (!type) continue
    counts.set(type, (counts.get(type) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
}

/* ══════════════════════════════════════════════════════════════════════════
 * DEEPENED ENGINE (additive) — real weighted scoring + driver↔tyre-damage
 * correlation. Everything below is derived from REAL rows only:
 *   • driver_safety_events  (severity, event_type, speed vs limit)  → GAP2 score
 *   • tyre_records          (driver_name, removal reason, km, cost) → GAP1 correlation
 *   • trips                 (driver_name, distance_km)              → GAP3 utilisation
 * No synthetic dimensions, trips, fuel or badges are fabricated. When a driver
 * has no rows for a signal the result is an honest null / '—', never a guess.
 * ════════════════════════════════════════════════════════════════════════ */

// ── GAP2: weighted event score ──────────────────────────────────────────────

/** Severity multiplier — a high-severity event weighs 8× a low one. */
export const SEVERITY_WEIGHT = Object.freeze({ low: 1, medium: 3, high: 8 })

/** Event-type multiplier — fatigue/overspeed are the most dangerous, idling least. */
export const TYPE_WEIGHT = Object.freeze({
  fatigue: 2.0,
  overspeed: 1.8,
  speeding: 1.5,
  harsh_brake: 1.3,
  harsh_accel: 1.2,
  harsh_corner: 1.2,
  idling: 0.5,
  other: 1.0,
})
const DEFAULT_TYPE_WEIGHT = 1.0

/**
 * Per-category risk caps (adopted from fleet_IQ driver_behavior.py's
 * `min(cap, events * weight)` idea) so a single event category can't dominate
 * the whole score. Unknown categories fall back to DEFAULT_CATEGORY_CAP.
 */
export const CATEGORY_CAP = Object.freeze({
  fatigue: 40,
  overspeed: 30,
  speeding: 30,
  harsh_brake: 25,
  harsh_accel: 20,
  harsh_corner: 20,
  idling: 12,
  other: 15,
})
const DEFAULT_CATEGORY_CAP = 20

/** Each km/h sustained over the limit adds this much to the event's risk. */
export const OVERSPEED_PER_KMH = 0.2
/** Score sensitivity: score = clamp(100 - SCORE_K * riskIndex, 0, 100). */
export const SCORE_K = 1.0

/** Letter grade from a 0–100 score (ported from driver_scoring `_score_grade`). */
export function scoreGrade(score) {
  if (score == null) return 'N/A'
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

/** Safety band from a 0–100 score (ported from driver_scoring `_score_band`). */
export function scoreBand(score) {
  if (score == null) return 'unknown'
  if (score >= 85) return 'good'
  if (score >= 70) return 'watch'
  return 'coach'
}

/** Normalise an event_type token to a lower-case key, or 'other' when absent. */
function eventTypeKey(r) {
  const t = r?.event_type != null ? String(r.event_type).trim().toLowerCase() : ''
  return t || 'other'
}

/**
 * Risk contributed by a single event, before per-category capping:
 *   severityWeight × typeWeight  +  overspeedExcess × OVERSPEED_PER_KMH
 * overspeedExcess = max(0, speed_kmh − speed_limit_kmh) and only adds when > 0.
 *
 * @returns {{ category:string, risk:number }}
 */
export function eventRisk(row, opts = {}) {
  const severityWeight = opts.severityWeight || SEVERITY_WEIGHT
  const typeWeight = opts.typeWeight || TYPE_WEIGHT
  const overspeedPerKmh = opts.overspeedPerKmh ?? OVERSPEED_PER_KMH

  const category = eventTypeKey(row)
  const sev = String(row?.severity || '').toLowerCase()
  const sw = severityWeight[sev] ?? 1
  const tw = typeWeight[category] ?? DEFAULT_TYPE_WEIGHT

  let risk = sw * tw

  const speed = toFiniteNumber(row?.speed_kmh)
  const limit = toFiniteNumber(row?.speed_limit_kmh)
  if (speed != null && limit != null) {
    const excess = speed - limit
    if (excess > 0) risk += excess * overspeedPerKmh
  }
  return { category, risk }
}

/**
 * Weighted per-driver risk scorecard. For each named driver aggregates event
 * risk BY CATEGORY, caps each category, sums the capped categories into a
 * riskIndex, then derives score = clamp(100 − k·riskIndex, 0, 100), a letter
 * grade and a safety band. Sorted worst-first (lowest score) for triage.
 *
 * @param {Array<object>} rows  driver_safety_events rows
 * @param {object} [opts]  { severityWeight, typeWeight, categoryCap, scoreK, overspeedPerKmh }
 * @returns {Array<{ driver_name:string, events:number, highSeverity:number,
 *   riskIndex:number, score:number, grade:string, band:string,
 *   categoryRisk:Record<string,number>, weakestCategory:string|null }>}
 */
export function weightedDriverScorecard(rows = [], opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const categoryCap = opts.categoryCap || CATEGORY_CAP
  const scoreK = opts.scoreK ?? SCORE_K
  const byDriver = new Map()

  for (const r of list) {
    const driver = driverKey(r)
    if (!driver) continue
    const prev = byDriver.get(driver) ||
      { driver_name: driver, events: 0, highSeverity: 0, categoryRisk: {} }
    prev.events += 1
    if (String(r?.severity || '').toLowerCase() === 'high') prev.highSeverity += 1
    const { category, risk } = eventRisk(r, opts)
    prev.categoryRisk[category] = (prev.categoryRisk[category] || 0) + risk
    byDriver.set(driver, prev)
  }

  const out = [...byDriver.values()].map((d) => {
    let riskIndex = 0
    let weakestCategory = null
    let weakestCapped = -1
    for (const [cat, raw] of Object.entries(d.categoryRisk)) {
      const cap = categoryCap[cat] ?? DEFAULT_CATEGORY_CAP
      const capped = Math.min(cap, raw)
      riskIndex += capped
      if (capped > weakestCapped) { weakestCapped = capped; weakestCategory = cat }
    }
    riskIndex = Math.round(riskIndex * 1000) / 1000
    const score = clamp(Math.round(100 - scoreK * riskIndex), 0, 100)
    return {
      ...d,
      riskIndex,
      score,
      grade: scoreGrade(score),
      band: scoreBand(score),
      weakestCategory,
    }
  })

  return out.sort((a, b) =>
    a.score - b.score ||
    b.riskIndex - a.riskIndex ||
    a.driver_name.localeCompare(b.driver_name),
  )
}

// ── GAP1: driver ↔ tyre-damage correlation ──────────────────────────────────

/** Removal reasons that indicate driver-attributable tyre damage. */
export const DRIVER_CAUSED_REMOVAL_RE = /impact|cut|kerb|curb|underinflation|under.?inflat|run.?flat|overload/i

const removalReasonText = (r) =>
  `${r?.reason_for_removal || ''} ${r?.removal_reason || ''}`.trim()

/** True when a tyre_records row represents an actual removal (has an end signal). */
function isRemoval(r) {
  return Boolean(
    removalReasonText(r) ||
    r?.removal_date ||
    toFiniteNumber(r?.km_at_removal) != null,
  )
}

/** Life (km) of a removed tyre: km_at_removal − km_at_fitment, guarded > 0. */
function tyreLifeKm(r) {
  const fit = toFiniteNumber(r?.km_at_fitment)
  const rem = toFiniteNumber(r?.km_at_removal)
  if (fit == null || rem == null) return null
  const life = rem - fit
  return life > 0 ? life : null
}

/** Median of a numeric array (sorted copy); null when empty. */
export function median(values = []) {
  const nums = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!nums.length) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

/**
 * Correlate each driver's tyre_records into damage/economics signals — the
 * Tyre-Pulse-unique intelligence the original only gestured at:
 *   • driverCausedRemovalRate — share of a driver's removals whose reason matches
 *     driver-attributable damage (impact / cut / kerb / underinflation / run-flat / overload)
 *   • driverCpk               — Σ cost_per_tyre / Σ tyre-life-km (cost per km)
 *   • prematureRemovalRate    — share of the driver's removed tyres whose life is
 *     below the FLEET MEDIAN removed-tyre life
 * Drivers with no tyre rows get nulls (honest '—'), never a fabricated rate.
 *
 * @param {Array<object>} records  tyre_records rows
 * @returns {{ fleetMedianLifeKm:number|null,
 *   drivers:Array<{ driver_name:string, tyres:number, removals:number,
 *     driverCausedRemovals:number, driverCausedRemovalRate:number|null,
 *     totalCost:number, lifeKm:number, driverCpk:number|null,
 *     prematureRemovals:number, prematureRemovalRate:number|null }> }}
 */
export function driverTyreCorrelation(records = []) {
  const list = Array.isArray(records) ? records : []

  // Fleet median removed-tyre life across ALL drivers (the benchmark).
  const fleetLives = []
  for (const r of list) {
    if (!isRemoval(r)) continue
    const life = tyreLifeKm(r)
    if (life != null) fleetLives.push(life)
  }
  const fleetMedianLifeKm = median(fleetLives)

  const byDriver = new Map()
  for (const r of list) {
    const driver = driverKey(r)
    if (!driver) continue
    const d = byDriver.get(driver) || {
      driver_name: driver, tyres: 0, removals: 0, driverCausedRemovals: 0,
      totalCost: 0, lifeKm: 0, prematureRemovals: 0,
    }
    d.tyres += 1
    const cost = toFiniteNumber(r?.cost_per_tyre)
    const life = tyreLifeKm(r)
    if (cost != null) d.totalCost += cost
    if (life != null) d.lifeKm += life
    if (isRemoval(r)) {
      d.removals += 1
      if (DRIVER_CAUSED_REMOVAL_RE.test(removalReasonText(r))) d.driverCausedRemovals += 1
      if (life != null && fleetMedianLifeKm != null && life < fleetMedianLifeKm) {
        d.prematureRemovals += 1
      }
    }
    byDriver.set(driver, d)
  }

  const drivers = [...byDriver.values()].map((d) => ({
    ...d,
    totalCost: Math.round(d.totalCost * 100) / 100,
    driverCausedRemovalRate: d.removals > 0
      ? Math.round((d.driverCausedRemovals / d.removals) * 1000) / 1000
      : null,
    driverCpk: d.lifeKm > 0
      ? Math.round((d.totalCost / d.lifeKm) * 1000) / 1000
      : null,
    prematureRemovalRate: d.removals > 0
      ? Math.round((d.prematureRemovals / d.removals) * 1000) / 1000
      : null,
  })).sort((a, b) =>
    (b.driverCausedRemovalRate ?? -1) - (a.driverCausedRemovalRate ?? -1) ||
    (b.driverCpk ?? -1) - (a.driverCpk ?? -1) ||
    a.driver_name.localeCompare(b.driver_name),
  )

  return { fleetMedianLifeKm, drivers }
}

// ── GAP3: composite behaviour × utilisation band ────────────────────────────

/** 60% behaviour + 40% utilisation; None inputs get a neutral 50 (verbatim port). */
function compositeScore(behavior, utilization) {
  if (behavior == null && utilization == null) return null
  const b = behavior != null ? behavior : 50
  const u = utilization != null ? utilization : 50
  return Math.round((b * 0.6 + u * 0.4) * 10) / 10
}

/**
 * Composite driver safety band — ports `compute_driver_safety_band` from
 * tyre_saas driver_safety.py verbatim (behaviour × utilisation, inactive/unknown
 * branches, harsh-rate fallback). `behavior` should come from GAP2 (the weighted
 * event score); `km`/`trips` from the trips table; `harshEvents` from harsh_* events.
 *
 * @param {{ behavior?:number|null, utilization?:number|null, km?:number,
 *           trips?:number, harshEvents?:number }} d
 * @returns {{ band:string, label:string, composite:number|null, urgency:string }}
 */
export function computeDriverSafetyBand(d = {}) {
  const behavior = d.behavior ?? null
  const utilization = d.utilization ?? null
  const km = toFiniteNumber(d.km) || 0
  const trips = toFiniteNumber(d.trips) || 0

  if (km === 0 && trips === 0 && behavior == null && utilization == null) {
    return { band: 'unknown', label: 'No activity', composite: null, urgency: 'none' }
  }
  if (km === 0 && trips === 0) {
    return { band: 'inactive', label: 'Inactive 30d', composite: null, urgency: 'low' }
  }

  let composite = compositeScore(behavior, utilization)

  if (composite == null) {
    // Fall back to harsh-event rate per 1000 km: 0 → 100, ≥10 → 0.
    const he = toFiniteNumber(d.harshEvents) || 0
    const rate = (he / Math.max(km, 1)) * 1000
    composite = clamp(100 - rate * 10, 0, 100)
    composite = Math.round(composite * 10) / 10
  }

  let band, label, urgency
  if (composite >= 90) { band = 'top_performer'; label = 'Top performer'; urgency = 'none' }
  else if (composite >= 70) { band = 'steady'; label = 'Steady'; urgency = 'low' }
  else if (composite >= 50) { band = 'coaching'; label = 'Schedule coaching'; urgency = 'medium' }
  else { band = 'risk'; label = 'Safety risk'; urgency = 'high' }

  return { band, label, composite, urgency }
}

// ── GAP4: coaching queue ────────────────────────────────────────────────────

/** Static coaching guidance keyed by event category (real advice, not data). */
export const COACHING_TIPS = Object.freeze({
  harsh_brake: 'Anticipate stops earlier — ease off the throttle 3–4 s before braking. Cuts brake heat and tyre scrub.',
  harsh_accel: 'Avoid jack-rabbit starts. Smooth acceleration limits tyre slip and drive-axle wear at launch.',
  harsh_corner: 'Reduce entry speed before the curve, not during. Lateral G-load is what burns shoulder tread.',
  speeding: 'Hold within the posted limit. Sustained high speed raises casing temperature and wear rate.',
  overspeed: 'Sustained overspeed overheats tyres in GCC conditions — the top driver-attributable failure cause.',
  idling: 'Cut idle time. Prolonged idling wastes fuel and heat-soaks stationary tyres.',
  fatigue: 'Enforce mandated rest breaks and rotate long hauls — fatigue events precede the most severe incidents.',
  other: 'Schedule a ride-along review to pinpoint the recurring behaviour.',
})

/**
 * Build the coaching queue: drivers scoring below `threshold` (i.e. not in the
 * 'good' band), each with their weakest event category, a matching static tip,
 * and a suggested session length (30 min when score < 60, else 20).
 *
 * @param {Array<object>} scorecards  output of weightedDriverScorecard()
 * @param {{ threshold?:number }} [opts]
 */
export function coachingQueue(scorecards = [], opts = {}) {
  const threshold = opts.threshold ?? 85
  const list = Array.isArray(scorecards) ? scorecards : []
  return list
    .filter((d) => d.score < threshold)
    .map((d) => {
      const focus = d.weakestCategory || 'other'
      return {
        driver_name: d.driver_name,
        score: d.score,
        grade: d.grade,
        band: d.band,
        focus,
        tip: COACHING_TIPS[focus] || COACHING_TIPS.other,
        suggestedSessionMin: d.score < 60 ? 30 : 20,
      }
    })
    .sort((a, b) => a.score - b.score || a.driver_name.localeCompare(b.driver_name))
}

// ── GAP5: real weekly event-rate / high-severity-rate trend ─────────────────

/** ISO-week Monday (UTC) as YYYY-MM-DD for a timestamp, or null when invalid. */
export function weekStartKey(v) {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow))
  return monday.toISOString().slice(0, 10)
}

/**
 * Real weekly trend from event timestamps — NO synthesis. Buckets events by
 * ISO week (Monday, UTC) and reports, per week, the event count and the
 * high-severity share. Returns a fleet-wide series plus an optional per-driver
 * breakdown. Weeks are sorted ascending; rows with an unparseable event_at are
 * ignored.
 *
 * @param {Array<object>} rows  driver_safety_events rows
 * @returns {{ fleet:Array<{ week:string, events:number, highSeverity:number,
 *   highSeverityRate:number }>, byDriver:Record<string, Array<object>> }}
 */
export function weeklyEventTrend(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const fleet = new Map()
  const byDriver = new Map()

  const bump = (bucketMap, week, isHigh) => {
    const b = bucketMap.get(week) || { week, events: 0, highSeverity: 0 }
    b.events += 1
    if (isHigh) b.highSeverity += 1
    bucketMap.set(week, b)
  }

  for (const r of list) {
    const week = weekStartKey(r?.event_at)
    if (!week) continue
    const isHigh = String(r?.severity || '').toLowerCase() === 'high'
    bump(fleet, week, isHigh)
    const driver = driverKey(r)
    if (driver) {
      const dm = byDriver.get(driver) || new Map()
      bump(dm, week, isHigh)
      byDriver.set(driver, dm)
    }
  }

  const finalise = (bucketMap) => [...bucketMap.values()]
    .map((b) => ({
      ...b,
      highSeverityRate: b.events > 0 ? Math.round((b.highSeverity / b.events) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => a.week.localeCompare(b.week))

  const byDriverOut = {}
  for (const [driver, dm] of byDriver.entries()) byDriverOut[driver] = finalise(dm)

  return { fleet: finalise(fleet), byDriver: byDriverOut }
}
