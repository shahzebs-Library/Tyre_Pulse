/**
 * Emissions Tests — pure, dependency-free domain logic for the Emissions /
 * Smog Compliance module (/emissions). Reduces a set of emissions test
 * certificates into expiry status, per-asset latest state, and a fleet-level
 * compliance KPI summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/emissionsTests.js`) and page
 * (`src/pages/Emissions.jsx`) both build on these primitives so the compliance
 * logic lives in exactly one place. Every time-dependent function accepts an
 * explicit `nowMs` argument — it never calls Date.now() internally — so results
 * are fully reproducible in tests.
 */

/** Days inside the "expiring soon" window: at or below this ⇒ needs attention. */
export const EXPIRING_SOON_DAYS = 30

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Epoch ms at UTC midnight for a date-ish value, or null when unparseable. */
function dayStartMs(v) {
  if (!v) return null
  const d = new Date(v)
  const t = d.getTime()
  if (Number.isNaN(t)) return null
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Whole calendar days from `nowMs` until a test's expiry_date. Positive when the
 * certificate is still valid, zero on the expiry day, negative once expired.
 * Returns null when the test has no parseable expiry_date.
 *
 * Both ends are normalised to UTC midnight so the result is a stable integer
 * count of days independent of the time-of-day component of `nowMs`.
 *
 * @param {object} test
 * @param {number} nowMs  reference "now" in epoch milliseconds
 * @returns {number|null}
 */
export function daysUntilExpiry(test, nowMs) {
  const expMs = dayStartMs(test?.expiry_date)
  if (expMs == null) return null
  const now = Number(nowMs)
  if (!Number.isFinite(now)) return null
  const nowDay = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  )
  return Math.round((expMs - nowDay) / 86_400_000)
}

/**
 * Classify a test's certificate validity relative to `nowMs`:
 *   • 'unknown'       — no parseable expiry_date
 *   • 'expired'       — expiry_date is in the past (days < 0)
 *   • 'expiring_soon' — expires within EXPIRING_SOON_DAYS (0..30 inclusive)
 *   • 'valid'         — expires beyond the window
 *
 * @param {object} test
 * @param {number} nowMs
 * @returns {'expired'|'expiring_soon'|'valid'|'unknown'}
 */
export function expiryStatus(test, nowMs) {
  const days = daysUntilExpiry(test, nowMs)
  if (days == null) return 'unknown'
  if (days < 0) return 'expired'
  if (days <= EXPIRING_SOON_DAYS) return 'expiring_soon'
  return 'valid'
}

/** Sortable ordinal for a test: prefer test_date, fall back to created_at. */
function testTime(r) {
  const d = r?.test_date || r?.created_at
  if (!d) return 0
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Latest test per asset. For each distinct `asset_no`, keeps the row with the
 * most recent test_date (created_at as tiebreaker/fallback). Rows without an
 * asset number are ignored. Returns an array (unsorted).
 *
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function latestPerAsset(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byAsset = new Map()
  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (!asset) continue
    const prev = byAsset.get(asset)
    if (!prev) { byAsset.set(asset, r); continue }
    if (testTime(r) > testTime(prev)) byAsset.set(asset, r)
  }
  return [...byAsset.values()]
}

/**
 * Summarise a set of emissions tests for the KPI header:
 *   • totalTests        — number of rows
 *   • passCount         — rows with result === 'pass'
 *   • failCount         — rows with result === 'fail'
 *   • passRate          — passCount / (passCount + failCount) as a 0..100 integer
 *                          percentage; 0 when there are no pass/fail results
 *   • expiredCount      — distinct assets whose latest test has expired
 *   • expiringSoonCount — distinct assets whose latest test expires within window
 *
 * Expiry counts are computed on the latest test per asset so a single vehicle is
 * never double-counted across multiple historical certificates.
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 * @returns {{ totalTests:number, passCount:number, failCount:number,
 *             passRate:number, expiredCount:number, expiringSoonCount:number }}
 */
export function summariseEmissions(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows : []
  let passCount = 0
  let failCount = 0
  for (const r of list) {
    const result = String(r?.result || '').trim().toLowerCase()
    if (result === 'pass') passCount += 1
    else if (result === 'fail') failCount += 1
  }
  const decided = passCount + failCount
  const passRate = decided > 0 ? Math.round((passCount / decided) * 100) : 0

  let expiredCount = 0
  let expiringSoonCount = 0
  for (const r of latestPerAsset(list)) {
    const status = expiryStatus(r, nowMs)
    if (status === 'expired') expiredCount += 1
    else if (status === 'expiring_soon') expiringSoonCount += 1
  }

  return {
    totalTests: list.length,
    passCount,
    failCount,
    passRate,
    expiredCount,
    expiringSoonCount,
  }
}
