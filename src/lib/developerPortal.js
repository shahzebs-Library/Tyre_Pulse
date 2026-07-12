/**
 * Developer Portal — pure, dependency-free domain logic for the Developer Portal
 * module (/developer-portal). Reduces API-key and webhook-endpoint record sets
 * into the KPI summaries the page renders, plus small display helpers (key
 * masking, expiry detection).
 *
 * Keeping this here (no Supabase, no React, no `Date.now()` reads) makes it
 * deterministic and unit-tested: every time-dependent function takes an injected
 * `nowMs` so results never drift with the wall clock. The service
 * (`src/lib/api/developerPortal.js`) and page (`src/pages/DeveloperPortal.jsx`)
 * both build on these primitives so the roll-up logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Milliseconds for a timestamp-ish value, or null when unparseable. */
function timeMs(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * True when an API key is past its expiry. A key is considered expired when it
 * carries an `expires_at` in the past relative to the injected `nowMs`, OR when
 * its stored `status` is already 'expired'. Keys without an expiry never expire
 * by time alone. Deterministic — `nowMs` must be supplied by the caller.
 *
 * @param {object} key
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isKeyExpired(key, nowMs) {
  if (!key) return false
  if (String(key.status || '').toLowerCase() === 'expired') return true
  const exp = timeMs(key.expires_at)
  const now = toFiniteNumber(nowMs)
  if (exp == null || now == null) return false
  return exp <= now
}

/**
 * Mask a key for display: shows the non-secret prefix followed by a fixed dot
 * run so the UI never implies it holds the full secret. Empty/absent prefixes
 * still render the dot run so the field is visually consistent.
 *
 * @param {string} prefix
 * @returns {string} e.g. "tp_live_9f3c••••••••"
 */
export function maskKey(prefix) {
  const p = prefix == null ? '' : String(prefix).trim()
  return `${p}••••••••`
}

/**
 * Summarise a set of API-key rows for the KPI header:
 *   • totalKeys        — number of rows
 *   • activeCount      — status 'active' AND not time-expired
 *   • revokedCount     — status 'revoked'
 *   • expiredCount     — expired by status or by expires_at ≤ nowMs
 *   • productionCount  — environment 'production'
 *
 * A key that is both nominally 'active' and past its expiry counts as expired,
 * not active, so the tiles never double-count or overstate live credentials.
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 */
export function summariseKeys(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows : []
  let activeCount = 0
  let revokedCount = 0
  let expiredCount = 0
  let productionCount = 0

  for (const r of list) {
    const status = String(r?.status || '').toLowerCase()
    const expired = isKeyExpired(r, nowMs)
    if (status === 'revoked') revokedCount += 1
    if (expired) expiredCount += 1
    else if (status === 'active') activeCount += 1
    if (String(r?.environment || '').toLowerCase() === 'production') productionCount += 1
  }

  return {
    totalKeys: list.length,
    activeCount,
    revokedCount,
    expiredCount,
    productionCount,
  }
}

/**
 * Summarise a set of webhook-endpoint rows for the KPI header:
 *   • totalEndpoints — number of rows
 *   • activeCount    — status 'active'
 *   • failingCount   — status 'failing'
 *   • totalFailures  — sum of failure_count across all rows
 *
 * @param {Array<object>} rows
 */
export function summariseWebhooks(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let activeCount = 0
  let failingCount = 0
  let totalFailures = 0

  for (const r of list) {
    const status = String(r?.status || '').toLowerCase()
    if (status === 'active') activeCount += 1
    if (status === 'failing') failingCount += 1
    totalFailures += toFiniteNumber(r?.failure_count) ?? 0
  }

  return {
    totalEndpoints: list.length,
    activeCount,
    failingCount,
    totalFailures,
  }
}

/**
 * Percentage of webhook endpoints that are currently 'active' (0..100, rounded).
 * Returns 0 for an empty/non-array set so the meter has a safe floor.
 *
 * @param {Array<object>} rows
 * @returns {number}
 */
export function healthyWebhookRate(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) return 0
  const active = list.reduce(
    (n, r) => n + (String(r?.status || '').toLowerCase() === 'active' ? 1 : 0),
    0,
  )
  return Math.round((active / list.length) * 100)
}
