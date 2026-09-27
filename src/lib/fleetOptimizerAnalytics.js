/**
 * fleetOptimizerAnalytics - pure presentation engine for the Fleet Optimizer
 * page (/fleet-optimizer). Sits on the right-sizing primitives in
 * ./fleetOptimizer.js (costPerKm, suggestRecommendation) and adds what the page
 * used to compute inline: filtering, register enrichment, a currency-honest KPI
 * strip, the suggested-vs-recorded disagreement queue, utilisation bands and
 * the export shape.
 *
 * Honesty rules:
 *   - Average utilisation is null when no scenario records one (never 0%).
 *   - Projected savings in different currencies are never added together; the
 *     headline is null and the per-currency split is returned instead.
 *
 * No I/O, no React.
 */
import { toFiniteNumber, costPerKm, suggestRecommendation } from './fleetOptimizer'

export const REC_KEYS = ['keep', 'replace', 'redeploy', 'dispose', 'review']
export const REC_LABELS = { keep: 'Keep', replace: 'Replace', redeploy: 'Redeploy', dispose: 'Dispose', review: 'Review' }
export const CONFIDENCE_KEYS = ['high', 'medium', 'low']

export const UTIL_BANDS = [
  { key: 'idle', label: 'Under 40%', min: -Infinity, max: 40 },
  { key: 'low', label: '40 to 60%', min: 40, max: 60 },
  { key: 'ok', label: '60 to 80%', min: 60, max: 80 },
  { key: 'high', label: '80% and over', min: 80, max: Infinity },
]

const str = (v) => (v == null ? '' : String(v))

export function recLabel(key) {
  return REC_LABELS[key] || (key ? String(key) : 'N/A')
}

export function filterScenarios(rows = [], { rec = '', confidence = '', country = '', band = '', mismatchOnly = false, search = '' } = {}) {
  const q = str(search).trim().toLowerCase()
  const bandDef = band ? UTIL_BANDS.find((b) => b.key === band) : null
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (band === 'unknown' && toFiniteNumber(r?.utilization_pct) != null) return false
    if (bandDef) {
      const u = toFiniteNumber(r?.utilization_pct)
      if (u == null || u < bandDef.min || u >= bandDef.max) return false
    }
    if (rec && r?.recommendation !== rec) return false
    if (confidence && r?.confidence !== confidence) return false
    if (country && r?.country !== country) return false
    if (mismatchOnly && !isMismatch(r)) return false
    if (q) {
      const hay = [r?.asset_no, r?.scenario_name, r?.asset_type, r?.rationale, r?.notes].map(str).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Recorded decision disagrees with the data-driven suggestion. */
export function isMismatch(r) {
  return Boolean(r?.recommendation) && suggestRecommendation(r) !== r.recommendation
}

export function enrichScenarios(rows = [], fallbackCurrency = '') {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const suggested = suggestRecommendation(r)
    return {
      ...r,
      util: toFiniteNumber(r?.utilization_pct),
      km: toFiniteNumber(r?.annual_km),
      cost: toFiniteNumber(r?.annual_cost),
      cpk: costPerKm(r),
      age: toFiniteNumber(r?.age_years),
      downtime: toFiniteNumber(r?.downtime_days),
      saving: toFiniteNumber(r?.projected_saving),
      resale: toFiniteNumber(r?.resale_value),
      cur: str(r?.currency).trim() || fallbackCurrency || '',
      suggested,
      mismatch: Boolean(r?.recommendation) && suggested !== r.recommendation,
    }
  })
}

/** Sum a money field per currency; headline only when one currency is present. */
export function moneyByCurrency(rows = [], field, fallbackCurrency = '') {
  const map = new Map()
  let counted = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const v = toFiniteNumber(r?.[field])
    if (v == null) continue
    counted += 1
    const cur = str(r?.currency).trim() || fallbackCurrency || 'Unspecified'
    map.set(cur, (map.get(cur) || 0) + v)
  }
  const totals = [...map.entries()].map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total)
  return {
    totals,
    counted,
    mixed: totals.length > 1,
    total: totals.length === 1 ? totals[0].total : null,
    currency: totals.length === 1 ? totals[0].currency : null,
  }
}

export function utilisationBands(rows = []) {
  const bands = UTIL_BANDS.map((b) => ({ ...b, count: 0 }))
  let unknown = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const u = toFiniteNumber(r?.utilization_pct)
    if (u == null) { unknown += 1; continue }
    const band = bands.find((b) => u >= b.min && u < b.max)
    if (band) band.count += 1
  }
  return { bands, unknown }
}

/** Recorded vs suggested counts per recommendation, for the comparison panel. */
export function recommendationMatrix(rows = []) {
  const out = REC_KEYS.map((k) => ({ key: k, label: REC_LABELS[k], recorded: 0, suggested: 0 }))
  const idx = Object.fromEntries(out.map((o, i) => [o.key, i]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const rec = REC_KEYS.includes(r?.recommendation) ? r.recommendation : 'review'
    out[idx[rec]].recorded += 1
    out[idx[suggestRecommendation(r)]].suggested += 1
  }
  return out
}

export function buildOptimizerKpis(rows = [], fallbackCurrency = '') {
  const list = Array.isArray(rows) ? rows : []
  const counts = Object.fromEntries(REC_KEYS.map((k) => [k, 0]))
  let utilSum = 0
  let utilN = 0
  let idle = 0
  let mismatches = 0
  for (const r of list) {
    const rec = REC_KEYS.includes(r?.recommendation) ? r.recommendation : 'review'
    counts[rec] += 1
    const u = toFiniteNumber(r?.utilization_pct)
    if (u != null) { utilSum += u; utilN += 1; if (u < 40) idle += 1 }
    if (isMismatch(r)) mismatches += 1
  }
  return {
    total: list.length,
    counts,
    avgUtilization: utilN ? utilSum / utilN : null,
    utilCoverage: list.length ? utilN / list.length : null,
    idle,
    mismatches,
    saving: moneyByCurrency(list, 'projected_saving', fallbackCurrency),
    annualCost: moneyByCurrency(list, 'annual_cost', fallbackCurrency),
  }
}

export function buildOptimizerInsights(rows = [], fallbackCurrency = '') {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []
  const k = buildOptimizerKpis(list, fallbackCurrency)
  const out = []
  if (k.mismatches) out.push(`${k.mismatches} recorded decision(s) disagree with the utilisation, age and downtime model. Review those first.`)
  if (k.idle) out.push(`${k.idle} asset(s) run under 40% utilisation and are candidates to redeploy or dispose.`)
  const noSignal = list.filter((r) => suggestRecommendation(r) === 'review').length
  if (noSignal) out.push(`${noSignal} scenario(s) have no utilisation, age or downtime recorded, so no suggestion can be made.`)
  if (k.saving.mixed) out.push(`Projected savings are recorded in ${k.saving.totals.length} currencies, so no single total is shown.`)
  if (k.utilCoverage != null && k.utilCoverage < 1) out.push(`${list.length - Math.round(k.utilCoverage * list.length)} scenario(s) have no utilisation, so the average excludes them.`)
  return out
}

export const OPTIMIZER_EXPORT_COLUMNS = [
  { key: 'asset_no', header: 'Asset' },
  { key: 'asset_type', header: 'Type' },
  { key: 'utilization_pct', header: 'Utilisation %' },
  { key: 'annual_km', header: 'Annual km' },
  { key: 'annual_cost', header: 'Annual cost' },
  { key: 'cost_per_km', header: 'Cost/km' },
  { key: 'downtime_days', header: 'Downtime days' },
  { key: 'age_years', header: 'Age (yrs)' },
  { key: 'resale_value', header: 'Resale value' },
  { key: 'recommendation', header: 'Recommendation' },
  { key: 'suggested', header: 'Suggested' },
  { key: 'projected_saving', header: 'Projected saving' },
  { key: 'confidence', header: 'Confidence' },
  { key: 'currency', header: 'Currency' },
  { key: 'scenario_name', header: 'Scenario' },
]

export function optimizerExportRows(rows = [], fallbackCurrency = '') {
  return enrichScenarios(rows, fallbackCurrency).map((r) => ({
    asset_no: r.asset_no || '',
    asset_type: r.asset_type || '',
    utilization_pct: r.util ?? '',
    annual_km: r.km ?? '',
    annual_cost: r.cost ?? '',
    cost_per_km: r.cpk == null ? '' : Math.round(r.cpk * 100) / 100,
    downtime_days: r.downtime ?? '',
    age_years: r.age ?? '',
    resale_value: r.resale ?? '',
    recommendation: r.recommendation ? recLabel(r.recommendation) : '',
    suggested: recLabel(r.suggested),
    projected_saving: r.saving ?? '',
    confidence: r.confidence || '',
    currency: r.cur,
    scenario_name: r.scenario_name || '',
  }))
}
