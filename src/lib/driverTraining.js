/**
 * Driver Training — pure, dependency-free domain logic for the Driver Training
 * module (/driver-training). Reduces a set of training/certification records
 * into certification-currency status and a compliance KPI summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/driverTraining.js`) and page
 * (`src/pages/DriverTraining.jsx`) both build on these primitives so the
 * roll-up and expiry logic live in exactly one place.
 *
 * Every function that depends on "now" accepts an explicit `nowMs` argument —
 * it never calls Date.now() internally — so results are fully deterministic and
 * testable. The caller (page/tests) supplies the clock.
 */

/** Milliseconds in one day — the granularity for certification expiry. */
const DAY_MS = 24 * 60 * 60 * 1000

/** How many days out counts as "expiring soon". */
export const EXPIRY_SOON_DAYS = 30

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Parse a date-ish value to an epoch-ms UTC day start, or null when invalid. */
function expiryDayMs(record) {
  const raw = record?.expiry_date
  if (!raw) return null
  const t = new Date(raw).getTime()
  if (Number.isNaN(t)) return null
  // Normalise to whole UTC days so day counts don't drift with wall-clock time.
  return Math.floor(t / DAY_MS) * DAY_MS
}

/**
 * Integer days from `nowMs` until a record's expiry_date. May be negative when
 * the certification has already lapsed. Returns null when there is no valid
 * expiry_date (a certification that never expires, or missing data).
 *
 * @param {object} record          a training record with `expiry_date`
 * @param {number} nowMs           current time in epoch ms (explicit clock)
 * @returns {number|null}          whole days to expiry, negative if past
 */
export function daysUntilExpiry(record, nowMs) {
  const exp = expiryDayMs(record)
  if (exp == null) return null
  const now = Number.isFinite(nowMs) ? nowMs : 0
  const today = Math.floor(now / DAY_MS) * DAY_MS
  return Math.round((exp - today) / DAY_MS)
}

/**
 * Certification currency status for a record:
 *   • 'expired'       — expiry_date is in the past (days < 0)
 *   • 'expiring_soon' — expires within EXPIRY_SOON_DAYS (0..30 inclusive)
 *   • 'valid'         — expires further out
 *   • 'unknown'       — no valid expiry_date to assess
 *
 * @param {object} record
 * @param {number} nowMs
 * @returns {'expired'|'expiring_soon'|'valid'|'unknown'}
 */
export function expiryStatus(record, nowMs) {
  const days = daysUntilExpiry(record, nowMs)
  if (days == null) return 'unknown'
  if (days < 0) return 'expired'
  if (days <= EXPIRY_SOON_DAYS) return 'expiring_soon'
  return 'valid'
}

/**
 * Summarise a set of training records for the KPI header:
 *   • totalRecords       — number of rows
 *   • distinctDrivers    — count of distinct driver names
 *   • passCount          — records with result === 'pass'
 *   • expiredCount       — records whose certification has lapsed
 *   • expiringSoonCount  — records expiring within EXPIRY_SOON_DAYS
 *   • totalCost          — sum of training cost across all rows
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 * @returns {{ totalRecords:number, distinctDrivers:number, passCount:number,
 *             expiredCount:number, expiringSoonCount:number, totalCost:number }}
 */
export function summariseTraining(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows : []
  const drivers = new Set()
  let passCount = 0
  let expiredCount = 0
  let expiringSoonCount = 0
  let totalCost = 0

  for (const r of list) {
    const driver = r?.driver_name != null ? String(r.driver_name).trim() : ''
    if (driver) drivers.add(driver.toLowerCase())

    if (String(r?.result || '').toLowerCase() === 'pass') passCount++

    const status = expiryStatus(r, nowMs)
    if (status === 'expired') expiredCount++
    else if (status === 'expiring_soon') expiringSoonCount++

    const cost = toFiniteNumber(r?.cost)
    if (cost != null) totalCost += cost
  }

  return {
    totalRecords: list.length,
    distinctDrivers: drivers.size,
    passCount,
    expiredCount,
    expiringSoonCount,
    totalCost,
  }
}

/**
 * Count records per training category, sorted by count descending.
 * Rows without a category are ignored. Ties keep insertion (first-seen) order.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ category:string, count:number }>}
 */
export function byCategory(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = new Map()
  for (const r of list) {
    const cat = r?.category != null ? String(r.category).trim() : ''
    if (!cat) continue
    counts.set(cat, (counts.get(cat) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
}
