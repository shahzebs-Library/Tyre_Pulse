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
