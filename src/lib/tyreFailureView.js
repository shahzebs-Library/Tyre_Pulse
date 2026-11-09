/**
 * tyreFailureView - pure shaping for the rebuilt Tyre Failure and CPK page
 * (/tyre-failure-cpk). No I/O, no React, no clock reads.
 *
 * Board figures come from tyreFailureBoard (which reuses kpiEngine) and the
 * filters / register from tyreFailureCpkBoardAnalytics; nothing here
 * re-implements CPK or tyre-life maths. This module adds the mockup blocks:
 *   - tyre life distribution in km bands
 *   - donut segments for removal reasons and bars for CPK by brand
 *   - the removed register with purchase cost and risk rating
 *   - period-over-period trends, only when a closed date window is chosen
 *   - KPI targets read from kpi_targets rows
 *   - a plain-language drill-down for one removed tyre
 */
import { buildTyreFailureBoard } from './tyreFailureBoard'
import { filterBoardRecords, removedRegister } from './tyreFailureCpkBoardAnalytics'
import { toLifetimeTyres, withOnePricePerTyre, fitmentKm } from './tyreLifetime'

const DAY = 86400000

/** Tyre life bands in km. Upper bound exclusive; the last band is open. */
export const LIFE_BANDS = [
  { key: 'lt30', label: 'Under 30k km', min: 0, max: 30000 },
  { key: '30_50', label: '30k to 50k km', min: 30000, max: 50000 },
  { key: '50_70', label: '50k to 70k km', min: 50000, max: 70000 },
  { key: '70_90', label: '70k to 90k km', min: 70000, max: 90000 },
  { key: 'gt90', label: '90k km and over', min: 90000, max: Infinity },
]

/**
 * Life km of ONE fitment by the shared km rule (tyreKm.js): placeholder
 * fitment km 1 and readings above the vehicle class limit are unknown, a
 * factory 0 is real. Null when not measurable.
 */
export function lifeKmOf(r) {
  const v = fitmentKm(r)
  return v != null && v > 0 ? v : null
}

/**
 * Count of PHYSICAL tyres per lifetime-km band (rows collapsed first, so a
 * tyre refitted on three vehicles is one tyre with its km summed), plus how
 * many tyres were measurable and how many tyres (`total`) and fitment rows
 * (`fitments`) there were.
 */
export function lifeDistribution(rows = []) {
  const bands = LIFE_BANDS.map((b) => ({ ...b, count: 0 }))
  let measured = 0
  let total = 0
  for (const t of toLifetimeTyres(rows || [])) {
    const q = t._qty || 1
    total += q
    const v = t._life_km
    if (v == null || !(v > 0)) continue
    measured += q
    const b = bands.find((x) => v >= x.min && v < x.max)
    if (b) b.count += q
  }
  return { bands, measured, total, fitments: (rows || []).length, basis: 'tyre' }
}

/** Chart-data {labels, datasets[0].data} to donut segments; top n plus Other. */
export function reasonSegments(chart, colors = [], n = 5) {
  const labels = chart?.labels || []
  const data = chart?.datasets?.[0]?.data || []
  const items = labels.map((label, i) => ({ label, count: Number(data[i]) || 0 })).filter((x) => x.count > 0)
  const head = items.slice(0, n)
  const rest = items.slice(n).reduce((s, x) => s + x.count, 0)
  if (rest > 0) head.push({ label: 'Other', count: rest })
  return head.map((x, i) => ({ ...x, color: colors[i % Math.max(1, colors.length)] || 'currentColor' }))
}

/** CPK-by-brand chart data (best first) to bar rows. */
export function cpkBars(chart, n = 6) {
  const labels = chart?.labels || []
  const data = chart?.datasets?.[0]?.data || []
  return labels.slice(0, n).map((brand, i) => ({ brand, value: Number(data[i]) })).filter((b) => Number.isFinite(b.value))
}

/** Removed register with purchase cost and risk, newest removal first. */
export function removedRows(rows = []) {
  // Purchase cost kept once per physical tyre: a refit's removal shows none.
  const src = new Map(withOnePricePerTyre(rows || []).map((r) => [r.id, r]))
  return removedRegister(rows).map((r) => {
    const s = src.get(r.id) || {}
    const cost = Number(s.cost_per_tyre)
    return {
      ...r,
      purchaseCost: Number.isFinite(cost) && cost > 0 ? cost : null,
      risk: s.risk_level ? String(s.risk_level).trim() || null : null,
    }
  }).sort((a, b) => String(b.removed_on || '').localeCompare(String(a.removed_on || '')))
}

/** Risk tone for the register pill. */
export function riskTone(level) {
  const l = String(level || '').toLowerCase()
  if (l === 'critical' || l === 'high') return 'bad'
  if (l === 'medium') return 'warn'
  if (l === 'low') return 'good'
  return null
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

/** The equal-length window immediately before [from, to]; null unless both set. */
export function previousWindow(from, to) {
  if (!from || !to) return null
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  const len = b - a + DAY
  return { from: iso(a - len), to: iso(a - DAY) }
}

/** Whole-number percentage change; null when either side is missing or prev is 0. */
export function pctChange(cur, prev) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null
  return Math.round(((cur - prev) / Math.abs(prev)) * 100)
}

/**
 * KPI trends against the previous equal-length window. Only with a closed
 * date window; the same site / brand / status / search filters apply to both.
 */
export function periodTrends(records = [], filters = {}) {
  const prev = previousWindow(filters.from, filters.to)
  if (!prev) return null
  const cur = buildTyreFailureBoard(filterBoardRecords(records, filters)).kpis
  const before = buildTyreFailureBoard(filterBoardRecords(records, { ...filters, ...prev })).kpis
  if (!before.totalCount) return { window: prev, active: null, removed: null, cpk: null, life: null }
  return {
    window: prev,
    active: pctChange(cur.activeCount, before.activeCount),
    removed: pctChange(cur.removedCount, before.removedCount),
    cpk: pctChange(cur.fleetAvgCpk, before.fleetAvgCpk),
    life: pctChange(cur.avgLifeKm, before.avgLifeKm),
  }
}

/** Target metric keys stored in kpi_targets. */
export const TARGET_METRICS = { cpk: 'fleet_cpk', life: 'avg_tyre_life_km' }

/**
 * Pick the target for a metric from kpi_targets rows: the active country's
 * own row wins over a country-blank one. Monthly or site-level rows are
 * ignored (this board reports a fleet window).
 */
export function pickTarget(rows = [], metric, country) {
  const fleet = (rows || []).filter((r) => r?.metric === metric && r.month == null && !r.site)
  const own = fleet.find((r) => r.country && r.country === country)
  const any = fleet.find((r) => !r.country)
  const hit = own || any
  const v = hit ? Number(hit.target_value ?? hit.target) : NaN
  return Number.isFinite(v) && v > 0 ? v : null
}

const fmtN = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

/** One-line drill-down for a removed tyre, from measured fields only. */
export function drillSummary(r, { money = true, currency = '' } = {}) {
  if (!r) return ''
  const name = r.serial_no || 'This tyre'
  const parts = [`${name}${r.asset_no ? ` on ${r.asset_no}` : ''}${r.position ? ` (${r.position})` : ''}`]
  parts.push(r.reason ? `removed for ${r.reason.toLowerCase()}` : 'removed with no reason recorded')
  if (r.lifeKm != null) parts.push(`after ${fmtN(r.lifeKm)} km`)
  let s = parts.join(' ') + '.'
  if (r.cpk != null && money) s += ` Cost per km ${r.cpk.toFixed(3)} ${currency}/km.`.replace(' /km', '/km')
  if (r.lifetimeKm != null && r.fitments > 1) s += ` Lifetime across ${r.fitments} fitments ${fmtN(r.lifetimeKm)} km${r.lifetimeCpk != null && money ? `, lifetime cost per km ${r.lifetimeCpk.toFixed(3)} ${currency}/km`.replace(' /km', '/km') : ''}.`
  else if (r.lifeKm == null) s += ' Life and cost per km cannot be measured without fitment and removal km.'
  return s
}
