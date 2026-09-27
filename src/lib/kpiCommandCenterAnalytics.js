/**
 * kpiCommandCenterAnalytics - pure engine for the KPI Command Center page.
 *
 * The KPI maths comes from kpiEngine; this module benchmarks the results,
 * scores them 0-100, and builds the site / vehicle / monthly views.
 *
 * HONESTY RULE: a KPI with no measurable input is null and its score is null
 * ("Not measured"). The previous page scored a missing value as 0 and rated it
 * "Critical", which dragged the overall fleet score down for data nobody
 * recorded. The overall score now averages MEASURED KPIs only and says how
 * many it rests on.
 *
 * No I/O and no clock reads: every date helper takes the anchor explicitly.
 */
import {
  computeCpkFleet, computeAvgTyreLife, computeFailureRate,
  computeScrapRate, computePressureCompliance, computeInspectionCompliance,
} from './kpiEngine'

export function isMeasured(v) {
  return v != null && v !== '' && Number.isFinite(Number(v))
}

/** Static industry reference bands. Currency only affects display. */
export function makeBenchmarks(currency = '') {
  const cur = currency ? `${currency} ` : ''
  const pct = (v) => (isMeasured(v) ? `${Number(v).toFixed(1)}%` : 'N/A')
  return {
    cpk: {
      key: 'cpk', label: 'Cost Per Km (CPK)', unit: `${currency}/km`,
      world_class: 0.80, good: 1.20, average: 1.80, poor: 2.50, higherIsBetter: false,
      format: v => (isMeasured(v) ? `${cur}${Number(v).toFixed(3)}` : 'N/A'),
      description: 'Cost spent per km on tyres',
    },
    tyre_life: {
      key: 'tyre_life', label: 'Avg Tyre Life', unit: 'km',
      world_class: 150000, good: 100000, average: 70000, poor: 45000, higherIsBetter: true,
      format: v => (isMeasured(v) ? `${(Number(v) / 1000).toFixed(0)}k km` : 'N/A'),
      description: 'Average km per tyre before removal',
    },
    failure_rate: {
      key: 'failure_rate', label: 'Failure Rate', unit: '%',
      world_class: 3, good: 8, average: 15, poor: 25, higherIsBetter: false,
      format: pct, description: 'High + Critical risk removals (rated tyres)',
    },
    scrap_rate: {
      key: 'scrap_rate', label: 'Scrap Rate', unit: '%',
      world_class: 5, good: 12, average: 20, poor: 35, higherIsBetter: false,
      format: pct, description: 'Scrapped vs total tyres removed',
    },
    pressure_compliance: {
      key: 'pressure_compliance', label: 'Pressure Compliance', unit: '%',
      world_class: 97, good: 92, average: 85, poor: 70, higherIsBetter: true,
      format: pct, description: 'Readings within 15% of the vehicle median',
    },
    inspection_compliance: {
      key: 'inspection_compliance', label: 'Inspection Compliance', unit: '%',
      world_class: 98, good: 92, average: 80, poor: 65, higherIsBetter: true,
      format: pct, description: 'On-time inspection completion',
    },
  }
}

const STATIC = makeBenchmarks('')
export const KPI_KEYS = Object.keys(STATIC)

export const PERIOD_PRESETS = ['1d', '7d', '30d', '90d', '6m', '1y', 'custom']

const pad = (n) => String(n).padStart(2, '0')
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Window for a preset, counted back from `anchor` (latest data date, else today). */
export function periodDates(preset, custom = {}, anchor = new Date()) {
  const now = new Date(anchor)
  const back = (fn) => { const f = new Date(now); fn(f); return { from: isoDay(f), to: isoDay(now) } }
  if (preset === '1d') return back(f => f.setDate(f.getDate() - 1))
  if (preset === '7d') return back(f => f.setDate(f.getDate() - 7))
  if (preset === '30d') return back(f => f.setDate(f.getDate() - 30))
  if (preset === '90d') return back(f => f.setDate(f.getDate() - 90))
  if (preset === '6m') return back(f => f.setMonth(f.getMonth() - 6))
  if (preset === '1y') return back(f => f.setFullYear(f.getFullYear() - 1))
  return {
    from: custom.from || isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    to: custom.to || isoDay(now),
  }
}

/** The equally long window immediately before [from, to]. */
export function prevPeriodDates(from, to) {
  const f = new Date(`${from}T00:00:00`)
  const t = new Date(`${to}T00:00:00`)
  const days = Math.round((t - f) / 86400000)
  const pf = new Date(f); pf.setDate(pf.getDate() - days)
  const pt = new Date(f); pt.setDate(pt.getDate() - 1)
  return { from: isoDay(pf), to: isoDay(pt) }
}

/** 0-100 score against the bands; null when the value is unmeasured. */
export function kpiScore(key, value) {
  const b = STATIC[key]
  if (!b || !isMeasured(value)) return null
  const v = Number(value)
  const { world_class, good, average, poor, higherIsBetter } = b
  if (higherIsBetter) {
    if (v >= world_class) return 100
    if (v >= good) return 75 + 25 * ((v - good) / (world_class - good))
    if (v >= average) return 50 + 25 * ((v - average) / (good - average))
    if (v >= poor) return 25 + 25 * ((v - poor) / (average - poor))
    return Math.max(0, 25 * (v / poor))
  }
  if (v <= world_class) return 100
  if (v <= good) return 75 + 25 * ((good - v) / (good - world_class))
  if (v <= average) return 50 + 25 * ((average - v) / (average - good))
  if (v <= poor) return 25 + 25 * ((poor - v) / (poor - average))
  return Math.max(0, 25 * (1 - (v - poor) / poor))
}

/** Rating key for a score; 'notMeasured' when the score is null. */
export function ratingKey(score) {
  if (score == null) return 'notMeasured'
  if (score >= 90) return 'worldClass'
  if (score >= 70) return 'good'
  if (score >= 45) return 'average'
  if (score >= 20) return 'poor'
  return 'critical'
}

export const RATING_LABEL = {
  worldClass: 'World Class', good: 'Good', average: 'Average', poor: 'Poor', critical: 'Critical', notMeasured: 'Not measured',
}

/** Mean of the measured scores only. */
export function overallScore(values) {
  const scores = KPI_KEYS.map(k => kpiScore(k, values?.[k])).filter(s => s != null)
  return {
    score: scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
    measured: scores.length,
    total: KPI_KEYS.length,
  }
}

/** The six KPI values with honest nulls. */
export function extractKpiValues(records = [], inspections = []) {
  const cpk = computeCpkFleet(records)
  const life = computeAvgTyreLife(records)
  const fail = computeFailureRate(records)
  const scrap = computeScrapRate(records)
  const press = computePressureCompliance(inspections)
  const insp = computeInspectionCompliance(inspections)
  return {
    cpk: cpk.validCount > 0 ? cpk.fleetAvgCpk : null,
    tyre_life: life.validCount > 0 ? life.avgKm : null,
    failure_rate: fail.failureRate == null ? null : fail.failureRate * 100,
    scrap_rate: scrap.totalCount > 0 ? scrap.scrapRate * 100 : null,
    pressure_compliance: isMeasured(press.compliancePct) ? press.compliancePct : null,
    inspection_compliance: insp.totalScheduled > 0 ? insp.compliancePct : null,
  }
}

/** % change current vs previous; null when either side is unmeasured or prev is 0. */
export function pctChange(curr, prev) {
  if (!isMeasured(curr) || !isMeasured(prev) || Number(prev) === 0) return null
  return ((Number(curr) - Number(prev)) / Math.abs(Number(prev))) * 100
}

/** True when a change is an improvement for this KPI; null when unknown. */
export function isImprovement(key, change) {
  if (change == null) return null
  return STATIC[key]?.higherIsBetter ? change >= 0 : change <= 0
}

/** Signed % distance from the "good" band. */
export function deltaVsGood(key, value) {
  const b = STATIC[key]
  if (!b || !isMeasured(value)) return null
  return ((Number(value) - b.good) / b.good) * 100
}

/** Target status: 'exceeded' | 'onTrack' | 'behind' | 'notMeasured'. */
export function targetStatus(key, value, target) {
  const b = STATIC[key]
  if (!b || !isMeasured(value)) return 'notMeasured'
  const t = isMeasured(target) ? Number(target) : b.good
  const v = Number(value)
  const exceeded = b.higherIsBetter ? v >= t * 1.1 : v <= t * 0.9
  const onTrack = b.higherIsBetter ? v >= t : v <= t
  return exceeded ? 'exceeded' : onTrack ? 'onTrack' : 'behind'
}

/** Monthly KPI matrix from a 12-month history, newest 12 months with data. */
export function monthlyMatrix(histRecords = []) {
  const byMonth = new Map()
  for (const r of histRecords) {
    if (!r?.issue_date) continue
    const mk = String(r.issue_date).slice(0, 7)
    if (!byMonth.has(mk)) byMonth.set(mk, [])
    byMonth.get(mk).push(r)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, rows]) => ({ month, records: rows.length, ...extractKpiValues(rows, []) }))
}

/** Per-site KPI values + scores, best overall first, unmeasured last. */
export function siteKpiRows(records = [], inspections = []) {
  const bySite = new Map()
  for (const r of records) {
    const s = r.site || 'Unknown'
    if (!bySite.has(s)) bySite.set(s, [])
    bySite.get(s).push(r)
  }
  return [...bySite.entries()].map(([site, rows]) => {
    const vals = extractKpiValues(rows, inspections.filter(i => (i.site || 'Unknown') === site))
    const o = overallScore(vals)
    return { site, records: rows.length, ...vals, overall: o.score, measured: o.measured }
  }).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1))
}

const VEHICLE_KEYS = ['cpk', 'tyre_life', 'failure_rate', 'scrap_rate']

/** Per-vehicle scorecard (vehicles with at least `minRecords` records). */
export function vehicleRows(records = [], minRecords = 2) {
  const byAsset = new Map()
  for (const r of records) {
    const a = r.asset_no || 'Unknown'
    if (!byAsset.has(a)) byAsset.set(a, [])
    byAsset.get(a).push(r)
  }
  const out = []
  for (const [asset, rows] of byAsset) {
    if (rows.length < minRecords) continue
    const v = extractKpiValues(rows, [])
    const scores = VEHICLE_KEYS.map(k => kpiScore(k, v[k])).filter(s => s != null)
    out.push({
      asset,
      records: rows.length,
      cpk: v.cpk,
      tyre_life: v.tyre_life,
      failure_rate: v.failure_rate,
      scrap_rate: v.scrap_rate,
      overall: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
      measured: scores.length,
    })
  }
  return out.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1))
}

/**
 * Alerts: achievements (score >= 90), warnings (< 45) and deterioration over
 * the last three measured months. Unmeasured KPIs raise nothing.
 */
export function kpiAlerts(values, matrix = []) {
  const out = []
  for (const key of KPI_KEYS) {
    const score = kpiScore(key, values?.[key])
    if (score == null) continue
    if (score >= 90) out.push({ type: 'achievement', kpi: key, value: values[key], severity: 0 })
    else if (score < 45) out.push({ type: 'warning', kpi: key, value: values[key], severity: 2 })
    const series = matrix.map(m => m[key]).filter(isMeasured).slice(-3)
    if (series.length === 3 && score < 85) {
      const worse = STATIC[key].higherIsBetter ? series[2] < series[0] : series[2] > series[0]
      if (worse) {
        const change = series[0] !== 0 ? Math.abs((series[2] - series[0]) / series[0] * 100) : null
        out.push({ type: 'deteriorating', kpi: key, value: values[key], change, severity: 1 })
      }
    }
  }
  return out.sort((a, b) => b.severity - a.severity)
}

/** Flat export rows for the KPI summary. */
export function kpiSummaryExportRows(values, prevValues, benchmarks) {
  return KPI_KEYS.map(k => {
    const b = benchmarks[k]
    const score = kpiScore(k, values?.[k])
    const change = pctChange(values?.[k], prevValues?.[k])
    const vsGood = deltaVsGood(k, values?.[k])
    return {
      kpi: b.label,
      value: b.format(values?.[k]),
      score: score == null ? 'N/A' : `${score.toFixed(0)}/100`,
      rating: RATING_LABEL[ratingKey(score)],
      change: change == null ? 'N/A' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
      vsGood: vsGood == null ? 'N/A' : `${vsGood > 0 ? '+' : ''}${vsGood.toFixed(1)}%`,
      worldClass: b.format(b.world_class),
      good: b.format(b.good),
      average: b.format(b.average),
      poor: b.format(b.poor),
    }
  })
}
