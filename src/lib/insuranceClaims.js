/**
 * Insurance claims — pure helpers (no I/O) for the Insurance Claims module.
 * A claim tracks an accident/incident against a fleet asset through its
 * lifecycle with an insurer, capturing what was claimed and what was ultimately
 * settled. Recovery rate = settled ÷ claimed.
 *
 * These functions are unit-tested; the page and service consume them so the
 * status/aggregation logic lives in exactly one place. `now` is always injected
 * so the module stays deterministic (it never reads Date.now itself).
 */

export const CLAIM_STATUSES = [
  'open', 'submitted', 'under_review', 'approved', 'rejected', 'settled', 'closed',
]

export const CLAIM_STATUS_META = {
  open:         { label: 'Open', tone: 'sky' },
  submitted:    { label: 'Submitted', tone: 'blue' },
  under_review: { label: 'Under review', tone: 'amber' },
  approved:     { label: 'Approved', tone: 'green' },
  rejected:     { label: 'Rejected', tone: 'red' },
  settled:      { label: 'Settled', tone: 'emerald' },
  closed:       { label: 'Closed', tone: 'slate' },
}

// A claim is still live (not yet resolved) in these states.
export const OPEN_CLAIM_STATUSES = ['open', 'submitted', 'under_review', 'approved']

/** Parse a claim's effective start date (incident → claim date). */
export function claimAnchorDate(claim) {
  const raw = claim?.incident_date || claim?.claim_date || null
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Age of a claim in whole days as of `now` (ms or Date). Measured from the
 * incident date (falling back to claim date). Returns null when there is no
 * usable date, and never goes negative.
 */
export function claimAgeDays(claim, now) {
  const d = claimAnchorDate(claim)
  if (!d) return null
  const ref = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(ref.getTime())) return null
  const days = Math.floor((ref.getTime() - d.getTime()) / (24 * 3600 * 1000))
  return days < 0 ? 0 : days
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Summarize a list of claims: counts by status, total claimed, total settled,
 * and the recovery rate (%). Recovery rate is settled ÷ claimed over all rows.
 * @param {Array} rows
 */
export function summarizeClaims(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = CLAIM_STATUSES.reduce((acc, s) => { acc[s] = 0; return acc }, {})

  let totalClaimed = 0
  let totalSettled = 0
  let openCount = 0

  for (const r of list) {
    const status = r?.status
    if (byStatus[status] != null) byStatus[status] += 1
    if (OPEN_CLAIM_STATUSES.includes(status)) openCount += 1
    totalClaimed += num(r?.amount_claimed)
    totalSettled += num(r?.amount_settled)
  }

  const recoveryRate = totalClaimed > 0
    ? Math.round((totalSettled / totalClaimed) * 100)
    : 0

  return {
    total: list.length,
    byStatus,
    openCount,
    totalClaimed,
    totalSettled,
    recoveryRate,
  }
}
