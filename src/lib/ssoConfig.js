/**
 * SSO Configuration — pure, dependency-free domain logic for the SSO
 * Configuration module (/sso-configuration). Reduces a set of identity-provider
 * connections into certificate-health, KPI, and breakdown primitives.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/ssoConfig.js`) and page
 * (`src/pages/SsoConfiguration.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 *
 * Determinism: every time-relative helper takes `nowMs` (epoch milliseconds)
 * as an injected argument. This module never reads the wall clock itself.
 */

/** One day in milliseconds — the unit for certificate-expiry countdowns. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Certificates within this many days of expiry are flagged "expiring soon". */
export const CERT_EXPIRY_WARN_DAYS = 30

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Parse a connection's `cert_expiry` (YYYY-MM-DD or ISO) to an epoch ms, or null. */
function certExpiryMs(conn) {
  const raw = conn?.cert_expiry
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Whole days remaining until a connection's certificate expires, relative to
 * `nowMs`. Negative when already expired, 0 on the expiry day. Returns null when
 * there is no (parseable) certificate expiry date.
 *
 * Uses UTC-day granularity via a ceil on the millisecond delta so a cert
 * expiring later today still reads as 0 days remaining rather than a fraction.
 *
 * @param {object} conn
 * @param {number} nowMs
 * @returns {number|null}
 */
export function certDaysRemaining(conn, nowMs) {
  const expMs = certExpiryMs(conn)
  if (expMs == null) return null
  const now = toFiniteNumber(nowMs)
  if (now == null) return null
  return Math.ceil((expMs - now) / DAY_MS)
}

/**
 * Certificate status for a connection relative to `nowMs`:
 *   • 'unknown'       — no certificate expiry recorded
 *   • 'expired'       — expiry date is in the past
 *   • 'expiring_soon' — expires within CERT_EXPIRY_WARN_DAYS (<= 30 days)
 *   • 'valid'         — expires further out
 *
 * @param {object} conn
 * @param {number} nowMs
 * @returns {'expired'|'expiring_soon'|'valid'|'unknown'}
 */
export function certStatus(conn, nowMs) {
  const days = certDaysRemaining(conn, nowMs)
  if (days == null) return 'unknown'
  if (days < 0) return 'expired'
  if (days <= CERT_EXPIRY_WARN_DAYS) return 'expiring_soon'
  return 'valid'
}

/**
 * Split a connection's comma/whitespace-separated `domains` string into an
 * array of trimmed, non-empty, lower-cased domains (order preserved, dedup'd).
 * Returns [] when there is no domains value.
 *
 * @param {object} conn
 * @returns {string[]}
 */
export function parseDomains(conn) {
  const raw = conn?.domains
  if (raw == null) return []
  const seen = new Set()
  const out = []
  for (const part of String(raw).split(/[\s,;]+/)) {
    const d = part.trim().toLowerCase()
    if (!d || seen.has(d)) continue
    seen.add(d)
    out.push(d)
  }
  return out
}

/**
 * Summarise a set of connections for the KPI header:
 *   • totalConnections   — number of rows
 *   • activeCount        — connections with status 'active'
 *   • enforcedCount      — connections with enforce_sso truthy
 *   • expiringCertCount  — connections whose cert is expired OR expiring soon
 *   • jitEnabledCount    — connections with jit_provisioning truthy
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 */
export function summariseSso(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows : []
  let activeCount = 0
  let enforcedCount = 0
  let expiringCertCount = 0
  let jitEnabledCount = 0

  for (const r of list) {
    if (String(r?.status || '').toLowerCase() === 'active') activeCount++
    if (r?.enforce_sso === true || r?.enforce_sso === 'true') enforcedCount++
    if (r?.jit_provisioning === true || r?.jit_provisioning === 'true') jitEnabledCount++
    const cs = certStatus(r, nowMs)
    if (cs === 'expired' || cs === 'expiring_soon') expiringCertCount++
  }

  return {
    totalConnections: list.length,
    activeCount,
    enforcedCount,
    expiringCertCount,
    jitEnabledCount,
  }
}

/**
 * Count connections by protocol, as an array of { protocol, count } sorted by
 * count descending (ties keep first-seen order — stable). Rows without a
 * protocol are grouped under 'unknown'.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ protocol:string, count:number }>}
 */
export function byProtocol(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const order = []
  const counts = new Map()
  for (const r of list) {
    const p = r?.protocol ? String(r.protocol).trim().toLowerCase() : 'unknown'
    const key = p || 'unknown'
    if (!counts.has(key)) { counts.set(key, 0); order.push(key) }
    counts.set(key, counts.get(key) + 1)
  }
  return order
    .map((protocol) => ({ protocol, count: counts.get(protocol) }))
    .sort((a, b) => b.count - a.count)
}
