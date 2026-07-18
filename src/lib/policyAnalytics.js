/**
 * policyAnalytics.js - Pure, deterministic analytics for the Policy Management
 * module. NO I/O: every function is injectable (the reference clock `now` is a
 * parameter) so it is fully unit-testable and lives in exactly one place.
 *
 * The backing `policies` table (V137) stores fleet governance documents with a
 * lifecycle status (draft / active / under_review / archived), an effective_date
 * and a review_date. For a fleet policy the review_date is the renewal / expiry
 * trigger, so the "expiry" analytics below key off review_date.
 *
 * HONESTY RULES (no fabrication):
 *  - Premium is summed ONLY over rows that actually carry a numeric premium
 *    field. When no row has one, the total is null so the UI can show "N/A"
 *    instead of a fake 0.
 *  - Breakdown buckets are built only from values present on the rows.
 *  - `category` is the coverage-type dimension; `owner` is the responsible
 *    party; an optional `insurer` field is used only when present.
 */

export const POLICY_STATUSES = ['draft', 'active', 'under_review', 'archived']

export const POLICY_STATUS_LABELS = {
  draft: 'Draft',
  active: 'Active',
  under_review: 'Under review',
  archived: 'Archived',
}

// Default "expiring soon" horizon in days (tunable by callers).
export const DEFAULT_WARN_DAYS = 30

// Optional numeric premium fields, checked in priority order. The governance
// table does not ship one today; the engine reads it if a deployment adds it.
export const PREMIUM_FIELDS = ['premium', 'premium_amount', 'annual_premium']
// Optional insurer / provider fields, checked in priority order.
export const INSURER_FIELDS = ['insurer', 'insurer_name', 'provider']

export const EXPIRY_BANDS = [
  { key: 'expired', label: 'Expired' },
  { key: 'expiring', label: 'Expiring soon' },
  { key: 'valid', label: 'Valid' },
  { key: 'none', label: 'No renewal date' },
]

const DAY_MS = 24 * 60 * 60 * 1000

// ── primitives ────────────────────────────────────────────────────────────────

/** Parse a value to a valid Date, or null. */
export function toDate(v) {
  if (!v && v !== 0) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole days from `now` to `date` (positive = future). null when undatable. */
export function daysUntil(date, now) {
  const d = toDate(date)
  const ref = toDate(now) || new Date()
  if (!d) return null
  return Math.ceil((d.getTime() - ref.getTime()) / DAY_MS)
}

/** Parse a finite non-negative amount, or null. Strips currency symbols/commas. */
export function parseAmount(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const cleaned = String(v).replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Numeric premium for a policy from the first present PREMIUM_FIELDS, or null. */
export function policyPremium(policy) {
  if (!policy) return null
  for (const f of PREMIUM_FIELDS) {
    if (policy[f] != null && policy[f] !== '') {
      const n = parseAmount(policy[f])
      if (n != null) return n
    }
  }
  return null
}

/** Insurer/provider string for a policy, or null (never invented). */
export function policyInsurer(policy) {
  if (!policy) return null
  for (const f of INSURER_FIELDS) {
    const raw = policy[f]
    if (raw != null && String(raw).trim() !== '') return String(raw).trim()
  }
  return null
}

// ── expiry / renewal ──────────────────────────────────────────────────────────

/**
 * Expiry state of a single policy as of `now`, keyed off review_date.
 * band: 'expired' | 'expiring' | 'valid' | 'none'.
 * Archived policies are out of active governance, so they are never flagged as
 * expiring/expired (band reflects the raw date but `actionable` is false).
 */
export function policyExpiry(policy, now, { warnDays = DEFAULT_WARN_DAYS } = {}) {
  const date = toDate(policy?.review_date)
  const archived = policy?.status === 'archived'
  if (!date) {
    return { hasDate: false, band: 'none', days: null, expired: false, expiringSoon: false, actionable: false }
  }
  const days = daysUntil(date, now)
  let band
  if (days < 0) band = 'expired'
  else if (days <= warnDays) band = 'expiring'
  else band = 'valid'
  const actionable = !archived
  return {
    hasDate: true,
    band,
    days,
    expired: band === 'expired' && actionable,
    expiringSoon: band === 'expiring' && actionable,
    actionable,
  }
}

/**
 * Count policies into expiry bands as of `now`. By default archived policies are
 * excluded from valid/expiring/expired (they are still counted in `archived`).
 */
export function expiryBands(rows, now, { warnDays = DEFAULT_WARN_DAYS } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const bands = { expired: 0, expiring: 0, valid: 0, none: 0 }
  let archived = 0
  let governed = 0
  for (const r of list) {
    if (r?.status === 'archived') { archived += 1; continue }
    governed += 1
    const e = policyExpiry(r, now, { warnDays })
    bands[e.band] += 1
  }
  return { ...bands, archived, governed, total: list.length }
}

// ── status ────────────────────────────────────────────────────────────────────

/** Status distribution over the known vocabulary plus an `unknown` catch-all. */
export function statusDistribution(rows) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { draft: 0, active: 0, under_review: 0, archived: 0, unknown: 0 }
  for (const r of list) {
    const s = r?.status
    if (byStatus[s] != null) byStatus[s] += 1
    else byStatus.unknown += 1
  }
  const order = [...POLICY_STATUSES, 'unknown']
  const list2 = order
    .filter((s) => byStatus[s] > 0 || s !== 'unknown')
    .map((s) => ({ status: s, label: POLICY_STATUS_LABELS[s] || 'Unknown', count: byStatus[s] }))
  return { total: list.length, byStatus, list: list2 }
}

// ── renewal pipeline ──────────────────────────────────────────────────────────

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthLabel(d) {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * Upcoming renewals bucketed by month for the next `months` calendar months
 * (starting with the month containing `now`), driven by review_date. Archived
 * policies are excluded. Also returns `overdue` (review_date already past).
 * Each bucket carries a premium sum ONLY over rows that have a premium (else 0
 * with premiumPresent flag false).
 */
export function renewalPipeline(rows, now, { months = 12 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const ref = toDate(now) || new Date()
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1)
  const buckets = []
  const index = new Map()
  for (let i = 0; i < Math.max(1, months); i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    const key = monthKey(d)
    const b = { key, label: monthLabel(d), count: 0, premium: 0, premiumPresent: false }
    buckets.push(b)
    index.set(key, b)
  }
  let overdue = 0
  let overduePremium = 0
  for (const r of list) {
    if (r?.status === 'archived') continue
    const d = toDate(r?.review_date)
    if (!d) continue
    const prem = policyPremium(r)
    // Overdue = renewal date already past relative to `now` (not just the
    // month start), so a policy that lapsed earlier this month is flagged.
    if (d.getTime() < ref.getTime()) {
      overdue += 1
      if (prem != null) overduePremium += prem
      continue
    }
    const b = index.get(monthKey(d))
    if (b) {
      b.count += 1
      if (prem != null) { b.premium += prem; b.premiumPresent = true }
    }
  }
  return { buckets, overdue, overduePremium }
}

// ── breakdowns ────────────────────────────────────────────────────────────────

/**
 * Group rows by a key function, counting rows and summing premium where present.
 * Returns [{ key, count, premium(null|number), premiumCount }] sorted by count
 * desc then key. `keyFn` returning null/'' folds into an "Unspecified" bucket.
 */
export function groupBy(rows, keyFn, { unspecified = 'Unspecified' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    let k = keyFn(r)
    k = k == null || String(k).trim() === '' ? unspecified : String(k).trim()
    let g = map.get(k)
    if (!g) { g = { key: k, count: 0, premium: 0, premiumCount: 0 }; map.set(k, g) }
    g.count += 1
    const prem = policyPremium(r)
    if (prem != null) { g.premium += prem; g.premiumCount += 1 }
  }
  return [...map.values()]
    .map((g) => ({ ...g, premium: g.premiumCount > 0 ? g.premium : null }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
}

/** Breakdown by coverage type (the `category` column). */
export function byCoverageType(rows) {
  return groupBy(rows, (r) => r?.category)
}
/** Breakdown by responsible owner (the `owner` column). */
export function byOwner(rows) {
  return groupBy(rows, (r) => r?.owner)
}
/** Breakdown by insurer (only meaningful when rows carry an insurer field). */
export function byInsurer(rows) {
  return groupBy(rows, (r) => policyInsurer(r))
}

// ── premium ───────────────────────────────────────────────────────────────────

/**
 * Portfolio premium. total is null (=> render N/A) unless at least one row
 * carries a numeric premium. Never fabricates a 0.
 */
export function premiumSummary(rows) {
  const list = Array.isArray(rows) ? rows : []
  let total = 0
  let present = 0
  for (const r of list) {
    const p = policyPremium(r)
    if (p != null) { total += p; present += 1 }
  }
  return {
    hasAny: present > 0,
    total: present > 0 ? total : null,
    present,
    missing: list.length - present,
    average: present > 0 ? total / present : null,
  }
}

// ── sort + filter ─────────────────────────────────────────────────────────────

/** New array sorted by soonest review_date (nulls last). Non-mutating. */
export function sortByExpiry(rows, direction = 'asc') {
  const list = Array.isArray(rows) ? [...rows] : []
  const dir = direction === 'desc' ? -1 : 1
  return list.sort((a, b) => {
    const da = toDate(a?.review_date)
    const db = toDate(b?.review_date)
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return (da.getTime() - db.getTime()) * dir
  })
}

/**
 * Pure filter used by the table (and tests). All filters optional:
 *   { status, category, owner, insurer, band, search, from, to }
 * `band` matches policyExpiry().band; `from`/`to` bound review_date (inclusive).
 */
export function filterPolicies(rows, filters = {}, now, { warnDays = DEFAULT_WARN_DAYS } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const { status, category, owner, insurer, band, search, from, to } = filters
  const q = String(search || '').trim().toLowerCase()
  const fromD = toDate(from)
  const toD = toDate(to)
  return list.filter((r) => {
    if (status && status !== 'all' && r?.status !== status) return false
    if (category && r?.category !== category) return false
    if (owner && r?.owner !== owner) return false
    if (insurer && policyInsurer(r) !== insurer) return false
    if (band && band !== 'all') {
      // Archived policies are out of active governance: they only match an
      // explicit 'archived' band, never the date bands (matches expiryBands).
      if (band === 'archived') {
        if (r?.status !== 'archived') return false
      } else if (r?.status === 'archived' || policyExpiry(r, now, { warnDays }).band !== band) {
        return false
      }
    }
    if (fromD || toD) {
      const d = toDate(r?.review_date)
      if (!d) return false
      if (fromD && d.getTime() < fromD.getTime()) return false
      if (toD && d.getTime() > toD.getTime()) return false
    }
    if (q) {
      const ins = policyInsurer(r) || ''
      const hay = `${r?.title || ''} ${r?.category || ''} ${r?.owner || ''} ${r?.version || ''} ${ins}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ── master composer ───────────────────────────────────────────────────────────

/**
 * Compose the full portfolio snapshot as of `now`. Deterministic. Combines the
 * KPI counts, status/expiry/pipeline distributions and the breakdowns so the
 * page reads them from one place.
 */
export function summarizePolicyPortfolio(rows, now, { warnDays = DEFAULT_WARN_DAYS, pipelineMonths = 12 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const status = statusDistribution(list)
  const bands = expiryBands(list, now, { warnDays })
  const pipeline = renewalPipeline(list, now, { months: pipelineMonths })
  const premium = premiumSummary(list)
  const coverage = byCoverageType(list)
  const owners = byOwner(list)
  const insurers = byInsurer(list)
  const hasInsurer = list.some((r) => policyInsurer(r) != null)

  return {
    total: list.length,
    warnDays,
    status,
    bands,
    pipeline,
    premium,
    coverage,
    owners,
    insurers,
    hasInsurer,
    kpis: {
      total: list.length,
      active: status.byStatus.active,
      underReview: status.byStatus.under_review,
      archived: status.byStatus.archived,
      expiringSoon: bands.expiring,
      expired: bands.expired,
      noRenewalDate: bands.none,
      coverageTypes: coverage.filter((c) => c.key !== 'Unspecified').length,
      owners: owners.filter((o) => o.key !== 'Unspecified').length,
      premiumTotal: premium.total, // null => N/A
    },
  }
}
