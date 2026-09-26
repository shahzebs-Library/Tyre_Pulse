/**
 * claimsSummaryAnalytics - pure presentation engine for the Claims Summary
 * dashboard (/claims-summary). Every claims figure (totals, recovery, liability,
 * ageing, delay detail) comes from THE claims engine `src/lib/claimsAnalytics.js`;
 * this module only filters the accident rows before analysis and shapes the
 * results for tables, sorting and exports. No I/O; the clock is injected.
 */
import { hasClaim, isClosed, isDelayed, claimNet, overdueDays } from './claimsAnalytics'
import { sortRows } from './consoleTableSort'

export { sortRows }

const N = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** ISO day for an injected clock (Date | string | undefined = now). */
export function todayIso(now) {
  const d = now ? new Date(now) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10)
}

/** Lifecycle state of a claim: Closed, Delayed (open past expected release) or Open. */
export function claimState(r, today) {
  if (isClosed(r)) return 'Closed'
  if (isDelayed(r, today)) return 'Delayed'
  return 'Open'
}

/** Liability label, or null when the ratio was never recorded. */
export function liabilityText(v) {
  const n = N(v)
  return n == null ? null : `${n}%`
}

/**
 * Filter accident rows before analysis: incident date window, insurer, site,
 * lifecycle state and a free-text search over asset, driver, insurer, policy
 * and site. A row with no incident date is kept by the date window (it cannot
 * be placed outside it).
 */
export function filterClaimRows(rows = [], { from = '', to = '', insurer = '', site = '', state = 'all', search = '' } = {}, today = todayIso()) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (!r || typeof r !== 'object') return false
    const d = String(r.incident_date || '').slice(0, 10)
    if (from && d && d < from) return false
    if (to && d && d > to) return false
    if (insurer && (r.insurer || '') !== insurer) return false
    if (site && (r.site || '') !== site) return false
    if (state === 'open' && isClosed(r)) return false
    if (state === 'closed' && !isClosed(r)) return false
    if (state === 'delayed' && !isDelayed(r, today)) return false
    if (q) {
      const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.insurer || ''} ${r.policy_no || ''} ${r.site || ''} ${r.claim_status || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Distinct, sorted filter options drawn from the rows that carry a claim. */
export function claimFilterOptions(rows = []) {
  const claims = (rows || []).filter((r) => r && hasClaim(r))
  const uniq = (f) => [...new Set(claims.map((r) => r[f]).filter((v) => typeof v === 'string' && v.trim()))].sort()
  return { insurers: uniq('insurer'), sites: uniq('site') }
}

/** Detail-table rows: the claim plus its state, net exposure and overdue days. */
export function claimTableRows(claims = [], today = todayIso()) {
  return (claims || []).map((r) => ({
    ...r,
    _state: claimState(r, today),
    _net: claimNet(r),
    _overdue: overdueDays(r, today) || null,
    _claimed: N(r.claim_amount),
    _approved: N(r.claim_approved_amount),
    _recovered: N(r.recovered_amount),
    _liability: N(r.gcc_liability_ratio),
  }))
}

const STATE_ORDER = { Delayed: 0, Open: 1, Closed: 2 }

export const CLAIM_SORT_ACCESSORS = {
  date: (r) => (r.incident_date ? String(r.incident_date).slice(0, 10) : null),
  asset: (r) => r.asset_no || null,
  site: (r) => r.site || null,
  insurer: (r) => r.insurer || null,
  liability: (r) => r._liability,
  fault: (r) => r.fault_status || null,
  state: (r) => STATE_ORDER[r._state],
  claimed: (r) => r._claimed,
  approved: (r) => r._approved,
  recovered: (r) => r._recovered,
  net: (r) => r._net,
  expected: (r) => (r.expected_release_date ? String(r.expected_release_date).slice(0, 10) : null),
  overdue: (r) => r._overdue,
}

/** Delayed-by-insurer rows with each insurer's share of all value at risk. */
export function delayedInsurerRows(detail) {
  const list = detail?.byInsurer || []
  const total = N(detail?.valueAtRisk)
  return list.map((x) => ({ ...x, share: total && total > 0 ? (N(x.value) / total) * 100 : null }))
}

function fmtDay(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 10)
}

export const CLAIM_EXPORT_KEYS = ['incident_date', 'asset_no', 'site', 'driver_name', 'state', 'claim_status', 'insurer', 'policy_no', 'gcc_liability_ratio', 'fault_status', 'claim_amount', 'claim_approved_amount', 'deductible', 'recovered_amount', 'net_cost', 'overdue_days', 'expected_release_date', 'release_date']
export const CLAIM_EXPORT_HEADERS = ['Date', 'Asset', 'Site', 'Driver', 'State', 'Claim Status', 'Insurer', 'Policy/Claim No', 'GCC Liab %', 'Fault', 'Claimed', 'Approved', 'Deductible', 'Recovered', 'Net', 'Days overdue', 'Expected Release', 'Released']

/**
 * Export rows for every filtered claim. Net uses claimNet (THE single definition
 * of net exposure), so the file always agrees with the dashboard.
 */
export function claimExportRows(tableRows = []) {
  return (tableRows || []).map((r) => ({
    incident_date: fmtDay(r.incident_date),
    asset_no: r.asset_no || '',
    site: r.site || '',
    driver_name: r.driver_name || '',
    state: r._state,
    claim_status: r.claim_status || '',
    insurer: r.insurer || '',
    policy_no: r.policy_no || '',
    gcc_liability_ratio: liabilityText(r.gcc_liability_ratio) || '',
    fault_status: r.fault_status || '',
    claim_amount: r.claim_amount ?? '',
    claim_approved_amount: r.claim_approved_amount ?? '',
    deductible: r.deductible ?? '',
    recovered_amount: r.recovered_amount ?? '',
    net_cost: r._net,
    overdue_days: r._overdue ?? '',
    expected_release_date: fmtDay(r.expected_release_date),
    release_date: fmtDay(r.release_date),
  }))
}

/** Short month label ("Jan 26") for a YYYY-MM key. */
export function monthLabel(ym) {
  const [y, m] = String(ym).split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[(Number(m) || 1) - 1]} ${String(y).slice(2)}`
}
