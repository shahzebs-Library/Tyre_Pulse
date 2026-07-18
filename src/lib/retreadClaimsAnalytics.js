/**
 * Retread Claims analytics - pure, dependency-light aggregation for the
 * Retread Claims module (warranty / quality claims raised against retread
 * vendors). NO I/O: every function takes an already-fetched row array and
 * returns plain data, so the page, exports and tests share one calculation
 * source.
 *
 * Real columns only (public.retread_claims): claim_no, tyre_serial, asset_no,
 * vendor, reason, claim_date (date), cost (numeric), amount_recovered
 * (numeric), status (open|submitted|approved|rejected|settled), notes,
 * created_at, updated_at. There is NO brand column on this table, so brand
 * ranking is only produced when caller-supplied rows carry a `brand` field -
 * never fabricated.
 *
 * Status model:
 *   open, submitted        -> live, awaiting a vendor decision
 *   approved               -> decided in our favour, recovery pending
 *   settled                -> approved AND money recovered / closed
 *   rejected               -> decided against us
 * A claim is "decided" once it is approved / settled / rejected; the approval
 * rate is measured over decided claims. "Resolved" (for time-to-resolve) means
 * settled or rejected - a final outcome with a resolution timestamp.
 */

import { RETREAD_CLAIM_STATUSES, RETREAD_CLAIM_STATUS_META } from './retreadClaims.js'

// Re-export the canonical vocab so consumers can depend on this one module.
export { RETREAD_CLAIM_STATUSES, RETREAD_CLAIM_STATUS_META }

/** Claims still live (no final outcome yet). */
export const OPEN_STATUSES = ['open', 'submitted', 'approved']
/** Claims with a final outcome carrying a resolution date. */
export const RESOLVED_STATUSES = ['settled', 'rejected']
/** Claims a vendor has ruled on (basis for the approval rate). */
export const DECIDED_STATUSES = ['approved', 'settled', 'rejected']
/** Decided in our favour. */
export const APPROVED_OUTCOME_STATUSES = ['approved', 'settled']

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

const asList = (rows) => (Array.isArray(rows) ? rows : [])

const cleanStr = (v) => (v == null ? '' : String(v).trim())

const pct = (part, whole) => (whole > 0 ? Math.round((num(part) / num(whole)) * 1000) / 10 : 0)

/** Whole days between two dates (b - a), floored at 0. null when either is invalid. */
export function daysBetween(a, b) {
  if (!a || !b) return null
  const da = a instanceof Date ? a : new Date(a)
  const db = b instanceof Date ? b : new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null
  const diff = Math.floor((db.getTime() - da.getTime()) / 86400000)
  return diff < 0 ? 0 : diff
}

export const isOpen = (status) => OPEN_STATUSES.includes(status)
export const isResolved = (status) => RESOLVED_STATUSES.includes(status)
export const isDecided = (status) => DECIDED_STATUSES.includes(status)
export const isApprovedOutcome = (status) => APPROVED_OUTCOME_STATUSES.includes(status)

/**
 * The date a claim reached a final outcome. We use updated_at as the resolution
 * timestamp for settled/rejected claims (the row was last written when its
 * status moved). Returns null when the claim is not resolved or has no usable
 * timestamps.
 */
export function resolutionDays(row) {
  if (!row || !isResolved(row.status)) return null
  return daysBetween(row.claim_date, row.updated_at || row.created_at)
}

/**
 * Headline KPIs for a set of retread claims. All money is summed over the rows
 * exactly as stored (honest zeros, never fabricated). avgResolutionDays and
 * approvalRate are null when there is nothing to measure so the UI can show N/A.
 */
export function computeRetreadKpis(rows = []) {
  const list = asList(rows)

  let totalClaimed = 0
  let totalRecovered = 0
  let openCount = 0
  let openExposure = 0
  let decidedCount = 0
  let approvedCount = 0
  let rejectedCount = 0
  let settledCount = 0
  let resolvedSum = 0
  let resolvedN = 0

  for (const r of list) {
    const status = r?.status
    const cost = num(r?.cost)
    totalClaimed += cost
    totalRecovered += num(r?.amount_recovered)

    if (isOpen(status)) { openCount += 1; openExposure += cost }
    if (isDecided(status)) decidedCount += 1
    if (isApprovedOutcome(status)) approvedCount += 1
    if (status === 'rejected') rejectedCount += 1
    if (status === 'settled') settledCount += 1

    const days = resolutionDays(r)
    if (days != null) { resolvedSum += days; resolvedN += 1 }
  }

  return {
    total: list.length,
    openCount,
    openExposure,
    decidedCount,
    approvedCount,
    rejectedCount,
    settledCount,
    resolvedCount: resolvedN,
    totalClaimed,
    totalRecovered,
    outstanding: Math.max(0, Math.round((totalClaimed - totalRecovered) * 100) / 100),
    recoveryRate: pct(totalRecovered, totalClaimed),
    approvalRate: decidedCount > 0 ? pct(approvedCount, decidedCount) : null,
    avgResolutionDays: resolvedN > 0 ? Math.round((resolvedSum / resolvedN) * 10) / 10 : null,
  }
}

/**
 * Status distribution in canonical vocab order: one entry per status with count
 * and share of total. Statuses outside the vocab are ignored (they cannot occur
 * given the CHECK constraint) so the funnel stays clean.
 */
export function statusDistribution(rows = []) {
  const list = asList(rows)
  const counts = RETREAD_CLAIM_STATUSES.reduce((a, s) => { a[s] = 0; return a }, {})
  for (const r of list) {
    if (counts[r?.status] != null) counts[r.status] += 1
  }
  const total = list.length
  return RETREAD_CLAIM_STATUSES.map((s) => ({
    status: s,
    label: RETREAD_CLAIM_STATUS_META[s]?.label || s,
    tone: RETREAD_CLAIM_STATUS_META[s]?.tone || 'slate',
    count: counts[s],
    pct: pct(counts[s], total),
  }))
}

/**
 * Rank claims grouped by an arbitrary string field (default `vendor`). Only rows
 * with a non-empty value for that field are grouped, so a missing field (e.g.
 * brand, which is not stored) yields an empty list rather than a fabricated one.
 * Sorted by claim count desc, then cost desc. Each group carries claim rate
 * inputs (claims/cost/recovered), recovery %, approval rate and status splits.
 * @param {Array} rows
 * @param {string} field
 * @param {{limit?:number}} [opts]
 */
export function rankByField(rows = [], field = 'vendor', { limit } = {}) {
  const list = asList(rows)
  const map = new Map()

  for (const r of list) {
    const key = cleanStr(r?.[field])
    if (!key) continue
    let g = map.get(key)
    if (!g) {
      g = {
        key,
        claims: 0,
        cost: 0,
        recovered: 0,
        open: 0,
        approved: 0,
        rejected: 0,
        settled: 0,
        decided: 0,
      }
      map.set(key, g)
    }
    g.claims += 1
    g.cost += num(r?.cost)
    g.recovered += num(r?.amount_recovered)
    if (isOpen(r?.status)) g.open += 1
    if (isApprovedOutcome(r?.status)) g.approved += 1
    if (r?.status === 'rejected') g.rejected += 1
    if (r?.status === 'settled') g.settled += 1
    if (isDecided(r?.status)) g.decided += 1
  }

  const out = [...map.values()].map((g) => ({
    ...g,
    cost: Math.round(g.cost * 100) / 100,
    recovered: Math.round(g.recovered * 100) / 100,
    recoveryPct: pct(g.recovered, g.cost),
    approvalRate: g.decided > 0 ? pct(g.approved, g.decided) : null,
  }))

  out.sort((a, b) => (b.claims - a.claims) || (b.cost - a.cost) || a.key.localeCompare(b.key))
  return typeof limit === 'number' && limit > 0 ? out.slice(0, limit) : out
}

/** Convenience wrapper: vendor performance ranking. */
export function rankVendors(rows = [], opts = {}) {
  return rankByField(rows, 'vendor', opts)
}

/**
 * Monthly trend over the trailing `months` window (default 12), bucketed by
 * claim_date. Always returns exactly `months` contiguous buckets (zero-filled)
 * ending on the month containing `now`, so the chart never has gaps. Rows with
 * no/invalid claim_date are excluded from buckets (honest - not back-dated).
 * @param {Array} rows
 * @param {{months?:number, now?:Date}} [opts]
 */
export function monthlyTrend(rows = [], { months = 12, now = new Date() } = {}) {
  const n = Math.max(1, Math.floor(months))
  const base = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()

  const buckets = []
  const index = new Map()
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = {
      key,
      label: `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`,
      claims: 0,
      cost: 0,
      recovered: 0,
    }
    buckets.push(bucket)
    index.set(key, bucket)
  }

  for (const r of asList(rows)) {
    if (!r?.claim_date) continue
    const d = new Date(r.claim_date)
    if (Number.isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = index.get(key)
    if (!bucket) continue
    bucket.claims += 1
    bucket.cost += num(r.cost)
    bucket.recovered += num(r.amount_recovered)
  }

  for (const b of buckets) {
    b.cost = Math.round(b.cost * 100) / 100
    b.recovered = Math.round(b.recovered * 100) / 100
  }
  return buckets
}

/**
 * One-shot bundle for the page: KPIs, status distribution, vendor ranking and
 * the monthly trend, computed once from the same row set.
 */
export function analyzeRetreadClaims(rows = [], { months = 12, vendorLimit = 8, now } = {}) {
  return {
    kpis: computeRetreadKpis(rows),
    statuses: statusDistribution(rows),
    vendors: rankVendors(rows, { limit: vendorLimit }),
    trend: monthlyTrend(rows, { months, now }),
  }
}
