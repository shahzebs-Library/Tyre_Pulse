/**
 * developerPortalAnalytics - pure view logic for the Developer Portal page
 * (/developer-portal), built on the domain primitives in developerPortal.js
 * (isKeyExpired, summariseKeys, ...). No I/O; `nowMs` is always injected.
 *
 * Honesty rules:
 *   - A health or usage rate over an empty set is null (N/A), not 0% or 100%.
 *   - "Never used" is a key with no last_used_at, which is a real signal; an
 *     unparseable date is treated as unknown, not as never.
 */
import { isKeyExpired, toFiniteNumber } from './developerPortal'

export const EXPIRING_SOON_DAYS = 30
export const STALE_KEY_DAYS = 90
const MS_DAY = 24 * 60 * 60 * 1000

function ms(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Effective key status: expired by time wins over a stored 'active'. */
export function keyStatus(key, nowMs) {
  if (!key) return ''
  return isKeyExpired(key, nowMs) ? 'expired' : String(key.status || '').toLowerCase()
}

/** Key rows with the effective status attached (for sort / filter / export). */
export function keyRows(keys, nowMs) {
  return (Array.isArray(keys) ? keys : []).map((k) => ({ ...k, _status: keyStatus(k, nowMs) }))
}

/** Webhook rows with a normalised status and numeric failure count. */
export function hookRows(hooks) {
  return (Array.isArray(hooks) ? hooks : []).map((h) => ({
    ...h,
    _status: String(h.status || '').toLowerCase(),
    _failures: toFiniteNumber(h.failure_count),
  }))
}

function hay(parts) {
  return parts.filter(Boolean).join(' ').toLowerCase()
}

/** Filter key rows (from keyRows) by effective status and free text. */
export function filterKeyRows(rows, { status = '', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (status && r._status !== status) return false
    if (!q) return true
    return hay([r.key_name, r.key_prefix, r.scopes, r.environment, r.created_label, r.notes]).includes(q)
  })
}

/** Filter webhook rows (from hookRows) by status and free text. */
export function filterHookRows(rows, { status = '', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (status && r._status !== status) return false
    if (!q) return true
    return hay([r.endpoint_name, r.url, r.event_types, r.notes]).includes(q)
  })
}

/**
 * Key hygiene signals over LIVE keys (active and not expired):
 *   expiringSoon  expires within EXPIRING_SOON_DAYS
 *   neverUsed     no last_used_at at all
 *   stale         last used more than STALE_KEY_DAYS ago
 *   noExpiry      live keys that never expire
 *   usedRate      share of live keys used at least once (null when none live)
 */
export function keyInsights(keys, nowMs) {
  const live = (Array.isArray(keys) ? keys : []).filter((k) => keyStatus(k, nowMs) === 'active')
  const soonCut = nowMs + EXPIRING_SOON_DAYS * MS_DAY
  const staleCut = nowMs - STALE_KEY_DAYS * MS_DAY
  let expiringSoon = 0
  let neverUsed = 0
  let stale = 0
  let noExpiry = 0
  for (const k of live) {
    const exp = ms(k.expires_at)
    if (exp == null) noExpiry += 1
    else if (exp <= soonCut) expiringSoon += 1
    if (!k.last_used_at) neverUsed += 1
    else {
      const used = ms(k.last_used_at)
      if (used != null && used < staleCut) stale += 1
    }
  }
  return {
    live: live.length,
    expiringSoon,
    neverUsed,
    stale,
    noExpiry,
    usedRate: live.length > 0 ? (live.length - neverUsed) / live.length : null,
  }
}

/**
 * Webhook signals:
 *   withoutSecret  endpoints with no signing secret recorded
 *   withFailures   endpoints that recorded at least one failed delivery
 *   healthRate     active / total, null when there are no endpoints
 *   worst          the endpoint with the most failures (null when none failed)
 */
export function hookInsights(hooks) {
  const rows = hookRows(hooks)
  let worst = null
  for (const r of rows) {
    if ((r._failures ?? 0) > 0 && (!worst || r._failures > worst._failures)) worst = r
  }
  const active = rows.filter((r) => r._status === 'active').length
  return {
    total: rows.length,
    withoutSecret: rows.filter((r) => !r.secret_set).length,
    withFailures: rows.filter((r) => (r._failures ?? 0) > 0).length,
    healthRate: rows.length > 0 ? active / rows.length : null,
    worst: worst ? { name: worst.endpoint_name || null, failures: worst._failures } : null,
  }
}
