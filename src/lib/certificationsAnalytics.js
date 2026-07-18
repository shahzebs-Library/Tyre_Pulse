/**
 * certificationsAnalytics.js: pure, deterministic analytics engine for the
 * Certifications module (driver / vehicle / technician / site licences, permits
 * and inspections and their EXPIRY). No I/O: every function takes an injected
 * `now` (ms or Date) so the results are fully reproducible and unit-testable.
 *
 * The engine derives, from real certification rows only (never fabricated):
 *   - days-to-expiry + a lifecycle band per cert (valid / expiring / expired /
 *     revoked), with tunable thresholds;
 *   - headline KPIs (total, valid %, expiring-soon, expired, next expiry);
 *   - a 12-month renewal pipeline (upcoming expiries by calendar month);
 *   - by-type and by-holder breakdowns;
 *   - status-distribution + by-type chart series.
 *
 * Rows with no usable expiry_date are treated as 'valid' (nothing to renew) and
 * are never invented into the pipeline. Empty input yields honest zeros/N/A.
 */

// -- Tunable thresholds -------------------------------------------------------
// A certification is "expiring soon" within this many days of its expiry_date.
export const EXPIRING_SOON_DAYS = 30
// How many forward months the renewal pipeline spans (inclusive of this month).
export const PIPELINE_MONTHS = 12

export const CERT_STATUSES = ['valid', 'expiring', 'expired', 'revoked']

export const SUBJECT_TYPES = ['driver', 'vehicle', 'technician', 'site']

export const SUBJECT_LABELS = {
  driver: 'Driver',
  vehicle: 'Vehicle',
  technician: 'Technician',
  site: 'Site',
}

export const CERT_STATUS_META = {
  valid: { label: 'Valid', tone: 'green' },
  expiring: { label: 'Expiring soon', tone: 'amber' },
  expired: { label: 'Expired', tone: 'red' },
  revoked: { label: 'Revoked', tone: 'slate' },
}

const MS_PER_DAY = 24 * 3600 * 1000
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Parse a date-ish value to a Date, or null when unusable. */
function toDate(value) {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Reference Date from an injected `now` (ms | Date | date string). */
function refDate(now) {
  if (now == null) return null
  const d = now instanceof Date ? now : new Date(now)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Whole days from `now` until the certification's expiry_date. Negative when
 * already expired, null when there is no usable expiry date. Compared on the
 * calendar-day (UTC) boundary so "today" is 0, not a fractional day.
 */
export function daysToExpiry(cert, now) {
  const expiry = toDate(cert?.expiry_date)
  if (!expiry) return null
  const ref = refDate(now)
  if (!ref) return null
  const a = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate())
  const b = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())
  return Math.round((a - b) / MS_PER_DAY)
}

/**
 * Derive the lifecycle status of a certification as of `now`:
 *   - 'revoked'  when explicitly revoked (sticky, human decision).
 *   - 'expired'  when expiry_date is in the past.
 *   - 'expiring' when expiry_date is within `expiringSoonDays`.
 *   - 'valid'    otherwise (including no expiry date on file).
 *
 * @param {object} cert
 * @param {number|Date} now
 * @param {{expiringSoonDays?:number}} [opts]
 */
export function certStatus(cert, now, opts = {}) {
  if (cert?.status === 'revoked') return 'revoked'
  const soon = Number.isFinite(opts.expiringSoonDays) ? opts.expiringSoonDays : EXPIRING_SOON_DAYS
  const days = daysToExpiry(cert, now)
  if (days == null) return 'valid'
  if (days < 0) return 'expired'
  if (days <= soon) return 'expiring'
  return 'valid'
}

/** Traffic-light band for a derived status ('good' | 'warn' | 'bad' | 'muted'). */
export function statusTone(status) {
  if (status === 'expired') return 'bad'
  if (status === 'expiring') return 'warn'
  if (status === 'revoked') return 'muted'
  return 'good'
}

const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
const monthLabel = (d) => `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

/**
 * Enrich each row with `_status` and `_days`, preserving the original fields.
 * Non-array input degrades to [].
 */
export function enrichCertifications(rows = [], now, opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  return list.map((r) => ({
    ...r,
    _status: certStatus(r, now, opts),
    _days: daysToExpiry(r, now),
  }))
}

/**
 * Sort a list of certifications by soonest expiry first. Rows with no expiry
 * date sink to the bottom; already-expired rows (most negative) surface first.
 * Non-mutating.
 */
export function sortBySoonestExpiry(rows = [], now) {
  const list = Array.isArray(rows) ? [...rows] : []
  return list.sort((a, b) => {
    const da = daysToExpiry(a, now)
    const db = daysToExpiry(b, now)
    const va = da == null ? Infinity : da
    const vb = db == null ? Infinity : db
    return va - vb
  })
}

/**
 * Build the 12-month (default) forward renewal pipeline: how many certifications
 * come up for renewal in each calendar month from `now` onward, plus a leading
 * "Overdue" bucket for already-expired non-revoked certs. Only real expiry dates
 * feed it. Revoked certs are excluded (no renewal owed).
 *
 * @returns {{overdue:number, months:Array<{key,label,count,soon:number}>, horizon:number}}
 */
export function renewalPipeline(rows = [], now, opts = {}) {
  const horizon = Number.isFinite(opts.months) ? Math.max(1, opts.months) : PIPELINE_MONTHS
  const soonDays = Number.isFinite(opts.expiringSoonDays) ? opts.expiringSoonDays : EXPIRING_SOON_DAYS
  const list = Array.isArray(rows) ? rows : []
  const ref = refDate(now)

  const months = []
  const index = new Map()
  if (ref) {
    for (let i = 0; i < horizon; i += 1) {
      const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + i, 1))
      const bucket = { key: monthKey(d), label: monthLabel(d), count: 0, soon: 0 }
      months.push(bucket)
      index.set(bucket.key, bucket)
    }
  }

  let overdue = 0
  for (const r of list) {
    if (r?.status === 'revoked') continue
    const expiry = toDate(r?.expiry_date)
    if (!expiry) continue
    const days = daysToExpiry(r, now)
    if (days == null) continue
    if (days < 0) { overdue += 1; continue }
    const bucket = index.get(monthKey(expiry))
    if (bucket) {
      bucket.count += 1
      if (days <= soonDays) bucket.soon += 1
    }
  }

  return { overdue, months, horizon }
}

/**
 * Group certifications by cert_type, with per-band counts. Sorted by total
 * count desc, then type asc. Blank cert_type collapses to "Unspecified".
 */
export function breakdownByType(rows = [], now, opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const key = String(r?.cert_type || '').trim() || 'Unspecified'
    let g = map.get(key)
    if (!g) { g = { type: key, count: 0, valid: 0, expiring: 0, expired: 0, revoked: 0 }; map.set(key, g) }
    g.count += 1
    const s = certStatus(r, now, opts)
    if (g[s] != null) g[s] += 1
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
}

/**
 * Group by holder (subject_name), highlighting who has the most lapsing certs.
 * Sorted by (expiring+expired) desc, then total desc, then name asc.
 */
export function breakdownByHolder(rows = [], now, opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const key = String(r?.subject_name || '').trim() || 'Unnamed'
    let g = map.get(key)
    if (!g) { g = { holder: key, subject_type: r?.subject_type || null, count: 0, expiring: 0, expired: 0 }; map.set(key, g) }
    g.count += 1
    const s = certStatus(r, now, opts)
    if (s === 'expiring') g.expiring += 1
    else if (s === 'expired') g.expired += 1
  }
  return [...map.values()].sort((a, b) => {
    const la = a.expiring + a.expired
    const lb = b.expiring + b.expired
    return lb - la || b.count - a.count || a.holder.localeCompare(b.holder)
  })
}

/**
 * Full analytics roll-up over a list of certifications as of `now`.
 *
 * @param {Array} rows
 * @param {number|Date} now
 * @param {{expiringSoonDays?:number, months?:number}} [opts]
 * @returns {{
 *   total:number, active:number,
 *   byStatus:{valid:number,expiring:number,expired:number,revoked:number},
 *   bySubjectType:Object<string,number>,
 *   validPct:number|null,
 *   compliancePct:number|null,
 *   expiringSoonCount:number, expiredCount:number, revokedCount:number,
 *   nextExpiry:(null|{cert:object, expiry_date:string, days:number}),
 *   expiringSoon:Array, expired:Array,
 *   pipeline:object, byType:Array, byHolder:Array,
 *   statusDistribution:Array<{status:string,label:string,count:number}>,
 * }}
 */
export function buildCertAnalytics(rows = [], now, opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const soonDays = Number.isFinite(opts.expiringSoonDays) ? opts.expiringSoonDays : EXPIRING_SOON_DAYS

  const byStatus = { valid: 0, expiring: 0, expired: 0, revoked: 0 }
  const bySubjectType = { driver: 0, vehicle: 0, technician: 0, site: 0 }
  const expiringSoon = []
  const expired = []
  let nextExpiry = null

  for (const r of list) {
    const status = certStatus(r, now, opts)
    if (byStatus[status] != null) byStatus[status] += 1
    if (bySubjectType[r?.subject_type] != null) bySubjectType[r.subject_type] += 1

    const days = daysToExpiry(r, now)
    if (status === 'expiring') expiringSoon.push({ ...r, _status: status, _days: days })
    if (status === 'expired') expired.push({ ...r, _status: status, _days: days })

    // Next expiry = the soonest non-negative expiry among non-revoked certs.
    if (status !== 'revoked' && days != null && days >= 0) {
      if (!nextExpiry || days < nextExpiry.days) {
        nextExpiry = { cert: r, expiry_date: r.expiry_date, days }
      }
    }
  }

  expiringSoon.sort((a, b) => (a._days == null ? Infinity : a._days) - (b._days == null ? Infinity : b._days))
  expired.sort((a, b) => (a._days == null ? Infinity : a._days) - (b._days == null ? Infinity : b._days))

  const total = list.length
  const active = total - byStatus.revoked
  // Valid % is over the whole tracked set; compliance % excludes revoked (renewal-owed universe).
  const validPct = total > 0 ? Math.round((byStatus.valid / total) * 1000) / 10 : null
  const compliancePct = active > 0 ? Math.round((byStatus.valid / active) * 1000) / 10 : null

  const statusDistribution = CERT_STATUSES.map((s) => ({
    status: s,
    label: CERT_STATUS_META[s].label,
    count: byStatus[s],
  }))

  return {
    total,
    active,
    byStatus,
    bySubjectType,
    validPct,
    compliancePct,
    expiringSoonCount: byStatus.expiring,
    expiredCount: byStatus.expired,
    revokedCount: byStatus.revoked,
    nextExpiry,
    expiringSoon,
    expired,
    pipeline: renewalPipeline(list, now, { ...opts, expiringSoonDays: soonDays }),
    byType: breakdownByType(list, now, opts),
    byHolder: breakdownByHolder(list, now, opts),
    statusDistribution,
  }
}
