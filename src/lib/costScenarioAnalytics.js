/**
 * Cost Scenario Planner analytics (pure, no I/O, no Supabase).
 *
 * Sits ON TOP of the single cost model in ./costScenario (computeScenarios).
 * This module never re-implements the cost maths: every figure below is
 * produced by calling computeScenarios with adjusted inputs, so the planner's
 * table, its sensitivity view and its exports can never disagree.
 *
 * What it adds:
 *  - validateInputs: honest warnings for inputs that make a result meaningless
 *    (zero tyre life, retread factor >= 1, zero fleet, duplicate names);
 *  - rankScenarios: ordering with delta-to-best and tyre-vs-maintenance mix;
 *  - sensitivity: a one-at-a-time +/- swing per driver on annual cost;
 *  - breakEvenRetreadPct: the retread share at which a scenario matches the
 *    baseline's annual cost (null when it can never match).
 *
 * Money is currency-agnostic: the numbers are in whatever unit the user typed.
 * The page labels them with the active currency and never converts.
 */
import { computeScenarios, SHARED_DEFAULTS } from './costScenario'

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/** Drivers the sensitivity view varies, with the object they live on. */
export const SENSITIVITY_DRIVERS = [
  { key: 'tyre_cost', scope: 'scenario', label: 'Tyre cost' },
  { key: 'tyre_life_km', scope: 'scenario', label: 'Tyre life (km)' },
  { key: 'maintenance_per_tyre_year', scope: 'scenario', label: 'Maintenance per tyre' },
  { key: 'retread_pct', scope: 'scenario', label: 'Retread mix' },
  { key: 'annual_km_per_vehicle', scope: 'shared', label: 'Annual km per vehicle' },
  { key: 'fleet_size', scope: 'shared', label: 'Fleet size' },
]

/**
 * Warnings about inputs. Each item: { level: 'error'|'warning', scope, name, message }.
 * An 'error' means the scenario's CPK or cost cannot be read as a real figure.
 */
export function validateInputs(shared = {}, scenarios = []) {
  const out = []
  const s = { ...SHARED_DEFAULTS, ...shared }
  if (!(num(s.fleet_size) > 0)) out.push({ level: 'error', scope: 'shared', name: 'Fleet', message: 'Fleet size is zero, so every cost is zero.' })
  if (!(num(s.tyres_per_vehicle) > 0)) out.push({ level: 'error', scope: 'shared', name: 'Fleet', message: 'Tyres per vehicle is zero, so every cost is zero.' })
  if (!(num(s.annual_km_per_vehicle) > 0)) out.push({ level: 'error', scope: 'shared', name: 'Fleet', message: 'Annual km is zero, so CPK cannot be measured.' })
  if (!(num(s.horizon_years) >= 1)) out.push({ level: 'warning', scope: 'shared', name: 'Fleet', message: 'Horizon is under 1 year, so there is no cumulative curve.' })
  if (num(s.horizon_years) > 30) out.push({ level: 'warning', scope: 'shared', name: 'Fleet', message: 'Horizon is capped at 30 years.' })
  const seen = new Map()
  ;(Array.isArray(scenarios) ? scenarios : []).forEach((sc, i) => {
    const name = String(sc?.name || '').trim() || `Scenario ${i + 1}`
    const key = name.toLowerCase()
    if (seen.has(key)) out.push({ level: 'warning', scope: 'scenario', name, message: 'Two scenarios share this name, so the charts cannot tell them apart.' })
    seen.set(key, true)
    if (!(num(sc?.tyre_life_km) > 0)) out.push({ level: 'error', scope: 'scenario', name, message: 'Tyre life is zero, so no replacements are costed and CPK reads falsely low.' })
    if (!(num(sc?.tyre_cost) > 0)) out.push({ level: 'warning', scope: 'scenario', name, message: 'Tyre cost is zero.' })
    const pct = num(sc?.retread_pct)
    if (pct != null && (pct < 0 || pct > 100)) out.push({ level: 'warning', scope: 'scenario', name, message: 'Retread mix is outside 0 to 100 and is clamped.' })
    if (pct > 0 && num(sc?.retread_cost_factor) >= 1) out.push({ level: 'warning', scope: 'scenario', name, message: 'Retread cost factor is 1 or more, so retreading saves nothing.' })
  })
  return out
}

/** Rows ranked by annual cost, cheapest first, with delta to best and cost mix. */
export function rankScenarios(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : []
  if (!rows.length) return []
  const best = Math.min(...rows.map((r) => r.annualCost))
  return rows
    .map((r, index) => ({
      ...r,
      index,
      deltaToBest: r.annualCost - best,
      deltaToBestPct: best > 0 ? Math.round(((r.annualCost - best) / best) * 1000) / 10 : null,
      tyreSharePct: r.annualCost > 0 ? Math.round((r.annualTyreCost / r.annualCost) * 1000) / 10 : null,
      costPerVehicleYear: null,
    }))
    .sort((a, b) => a.annualCost - b.annualCost || a.index - b.index)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/** Annual cost per vehicle per year for each row (null when fleet is zero). */
export function withPerVehicle(ranked, shared = {}) {
  const fleet = num({ ...SHARED_DEFAULTS, ...shared }.fleet_size)
  return (ranked || []).map((r) => ({ ...r, costPerVehicleYear: fleet > 0 ? Math.round(r.annualCost / fleet) : null }))
}

function annualFor(shared, scenario) {
  const r = computeScenarios(shared, [scenario])
  return r.rows[0]?.annualCost ?? null
}

/**
 * One-at-a-time sensitivity of a scenario's annual cost. Each driver is moved
 * by -pct and +pct; the swing is the spread between the two results.
 * Sorted by absolute swing, largest first (a tornado order).
 */
export function sensitivity(shared = {}, scenario = {}, { pct = 20 } = {}) {
  const base = annualFor(shared, scenario)
  if (base == null) return { base: null, drivers: [] }
  const f = pct / 100
  const drivers = SENSITIVITY_DRIVERS.map((d) => {
    const src = d.scope === 'shared' ? { ...SHARED_DEFAULTS, ...shared } : scenario
    const v = num(src?.[d.key])
    if (v == null || v === 0) return { ...d, low: null, high: null, swing: null, note: 'Input is zero' }
    const at = (mult) => {
      const nv = d.key === 'retread_pct' ? Math.min(100, Math.max(0, v * mult)) : v * mult
      return d.scope === 'shared'
        ? annualFor({ ...shared, [d.key]: nv }, scenario)
        : annualFor(shared, { ...scenario, [d.key]: nv })
    }
    const low = at(1 - f)
    const high = at(1 + f)
    return { ...d, low: low - base, high: high - base, swing: Math.abs(high - low), note: '' }
  })
  drivers.sort((a, b) => (b.swing ?? -1) - (a.swing ?? -1))
  return { base, drivers }
}

/**
 * Retread share (0-100) at which `scenario` matches `baseline` annual cost,
 * searched in 1-point steps. null when no share in range reaches it, or the
 * scenario is already cheaper at 0% retread (then it returns 0).
 */
export function breakEvenRetreadPct(shared = {}, baseline = {}, scenario = {}) {
  const target = annualFor(shared, baseline)
  if (target == null) return null
  for (let p = 0; p <= 100; p++) {
    const c = annualFor(shared, { ...scenario, retread_pct: p })
    if (c != null && c <= target) return p
  }
  return null
}

/** Flat rows for export. */
export function scenarioExportRows(ranked = [], horizonYears = 0) {
  return (ranked || []).map((r) => ({
    rank: r.rank,
    name: r.name,
    tyres_per_year: r.tyresPerYear,
    effective_cost_per_tyre: r.effectiveCostPerTyre,
    annual_tyre_cost: r.annualTyreCost,
    annual_maintenance: r.annualMaintenance,
    annual_cost: r.annualCost,
    horizon_cost: r.horizonCost,
    cpk: r.cpk,
    delta_to_best: r.deltaToBest,
    savings_vs_baseline: r.isBaseline ? '' : r.savingsVsBaselineHorizon,
    horizon_years: horizonYears,
    role: [r.isBest ? 'Best' : '', r.isBaseline ? 'Baseline' : ''].filter(Boolean).join(', '),
  }))
}
