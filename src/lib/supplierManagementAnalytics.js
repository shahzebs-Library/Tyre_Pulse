/**
 * supplierManagementAnalytics - pure engine behind /suppliers (SupplierManagement).
 *
 * Everything here is injectable and I/O free: callers pass the rows they
 * already loaded and, where time matters, an explicit `now`. The page used to
 * compute all of this inline; it now renders what this module returns.
 *
 * CPK maths is NOT re-implemented. `kpiEngine.computeCpkFleet` is the single
 * CPK source; per-supplier CPK is that function over the supplier's rows, so a
 * supplier's figure here always matches Engineering KPI for the same rows.
 *
 * HONEST NULLS: a value that cannot be measured is null (rendered N/A), never
 * a flattering 0. In particular the old in-page savings estimate assumed
 * 80,000 km for any tyre with no recorded distance; that fabrication is gone,
 * only measured km contribute.
 */
import { computeCpkFleet } from './kpiEngine'
import { recordCost } from './analyticsEngine'

export const CPK_BENCHMARK = 1.2
export const FAILURE_THRESHOLD = 0.15
export const EXPIRY_WINDOW_DAYS = 30
export const RATINGS = ['Preferred', 'Approved', 'Under Review', 'Probation']
export const CONTRACT_STATUSES = ['Active', 'Expiring Soon', 'Expired']

const DAY_MS = 86_400_000

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Parse a date-only string as LOCAL midnight (a bare `new Date('YYYY-MM-DD')` is UTC). */
export function parseDay(value) {
  if (!value) return null
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function toMonthKey(value) {
  if (!value) return null
  const m = String(value).match(/^(\d{4})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function yearOf(value) {
  const key = toMonthKey(value)
  return key ? Number(key.slice(0, 4)) : null
}

/**
 * Anchor time windows to the data's latest issue_date so historic imports
 * still populate "last 12 months" and year-on-year views. Falls back to `now`.
 */
export function dataAnchorDate(records = [], now = new Date()) {
  let max = null
  for (const r of records || []) {
    if (r?.issue_date && (!max || String(r.issue_date) > max)) max = String(r.issue_date)
  }
  return max ? (parseDay(max.slice(0, 10)) || new Date(now)) : new Date(now)
}

export function last12Months(anchor = new Date()) {
  const out = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

// ── Contracts ────────────────────────────────────────────────────────────────

/** Whole days from `now` to the contract end, or null when no end date is recorded. */
export function daysToExpiry(contract, now = new Date()) {
  const end = parseDay(contract?.contract_end)
  if (!end) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((end - today) / DAY_MS)
}

/** An open-ended contract (no end date) is Active: nothing says it lapsed. */
export function contractStatus(contract, now = new Date()) {
  const days = daysToExpiry(contract, now)
  if (days == null) return 'Active'
  if (days < 0) return 'Expired'
  if (days <= EXPIRY_WINDOW_DAYS) return 'Expiring Soon'
  return 'Active'
}

/** Committed value = price x minimum order, only when BOTH are recorded. */
export function contractValue(contract) {
  const price = num(contract?.price_per_unit)
  const qty = num(contract?.min_order)
  if (price == null || qty == null) return null
  return price * qty
}

export function filterContracts(contracts = [], { search = '', status = 'All' } = {}, now = new Date()) {
  const q = String(search || '').trim().toLowerCase()
  return (contracts || []).filter((c) => {
    if (q && !String(c?.supplier_name || '').toLowerCase().includes(q)) return false
    if (status && status !== 'All' && contractStatus(c, now) !== status) return false
    return true
  })
}

export function summarizeContracts(contracts = [], now = new Date()) {
  const list = contracts || []
  const counts = { Active: 0, 'Expiring Soon': 0, Expired: 0 }
  let noEndDate = 0
  let valued = 0
  let committed = 0
  const expiring = []
  for (const c of list) {
    const status = contractStatus(c, now)
    counts[status] += 1
    if (!c?.contract_end) noEndDate += 1
    if (status === 'Expiring Soon') expiring.push(c)
    const v = contractValue(c)
    if (v != null && status !== 'Expired') { committed += v; valued += 1 }
  }
  return {
    total: list.length,
    active: counts.Active,
    expiringSoon: counts['Expiring Soon'],
    expired: counts.Expired,
    noEndDate,
    // null (N/A) when no live contract records both a price and a quantity.
    committedValue: valued > 0 ? committed : null,
    valuedCount: valued,
    expiring: expiring.sort((a, b) => String(a.contract_end).localeCompare(String(b.contract_end))),
  }
}

// ── Supplier metrics ─────────────────────────────────────────────────────────

function kmRun(r) {
  const fit = num(r?.km_at_fitment)
  const rem = num(r?.km_at_removal)
  if (fit == null || rem == null || fit <= 0 || rem <= fit) return null
  return rem - fit
}

function isCostValid(r) {
  const cost = num(r?.cost_per_tyre)
  return kmRun(r) != null && cost != null && cost > 0
}

export function supplierMetrics(records = [], brand, anchorYear = new Date().getFullYear()) {
  const recs = (records || []).filter((r) => r?.brand === brand)
  const validRecs = recs.filter(isCostValid)
  const avgCpk = computeCpkFleet(recs).fleetAvgCpk
  const kms = validRecs.map(kmRun)
  const avgLife = kms.length ? kms.reduce((s, v) => s + v, 0) / kms.length : null
  const failures = recs.filter((r) => r.risk_level === 'High' || r.risk_level === 'Critical')
  const failureRate = recs.length > 0 ? failures.length / recs.length : null
  const totalSpend = recs.reduce((s, r) => s + recordCost(r), 0)
  const spendThisYear = recs
    .filter((r) => yearOf(r.issue_date) === anchorYear)
    .reduce((s, r) => s + recordCost(r), 0)
  const uniq = (key) => [...new Set(recs.map((r) => r[key]).filter(Boolean))]
  return {
    brand,
    recs,
    validRecs,
    avgCpk,
    avgLife,
    failureRate,
    totalSpend,
    spendThisYear,
    sites: uniq('site'),
    sizes: uniq('size'),
    countries: uniq('country'),
    count: recs.length,
  }
}

export function autoRate(m) {
  const fr = m?.failureRate ?? 0
  if (m?.avgCpk != null && m.avgCpk <= CPK_BENCHMARK * 0.9 && fr < 0.1) return 'Preferred'
  if (fr > FAILURE_THRESHOLD * 1.5) return 'Probation'
  if (fr > FAILURE_THRESHOLD || (m?.avgCpk != null && m.avgCpk > CPK_BENCHMARK * 1.3)) return 'Under Review'
  return 'Approved'
}

export function filterRecords(records = [], { country = 'All', site = 'All' } = {}) {
  return (records || []).filter((r) => {
    if (country !== 'All' && r?.country !== country) return false
    if (site !== 'All' && r?.site !== site) return false
    return true
  })
}

/**
 * One metric row per brand. `ratings` is `{ [brand]: { label, notes } }`; a
 * stored rating wins over the automatic one.
 */
export function buildSupplierMetrics(records = [], ratings = {}, now = new Date()) {
  const brands = [...new Set((records || []).map((r) => r?.brand).filter(Boolean))]
  const anchorYear = dataAnchorDate(records, now).getFullYear()
  return brands.map((brand) => {
    const m = supplierMetrics(records, brand, anchorYear)
    const entry = ratings?.[brand]
    return { ...m, rating: entry?.label || autoRate(m), ratingSource: entry?.label ? 'manual' : 'auto', notes: entry?.notes || '' }
  })
}

export function filterSuppliers(metrics = [], { search = '', rating = 'All' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (metrics || []).filter((s) => {
    if (q && !String(s.brand).toLowerCase().includes(q)) return false
    if (rating !== 'All' && s.rating !== rating) return false
    return true
  })
}

export function supplierKpis(metrics = []) {
  const list = metrics || []
  const withCpk = list.filter((m) => m.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk)
  const cpks = withCpk.map((m) => m.avgCpk)
  const spend = list.reduce((s, m) => s + (m.totalSpend || 0), 0)
  return {
    total: list.length,
    preferredCount: list.filter((m) => m.rating === 'Preferred').length,
    atRiskCount: list.filter((m) => m.failureRate != null && m.failureRate > FAILURE_THRESHOLD).length,
    cpkMin: cpks.length ? cpks[0] : null,
    cpkMax: cpks.length ? cpks[cpks.length - 1] : null,
    best: withCpk[0] || null,
    worst: withCpk.length ? withCpk[withCpk.length - 1] : null,
    totalSpend: list.length ? spend : null,
    cpkCoverage: list.length ? withCpk.length / list.length : null,
  }
}

export function sortByCpk(metrics = []) {
  return [...(metrics || [])].sort((a, b) => (a.avgCpk ?? Infinity) - (b.avgCpk ?? Infinity))
}

/** Percentage above (+) or below (-) the CPK benchmark, null when CPK is unmeasured. */
export function vsBenchmark(avgCpk, benchmark = CPK_BENCHMARK) {
  if (avgCpk == null || !(benchmark > 0)) return null
  return ((avgCpk - benchmark) / benchmark) * 100
}

export function radarScores(metrics, allMetrics = []) {
  const allCpks = allMetrics.map((m) => m.avgCpk).filter((v) => v != null)
  const allLives = allMetrics.map((m) => m.avgLife).filter((v) => v != null && v > 0)
  const maxCpk = allCpks.length ? Math.max(...allCpks) : 1
  const maxLife = allLives.length ? Math.max(...allLives) : 1
  const fleetAvgCpk = allCpks.length ? allCpks.reduce((s, v) => s + v, 0) / allCpks.length : CPK_BENCHMARK
  const totalCount = allMetrics.reduce((s, m) => s + m.count, 0)
  const cap = (v) => Math.min(100, Math.max(0, v))
  return {
    cpkScore: cap(metrics.avgCpk != null ? 100 - (metrics.avgCpk / maxCpk) * 100 : 0),
    lifeScore: cap(metrics.avgLife != null && maxLife > 0 ? (metrics.avgLife / maxLife) * 100 : 0),
    reliabilityScore: cap(100 - (metrics.failureRate ?? 0) * 100 * 4),
    valueScore: cap(metrics.avgCpk != null && fleetAvgCpk > 0 ? (fleetAvgCpk / metrics.avgCpk) * 50 + 50 : 50),
    coverageScore: cap(totalCount > 0 ? (metrics.count / totalCount) * 100 * 3 : 0),
  }
}

/** Year-on-year spend per supplier, latest data year against the one before. */
export function yoySpend(metrics = [], anchorYear) {
  const lastYear = anchorYear - 1
  return (metrics || [])
    .map((m) => {
      const thisYear = m.recs.filter((r) => yearOf(r.issue_date) === anchorYear).reduce((s, r) => s + recordCost(r), 0)
      const prev = m.recs.filter((r) => yearOf(r.issue_date) === lastYear).reduce((s, r) => s + recordCost(r), 0)
      return { brand: m.brand, thisYear, lastYear: prev, change: prev > 0 ? ((thisYear - prev) / prev) * 100 : null }
    })
    .filter((y) => y.thisYear > 0 || y.lastYear > 0)
    .sort((a, b) => b.thisYear - a.thisYear)
}

/** Monthly spend per brand over the given month keys. */
export function monthlySpend(recs = [], months = []) {
  return months.map((mo) => recs.filter((r) => toMonthKey(r.issue_date) === mo).reduce((s, r) => s + recordCost(r), 0))
}

/**
 * Structured procurement recommendations. Messages are composed by the page
 * (translated); this returns only the facts behind each one.
 */
export function recommendationFacts(metrics = []) {
  const out = []
  const list = metrics || []
  if (list.length === 0) return out
  const cpks = list.map((m) => m.avgCpk).filter((v) => v != null)
  const fleetAvgCpk = cpks.length ? cpks.reduce((s, v) => s + v, 0) / cpks.length : null
  const sorted = list.filter((m) => m.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]

  if (best && fleetAvgCpk > 0) {
    const pct = ((fleetAvgCpk - best.avgCpk) / fleetAvgCpk) * 100
    if (pct > 5) out.push({ type: 'increase', brand: best.brand, impact: 'High', cpk: best.avgCpk, pct })
  }
  list.filter((m) => m.failureRate != null && m.failureRate > FAILURE_THRESHOLD).forEach((m) => {
    out.push({ type: 'review', brand: m.brand, impact: 'Critical', rate: m.failureRate })
  })
  if (worst && best && worst.brand !== best.brand) {
    // Only MEASURED distance counts; a tyre with no recorded km contributes nothing.
    const km = worst.recs.reduce((s, r) => s + (kmRun(r) || 0), 0)
    const saving = (worst.avgCpk - best.avgCpk) * km
    if (km > 0 && saving > 1000) {
      out.push({ type: 'saving', brand: worst.brand, impact: 'High', bestBrand: best.brand, amount: saving })
    }
  }
  const sizeMap = {}
  list.forEach((m) => {
    m.sizes.forEach((sz) => {
      const cpk = computeCpkFleet(m.recs.filter((r) => r.size === sz)).fleetAvgCpk
      if (!sizeMap[sz] || (cpk != null && cpk < (sizeMap[sz].cpk ?? Infinity))) sizeMap[sz] = { brand: m.brand, cpk }
    })
  })
  Object.entries(sizeMap).slice(0, 2).forEach(([size, info]) => {
    if (info.cpk != null) out.push({ type: 'consolidate', brand: info.brand, impact: 'Medium', size, cpk: info.cpk })
  })
  return out.slice(0, 8)
}

// ── Export shaping ───────────────────────────────────────────────────────────

const naNum = (v, digits) => (v == null || !Number.isFinite(v) ? 'N/A' : digits == null ? v : Number(v.toFixed(digits)))

export const SUPPLIER_EXPORT_COLUMNS = [
  { key: 'brand', header: 'Supplier' },
  { key: 'rating', header: 'Rating' },
  { key: 'count', header: 'Tyres' },
  { key: 'avg_cpk', header: 'Avg CPK' },
  { key: 'vs_benchmark', header: 'vs Benchmark %' },
  { key: 'avg_life_km', header: 'Avg Life (km)' },
  { key: 'failure_rate', header: 'Failure Rate %' },
  { key: 'spend_ytd', header: 'Spend (latest year)' },
  { key: 'total_spend', header: 'Total Spend' },
  { key: 'sites', header: 'Sites' },
  { key: 'countries', header: 'Countries' },
]

export function supplierExportRows(metrics = []) {
  return (metrics || []).map((m) => ({
    brand: m.brand,
    rating: m.rating,
    count: m.count,
    avg_cpk: naNum(m.avgCpk, 4),
    vs_benchmark: naNum(vsBenchmark(m.avgCpk), 1),
    avg_life_km: m.avgLife == null ? 'N/A' : Math.round(m.avgLife),
    failure_rate: m.failureRate == null ? 'N/A' : Number((m.failureRate * 100).toFixed(1)),
    spend_ytd: Math.round(m.spendThisYear),
    total_spend: Math.round(m.totalSpend),
    sites: m.sites.join(', '),
    countries: m.countries.join(', '),
  }))
}

export const CONTRACT_EXPORT_COLUMNS = [
  { key: 'supplier_name', header: 'Supplier' },
  { key: 'contract_start', header: 'Start' },
  { key: 'contract_end', header: 'End' },
  { key: 'days_to_expiry', header: 'Days to Expiry' },
  { key: 'status', header: 'Status' },
  { key: 'payment_terms', header: 'Payment Terms' },
  { key: 'price_per_unit', header: 'Price / Unit' },
  { key: 'min_order', header: 'Min Order' },
  { key: 'committed_value', header: 'Committed Value' },
]

export function contractExportRows(contracts = [], now = new Date()) {
  return (contracts || []).map((c) => {
    const days = daysToExpiry(c, now)
    const value = contractValue(c)
    return {
      supplier_name: c.supplier_name || 'N/A',
      contract_start: c.contract_start || 'N/A',
      contract_end: c.contract_end || 'N/A',
      days_to_expiry: days == null ? 'N/A' : days,
      status: contractStatus(c, now),
      payment_terms: c.payment_terms || 'N/A',
      price_per_unit: num(c.price_per_unit) ?? 'N/A',
      min_order: num(c.min_order) ?? 'N/A',
      committed_value: value == null ? 'N/A' : value,
    }
  })
}
