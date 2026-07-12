/**
 * Certifications — pure helpers (no I/O) for the Certifications module.
 *
 * Derives a lifecycle band (valid / expiring / expired) from a certification's
 * expiry_date and rolls a list of records up into counts + an expiring-soon
 * list. A record explicitly marked 'revoked' keeps that status.
 *
 * Every function takes an injected `now` (ms or Date) so results are fully
 * deterministic and unit-testable — the module never reads Date.now() itself.
 */

// A certification is "expiring soon" within this many days of its expiry_date.
export const EXPIRING_SOON_DAYS = 60

export const CERT_STATUSES = ['valid', 'expiring', 'expired', 'revoked']

export const SUBJECT_TYPES = ['driver', 'vehicle', 'technician', 'site']

export const CERT_STATUS_META = {
  valid: { label: 'Valid', tone: 'green' },
  expiring: { label: 'Expiring soon', tone: 'amber' },
  expired: { label: 'Expired', tone: 'red' },
  revoked: { label: 'Revoked', tone: 'slate' },
}

/** Parse a date-ish value to a Date, or null when unusable. */
function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Whole days from `now` until the certification's expiry_date. Negative when
 * already expired, null when there is no usable expiry date.
 */
export function daysToExpiry(cert, now) {
  const expiry = toDate(cert?.expiry_date)
  if (!expiry) return null
  const ref = toDate(now) || new Date(now)
  if (!ref || Number.isNaN(ref.getTime())) return null
  const MS = 24 * 3600 * 1000
  // Compare on the calendar-day boundary so "today" is 0, not a fractional day.
  const a = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate())
  const b = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())
  return Math.round((a - b) / MS)
}

/**
 * Derive the lifecycle status of a certification as of `now`:
 *   - 'revoked'  when the record is explicitly revoked (sticky).
 *   - 'expired'  when expiry_date is in the past.
 *   - 'expiring' when expiry_date is within EXPIRING_SOON_DAYS.
 *   - 'valid'    otherwise (including no expiry date on file).
 */
export function certStatus(cert, now) {
  if (cert?.status === 'revoked') return 'revoked'
  const days = daysToExpiry(cert, now)
  if (days == null) return 'valid'
  if (days < 0) return 'expired'
  if (days <= EXPIRING_SOON_DAYS) return 'expiring'
  return 'valid'
}

/**
 * Roll a list of certifications up into { total, byStatus, bySubjectType,
 * expiringSoon }. Each row is banded via certStatus so a stored status that has
 * since lapsed is reflected correctly. `expiringSoon` lists rows whose derived
 * status is 'expiring' or 'expired', soonest expiry first, each carrying a
 * `daysToExpiry` and derived `status`.
 */
export function summarizeCertifications(rows = [], now) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { valid: 0, expiring: 0, expired: 0, revoked: 0 }
  const bySubjectType = { driver: 0, vehicle: 0, technician: 0, site: 0 }
  const expiringSoon = []

  for (const r of list) {
    const status = certStatus(r, now)
    if (byStatus[status] != null) byStatus[status] += 1
    const subj = SUBJECT_TYPES.includes(r?.subject_type) ? r.subject_type : null
    if (subj) bySubjectType[subj] += 1
    if (status === 'expiring' || status === 'expired') {
      expiringSoon.push({ ...r, status, daysToExpiry: daysToExpiry(r, now) })
    }
  }

  expiringSoon.sort((a, b) => {
    const da = a.daysToExpiry == null ? Infinity : a.daysToExpiry
    const db = b.daysToExpiry == null ? Infinity : b.daysToExpiry
    return da - db
  })

  return {
    total: list.length,
    byStatus,
    bySubjectType,
    expiringSoon,
  }
}
