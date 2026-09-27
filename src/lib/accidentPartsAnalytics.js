/**
 * accidentPartsAnalytics - pure summary for the "Parts & Repairs" tab of the
 * accident case (src/components/AccidentDetailModal.jsx, PartsTab).
 *
 * Every part belongs to one case, and a case is costed in the one currency of
 * its country, so the parts total is a single-currency sum by construction.
 * A figure with no costed part is null (rendered N/A), never a fabricated 0.
 * No I/O.
 */

export const PART_STATUSES = ['needed', 'ordered', 'received', 'fitted']
export const PART_LABELS = { needed: 'Needed', ordered: 'Ordered', received: 'Received', fitted: 'Fitted' }

// Number(null) is 0 and 0 is finite, so a blank cost must be caught first.
const money = (v) => {
  if (v == null || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Status token for a part; unknown values are kept but counted as 'other'. */
export const partStatus = (p) => {
  const s = String(p?.status || '').trim().toLowerCase()
  return PART_LABELS[s] ? s : 'other'
}

/** Summary of the case's parts. */
export function summarizeAccidentParts(parts = []) {
  const list = Array.isArray(parts) ? parts : []
  const byStatus = { needed: 0, ordered: 0, received: 0, fitted: 0, other: 0 }
  let total = 0
  let costed = 0
  let outstandingValue = 0
  let outstandingCosted = 0
  let outstanding = 0
  for (const p of list) {
    const st = partStatus(p)
    byStatus[st] += 1
    const cost = money(p?.total_cost)
    if (cost != null) { total += cost; costed += 1 }
    if (st === 'needed' || st === 'ordered') {
      outstanding += 1
      if (cost != null) { outstandingValue += cost; outstandingCosted += 1 }
    }
  }
  return {
    count: list.length,
    byStatus,
    total: costed ? Math.round(total * 100) / 100 : null,
    uncosted: list.length - costed,
    outstanding,
    outstandingValue: outstandingCosted ? Math.round(outstandingValue * 100) / 100 : null,
    fittedPct: list.length ? Math.round((byStatus.fitted / list.length) * 1000) / 10 : null,
  }
}

/** Search across name, number and supplier; optional status filter. */
export function filterAccidentParts(parts = [], { search = '', status = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(parts) ? parts : []).filter((p) => {
    if (status !== 'all' && partStatus(p) !== status) return false
    if (!q) return true
    return [p?.part_name, p?.part_number, p?.supplier].map((v) => String(v || '').toLowerCase()).join(' ').includes(q)
  })
}
