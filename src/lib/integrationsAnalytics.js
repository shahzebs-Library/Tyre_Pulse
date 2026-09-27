/**
 * integrationsAnalytics - pure engine behind the API & Webhooks page.
 *
 * No I/O. Every time-dependent answer takes an injectable `now` so tests (and
 * the page) agree on what "expired" and "stale" mean at a given instant.
 *
 * HONESTY RULES
 *  - A rate with no denominator is null (rendered N/A), never 0 or 100.
 *  - Delivery figures describe the rows LOADED (one server page), and the
 *    summary says so via `scope: 'page'`; the exact server total is separate.
 */

const DAY = 86400000

export const EXPIRING_SOON_DAYS = 30
export const STALE_KEY_DAYS = 90

function toMs(v) {
  if (v == null || v === '') return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

function nowMs(now) {
  const t = now instanceof Date ? now.getTime() : toMs(now)
  return t == null ? Date.now() : t
}

function norm(s) {
  return String(s ?? '').trim().toLowerCase()
}

// ── API keys ──────────────────────────────────────────────────────────────────

export const KEY_STATUS_LABEL = { active: 'Active', expired: 'Expired', revoked: 'Revoked' }

/** 'revoked' | 'expired' | 'active' */
export function apiKeyStatus(k, now) {
  if (!k || !k.active) return 'revoked'
  const exp = toMs(k.expires_at)
  if (exp != null && exp < nowMs(now)) return 'expired'
  return 'active'
}

/** Whole days until expiry (negative when past), null when the key never expires. */
export function daysToExpiry(k, now) {
  const exp = toMs(k?.expires_at)
  if (exp == null) return null
  return Math.floor((exp - nowMs(now)) / DAY)
}

/** Days since the key was last used, null when it never was. */
export function daysSinceUse(k, now) {
  const used = toMs(k?.last_used_at)
  if (used == null) return null
  return Math.max(0, Math.floor((nowMs(now) - used) / DAY))
}

export function summarizeApiKeys(keys = [], now) {
  const list = Array.isArray(keys) ? keys : []
  let active = 0, expired = 0, revoked = 0, expiringSoon = 0, neverUsed = 0, stale = 0
  for (const k of list) {
    const st = apiKeyStatus(k, now)
    if (st === 'active') {
      active += 1
      const d = daysToExpiry(k, now)
      if (d != null && d >= 0 && d <= EXPIRING_SOON_DAYS) expiringSoon += 1
      const used = daysSinceUse(k, now)
      if (used == null) neverUsed += 1
      else if (used > STALE_KEY_DAYS) stale += 1
    } else if (st === 'expired') expired += 1
    else revoked += 1
  }
  return { total: list.length, active, expired, revoked, expiringSoon, neverUsed, stale }
}

export function filterApiKeys(keys = [], { search = '', status = 'all' } = {}, now) {
  const q = norm(search)
  return (keys || []).filter((k) => {
    if (status !== 'all' && apiKeyStatus(k, now) !== status) return false
    if (!q) return true
    return norm(k.name).includes(q) || norm(k.key_prefix).includes(q) || (k.scopes || []).some((s) => norm(s).includes(q))
  })
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export const HOOK_HEALTH_LABEL = {
  healthy: 'Healthy',
  failing: 'Failing',
  disabled: 'Auto-disabled',
  inactive: 'Inactive',
}

/** 'disabled' (auto-disabled with a reason) | 'inactive' | 'failing' | 'healthy' */
export function webhookHealth(h) {
  if (!h) return 'inactive'
  if (h.disabled_reason) return 'disabled'
  if (!h.active) return 'inactive'
  if (Number(h.consecutive_failures) > 0) return 'failing'
  return 'healthy'
}

export function summarizeWebhooks(hooks = []) {
  const list = Array.isArray(hooks) ? hooks : []
  const out = { total: list.length, healthy: 0, failing: 0, disabled: 0, inactive: 0, allEvents: 0, subscribedEvents: 0 }
  const events = new Set()
  for (const h of list) {
    out[webhookHealth(h)] += 1
    if (!h.event_types || h.event_types.length === 0) out.allEvents += 1
    else h.event_types.forEach((e) => events.add(e))
  }
  out.subscribedEvents = events.size
  out.active = out.healthy + out.failing
  return out
}

export function filterWebhooks(hooks = [], { search = '', health = 'all' } = {}) {
  const q = norm(search)
  return (hooks || []).filter((h) => {
    if (health !== 'all' && webhookHealth(h) !== health) return false
    if (!q) return true
    return norm(h.name).includes(q) || norm(h.url).includes(q) || (h.event_types || []).some((e) => norm(e).includes(q))
  })
}

// ── Deliveries ───────────────────────────────────────────────────────────────

export const DELIVERY_STATUS_LABEL = { pending: 'Pending', delivered: 'Delivered', failed: 'Failed' }

/**
 * Summary over the LOADED deliveries (one server page). `successRate` is the
 * share of finished attempts (delivered + failed) that were delivered; null
 * when nothing on the page has finished.
 */
export function summarizeDeliveries(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let delivered = 0, failed = 0, pending = 0, attempts = 0, attemptRows = 0, httpErrors = 0
  for (const d of list) {
    if (d.status === 'delivered') delivered += 1
    else if (d.status === 'failed') failed += 1
    else pending += 1
    const a = Number(d.attempts)
    if (Number.isFinite(a)) { attempts += a; attemptRows += 1 }
    const code = Number(d.response_status)
    if (Number.isFinite(code) && code >= 300) httpErrors += 1
  }
  const finished = delivered + failed
  return {
    scope: 'page',
    loaded: list.length,
    delivered,
    failed,
    pending,
    httpErrors,
    successRate: finished > 0 ? Math.round((delivered / finished) * 1000) / 10 : null,
    avgAttempts: attemptRows > 0 ? Math.round((attempts / attemptRows) * 10) / 10 : null,
  }
}

export function filterDeliveries(rows = [], { search = '', status = 'all' } = {}, subName = () => '') {
  const q = norm(search)
  return (rows || []).filter((d) => {
    if (status !== 'all' && d.status !== status) return false
    if (!q) return true
    return norm(d.event_type).includes(q) || norm(subName(d.subscription_id)).includes(q) || norm(d.last_error).includes(q)
  })
}

/** [{ event, count }] sorted by count desc then name, over the given rows. */
export function eventTypeBreakdown(rows = []) {
  const m = new Map()
  for (const d of rows || []) {
    const k = d.event_type || 'unknown'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()]
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event))
}

export function fmtRate(v) {
  return v == null ? 'N/A' : `${v}%`
}
