/**
 * API key lifecycle rules (pure, no I/O).
 *
 * Reads the rows returned by admin_list_api_keys and decides, for each key,
 * its status and the rotation findings a super admin should act on. Nothing
 * here revokes anything: every flag is advice, the revoke is a person's call.
 *
 * Rules:
 *   - rotate:      an ACTIVE key older than ROTATE_AFTER_DAYS (90).
 *   - stale:       an ACTIVE key unused for STALE_AFTER_DAYS (30), or never
 *                  used and itself older than that (a brand new key is not
 *                  stale just because nobody has called it yet).
 *   - no_expiry:   an ACTIVE key with no expiry date at all.
 *   - over_policy: an ACTIVE key older than the optional system_config
 *                  'api_key_max_age_days' policy (0 or unset = off).
 *   - expiring:    an ACTIVE key expiring within EXPIRING_WITHIN_DAYS (14).
 */

export const ROTATE_AFTER_DAYS = 90
export const STALE_AFTER_DAYS = 30
export const EXPIRING_WITHIN_DAYS = 14

const DAY_MS = 86400000

export const FLAG_META = {
  rotate: { label: `Older than ${ROTATE_AFTER_DAYS} days`, tone: 'warning', hint: 'Rotate: issue a new key, move the integration over, then revoke this one.' },
  stale: { label: `Unused ${STALE_AFTER_DAYS}+ days`, tone: 'warning', hint: 'Nothing has called this key recently. If no integration needs it, revoke it.' },
  no_expiry: { label: 'No expiry', tone: 'accent', hint: 'A key with no expiry stays valid until someone remembers to revoke it. Set one.' },
  over_policy: { label: 'Over max age policy', tone: 'danger', hint: 'Older than the platform maximum key age. Rotate it.' },
  expiring: { label: 'Expiring soon', tone: 'info', hint: 'Extend the expiry or rotate before the integration starts failing.' },
}

export const STATUS_META = {
  active: { label: 'Active', tone: 'good' },
  expired: { label: 'Expired', tone: 'quiet' },
  revoked: { label: 'Revoked', tone: 'danger' },
}

function toMs(v) {
  if (v === null || v === undefined || v === '') return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Whole days between an instant and now; null when the instant is unknown. */
export function daysSince(v, now = Date.now()) {
  const t = toMs(v)
  if (t === null) return null
  return Math.max(0, Math.floor((now - t) / DAY_MS))
}

/** Whole days from now until an instant (negative once it has passed). */
export function daysUntil(v, now = Date.now()) {
  const t = toMs(v)
  if (t === null) return null
  return Math.floor((t - now) / DAY_MS)
}

/** active | expired | revoked. Revoked wins: it is terminal. */
export function keyStatus(key, now = Date.now()) {
  if (!key) return 'revoked'
  if (key.active === false) return 'revoked'
  const exp = toMs(key.expires_at)
  if (exp !== null && exp <= now) return 'expired'
  return 'active'
}

function policyDays(maxAgeDays) {
  const n = Number(maxAgeDays)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Rotation findings for one key. Only an active key gets findings. */
export function keyFlags(key, { now = Date.now(), maxAgeDays = null } = {}) {
  if (keyStatus(key, now) !== 'active') return []
  const flags = []
  const age = daysSince(key.created_at, now)
  const idle = daysSince(key.last_used_at, now)
  const policy = policyDays(maxAgeDays)
  if (policy !== null && age !== null && age > policy) flags.push('over_policy')
  if (age !== null && age > ROTATE_AFTER_DAYS) flags.push('rotate')
  if (idle !== null ? idle >= STALE_AFTER_DAYS : (age !== null && age >= STALE_AFTER_DAYS)) flags.push('stale')
  if (toMs(key.expires_at) === null) flags.push('no_expiry')
  else {
    const left = daysUntil(key.expires_at, now)
    if (left !== null && left <= EXPIRING_WITHIN_DAYS) flags.push('expiring')
  }
  return flags
}

/** Adds status / ageDays / idleDays / expiresInDays / flags to each key. */
export function decorateKeys(keys = [], opts = {}) {
  const now = opts.now ?? Date.now()
  return (Array.isArray(keys) ? keys : []).map((k) => ({
    ...k,
    status: keyStatus(k, now),
    ageDays: daysSince(k.created_at, now),
    idleDays: daysSince(k.last_used_at, now),
    expiresInDays: daysUntil(k.expires_at, now),
    flags: keyFlags(k, { now, maxAgeDays: opts.maxAgeDays }),
  }))
}

/** Headline counts for the tiles. */
export function summarizeKeys(decorated = []) {
  const out = {
    total: decorated.length, active: 0, expired: 0, revoked: 0,
    needsAttention: 0, rotate: 0, stale: 0, no_expiry: 0, over_policy: 0, expiring: 0,
    orgs: new Set(decorated.map((k) => k.organisation_id).filter(Boolean)).size,
    requestsLastHour: 0,
  }
  for (const k of decorated) {
    out[k.status] += 1
    if (k.flags.length) out.needsAttention += 1
    for (const f of k.flags) out[f] += 1
    out.requestsLastHour += Number(k.requests_last_hour) || 0
  }
  return out
}

/** Filter by status (all | active | expired | revoked | attention | <flag>) and free text. */
export function filterKeys(decorated = [], { status = 'all', search = '', org = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return decorated.filter((k) => {
    if (org && k.organisation_id !== org) return false
    if (status === 'attention' && !k.flags.length) return false
    if (['active', 'expired', 'revoked'].includes(status) && k.status !== status) return false
    if (FLAG_META[status] && !k.flags.includes(status)) return false
    if (!q) return true
    return [k.name, k.key_prefix, k.organisation_name, k.created_by_name, ...(k.scopes || [])]
      .some((v) => String(v || '').toLowerCase().includes(q))
  })
}

/** Validation for the revoke dialog; mirrors the server (>= 5 characters). */
export function revokeReasonError(reason) {
  const r = String(reason || '').trim()
  if (!r) return 'Say why this key is being revoked.'
  if (r.length < 5) return 'Give a reason of at least 5 characters.'
  return null
}

/** Validation for a new expiry; mirrors the server (future, at most 5 years). */
export function expiryError(value, now = Date.now()) {
  if (value === null || value === '') return null // clearing is allowed
  const t = toMs(value)
  if (t === null) return 'Pick a valid date.'
  if (t <= now) return 'The expiry must be in the future. Revoke the key instead.'
  if (t > now + 5 * 365 * DAY_MS) return 'The expiry cannot be more than 5 years ahead.'
  return null
}

/** New expiry = the later of now and the current expiry, plus N days. */
export function extendedExpiry(currentExpiry, days, now = Date.now()) {
  const base = Math.max(now, toMs(currentExpiry) ?? now)
  return new Date(base + days * DAY_MS).toISOString()
}
