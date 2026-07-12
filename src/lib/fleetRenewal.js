/**
 * Fleet renewal — pure helpers (no I/O) for the Fleet Renewal Planning module.
 * A renewal plan records the intent to replace/renew a fleet asset: its current
 * age & mileage, a recommended action, a target replacement date, an estimated
 * cost, and where it sits in a lightweight lifecycle
 * (planned → approved → deferred → completed) at a given priority.
 *
 * These functions are unit-tested; the page and service consume them so the
 * status/aggregation logic lives in exactly one place.
 */

export const RENEWAL_STATUSES = ['planned', 'approved', 'deferred', 'completed']
export const RENEWAL_PRIORITIES = ['low', 'medium', 'high']

export const RENEWAL_STATUS_META = {
  planned:   { label: 'Planned', tone: 'sky' },
  approved:  { label: 'Approved', tone: 'green' },
  deferred:  { label: 'Deferred', tone: 'amber' },
  completed: { label: 'Completed', tone: 'emerald' },
}

export const RENEWAL_PRIORITY_META = {
  low:    { label: 'Low', tone: 'slate' },
  medium: { label: 'Medium', tone: 'sky' },
  high:   { label: 'High', tone: 'red' },
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Summarize a list of renewal plans:
 *  - byStatus:   count per lifecycle status
 *  - byPriority: count per priority
 *  - totalEstCost: summed estimated replacement cost across all rows
 *  - highPriority: number of high-priority plans
 *  - open:       plans not yet completed (planned + approved + deferred)
 * Tolerates non-array input and unknown status/priority values.
 * @param {Array} rows
 */
export function summarizeRenewal(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = RENEWAL_STATUSES.reduce((acc, s) => { acc[s] = 0; return acc }, {})
  const byPriority = RENEWAL_PRIORITIES.reduce((acc, p) => { acc[p] = 0; return acc }, {})
  let totalEstCost = 0

  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    if (byPriority[r?.priority] != null) byPriority[r.priority] += 1
    totalEstCost += num(r?.est_cost)
  }

  return {
    total: list.length,
    byStatus,
    byPriority,
    totalEstCost,
    highPriority: byPriority.high,
    planned: byStatus.planned,
    open: byStatus.planned + byStatus.approved + byStatus.deferred,
  }
}
