/**
 * fleetRiskScoreAnalytics - pure presentation engine behind the Fleet Risk
 * Score page (/fleet-risk-score). It does NOT score anything: every safety
 * score comes from `src/lib/fleetRisk.js` (scoreTyres / rollupVehicles /
 * summarizeTyreRisk), which stays the single home of the maths. This module
 * filters those scored rows and states how much of each score rests on real
 * measurements.
 *
 * Why the evidence view matters: fleetRisk imputes a neutral default when a
 * factor is missing (tread 50, pressure 60, age 60, km 80, inspection 40). A
 * tyre with nothing recorded still gets a score, and it looks exactly like a
 * measured one. `measuredFactors` counts the inputs that were real so the page
 * can mark a score "estimated" instead of letting defaults pose as data.
 *
 * No I/O, no React.
 */
import { RISK_LEVELS } from './fleetRisk'

/** Factors fleetRisk can measure from tyre_records (inspection has no source). */
export const MEASURABLE_FACTORS = ['tread', 'pressure', 'age', 'km']

/** Measured inputs behind one scored tyre row. */
export function measuredFactors(row) {
  const has = {
    tread: row?.tread_depth != null && Number.isFinite(Number(row.tread_depth)),
    pressure: row?.pressure_reading != null && Number.isFinite(Number(row.pressure_reading)),
    age: row?.age_years != null && Number.isFinite(Number(row.age_years)),
    km: row?.km != null && Number(row.km) > 0,
  }
  const count = MEASURABLE_FACTORS.filter((k) => has[k]).length
  return { ...has, count, of: MEASURABLE_FACTORS.length }
}

/** 'measured' (3-4 real inputs), 'partial' (1-2) or 'estimated' (0). */
export function evidenceLevel(row) {
  const { count } = measuredFactors(row)
  if (count >= 3) return 'measured'
  if (count >= 1) return 'partial'
  return 'estimated'
}

export const EVIDENCE_LABELS = { measured: 'Measured', partial: 'Partial', estimated: 'Estimated' }

/**
 * Filter scored tyre rows.
 * @param {{ band?:string, site?:string, brand?:string, evidence?:string, search?:string }} f
 */
export function filterTyreRows(rows, f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.band && f.band !== 'all' && r.risk_level !== f.band) return false
    if (f.site && r.site !== f.site) return false
    if (f.brand && r.brand !== f.brand) return false
    if (f.evidence && evidenceLevel(r) !== f.evidence) return false
    if (q) {
      const hay = [r.serial, r.asset_no, r.brand, r.size, r.position, r.site].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Filter vehicle roll-up rows. */
export function filterVehicleRows(rows, f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.band && f.band !== 'all' && r.vehicle_risk_level !== f.band) return false
    if (f.site && r.site !== f.site) return false
    if (q && !`${r.asset_no || ''} ${r.site || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

/** Share of scored tyres that carry each measurable input. */
export function evidenceCoverage(rows) {
  const list = Array.isArray(rows) ? rows : []
  const n = list.length
  const pct = (k) => (n ? Math.round((list.filter((r) => measuredFactors(r)[k]).length / n) * 1000) / 10 : null)
  const levels = { measured: 0, partial: 0, estimated: 0 }
  for (const r of list) levels[evidenceLevel(r)] += 1
  return {
    total: n,
    tread: pct('tread'),
    pressure: pct('pressure'),
    age: pct('age'),
    km: pct('km'),
    levels,
    // Share of scores resting on at least 3 real inputs; null with nothing scored.
    measuredShare: n ? Math.round((levels.measured / n) * 1000) / 10 : null,
  }
}

/** Per-site roll-up: tyre count, average score, and critical+high count. Worst first. */
export function siteRiskRollup(rows) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = r?.site || 'Unassigned'
    const g = map.get(key) || { site: key, tyres: 0, sum: 0, critical: 0, high: 0 }
    g.tyres += 1
    g.sum += Number(r.risk_score) || 0
    if (r.risk_level === 'critical') g.critical += 1
    if (r.risk_level === 'high') g.high += 1
    map.set(key, g)
  }
  return [...map.values()]
    .map((g) => ({
      site: g.site, tyres: g.tyres, critical: g.critical, high: g.high,
      averageScore: g.tyres ? Math.round((g.sum / g.tyres) * 10) / 10 : null,
      atRiskShare: g.tyres ? Math.round(((g.critical + g.high) / g.tyres) * 1000) / 10 : null,
    }))
    .sort((a, b) => (a.averageScore ?? Infinity) - (b.averageScore ?? Infinity) || a.site.localeCompare(b.site))
}

/** Band counts in canonical order, for charts and tiles. */
export function bandCounts(rows, key = 'risk_level') {
  const counts = Object.fromEntries(RISK_LEVELS.map((l) => [l, 0]))
  for (const r of Array.isArray(rows) ? rows : []) if (counts[r?.[key]] != null) counts[r[key]] += 1
  return counts
}

/** Fleet average, null (not 0) when nothing has been scored. */
export function fleetAverage(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return null
  return Math.round((list.reduce((a, r) => a + (Number(r.risk_score) || 0), 0) / list.length) * 10) / 10
}
