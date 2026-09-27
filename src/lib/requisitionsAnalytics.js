/**
 * requisitionsAnalytics - pure engine behind the Requisitions register.
 *
 * `est_cost` on a requisition is the ESTIMATED UNIT COST (the form labels it
 * "Est. unit cost" and derives the total as qty x unit). The line value is
 * therefore qty x unit, and it is null - never 0 - when either side is
 * missing, because "not priced" and "costs nothing" are different claims.
 *
 * Status counts reuse summarizeRequisitions so there is one definition of
 * "pending" in the codebase. No I/O; `now` is injectable.
 */
import { summarizeRequisitions } from './requisitions'

export const DUE_SOON_DAYS = 14
const DAY = 86400000
const CLOSED = new Set(['ordered', 'rejected'])

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function dayStart(ms) {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function parseDay(v) {
  if (!v) return null
  const s = String(v).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return Number.isFinite(t) ? t : null
}

/** qty x unit cost, or null when either is missing / not a number. */
export function lineValue(r) {
  const q = num(r?.quantity)
  const u = num(r?.est_cost)
  if (q == null || u == null) return null
  return Math.round(q * u * 100) / 100
}

/**
 * Where a requisition sits against its needed-by date.
 *   closed   ordered or rejected (the date no longer matters)
 *   none     no needed-by date recorded
 *   overdue  needed-by is before today and it is still open
 *   due_soon needed-by within DUE_SOON_DAYS
 *   later    further out
 */
export function dueBand(r, now = Date.now()) {
  if (CLOSED.has(r?.status)) return 'closed'
  const t = parseDay(r?.needed_by)
  if (t == null) return 'none'
  const days = Math.round((t - dayStart(now)) / DAY)
  if (days < 0) return 'overdue'
  if (days <= DUE_SOON_DAYS) return 'due_soon'
  return 'later'
}

export const DUE_BANDS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_soon', label: `Due within ${DUE_SOON_DAYS} days` },
  { key: 'later', label: 'Due later' },
  { key: 'none', label: 'No needed-by date' },
  { key: 'closed', label: 'Ordered or rejected' },
]

export function summarizeRequisitionRegister(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  const base = summarizeRequisitions(list)
  let overdue = 0
  let dueSoon = 0
  let valued = 0
  let value = 0
  let openValue = 0
  let openValued = 0
  const requesters = new Set()
  const cats = new Map()
  for (const r of list) {
    const band = dueBand(r, now)
    if (band === 'overdue') overdue += 1
    if (band === 'due_soon') dueSoon += 1
    if (r?.requester) requesters.add(String(r.requester).trim().toLowerCase())
    const v = lineValue(r)
    const key = r?.category || 'unspecified'
    const c = cats.get(key) || { key, count: 0, value: 0, valued: 0 }
    c.count += 1
    if (v != null) {
      valued += 1
      value += v
      c.value += v
      c.valued += 1
      if (!CLOSED.has(r?.status)) { openValue += v; openValued += 1 }
    }
    cats.set(key, c)
  }
  const byCategory = [...cats.values()]
    .map(c => ({ ...c, value: c.valued ? Math.round(c.value * 100) / 100 : null }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || b.count - a.count)
  const decided = base.byStatus.approved + base.byStatus.ordered + base.byStatus.rejected
  return {
    ...base,
    overdue,
    dueSoon,
    requesters: requesters.size,
    valued,
    unvalued: list.length - valued,
    totalValue: valued ? Math.round(value * 100) / 100 : null,
    openValue: openValued ? Math.round(openValue * 100) / 100 : null,
    // Share of decided requests that were approved or ordered. N/A when none decided.
    approvalRate: decided ? Math.round(((base.byStatus.approved + base.byStatus.ordered) / decided) * 1000) / 10 : null,
    byCategory,
  }
}

export function filterRequisitions(rows, f = {}, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  return list.filter(r => {
    if (f.status && f.status !== 'all' && r.status !== f.status) return false
    if (f.category && f.category !== 'all' && r.category !== f.category) return false
    if (f.site && f.site !== 'all' && (r.site || '') !== f.site) return false
    if (f.due && f.due !== 'all' && dueBand(r, now) !== f.due) return false
    if (q) {
      const hay = `${r.item || ''} ${r.requisition_no || ''} ${r.requester || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
