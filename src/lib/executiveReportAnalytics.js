/**
 * executiveReportAnalytics - the pure calculation engine behind
 * src/pages/ExecutiveReport.jsx (/executive-report).
 *
 * Everything here is deterministic and free of I/O: the page loads rows through
 * the service layer and hands them in. Time-dependent helpers take an
 * injectable `now` so they are testable and never drift inside a render.
 *
 * Honesty rules (the reason this file exists):
 *   - An unmeasurable figure is `null` and renders "N/A", never a fabricated 0.
 *     `risk_level` is sparsely populated in this fleet, so every risk metric is
 *     computed over RATED rows only and is null when nothing is rated.
 *   - A CPK of zero is not a measurement (it means "no distance or no price"),
 *     so it reads N/A rather than "SAR 0.00" in green.
 *   - Money is never summed across currencies here; the spend total itself is
 *     resolved by src/lib/executiveSpend.js (null when currencies blend).
 *
 * Reuses kpiEngine / analyticsEngine maths rather than re-deriving it.
 */
import { recordCost } from './analyticsEngine'

// ── Formatting (shared by screen, PDF, PPTX and Excel) ───────────────────────

const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v))

/** Currency amount, or N/A when unknown. */
export function fmtCurrency(n, currency) {
  if (!isNum(n)) return 'N/A'
  const v = Number(n)
  if (v === 0) return `${currency} 0`
  return `${currency} ${Math.round(v).toLocaleString()}`
}

/** Grouped number, or N/A when unknown. */
export function fmtNum(n, decimals = 0) {
  if (!isNum(n)) return 'N/A'
  return Number(n).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Percentage (input already 0..100), or N/A when unknown. */
export function fmtPct(n) {
  return isNum(n) ? `${fmtNum(n, 1)}%` : 'N/A'
}

/** Fraction (0..1) as a percentage, or N/A when unknown. */
export function fmtRatio(r) {
  return isNum(r) ? fmtPct(Number(r) * 100) : 'N/A'
}

/** Cost per km. Zero or negative is not a measurement, so it reads N/A. */
export function fmtCpk(n, currency) {
  if (!isNum(n) || Number(n) <= 0) return 'N/A'
  return `${currency} ${Number(n).toFixed(4)}`
}

/** Value with a unit suffix, or N/A (no dangling unit) when unknown. */
export function withUnit(formatted, unit) {
  return formatted === 'N/A' ? 'N/A' : `${formatted} ${unit}`
}

// ── Status (colour is never the only signal: every status has a label) ──────

export const STATUS_LABELS = {
  green: 'On target',
  amber: 'Watch',
  red: 'Off target',
  neutral: 'Not measured',
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.neutral
}

export function cpkStatus(cpk) {
  if (!isNum(cpk) || Number(cpk) <= 0) return 'neutral'
  if (cpk <= 0.005) return 'green'
  if (cpk <= 0.012) return 'amber'
  return 'red'
}

/** Higher is better (e.g. compliance %). */
export function pctStatus(pct, goodAbove = 85) {
  if (!isNum(pct)) return 'neutral'
  if (pct >= goodAbove) return 'green'
  if (pct >= goodAbove * 0.7) return 'amber'
  return 'red'
}

/** Lower is better, fraction input (e.g. failure rate 0..1). */
export function lowerIsBetter(value, greenMax, amberMax) {
  if (!isNum(value)) return 'neutral'
  if (value <= greenMax) return 'green'
  if (value <= amberMax) return 'amber'
  return 'red'
}

/** Higher is better, absolute threshold (e.g. tyre life km). */
export function higherIsBetter(value, greenMin, amberMin) {
  if (!isNum(value) || Number(value) <= 0) return 'neutral'
  if (value >= greenMin) return 'green'
  if (value >= amberMin) return 'amber'
  return 'red'
}

// ── Period / site scoping ────────────────────────────────────────────────────

/**
 * PeriodFilter value -> INCLUSIVE-start / EXCLUSIVE-end server bounds, or null
 * for "all time". A superset of the client filter, so numbers never change.
 */
export function periodBounds(period) {
  const v = period || { mode: 'all' }
  if (v.mode === 'year') {
    const y = Number(v.year)
    if (!Number.isFinite(y)) return null
    return { from: `${y}-01-01`, toExclusive: `${y + 1}-01-01` }
  }
  if (v.mode === 'custom') {
    const from = v.from && /^\d{4}-\d{2}-\d{2}/.test(v.from) ? v.from.slice(0, 10) : null
    let toExclusive = null
    if (v.to && /^\d{4}-\d{2}-\d{2}/.test(v.to)) {
      const d = new Date(`${v.to.slice(0, 10)}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + 1)
      toExclusive = d.toISOString().slice(0, 10)
    }
    if (!from && !toExclusive) return null
    return { from, toExclusive }
  }
  return null
}

export const ALL_SITES = 'All'

/** Distinct non-empty sites across the row sets, sorted. */
export function siteOptions(...rowSets) {
  const s = new Set()
  for (const rows of rowSets) {
    for (const r of Array.isArray(rows) ? rows : []) {
      const site = r?.site == null ? '' : String(r.site).trim()
      if (site) s.add(site)
    }
  }
  return [...s].sort((a, b) => a.localeCompare(b))
}

/** Rows at one site; the All sentinel (or blank) keeps everything. */
export function filterBySite(rows, site) {
  const list = Array.isArray(rows) ? rows : []
  if (!site || site === ALL_SITES) return list
  return list.filter((r) => String(r?.site ?? '').trim() === site)
}

// ── Root cause classification ────────────────────────────────────────────────

export const RC_CATEGORIES = [
  { key: 'inflation', label: 'Inflation Issues', color: '#ef4444',
    keywords: ['inflation', 'pressure', 'under-inflat', 'over-inflat', 'deflat', 'blow'],
    prevention: 'Implement weekly pressure checks, install TPMS sensors, calibrate gauges quarterly.' },
  { key: 'alignment', label: 'Alignment / Suspension', color: '#f97316',
    keywords: ['align', 'suspension', 'camber', 'toe', 'wheel balance', 'balancing', 'bounce'],
    prevention: 'Schedule alignment checks every 20,000 km, inspect after impact events.' },
  { key: 'driver', label: 'Driver Behavior', color: '#eab308',
    keywords: ['driver', 'driving', 'speed', 'braking', 'cornering', 'abuse', 'misuse', 'overload'],
    prevention: 'Deploy telematics, run defensive driving training, review high-loss records monthly.' },
  { key: 'road', label: 'Road / Load Conditions', color: '#8b5cf6',
    keywords: ['road', 'terrain', 'load', 'overload', 'weight', 'debris', 'pothole', 'cut'],
    prevention: 'Map high-risk routes, enforce load compliance, carry puncture repair kits.' },
  { key: 'maintenance', label: 'Maintenance Quality', color: '#06b6d4',
    keywords: ['mainten', 'workshop', 'rotation', 'install', 'torque', 'fitment', 'rim'],
    prevention: 'Audit workshop standards, enforce mandatory service intervals, verify torque spec.' },
  { key: 'manufacturing', label: 'Manufacturing Defects', color: '#10b981',
    keywords: ['defect', 'manufactur', 'warranty', 'sidewall', 'bead', 'delamination', 'separation'],
    prevention: 'Raise warranty claims, audit supplier quality, inspect all incoming tyres.' },
  { key: 'other', label: 'Other / Unclassified', color: '#6b7280', keywords: [],
    prevention: 'Investigate individual records and assign to appropriate root cause category.' },
]

export function classifyRootCause(record) {
  const r = record || {}
  const text = [r.findings, r.category, r.risk_level].join(' ').toLowerCase()
  for (const cat of RC_CATEGORIES.slice(0, -1)) {
    if (cat.keywords.some((kw) => text.includes(kw))) return cat.key
  }
  if (r.risk_level === 'Critical' || r.risk_level === 'High') {
    if (text.includes('tread')) return 'maintenance'
    if (text.includes('pressure')) return 'inflation'
  }
  return 'other'
}

/** Counts, share and cost per root cause, most frequent first; empty causes dropped. */
export function computeRootCauses(records = []) {
  const counts = {}
  RC_CATEGORIES.forEach((c) => { counts[c.key] = { count: 0, cost: 0 } })
  for (const r of records) {
    const key = classifyRootCause(r)
    counts[key].count += 1
    counts[key].cost += recordCost(r)
  }
  const total = records.length
  return RC_CATEGORIES.map((cat) => ({
    ...cat,
    count: counts[cat.key].count,
    cost: counts[cat.key].cost,
    pct: total > 0 ? (counts[cat.key].count / total) * 100 : 0,
  })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count)
}

// ── Cost breakdowns (priced tyre records) ────────────────────────────────────

/** Highest-cost assets in the scope. */
export function topCostVehicles(records = [], limit = 5) {
  const byAsset = {}
  for (const r of records) {
    if (!r?.asset_no) continue
    if (!byAsset[r.asset_no]) byAsset[r.asset_no] = { asset_no: r.asset_no, site: r.site || null, cost: 0, count: 0 }
    byAsset[r.asset_no].cost += recordCost(r)
    byAsset[r.asset_no].count += 1
  }
  return Object.values(byAsset).sort((a, b) => b.cost - a.cost).slice(0, limit)
}

/** Cost grouped by one dimension (site / brand), descending. */
export function costByDimension(records = [], key, limit = Infinity) {
  const by = {}
  for (const r of records) {
    const k = r?.[key] ? String(r[key]) : 'Unknown'
    by[k] = (by[k] || 0) + recordCost(r)
  }
  return Object.entries(by)
    .map(([name, cost]) => ({ [key]: name, cost }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit)
}

/** Months covered by the dated rows (min 1), or 1 when nothing is dated. */
export function periodMonths(records = [], dateField = 'issue_date') {
  const dates = records.map((r) => r?.[dateField]).filter(Boolean).sort()
  if (!dates.length) return 1
  return Math.max(1, Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 2_592_000_000) + 1)
}

/** Budget over the period, or null when no vehicle carries a budget. */
export function periodBudget(fleet = [], records = []) {
  const monthly = fleet.reduce((s, v) => s + (Number(v?.monthly_tyre_budget) || 0), 0)
  if (!(monthly > 0)) return null
  return monthly * periodMonths(records)
}

/** Projected annual spend from the average month, or null when unknown. */
export function projectAnnual(avgMonthlyCost) {
  return isNum(avgMonthlyCost) && Number(avgMonthlyCost) > 0 ? Number(avgMonthlyCost) * 12 : null
}

/** Month-over-month % change of the last two months, or null. */
export function monthOverMonth(byMonth = []) {
  if (!Array.isArray(byMonth) || byMonth.length < 2) return null
  const last = byMonth[byMonth.length - 1]
  const prev = byMonth[byMonth.length - 2]
  if (!prev?.totalCost) return null
  return ((last.totalCost - prev.totalCost) / prev.totalCost) * 100
}

/** Annualised saving if the fleet reached its best-decile CPK, or null. */
export function savingsOpportunity(cpk, records = []) {
  const avg = Number(cpk?.fleetAvgCpk)
  const best = Number(cpk?.p10Cpk)
  if (!(avg > 0) || !(best > 0)) return null
  const improvement = avg - best
  if (improvement <= 0) return 0
  const totalKm = records.reduce((s, r) => {
    const f = Number(r?.km_at_fitment), rem = Number(r?.km_at_removal)
    return Number.isFinite(f) && Number.isFinite(rem) && rem > f ? s + (rem - f) : s
  }, 0)
  if (!(totalKm > 0)) return null
  const dates = records.map((r) => r?.issue_date).filter(Boolean).sort()
  const periodDays = dates.length
    ? Math.max(30, (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86_400_000 + 1)
    : 90
  return improvement * totalKm * (12 / periodDays * 30)
}

// ── Risk (rated rows only) ───────────────────────────────────────────────────

export const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low']
const RISK_WEIGHT = { Critical: 4, High: 3, Medium: 2, Low: 1 }

const isRated = (r) => Object.prototype.hasOwnProperty.call(RISK_WEIGHT, r?.risk_level)

/** Risk counts per level plus the rated/unrated split. */
export function riskCounts(records = []) {
  const out = { Critical: 0, High: 0, Medium: 0, Low: 0, rated: 0, unrated: 0 }
  for (const r of records) {
    if (isRated(r)) { out[r.risk_level] += 1; out.rated += 1 } else out.unrated += 1
  }
  return out
}

/** Weighted risk score 1..4 over rated rows, or null when nothing is rated. */
export function riskScore(records = []) {
  const c = riskCounts(records)
  if (!c.rated) return null
  return (c.Critical * 4 + c.High * 3 + c.Medium * 2 + c.Low) / c.rated
}

export function riskBand(score) {
  if (!isNum(score)) return { key: 'neutral', label: 'Not rated' }
  if (score >= 3) return { key: 'red', label: 'High risk' }
  if (score >= 2) return { key: 'amber', label: 'Moderate risk' }
  return { key: 'green', label: 'Acceptable risk' }
}

/** Site x risk-level matrix, worst score first (unrated sites last). */
export function buildRiskMatrix(records = []) {
  const bySite = {}
  for (const r of records) {
    const site = r?.site ? String(r.site) : null
    if (!site) continue
    ;(bySite[site] = bySite[site] || []).push(r)
  }
  return Object.entries(bySite).map(([site, rows]) => {
    const c = riskCounts(rows)
    return {
      site, Critical: c.Critical, High: c.High, Medium: c.Medium, Low: c.Low,
      rated: c.rated, total: rows.length, score: riskScore(rows),
    }
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.total - a.total)
}

/** Critical then High records, first `limit`. */
export function topHighRisk(records = [], limit = 10) {
  const order = { Critical: 0, High: 1 }
  return records
    .filter((r) => r?.risk_level === 'Critical' || r?.risk_level === 'High')
    .sort((a, b) => (order[a.risk_level] ?? 2) - (order[b.risk_level] ?? 2))
    .slice(0, limit)
}

/** Risk score per month for the last `months` months ending at `now`; null when a month has no rated rows. */
export function riskTrend(records = [], { months = 6, now = new Date() } = {}) {
  const keys = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const byMonth = {}
  for (const r of records) {
    const k = r?.issue_date ? String(r.issue_date).slice(0, 7) : null
    if (k) (byMonth[k] = byMonth[k] || []).push(r)
  }
  return keys.map((month) => ({ month, score: riskScore(byMonth[month] || []) }))
}

// ── Honest KPI view ──────────────────────────────────────────────────────────

/**
 * Normalises the kpiEngine output so an unmeasured KPI is null. kpiEngine
 * returns 0 (or 100% availability) when it has nothing to measure; on an
 * executive report that reads as a verdict the data does not support.
 */
export function honestKpis(kpis = {}, records = []) {
  const k = kpis || {}
  const rated = riskCounts(records).rated
  const life = k.avgTyreLife || {}
  const insp = k.inspectionCompliance || {}
  const scrap = k.scrapRate || {}
  const repl = k.replacementRate || {}
  const down = k.downtimeImpact || {}
  const avail = k.fleetAvailability || {}
  return {
    fleetAvgCpk: k.cpk?.fleetAvgCpk ?? null,
    medianCpk: k.cpk?.medianCpk ?? null,
    p10Cpk: k.cpk?.p10Cpk ?? null,
    avgTyreLifeKm: life.validCount > 0 ? life.avgKm : null,
    inspectionPct: insp.totalScheduled > 0 ? insp.compliancePct : null,
    pressurePct: k.pressureCompliance?.compliancePct ?? null,
    failureRate: k.failureRate?.failureRate ?? null,
    criticalRate: k.failureRate?.criticalRate ?? null,
    scrapRate: scrap.totalCount > 0 ? scrap.scrapRate : null,
    replacementPerVehicleMonth: records.length > 0 ? (repl.avgPerVehiclePerMonth ?? null) : null,
    downtimeHours: records.length > 0 ? (down.totalDowntimeHours ?? null) : null,
    availabilityPct: rated > 0 ? (avail.availabilityPct ?? null) : null,
    criticalCount: riskCounts(records).Critical,
  }
}

/** KPI rows for the Excel export - text N/A for anything unmeasured. */
export function kpiExportRows(h, { currency, totalSpend, projectedAnnual }) {
  const fixed = (v, d) => (isNum(v) ? Number(v).toFixed(d) : 'N/A')
  const pct = (v) => (isNum(v) ? (Number(v) * 100).toFixed(1) : 'N/A')
  const round = (v) => (isNum(v) ? Math.round(Number(v)) : 'N/A')
  const unit = (v, u) => (isNum(v) ? u : '')
  return [
    { KPI: 'Fleet Avg CPK', Value: fixed(h.fleetAvgCpk, 6), Unit: unit(h.fleetAvgCpk, `${currency}/km`) },
    { KPI: 'Median CPK', Value: fixed(h.medianCpk, 6), Unit: unit(h.medianCpk, `${currency}/km`) },
    { KPI: 'Fleet Avg Tyre Life', Value: round(h.avgTyreLifeKm), Unit: unit(h.avgTyreLifeKm, 'km') },
    { KPI: 'Inspection Compliance', Value: fixed(h.inspectionPct, 1), Unit: unit(h.inspectionPct, '%') },
    { KPI: 'Pressure Compliance', Value: fixed(h.pressurePct, 1), Unit: unit(h.pressurePct, '%') },
    { KPI: 'Failure Rate', Value: pct(h.failureRate), Unit: unit(h.failureRate, '%') },
    { KPI: 'Critical Rate', Value: pct(h.criticalRate), Unit: unit(h.criticalRate, '%') },
    { KPI: 'Scrap Rate', Value: pct(h.scrapRate), Unit: unit(h.scrapRate, '%') },
    { KPI: 'Total Downtime Hours', Value: round(h.downtimeHours), Unit: unit(h.downtimeHours, 'hrs') },
    { KPI: 'Fleet Availability', Value: fixed(h.availabilityPct, 1), Unit: unit(h.availabilityPct, '%') },
    { KPI: 'Total Spend', Value: round(totalSpend), Unit: unit(totalSpend, currency) },
    { KPI: 'Projected Annual Spend', Value: round(projectedAnnual), Unit: unit(projectedAnnual, currency) },
  ]
}

/** Split the flat action plan into its 30/60/90 day phases. */
export function actionPhaseOf(index) {
  if (index < 4) return '0-30 days'
  if (index < 7) return '30-60 days'
  return '60-90 days'
}
