/**
 * Insurance Claims analytics - pure, injectable helpers (no I/O) for the manual
 * insurance-claims ledger (`insurance_claims` table) surfaced by
 * src/pages/InsuranceClaims.jsx.
 *
 * DISTINCT from src/lib/claimsAnalytics.js (which analyzes accident-embedded
 * claims on the `accidents` table). This engine operates ONLY on the real
 * columns of the insurance_claims table:
 *   claim_no, asset_no, insurer, policy_no, incident_date, claim_date,
 *   amount_claimed, amount_settled, status, description, created_at, updated_at
 * Status vocabulary: open, submitted, under_review, approved, rejected,
 * settled, closed.
 *
 * Everything is derived from real fields with honest fallbacks (null / 0 /
 * empty) so the page can render honest empty states. `now` is always injected
 * so the module stays deterministic (it never reads Date.now itself). Shared
 * primitives (status meta, per-claim age, anchor date) are reused from
 * ./insuranceClaims so the status/age logic lives in exactly one place.
 */
import {
  CLAIM_STATUSES,
  CLAIM_STATUS_META,
  claimAnchorDate,
  claimAgeDays,
} from './insuranceClaims'

/** Ordered lifecycle used for the status funnel (rejected is a side branch). */
export const STATUS_FUNNEL_ORDER = [
  'open', 'submitted', 'under_review', 'approved', 'settled', 'closed',
]

/** Statuses that count as a live / unresolved claim. */
export const OPEN_STATUSES = ['open', 'submitted', 'under_review', 'approved']

/** Terminal statuses that count as resolved. */
export const RESOLVED_STATUSES = ['settled', 'closed', 'rejected']

/** Statuses where the claim was (at least partially) paid / recovered. */
export const SETTLED_STATUSES = ['settled', 'closed']

/** Statuses that represent a positive approval outcome. */
export const APPROVED_STATUSES = ['approved', 'settled', 'closed']

/** Open claims older than this many days are flagged as delayed / outstanding. */
export const DELAYED_THRESHOLD_DAYS = 30

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Finite number coercion, defaulting to 0. */
export function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

const toMs = (now) => {
  const ref = now instanceof Date ? now : new Date(now == null ? Date.now() : now)
  return Number.isNaN(ref.getTime()) ? Date.now() : ref.getTime()
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

export function isOpenClaim(claim) {
  return OPEN_STATUSES.includes(claim?.status)
}
export function isResolvedClaim(claim) {
  return RESOLVED_STATUSES.includes(claim?.status)
}
export function isSettledClaim(claim) {
  return SETTLED_STATUSES.includes(claim?.status)
}

/**
 * True when an OPEN claim has aged past `thresholdDays`. Resolved claims are
 * never delayed. Returns false when the claim has no usable anchor date.
 */
export function isDelayedClaim(claim, now, thresholdDays = DELAYED_THRESHOLD_DAYS) {
  if (!isOpenClaim(claim)) return false
  const age = claimAgeDays(claim, now)
  return age != null && age >= thresholdDays
}

/** Outstanding (unrecovered) value on a claim: max(claimed - settled, 0). */
export function outstandingValue(claim) {
  const out = num(claim?.amount_claimed) - num(claim?.amount_settled)
  return out > 0 ? out : 0
}

/** Month key (YYYY-MM) for a claim from claim_date -> incident_date -> created_at. */
export function claimMonthKey(claim) {
  const raw = claim?.claim_date || claim?.incident_date || claim?.created_at || null
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Human label for a YYYY-MM key, e.g. "Jul 26". */
export function monthLabel(ym) {
  const [y, m] = String(ym).split('-')
  const idx = (Number(m) || 1) - 1
  return `${MONTH_NAMES[idx] || '?'} ${String(y).slice(2)}`
}

/**
 * Days from a resolved claim's anchor date to its resolution timestamp
 * (updated_at). Used only for settled/closed claims that carry a settled
 * amount. Returns null when either date is missing/invalid or negative-safe 0.
 */
export function settleDays(claim) {
  const start = claimAnchorDate(claim)
  const rawEnd = claim?.updated_at || null
  if (!start || !rawEnd) return null
  const end = new Date(rawEnd)
  if (Number.isNaN(end.getTime())) return null
  const days = Math.floor((end.getTime() - start.getTime()) / (24 * 3600 * 1000))
  return days < 0 ? 0 : days
}

/** Counts by status across the full known vocabulary (missing = 0). */
export function countByStatus(rows = []) {
  const acc = CLAIM_STATUSES.reduce((o, s) => { o[s] = 0; return o }, {})
  for (const r of rows) {
    if (acc[r?.status] != null) acc[r.status] += 1
  }
  return acc
}

/** Ordered funnel rows for charting: [{ status, label, count }]. */
export function buildStatusFunnel(byStatus = {}) {
  return STATUS_FUNNEL_ORDER.map((s) => ({
    status: s,
    label: CLAIM_STATUS_META[s]?.label || s,
    count: num(byStatus[s]),
  }))
}

/**
 * Trailing `months` monthly buckets (oldest -> newest) ending at `now`'s month.
 * Each: { ym, label, count, claimed, settled }. Empty months included so the
 * trend line is continuous.
 */
export function monthlyTrend(rows = [], now, months = 12) {
  const ref = new Date(toMs(now))
  const buckets = []
  const index = new Map()
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1))
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const bucket = { ym, label: monthLabel(ym), count: 0, claimed: 0, settled: 0 }
    buckets.push(bucket)
    index.set(ym, bucket)
  }
  for (const r of rows) {
    const b = index.get(claimMonthKey(r))
    if (!b) continue
    b.count += 1
    b.claimed += num(r?.amount_claimed)
    b.settled += num(r?.amount_settled)
  }
  return buckets
}

/**
 * Per-insurer performance, sorted by total claimed value (desc). Claims with no
 * insurer are grouped under "Unassigned".
 * Each: { insurer, count, openCount, claimed, settled, outstanding,
 *         recoveryRate, avgClaim }.
 */
export function byInsurer(rows = [], now) {
  const map = new Map()
  for (const r of rows) {
    const key = (r?.insurer && String(r.insurer).trim()) || 'Unassigned'
    let g = map.get(key)
    if (!g) {
      g = { insurer: key, count: 0, openCount: 0, claimed: 0, settled: 0, outstanding: 0 }
      map.set(key, g)
    }
    g.count += 1
    if (isOpenClaim(r)) g.openCount += 1
    g.claimed += num(r?.amount_claimed)
    g.settled += num(r?.amount_settled)
    g.outstanding += outstandingValue(r)
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      recoveryRate: pct(g.settled, g.claimed),
      avgClaim: g.count > 0 ? g.claimed / g.count : 0,
    }))
    .sort((a, b) => b.claimed - a.claimed || b.count - a.count)
}

/**
 * Full analysis of a claims list. Pure. Pass `now` for determinism.
 * @param {Array} rows
 * @param {{ now?: number|Date, delayedThresholdDays?: number, trendMonths?: number }} [opts]
 */
export function analyzeInsuranceClaims(rows = [], opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const nowMs = toMs(opts.now)
  const delayedThresholdDays = opts.delayedThresholdDays ?? DELAYED_THRESHOLD_DAYS
  const trendMonths = opts.trendMonths ?? 12

  const byStatus = countByStatus(list)

  let totalClaimed = 0
  let totalSettled = 0
  let outstanding = 0
  let openCount = 0
  let resolvedCount = 0
  let rejectedCount = 0
  let settledCount = 0
  let approvedOutcome = 0

  let openAgeSum = 0
  let openAgeSamples = 0
  let oldestOpen = null

  let settleDaySum = 0
  let settleDaySamples = 0

  const delayed = []

  for (const r of list) {
    const status = r?.status
    totalClaimed += num(r?.amount_claimed)
    totalSettled += num(r?.amount_settled)
    outstanding += outstandingValue(r)

    if (OPEN_STATUSES.includes(status)) {
      openCount += 1
      const age = claimAgeDays(r, nowMs)
      if (age != null) {
        openAgeSum += age
        openAgeSamples += 1
        if (!oldestOpen || age > oldestOpen.ageDays) oldestOpen = { ...r, ageDays: age }
        if (age >= delayedThresholdDays) delayed.push({ ...r, ageDays: age })
      }
    }
    if (RESOLVED_STATUSES.includes(status)) resolvedCount += 1
    if (status === 'rejected') rejectedCount += 1
    if (SETTLED_STATUSES.includes(status)) {
      settledCount += 1
      const sd = settleDays(r)
      if (sd != null && num(r?.amount_settled) > 0) {
        settleDaySum += sd
        settleDaySamples += 1
      }
    }
    if (APPROVED_STATUSES.includes(status)) approvedOutcome += 1
  }

  // Decided = approval outcome vs rejection (excludes still-in-progress states).
  const decidedCount = approvedOutcome + rejectedCount

  delayed.sort((a, b) => b.ageDays - a.ageDays)

  const avgClaim = list.length > 0 ? totalClaimed / list.length : 0

  return {
    total: list.length,
    byStatus,
    funnel: buildStatusFunnel(byStatus),

    openCount,
    resolvedCount,
    rejectedCount,
    settledCount,

    totalClaimed,
    totalSettled,
    outstanding,
    avgClaim,

    recoveryRate: pct(totalSettled, totalClaimed),
    approvalRate: pct(approvedOutcome, decidedCount),
    decidedCount,

    avgOpenAgeDays: openAgeSamples > 0 ? Math.round(openAgeSum / openAgeSamples) : null,
    oldestOpen,

    avgSettleDays: settleDaySamples > 0 ? Math.round(settleDaySum / settleDaySamples) : null,
    settleSampleCount: settleDaySamples,

    delayed,
    delayedCount: delayed.length,
    delayedThresholdDays,
    outstandingOpen: delayed.reduce((s, r) => s + outstandingValue(r), 0),

    monthly: monthlyTrend(list, nowMs, trendMonths),
    insurers: byInsurer(list, nowMs),
  }
}
