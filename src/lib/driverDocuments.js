/**
 * Driver Documents — pure helpers (no I/O) for the Driver Documents module.
 *
 * Derives a lifecycle band (valid / expiring / expired) from a document's
 * expiry_date and rolls a list of records up into counts, an expiring-soon
 * list, an expired list, and a distinct-driver count.
 *
 * Every function takes an injected `now` (ms or Date) so results are fully
 * deterministic and unit-testable — the module never reads Date.now() itself.
 */

// A document is "expiring soon" within this many days of its expiry_date.
export const EXPIRING_SOON_DAYS = 60

export const DOC_STATUSES = ['valid', 'expiring', 'expired']

export const DOC_TYPES = ['license', 'medical', 'permit', 'visa', 'other']

export const DOC_STATUS_META = {
  valid: { label: 'Valid', tone: 'green' },
  expiring: { label: 'Expiring soon', tone: 'amber' },
  expired: { label: 'Expired', tone: 'red' },
}

export const DOC_TYPE_LABELS = {
  license: 'Licence',
  medical: 'Medical',
  permit: 'Permit',
  visa: 'Visa',
  other: 'Other',
}

/** Parse a date-ish value to a Date, or null when unusable. */
function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Whole days from `now` until the document's expiry_date. Negative when already
 * expired, null when there is no usable expiry date.
 */
export function daysToExpiry(doc, now) {
  const expiry = toDate(doc?.expiry_date)
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
 * Derive the lifecycle status of a document as of `now`:
 *   - 'expired'  when expiry_date is in the past.
 *   - 'expiring' when expiry_date is within EXPIRING_SOON_DAYS.
 *   - 'valid'    otherwise (including no expiry date on file).
 */
export function docStatus(doc, now) {
  const days = daysToExpiry(doc, now)
  if (days == null) return 'valid'
  if (days < 0) return 'expired'
  if (days <= EXPIRING_SOON_DAYS) return 'expiring'
  return 'valid'
}

/**
 * Roll a list of driver documents up into { total, byStatus, expiringSoon,
 * expired, drivers }. Each row is banded via docStatus so a stored status that
 * has since lapsed is reflected correctly.
 *   - `expiringSoon` lists rows whose derived status is 'expiring' or 'expired',
 *     soonest expiry first, each carrying a `daysToExpiry` and derived `status`.
 *   - `expired`      lists only the already-expired rows (soonest-first).
 *   - `drivers`      is the count of distinct driver names present.
 */
export function summarizeDriverDocuments(rows = [], now) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { valid: 0, expiring: 0, expired: 0 }
  const expiringSoon = []
  const expired = []
  const driverSet = new Set()

  for (const r of list) {
    const status = docStatus(r, now)
    if (byStatus[status] != null) byStatus[status] += 1
    const name = typeof r?.driver_name === 'string' ? r.driver_name.trim() : ''
    if (name) driverSet.add(name.toLowerCase())
    if (status === 'expiring' || status === 'expired') {
      const enriched = { ...r, status, daysToExpiry: daysToExpiry(r, now) }
      expiringSoon.push(enriched)
      if (status === 'expired') expired.push(enriched)
    }
  }

  const bySoonest = (a, b) => {
    const da = a.daysToExpiry == null ? Infinity : a.daysToExpiry
    const db = b.daysToExpiry == null ? Infinity : b.daysToExpiry
    return da - db
  }
  expiringSoon.sort(bySoonest)
  expired.sort(bySoonest)

  return {
    total: list.length,
    byStatus,
    expiringSoon,
    expired,
    drivers: driverSet.size,
  }
}
