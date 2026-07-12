/**
 * Retread claims — pure helpers (no I/O) for the Retread Claims module.
 * A retread claim tracks a warranty/quality claim raised against a retread
 * vendor for a specific casing/tyre serial, through its lifecycle
 * (open → submitted → approved/rejected → settled), capturing the cost exposure
 * and the amount ultimately recovered. Recovery rate = recovered ÷ cost.
 *
 * These functions are unit-tested; the page and service consume them so the
 * status/aggregation logic lives in exactly one place.
 */

export const RETREAD_CLAIM_STATUSES = [
  'open', 'submitted', 'approved', 'rejected', 'settled',
]

export const RETREAD_CLAIM_STATUS_META = {
  open:      { label: 'Open', tone: 'sky' },
  submitted: { label: 'Submitted', tone: 'blue' },
  approved:  { label: 'Approved', tone: 'green' },
  rejected:  { label: 'Rejected', tone: 'red' },
  settled:   { label: 'Settled', tone: 'emerald' },
}

// A claim is still live (not yet resolved) in these states.
export const OPEN_RETREAD_CLAIM_STATUSES = ['open', 'submitted', 'approved']

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Summarize a list of retread claims: counts by status, number still open,
 * total cost exposure, total amount recovered, and the recovery rate (%).
 * Recovery rate is recovered ÷ cost over all rows (0 when cost is 0).
 * @param {Array} rows
 */
export function summarizeRetreadClaims(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = RETREAD_CLAIM_STATUSES.reduce((acc, s) => { acc[s] = 0; return acc }, {})

  let totalCost = 0
  let totalRecovered = 0
  let openCount = 0

  for (const r of list) {
    const status = r?.status
    if (byStatus[status] != null) byStatus[status] += 1
    if (OPEN_RETREAD_CLAIM_STATUSES.includes(status)) openCount += 1
    totalCost += num(r?.cost)
    totalRecovered += num(r?.amount_recovered)
  }

  const recoveryRate = totalCost > 0
    ? Math.round((totalRecovered / totalCost) * 100)
    : 0

  return {
    total: list.length,
    byStatus,
    openCount,
    totalCost,
    totalRecovered,
    recoveryRate,
  }
}
