/**
 * supplierDetailAnalytics - pure page-side logic for /suppliers/:supplierId
 * (Supplier Detail). Zero I/O; `now` is injectable.
 *
 * The page used to carry its OWN copy of the supplier maths (CPK, life,
 * failure rate, radar, contract status), a second definition that could drift
 * from the directory. It now REUSES src/lib/supplierManagementAnalytics.js
 * (which itself takes CPK from kpiEngine) and this module only adds the
 * single-supplier views: breakdowns, per-record rows, contract rows and the
 * honest failure-rate read.
 *
 * Honesty: the directory engine reports failure rate 0% when no record carries
 * a risk level. That is not a measurement, so `ratedCoverage` exposes how many
 * records are rated and `honestFailureRate` returns null when none are.
 */
import {
  buildSupplierMetrics, radarScores, monthlySpend, last12Months, dataAnchorDate,
  contractStatus, daysToExpiry, contractValue, CPK_BENCHMARK, FAILURE_THRESHOLD,
} from './supplierManagementAnalytics'
import { sortRows } from './consoleTable'

const RATINGS = ['Preferred', 'Approved', 'Under Review', 'Probation']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export { CPK_BENCHMARK, FAILURE_THRESHOLD, RATINGS }

export function ratingToNum(label) {
  const i = RATINGS.indexOf(label)
  return i >= 0 ? i + 1 : null
}
export function numToRating(num) {
  const i = Math.round(Number(num)) - 1
  return RATINGS[i] || null
}

/** Map supplier_ratings rows to `{ [brand]: { id, label, notes } }`. */
export function ratingsMap(rows = []) {
  const map = {}
  for (const row of rows || []) {
    if (!row?.brand) continue
    map[row.brand] = { id: row.id, label: numToRating(row.rating), notes: row.notes || '' }
  }
  return map
}

const finite = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** km run of a record, or null when fitment/removal do not form a valid stint. */
export function recordKmRun(r) {
  const fit = finite(r?.km_at_fitment)
  const rem = finite(r?.km_at_removal)
  if (fit == null || rem == null || fit <= 0 || rem <= fit) return null
  return rem - fit
}

/** Per-record cost per km, null when cost or km is not measurable. */
export function recordCpk(r) {
  const km = recordKmRun(r)
  const cost = finite(r?.cost_per_tyre)
  if (km == null || cost == null || cost <= 0) return null
  return cost / km
}

/** How many of a supplier's records carry a risk level. */
export function ratedCoverage(recs = []) {
  const list = (recs || []).filter(Boolean)
  const rated = list.filter((r) => String(r.risk_level || '').trim() !== '').length
  return { rated, total: list.length, pct: list.length > 0 ? Math.round((rated / list.length) * 100) : null }
}

/** Failure rate over RATED records only; null when nothing is rated. */
export function honestFailureRate(recs = []) {
  const rated = (recs || []).filter((r) => r && String(r.risk_level || '').trim() !== '')
  if (!rated.length) return null
  const failures = rated.filter((r) => r.risk_level === 'High' || r.risk_level === 'Critical').length
  return failures / rated.length
}

/** Count breakdown by a key with share of the supplier's records. */
export function breakdownBy(recs = [], key) {
  const total = (recs || []).length
  const map = new Map()
  for (const r of recs || []) {
    const k = r?.[key]
    if (!k) continue
    map.set(k, (map.get(k) || 0) + 1)
  }
  const rows = [...map.entries()].map(([name, count]) => ({
    name, count, sharePct: total > 0 ? Math.round((count / total) * 1000) / 10 : null,
  }))
  return sortRows(rows, { key: 'count', dir: 'desc' })
}

function monthLabel(key) {
  const [y, m] = String(key).split('-')
  return `${MONTHS[Number(m) - 1] || m} ${String(y).slice(2)}`
}

/**
 * Everything the detail page renders for one brand, in one deterministic pass.
 * Returns `supplier: null` when the brand has no records in scope.
 */
export function buildSupplierDetail(records = [], ratings = {}, brand = '', now = new Date()) {
  const all = buildSupplierMetrics(records, ratings, now)
  const supplier = all.find((m) => m.brand === brand) || null
  if (!supplier) return { supplier: null, all }
  const months = last12Months(dataAnchorDate(supplier.recs, now))
  const spend = monthlySpend(supplier.recs, months)
  const coverage = ratedCoverage(supplier.recs)
  const ranked = all.filter((m) => m.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk)
  const rankIdx = supplier.avgCpk != null ? ranked.findIndex((m) => m.brand === brand) : -1
  return {
    supplier,
    all,
    radar: radarScores(supplier, all),
    months,
    monthLabels: months.map(monthLabel),
    monthlySpend: spend,
    spendInWindow: spend.reduce((s, v) => s + v, 0),
    sizes: breakdownBy(supplier.recs, 'size'),
    sites: breakdownBy(supplier.recs, 'site'),
    ratedCoverage: coverage,
    failureRate: honestFailureRate(supplier.recs),
    costedRecords: supplier.validRecs.length,
    cpkRank: rankIdx >= 0 ? { rank: rankIdx + 1, of: ranked.length } : null,
    vsBenchmarkPct: supplier.avgCpk != null ? ((supplier.avgCpk - CPK_BENCHMARK) / CPK_BENCHMARK) * 100 : null,
  }
}

/** Per-record rows for the records table (derived columns for sorting). */
export function recordRows(recs = []) {
  return (recs || []).filter(Boolean).map((r) => ({
    ...r,
    serial: r.serial_number || r.serial_no || null,
    kmRun: recordKmRun(r),
    cpk: recordCpk(r),
  }))
}

export function filterRecordRows(rows = [], { search = '', risk = 'all', site = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (risk === 'unrated' && r.risk_level) return false
    if (risk !== 'all' && risk !== 'unrated' && r.risk_level !== risk) return false
    if (site && r.site !== site) return false
    if (q && ![r.serial, r.size, r.asset_no, r.site].filter(Boolean).join(' ').toLowerCase().includes(q)) return false
    return true
  })
}

/** Contracts for this supplier (case-insensitive name match) with status + value. */
export function supplierContractRows(contracts = [], brand = '', now = new Date()) {
  const b = String(brand || '').toLowerCase()
  return (contracts || [])
    .filter((c) => String(c?.supplier_name || '').toLowerCase() === b)
    .map((c) => ({
      ...c,
      status: contractStatus(c, now),
      daysToExpiry: daysToExpiry(c, now),
      value: contractValue(c),
    }))
}

export const RECORD_EXPORT_COLUMNS = [
  { key: 'serial', header: 'Serial' },
  { key: 'size', header: 'Size' },
  { key: 'asset_no', header: 'Asset' },
  { key: 'site', header: 'Site' },
  { key: 'kmRun', header: 'Km run' },
  { key: 'cpk', header: 'Cost/km' },
  { key: 'risk_level', header: 'Risk' },
  { key: 'issue_date', header: 'Issue date' },
]

export function recordExportRows(rows = []) {
  return (rows || []).map((r) => ({
    serial: r.serial || 'N/A',
    size: r.size || 'N/A',
    asset_no: r.asset_no || 'N/A',
    site: r.site || 'N/A',
    kmRun: r.kmRun ?? 'N/A',
    cpk: r.cpk == null ? 'N/A' : Number(r.cpk.toFixed(4)),
    risk_level: r.risk_level || 'Not rated',
    issue_date: r.issue_date ? String(r.issue_date).slice(0, 10) : 'N/A',
  }))
}
