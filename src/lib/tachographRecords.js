/**
 * Tachograph Records — pure, dependency-free domain logic for the Tachograph
 * Records module (/tachograph). Reduces a set of EU driver tachograph download
 * records into infringement flags, a fleet-level compliance KPI summary, and a
 * per-driver infringement roll-up.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/tachographRecords.js`) and page
 * (`src/pages/Tachograph.jsx`) both build on these primitives so the roll-up
 * logic lives in exactly one place.
 */

/**
 * EU daily driving limit under EC 561/2006 in minutes (9 hours). Driving beyond
 * this on a single record is treated as an infringement even when the source
 * feed did not tally an explicit infringement count.
 */
export const DAILY_DRIVE_LIMIT_MIN = 540

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * True when a record represents a compliance infringement: either the source
 * feed tallied one or more infringements (infringement_count > 0), or the
 * driving minutes exceed the EU daily driving limit.
 *
 * @param {object} record
 * @returns {boolean}
 */
export function hasInfringement(record) {
  if (!record) return false
  const count = toFiniteNumber(record.infringement_count)
  if (count != null && count > 0) return true
  const driving = toFiniteNumber(record.driving_min)
  if (driving != null && driving > DAILY_DRIVE_LIMIT_MIN) return true
  return false
}

/**
 * Summarise a set of tachograph records for the KPI header:
 *   • totalRecords        — number of rows
 *   • distinctDrivers     — count of distinct driver names
 *   • totalDrivingHours   — sum of driving_min across all rows, in hours
 *   • totalInfringements  — sum of infringement_count across all rows
 *   • flaggedCount        — number of rows with status === 'flagged'
 *   • overDriveDays       — number of rows exceeding the daily driving limit
 *
 * @param {Array<object>} rows
 * @returns {{ totalRecords:number, distinctDrivers:number,
 *             totalDrivingHours:number, totalInfringements:number,
 *             flaggedCount:number, overDriveDays:number }}
 */
export function summariseTachograph(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const drivers = new Set()
  let totalDrivingMin = 0
  let totalInfringements = 0
  let flaggedCount = 0
  let overDriveDays = 0

  for (const r of list) {
    const driver = r?.driver_name != null ? String(r.driver_name).trim() : ''
    if (driver) drivers.add(driver)

    const driving = toFiniteNumber(r?.driving_min)
    if (driving != null) totalDrivingMin += driving

    const count = toFiniteNumber(r?.infringement_count)
    if (count != null && count > 0) totalInfringements += count

    if (r?.status === 'flagged') flaggedCount += 1
    if (driving != null && driving > DAILY_DRIVE_LIMIT_MIN) overDriveDays += 1
  }

  return {
    totalRecords: list.length,
    distinctDrivers: drivers.size,
    totalDrivingHours: Math.round((totalDrivingMin / 60) * 10) / 10,
    totalInfringements,
    flaggedCount,
    overDriveDays,
  }
}

/**
 * Per-driver infringement roll-up. For each distinct driver name, aggregates
 * record count, total driving minutes, and total infringements (feed count plus
 * over-limit driving days that carried no explicit count). Rows without a driver
 * name are ignored. Sorted by infringements descending (records desc as a
 * tiebreaker) so the highest-risk drivers surface first.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ driver_name:string, records:number,
 *                   drivingMin:number, infringements:number }>}
 */
export function byDriver(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()

  for (const r of list) {
    const driver = r?.driver_name != null ? String(r.driver_name).trim() : ''
    if (!driver) continue

    const entry = map.get(driver) || { driver_name: driver, records: 0, drivingMin: 0, infringements: 0 }
    entry.records += 1

    const driving = toFiniteNumber(r?.driving_min)
    if (driving != null) entry.drivingMin += driving

    const count = toFiniteNumber(r?.infringement_count)
    if (count != null && count > 0) entry.infringements += count
    else if (hasInfringement(r)) entry.infringements += 1

    map.set(driver, entry)
  }

  return [...map.values()].sort(
    (a, b) => b.infringements - a.infringements || b.records - a.records,
  )
}
