/**
 * Driver Coaching — pure, dependency-free domain logic for the Driver
 * Leaderboard / Coaching module (/driver-coaching). Turns raw per-driver
 * scorecards into an overall performance score, a ranked leaderboard, a
 * coaching-needed watchlist, and a fleet-level summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/driverCoaching.js`) and page
 * (`src/pages/DriverCoaching.jsx`) both build on these primitives so the
 * scoring/ranking logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Clamp a number into the inclusive [lo, hi] range. */
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

// Blend weights: safety behaviour carries more weight than fuel economy because
// it is the stronger predictor of accident risk and tyre/vehicle damage.
const SAFETY_WEIGHT = 0.6
const FUEL_WEIGHT = 0.4

/**
 * Overall driver score (0..100), a weighted blend of safety_score and
 * fuel_score. When only one of the two is present, that component carries the
 * full weight; when neither is present the result is 0. The output is always
 * clamped to [0, 100] and rounded to one decimal so scores are stable and
 * comparable across the leaderboard.
 *
 * @param {object} rec
 * @returns {number}
 */
export function overallScore(rec) {
  const safety = toFiniteNumber(rec?.safety_score)
  const fuel = toFiniteNumber(rec?.fuel_score)

  if (safety == null && fuel == null) return 0

  let weighted
  if (safety != null && fuel != null) {
    weighted = safety * SAFETY_WEIGHT + fuel * FUEL_WEIGHT
  } else if (safety != null) {
    weighted = safety
  } else {
    weighted = fuel
  }

  return Math.round(clamp(weighted, 0, 100) * 10) / 10
}

/**
 * Build a ranked leaderboard. Each distinct driver's most complete record is
 * scored via overallScore, then sorted best-first (overallScore desc). Ties
 * break on higher distance_km, then driver_name for full determinism. A 1-based
 * `rank` is assigned in sorted order.
 *
 * @param {Array<object>} rows
 * @returns {Array<{driver_name:string, overallScore:number,
 *                   harsh_events:number, distance_km:number, rank:number}>}
 */
export function leaderboard(rows = []) {
  const list = Array.isArray(rows) ? rows : []

  const entries = list
    .filter((r) => r && r.driver_name != null && String(r.driver_name).trim() !== '')
    .map((r) => ({
      driver_name: String(r.driver_name).trim(),
      overallScore: overallScore(r),
      harsh_events: toFiniteNumber(r.harsh_events) ?? 0,
      distance_km: toFiniteNumber(r.distance_km) ?? 0,
    }))

  entries.sort((a, b) => {
    if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore
    if (b.distance_km !== a.distance_km) return b.distance_km - a.distance_km
    return a.driver_name.localeCompare(b.driver_name)
  })

  return entries.map((e, i) => ({ ...e, rank: i + 1 }))
}

// A driver is flagged for coaching when their blended score is below this
// threshold — the point at which behaviour is materially raising cost/risk.
const COACHING_SCORE_THRESHOLD = 60
const COACHING_STATUSES = new Set(['recommended', 'scheduled'])

/**
 * Drivers who need coaching: overallScore below the threshold OR an explicit
 * coaching_status of 'recommended'/'scheduled'. Returned worst-first so the
 * attention panel leads with the highest-risk drivers.
 *
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function coachingNeeded(rows = []) {
  const list = Array.isArray(rows) ? rows : []

  return list
    .filter((r) => {
      if (!r || r.driver_name == null || String(r.driver_name).trim() === '') return false
      const status = String(r.coaching_status ?? '').trim().toLowerCase()
      if (COACHING_STATUSES.has(status)) return true
      return overallScore(r) < COACHING_SCORE_THRESHOLD
    })
    .map((r) => ({ ...r, overallScore: overallScore(r) }))
    .sort((a, b) => a.overallScore - b.overallScore)
}

/**
 * Fleet-level coaching summary for the KPI header:
 *   • totalDrivers      — count of scored (named) driver records
 *   • avgScore          — mean overallScore across drivers (1 decimal)
 *   • needsCoachingCount— drivers flagged by coachingNeeded (distinct)
 *   • coachedCount      — drivers with coaching_status 'completed'
 *   • topScore          — best overallScore (null when no drivers)
 *   • bottomScore       — worst overallScore (null when no drivers)
 *
 * @param {Array<object>} rows
 * @returns {{ totalDrivers:number, avgScore:number, needsCoachingCount:number,
 *             coachedCount:number, topScore:number|null, bottomScore:number|null }}
 */
export function summariseCoaching(rows = []) {
  const board = leaderboard(rows)
  const totalDrivers = board.length

  if (totalDrivers === 0) {
    return {
      totalDrivers: 0,
      avgScore: 0,
      needsCoachingCount: 0,
      coachedCount: 0,
      topScore: null,
      bottomScore: null,
    }
  }

  const scores = board.map((b) => b.overallScore)
  const avgScore = Math.round((scores.reduce((s, n) => s + n, 0) / totalDrivers) * 10) / 10
  const topScore = scores[0]
  const bottomScore = scores[scores.length - 1]

  const needsCoachingCount = new Set(
    coachingNeeded(rows).map((r) => String(r.driver_name).trim()),
  ).size

  const coachedCount = (Array.isArray(rows) ? rows : []).filter(
    (r) => String(r?.coaching_status ?? '').trim().toLowerCase() === 'completed',
  ).length

  return {
    totalDrivers,
    avgScore,
    needsCoachingCount,
    coachedCount,
    topScore,
    bottomScore,
  }
}
