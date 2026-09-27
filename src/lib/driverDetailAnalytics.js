/**
 * driverDetailAnalytics - pure engine for the single-driver page
 * (/driver-management/:driverId). Moves the page's inline aggregation into a
 * tested module and makes the unmeasurable figures honest:
 *
 *  - failure rate is computed over RISK-RATED tyres only (kpiEngine's rule)
 *    and is null when none are rated (risk_level is rarely populated);
 *  - recorded tyre cost only sums tyres that carry a price and is null when
 *    none do (cost_per_tyre is blank on most UAE/Egypt rows);
 *  - the fleet-relative risk score / rank keep DriverManagement's exact
 *    formula so the two pages agree, but `evidence` says what it rests on.
 *
 * No I/O. Deterministic.
 */
import { computeFailureRate } from './kpiEngine'
import { searchRows, sortRows, buildExport } from './consoleTable'

const RISK_CANON = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export function canonRisk(v) {
  return RISK_CANON[String(v ?? '').trim().toLowerCase()] || null
}

export function isHighRisk(r) {
  const c = canonRisk(r?.risk_level)
  return c === 'High' || c === 'Critical'
}

export function calcCpk(cost, kmFit, kmRem) {
  const c = num(cost); const f = num(kmFit); const m = num(kmRem)
  if (c == null || f == null || m == null) return null
  const dist = m - f
  if (dist <= 0) return null
  return c / dist
}

export function tyreLife(r) {
  const f = num(r?.km_at_fitment); const m = num(r?.km_at_removal)
  if (f == null || m == null) return null
  const d = m - f
  return d > 0 ? d : null
}

export function driverKey(r) {
  return (r?.driver_name ?? '').trim() || 'Unassigned'
}

/** Single-driver roll-up with honest nulls. */
export function aggregateDriver(name, records = []) {
  const cpks = []; const lives = []
  let pricedCost = 0; let priced = 0; let highRisk = 0
  for (const r of records) {
    const c = num(r.cost_per_tyre)
    if (c != null) { pricedCost += c * (num(r.qty) || 1); priced += 1 }
    if (isHighRisk(r)) highRisk += 1
    const cpk = calcCpk(r.cost_per_tyre, r.km_at_fitment, r.km_at_removal)
    if (cpk != null && cpk > 0) cpks.push(cpk)
    const life = tyreLife(r)
    if (life != null) lives.push(life)
  }
  const fr = computeFailureRate(records.map((r) => ({ ...r, risk_level: canonRisk(r.risk_level) })))
  return {
    name,
    totalTyres: records.length,
    totalCost: priced ? pricedCost : null,
    pricedTyres: priced,
    avgCpk: cpks.length ? cpks.reduce((s, v) => s + v, 0) / cpks.length : null,
    cpkTyres: cpks.length,
    avgTyreLife: lives.length ? lives.reduce((s, v) => s + v, 0) / lives.length : null,
    lifeTyres: lives.length,
    failureRate: fr.failureRate == null ? null : fr.failureRate * 100,
    ratedTyres: fr.ratedCount ?? records.filter((r) => canonRisk(r.risk_level)).length,
    highRiskCount: highRisk,
    records,
  }
}

/**
 * Fleet-relative composite risk score + rank - the SAME formula as
 * DriverManagement (40% CPK percentile, 60% failure-rate percentile; drivers
 * with no CPK take the worst CPK percentile; failure ordering uses high-risk
 * tyres over all tyres, as DriverManagement does). Returns { riskScore, rank, driverCount } for the target.
 */
export function computeFleetRank(targetName, fleetRecords = []) {
  const map = new Map()
  for (const r of fleetRecords) {
    const nm = driverKey(r)
    if (!map.has(nm)) map.set(nm, [])
    map.get(nm).push(r)
  }
  const drivers = [...map.entries()].map(([nm, recs]) => aggregateDriver(nm, recs))
  const withCpk = drivers.filter((d) => d.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk)
  const noCpk = drivers.filter((d) => d.avgCpk == null)
  const cpkRanked = withCpk.map((d, i) => ({ ...d, cpkRank: (i / Math.max(withCpk.length - 1, 1)) * 100 }))
  const all = [...cpkRanked, ...noCpk.map((d) => ({ ...d, cpkRank: 100 }))]
  // Ordering key mirrors DriverManagement exactly (high-risk / all tyres).
  const orderRate = (d) => (d.totalTyres ? (d.highRiskCount / d.totalTyres) * 100 : 0)
  const byFailure = [...all].sort((a, b) => orderRate(a) - orderRate(b))
  const failRank = new Map(byFailure.map((d, i) => [d.name, (i / Math.max(byFailure.length - 1, 1)) * 100]))
  const scored = all.map((d) => ({ ...d, riskScore: Math.min(100, Math.round(d.cpkRank * 0.4 + (failRank.get(d.name) ?? 100) * 0.6)) }))
  scored.sort((a, b) => a.riskScore - b.riskScore)
  const idx = scored.findIndex((d) => d.name === targetName)
  if (idx < 0) return null
  return { riskScore: scored[idx].riskScore, rank: idx + 1, driverCount: scored.length }
}

/** Build the full driver view model from the fleet read. null when the driver has no records. */
export function buildDriverView(driverName, fleetRecords = []) {
  const mine = fleetRecords.filter((r) => driverKey(r) === driverName)
  if (!mine.length) return null
  const base = aggregateDriver(driverName, mine)
  const ranked = computeFleetRank(driverName, fleetRecords)
  const hasEvidence = base.cpkTyres > 0 || base.ratedTyres > 0
  return {
    ...base,
    riskScore: hasEvidence ? ranked?.riskScore ?? null : null,
    rank: ranked?.rank ?? null,
    driverCount: ranked?.driverCount ?? null,
    evidence: { cpkTyres: base.cpkTyres, ratedTyres: base.ratedTyres, pricedTyres: base.pricedTyres, lifeTyres: base.lifeTyres },
  }
}

export function performanceBadge(score) {
  if (score == null) return { label: 'Not rated', tone: 'muted' }
  if (score <= 20) return { label: 'Excellent', tone: 'green' }
  if (score <= 40) return { label: 'Good', tone: 'blue' }
  if (score <= 60) return { label: 'Average', tone: 'yellow' }
  if (score <= 80) return { label: 'Poor', tone: 'orange' }
  return { label: 'Critical', tone: 'red' }
}

export function enrichRecords(records = []) {
  return records.map((r) => ({
    ...r,
    _asset: r.asset_no ?? r.asset_number ?? null,
    _cpk: calcCpk(r.cost_per_tyre, r.km_at_fitment, r.km_at_removal),
    _life: tyreLife(r),
    _risk: canonRisk(r.risk_level),
    _date: r.issue_date ? String(r.issue_date).slice(0, 10) : null,
  }))
}

export function optionList(records = [], key) {
  return [...new Set(records.map((r) => (r?.[key] ?? '').toString().trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** Filters: risk ('high' = High/Critical, 'unrated', or a canon level), brand, site, date range, search. */
export function filterRecords(enriched = [], { risk = '', brand = '', site = '', from = '', to = '', search = '' } = {}) {
  const list = enriched.filter((r) => {
    if (risk === 'high' && !(r._risk === 'High' || r._risk === 'Critical')) return false
    if (risk === 'unrated' && r._risk) return false
    if (risk && risk !== 'high' && risk !== 'unrated' && r._risk !== risk) return false
    if (brand && (r.brand ?? '').trim() !== brand) return false
    if (site && (r.site ?? '').trim() !== site) return false
    if (from && (!r._date || r._date < from)) return false
    if (to && (!r._date || r._date > to)) return false
    return true
  })
  const searched = searchRows(list, search, ['_asset', 'serial_no', 'brand', 'site', 'removal_reason', '_risk'])
  return sortRows(searched, { key: '_date', dir: 'desc' })
}

/** Count per key, largest first. Blank values grouped as 'Not recorded'. */
export function breakdown(records = [], key, limit = 6) {
  const m = new Map()
  for (const r of records) {
    const k = (r?.[key] ?? '').toString().trim() || 'Not recorded'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit)
}

export const RECORD_EXPORT_COLUMNS = [
  { key: 'asset', header: 'Asset No', value: (r) => r._asset },
  { key: 'serial_no', header: 'Serial No' },
  { key: 'brand', header: 'Brand' },
  { key: 'site', header: 'Site' },
  { key: 'issue_date', header: 'Issue Date', value: (r) => r._date },
  { key: 'cost_per_tyre', header: 'Cost', value: (r) => num(r.cost_per_tyre) ?? 'N/A' },
  { key: 'cpk', header: 'CPK', value: (r) => (r._cpk == null ? 'N/A' : Number(r._cpk.toFixed(4))) },
  { key: 'life', header: 'Life (km)', value: (r) => r._life ?? 'N/A' },
  { key: 'risk', header: 'Risk Level', value: (r) => r._risk ?? 'Not rated' },
  { key: 'removal_reason', header: 'Removal Reason' },
]

export function recordExport(rows = []) {
  return buildExport(rows, RECORD_EXPORT_COLUMNS)
}
