/**
 * driverRosterAnalytics - pure engine for the Driver Workspace roster and a
 * single driver's fine list. Counts come straight from the rows the workspace
 * RPC already returned; nothing is re-derived from another source.
 *
 * Money is NEVER summed across currencies: fine totals are grouped per currency.
 */

const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Roster KPIs from the driver list. */
export function rosterKpis(drivers = []) {
  const list = Array.isArray(drivers) ? drivers : []
  return {
    drivers: list.length,
    openFines: list.reduce((s, d) => s + n(d.open_fines), 0),
    awaitingResponse: list.reduce((s, d) => s + n(d.awaiting_response), 0),
    pendingReview: list.reduce((s, d) => s + n(d.pending_supervisor) + n(d.pending_finance), 0),
    overdue: list.reduce((s, d) => s + n(d.overdue_fines), 0),
    loginNotLinked: list.filter(d => !d.user_id).length,
  }
}

export const ROSTER_FILTERS = Object.freeze({
  all: 'All drivers',
  needs_response: 'Awaiting driver response',
  pending_review: 'Pending review',
  overdue: 'Overdue fines',
  no_login: 'Login not linked',
  clear: 'No open fines',
})

/** Filter + search the roster. */
export function filterRoster(drivers = [], { filter = 'all', search = '', site = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (drivers || []).filter(d => {
    if (site && d.site !== site) return false
    if (filter === 'needs_response' && !n(d.awaiting_response)) return false
    if (filter === 'pending_review' && !(n(d.pending_supervisor) + n(d.pending_finance))) return false
    if (filter === 'overdue' && !n(d.overdue_fines)) return false
    if (filter === 'no_login' && d.user_id) return false
    if (filter === 'clear' && n(d.open_fines)) return false
    if (!q) return true
    return `${d.driver_name || ''} ${d.driver_id || ''} ${d.site || ''} ${d.position || ''}`.toLowerCase().includes(q)
  })
}

/** Sort the roster: 'name', 'open' (most open fines), 'overdue'. */
export function sortRoster(drivers = [], key = 'name') {
  const out = [...drivers]
  if (key === 'open') return out.sort((a, b) => n(b.open_fines) - n(a.open_fines) || String(a.driver_name).localeCompare(String(b.driver_name)))
  if (key === 'overdue') return out.sort((a, b) => n(b.overdue_fines) - n(a.overdue_fines) || n(b.open_fines) - n(a.open_fines))
  return out.sort((a, b) => String(a.driver_name || '').localeCompare(String(b.driver_name || '')))
}

/** Distinct sites on the roster, sorted. */
export function rosterSites(drivers = []) {
  return [...new Set((drivers || []).map(d => d.site).filter(Boolean))].sort()
}

export function rosterExportRows(drivers = []) {
  return (drivers || []).map(d => ({
    driver_name: d.driver_name || 'N/A',
    driver_id: d.driver_id || 'N/A',
    site: d.site || 'N/A',
    country: d.country || 'N/A',
    open_fines: n(d.open_fines),
    awaiting_response: n(d.awaiting_response),
    pending_supervisor: n(d.pending_supervisor),
    pending_finance: n(d.pending_finance),
    overdue_fines: n(d.overdue_fines),
    login: d.user_id ? 'Linked' : 'Not linked',
  }))
}

/** Fine summary for one driver, money grouped per currency. */
export function fineSummary(fines = [], now = Date.now()) {
  const list = Array.isArray(fines) ? fines : []
  const byCurrency = {}
  let open = 0; let overdue = 0; let awaiting = 0
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  for (const f of list) {
    const cur = f.currency || 'Unknown'
    const row = byCurrency[cur] || (byCurrency[cur] = { currency: cur, issued: 0, paid: 0, outstanding: 0, count: 0 })
    row.count += 1
    row.issued += n(f.amount)
    row.paid += n(f.paid_amount)
    if (f.status === 'open') {
      open += 1
      row.outstanding += Math.max(0, n(f.amount) - n(f.paid_amount))
      if (f.due_date && new Date(f.due_date) < today) overdue += 1
      if (['awaiting_response', 'returned'].includes(f.response_status)) awaiting += 1
    }
  }
  return { total: list.length, open, overdue, awaiting, byCurrency: Object.values(byCurrency) }
}

/** Filter one driver's fines by status and free text. */
export function filterFines(fines = [], { status = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (fines || []).filter(f => {
    if (status !== 'all' && f.status !== status) return false
    if (!q) return true
    return `${f.notice_reference || ''} ${f.authority || ''} ${f.asset_no || ''} ${f.description || ''}`.toLowerCase().includes(q)
  })
}
