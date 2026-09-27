/**
 * performanceBenchmarkAnalytics.js - fleet versus static industry reference
 * benchmarking for src/pages/PerformanceBenchmark.jsx.
 *
 * Every measured value comes from the central kpiEngine (CPK, tyre life,
 * failure rate, pressure compliance) so this page can never disagree with the
 * Engineering KPI module; this file only adds the reference thresholds, the
 * rating ladder, scoping and the two page-specific measures (scrap rate over
 * removed tyres, inspection coverage of fitted assets). No I/O, no React, no
 * colours (ratings carry a `tone` key the page maps to classes).
 *
 * HONESTY RULES (each replaces a former fabricated default):
 *   - a metric with no measurable data is null and rated "Not measured"; it is
 *     never 0, never 95%, and never enters the overall score
 *   - money-derived metrics (CPK, brand CPK) are null when the records span
 *     more than one country, because each country reports in its own currency
 *   - the overall score averages only the metrics that were measured, and is
 *     null when none were
 */
import {
  computeCpkFleet, computeCpkByBrand, computeAvgTyreLife, computeFailureRate,
  computePressureCompliance,
} from './kpiEngine'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Static heavy-fleet reference thresholds. Not live competitor data. */
export const BENCHMARKS = Object.freeze({
  cpk: {
    label: 'Cost Per Kilometre (CPK)',
    world_class: 0.80, good: 1.20, average: 1.80, poor: 2.50,
    description: 'Tyre cost per kilometre run. Lower is better.',
    kind: 'money_per_km',
  },
  tyre_life: {
    label: 'Average Tyre Life',
    world_class: 150000, good: 100000, average: 70000, poor: 45000,
    description: 'Average distance per tyre before removal. Higher is better.',
    kind: 'km', higherIsBetter: true,
  },
  failure_rate: {
    label: 'Failure Rate',
    world_class: 3, good: 8, average: 15, poor: 25,
    description: 'Share of risk-rated tyres rated High or Critical. Lower is better.',
    kind: 'pct',
  },
  pressure_compliance: {
    label: 'Pressure Compliance',
    world_class: 97, good: 92, average: 85, poor: 70,
    description: 'Recorded pressures within 15% of their own vehicle median. Higher is better.',
    kind: 'pct', higherIsBetter: true,
  },
  scrap_rate: {
    label: 'Scrap Rate',
    world_class: 5, good: 12, average: 20, poor: 35,
    description: 'Share of removed tyres that were scrapped. Lower is better.',
    kind: 'pct',
  },
  inspection_compliance: {
    label: 'Inspection Coverage',
    world_class: 98, good: 92, average: 80, poor: 65,
    description: 'Share of assets with tyre records that were inspected in the period. Higher is better.',
    kind: 'pct', higherIsBetter: true,
  },
})
export const BENCHMARK_KEYS = Object.freeze(Object.keys(BENCHMARKS))

/** Format a benchmark value for display. `currency` is used for money kinds. */
export function formatBenchmark(key, v, currency = '') {
  const n = num(v)
  if (n == null) return 'N/A'
  const kind = BENCHMARKS[key]?.kind
  if (kind === 'money_per_km') return `${currency ? `${currency} ` : ''}${n.toFixed(2)}/km`
  if (kind === 'km') return `${(n / 1000).toFixed(0)}k km`
  return `${n.toFixed(1)}%`
}

/** Rating ladder. Unmeasurable values rate "Not measured" with a null score. */
export function benchmarkRating(key, value) {
  const b = BENCHMARKS[key]
  const v = num(value)
  if (!b || v == null) return { rating: 'Not measured', score: null, tone: 'none' }
  const ladder = b.higherIsBetter
    ? [[v >= b.world_class, 'World Class', 100, 'good'], [v >= b.good, 'Good', 75, 'info'], [v >= b.average, 'Average', 50, 'watch'], [v >= b.poor, 'Below Average', 25, 'warn']]
    : [[v <= b.world_class, 'World Class', 100, 'good'], [v <= b.good, 'Good', 75, 'info'], [v <= b.average, 'Average', 50, 'watch'], [v <= b.poor, 'Below Average', 25, 'warn']]
  const hit = ladder.find(([ok]) => ok)
  return hit ? { rating: hit[1], score: hit[2], tone: hit[3] } : { rating: 'Poor', score: 10, tone: 'risk' }
}

const blank = (v) => v == null || String(v).trim() === ''

/** Null-safe country/site scoping for inspections (rows with no country stay visible, like applyCountry). */
export function scopeInspections(inspections, { country = null, site = 'All' } = {}) {
  return (Array.isArray(inspections) ? inspections : []).filter((i) => {
    if (country && country !== 'All' && !blank(i?.country) && i.country !== country) return false
    if (site && site !== 'All' && i?.site !== site) return false
    return true
  })
}

/** Distinct countries present on the records (blank ignored). */
export function recordCountries(records) {
  return [...new Set((records || []).map((r) => r?.country).filter((c) => !blank(c)))]
}

const isRemoved = (r) => !blank(r?.removal_date) || (num(Number(r?.km_at_removal)) != null && Number(r?.km_at_removal) > 0)
const isScrap = (r) => /scrap/i.test(String(r?.category ?? '')) || /scrap/i.test(String(r?.removal_reason ?? '')) || /scrap/i.test(String(r?.status ?? ''))

/**
 * Measure the six benchmarked KPIs for the scoped records + inspections.
 * Returns { values, basis, mixedCurrency }.
 */
export function measureFleet(records, inspections) {
  const recs = Array.isArray(records) ? records : []
  const insp = Array.isArray(inspections) ? inspections : []
  const mixedCurrency = recordCountries(recs).length > 1

  const cpk = computeCpkFleet(recs)
  const life = computeAvgTyreLife(recs)
  const failure = computeFailureRate(recs)
  const pressure = computePressureCompliance(insp)

  const removed = recs.filter(isRemoved)
  const scrapped = removed.filter(isScrap)

  const assets = new Set(recs.map((r) => r?.asset_no || r?.asset_number).filter((a) => !blank(a)))
  const inspected = new Set(insp.map((i) => i?.asset_no).filter((a) => !blank(a) && assets.has(a)))

  const values = {
    cpk: mixedCurrency ? null : num(cpk.fleetAvgCpk),
    tyre_life: life.validCount > 0 ? num(life.avgKm) : null,
    failure_rate: failure.failureRate == null ? null : failure.failureRate * 100,
    pressure_compliance: num(pressure.compliancePct),
    scrap_rate: removed.length ? (scrapped.length / removed.length) * 100 : null,
    inspection_compliance: assets.size ? Math.min(100, (inspected.size / assets.size) * 100) : null,
  }
  const basis = {
    cpk: mixedCurrency
      ? 'Records span more than one country and currency. Pick one country.'
      : `${cpk.validCount} of ${cpk.totalCount} tyres carry both cost and distance`,
    tyre_life: `${life.validCount} removed tyres with fitment and removal km`,
    failure_rate: failure.ratedCount ? `${failure.ratedCount} of ${failure.totalCount} tyres are risk-rated` : 'No tyre is risk-rated yet',
    pressure_compliance: pressure.basis,
    scrap_rate: removed.length ? `${scrapped.length} scrapped of ${removed.length} removed tyres` : 'No removed tyres in the period',
    inspection_compliance: assets.size ? `${inspected.size} of ${assets.size} assets inspected` : 'No assets with tyre records',
  }
  return { values, basis, mixedCurrency }
}

/** Rows for the benchmark table and cards. */
export function benchmarkRows(values, basis = {}) {
  return BENCHMARK_KEYS.map((key) => {
    const b = BENCHMARKS[key]
    const value = num(values?.[key])
    const rating = benchmarkRating(key, value)
    let better = null
    let deltaPct = null
    if (value != null) {
      better = b.higherIsBetter ? value >= b.good : value <= b.good
      deltaPct = b.higherIsBetter
        ? ((value - b.good) / Math.max(0.001, b.good)) * 100
        : ((b.good - value) / Math.max(0.001, b.good)) * 100
    }
    return { key, ...b, value, rating, better, deltaPct, basis: basis[key] || '' }
  })
}

/** Mean score over measured metrics; null when nothing was measured. */
export function overallScore(rows) {
  const scores = (rows || []).map((r) => r.rating?.score).filter((s) => s != null)
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
}

/** Brand CPK ranking (min sample 3), null when currencies are mixed. */
export function brandBenchmarks(records, { minCount = 3, mixedCurrency = false } = {}) {
  if (mixedCurrency) return []
  return computeCpkByBrand(records || [])
    .filter((b) => b.count >= minCount && num(b.avgCpk) != null)
    .map((b) => ({ ...b, rating: benchmarkRating('cpk', b.avgCpk) }))
    .sort((a, b) => a.avgCpk - b.avgCpk)
    .map((b, i) => ({ ...b, rank: i + 1 }))
}

export const RECOMMENDATIONS = Object.freeze({
  cpk: 'Review tyre rotation schedules, improve inflation compliance, and source higher-durability brands for high-wear positions.',
  tyre_life: 'Audit alignment and suspension on high-wear vehicles. Enforce rotation schedules. Consider premium brands for drive positions.',
  failure_rate: 'Investigate root causes of failures. Check for overloading, alignment issues and inflation compliance. Review driver behaviour reports.',
  pressure_compliance: 'Increase inspection frequency, automate pressure monitoring, and train technicians on correct pressure readings.',
  scrap_rate: 'Increase the retreading programme. Remove tyres before they are too worn to retread. Improve maintenance schedules.',
  inspection_compliance: 'Schedule regular inspections for every asset in service. Use the Maintenance Calendar to track them and set reminders.',
})

/** Measured metrics below the Good threshold. */
export function improvementTargets(rows) {
  return (rows || []).filter((r) => r.rating?.score != null && r.rating.score < 75)
}
