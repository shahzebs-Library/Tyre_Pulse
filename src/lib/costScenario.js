/**
 * Cost Scenario Planner model — pure, currency-agnostic. An executive what-if
 * engine that compares several tyre-strategy scenarios (e.g. Premium new, Budget
 * new, Retread-heavy mix) side by side over a planning horizon. For each
 * scenario it projects the annual tyre spend, blended maintenance, total annual
 * cost, cost-per-km (CPK), tyres consumed per year and a cumulative spend curve,
 * then ranks scenarios against a baseline to surface the lowest-cost strategy
 * and its savings.
 *
 * All money is raw numbers; callers format with the active currency. Every
 * output is null-safe on empty / garbage input.
 *
 * (Cost model ported from tyre_saas's Cost Scenario Planner + Retread ROI
 * calculator — retread blends the effective replacement cost via a cost factor.)
 */

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

const round = (n) => Math.round(n)

// Shared fleet scope applied to every scenario.
export const SHARED_DEFAULTS = {
  fleet_size: 50, // vehicles
  tyres_per_vehicle: 6,
  annual_km_per_vehicle: 70000,
  horizon_years: 5,
}

// Sensible executive presets. Each scenario is a distinct tyre strategy.
export const DEFAULT_SCENARIOS = [
  {
    name: 'Premium new',
    tyre_cost: 1800,
    tyre_life_km: 120000,
    retread_pct: 0,
    retread_cost_factor: 0.45,
    maintenance_per_tyre_year: 40,
  },
  {
    name: 'Budget new',
    tyre_cost: 1100,
    tyre_life_km: 75000,
    retread_pct: 0,
    retread_cost_factor: 0.45,
    maintenance_per_tyre_year: 60,
  },
  {
    name: 'Retread-heavy mix',
    tyre_cost: 1600,
    tyre_life_km: 105000,
    retread_pct: 55,
    retread_cost_factor: 0.45,
    maintenance_per_tyre_year: 50,
  },
]

/**
 * Build a blank scenario (used by the UI "add scenario" action).
 * @param {string} [name]
 */
export function blankScenario(name = 'New scenario') {
  return {
    name,
    tyre_cost: 1400,
    tyre_life_km: 90000,
    retread_pct: 0,
    retread_cost_factor: 0.45,
    maintenance_per_tyre_year: 50,
  }
}

const clampPct = (v) => Math.min(100, Math.max(0, num(v)))

/**
 * Compute a single scenario against the shared fleet scope.
 * @returns {object} per-scenario cost model
 */
function computeOne(shared, scenario) {
  const fleetSize = Math.max(0, num(shared.fleet_size))
  const tyresPerVehicle = Math.max(0, num(shared.tyres_per_vehicle))
  const annualKmPerVehicle = Math.max(0, num(shared.annual_km_per_vehicle))
  const horizon = Math.min(30, Math.max(0, Math.round(num(shared.horizon_years))))

  const tyreCost = Math.max(0, num(scenario.tyre_cost))
  const tyreLifeKm = num(scenario.tyre_life_km)
  const retreadPct = clampPct(scenario.retread_pct)
  const retreadFactor = Math.max(0, num(scenario.retread_cost_factor))
  const maintPerTyreYear = Math.max(0, num(scenario.maintenance_per_tyre_year))

  const totalTyres = fleetSize * tyresPerVehicle
  const fleetAnnualKm = fleetSize * annualKmPerVehicle

  // Tyre replacements per year: each installed tyre wears out every tyre_life_km
  // of vehicle travel. Fleet-wide = total tyres × (annual km / life).
  const tyresPerYear = tyreLifeKm > 0
    ? totalTyres * (annualKmPerVehicle / tyreLifeKm)
    : 0

  // Retread blends the effective replacement cost: the retread share is bought
  // at tyre_cost × retread_cost_factor, the rest at full new-tyre cost.
  const p = retreadPct / 100
  const effectiveCostPerTyre = tyreCost * ((1 - p) + p * retreadFactor)

  const annualTyreCost = tyresPerYear * effectiveCostPerTyre
  const annualMaintenance = totalTyres * maintPerTyreYear
  const annualCost = annualTyreCost + annualMaintenance

  const cpk = fleetAnnualKm > 0 ? annualCost / fleetAnnualKm : 0

  // Cumulative spend curve over the planning horizon (linear per year).
  const cumulative = []
  let running = 0
  for (let y = 1; y <= horizon; y++) {
    running += annualCost
    cumulative.push({ year: `Year ${y}`, value: round(running) })
  }

  const horizonCost = annualCost * horizon

  return {
    name: typeof scenario.name === 'string' && scenario.name.trim()
      ? scenario.name.trim()
      : 'Scenario',
    tyresPerYear: Number(tyresPerYear.toFixed(1)),
    effectiveCostPerTyre: round(effectiveCostPerTyre),
    annualTyreCost: round(annualTyreCost),
    annualMaintenance: round(annualMaintenance),
    annualCost: round(annualCost),
    horizonCost: round(horizonCost),
    cpk: Number(cpk.toFixed(4)),
    retreadPct: round(retreadPct),
    cumulative,
    // raw (unrounded) fields for precise ranking
    _annualCost: annualCost,
    _horizonCost: horizonCost,
  }
}

/**
 * Compare a set of scenarios over the shared fleet horizon.
 * @param {object} shared partial overrides of SHARED_DEFAULTS
 * @param {Array<object>} scenarios list of scenario input objects
 * @returns {{ rows: object[], baselineName: string|null, bestName: string|null,
 *   savingsVsBaseline: number, savingsVsBaselinePct: number, horizonYears: number }}
 */
export function computeScenarios(shared = {}, scenarios = []) {
  const mergedShared = {}
  for (const k of Object.keys(SHARED_DEFAULTS)) {
    mergedShared[k] = shared[k] ?? SHARED_DEFAULTS[k]
  }
  const horizonYears = Math.min(30, Math.max(0, Math.round(num(mergedShared.horizon_years))))

  const list = Array.isArray(scenarios) ? scenarios : []
  const computed = list.map((s) => computeOne(mergedShared, s || {}))

  if (computed.length === 0) {
    return {
      rows: [],
      baselineName: null,
      bestName: null,
      savingsVsBaseline: 0,
      savingsVsBaselinePct: 0,
      horizonYears,
    }
  }

  // Baseline = first scenario. Best = lowest annual cost.
  const baseline = computed[0]
  const baselineName = baseline.name

  let best = computed[0]
  for (const c of computed) {
    if (c._annualCost < best._annualCost) best = c
  }
  const bestName = best.name

  const rows = computed.map((c) => {
    const savingsVsBaselineAnnual = baseline._annualCost - c._annualCost
    const savingsVsBaselineHorizon = baseline._horizonCost - c._horizonCost
    const savingsPct = baseline._annualCost > 0
      ? (savingsVsBaselineAnnual / baseline._annualCost) * 100
      : 0
    return {
      name: c.name,
      tyresPerYear: c.tyresPerYear,
      effectiveCostPerTyre: c.effectiveCostPerTyre,
      annualTyreCost: c.annualTyreCost,
      annualMaintenance: c.annualMaintenance,
      annualCost: c.annualCost,
      horizonCost: c.horizonCost,
      cpk: c.cpk,
      retreadPct: c.retreadPct,
      cumulative: c.cumulative,
      isBaseline: c === baseline,
      isBest: c === best,
      savingsVsBaselineAnnual: round(savingsVsBaselineAnnual),
      savingsVsBaselineHorizon: round(savingsVsBaselineHorizon),
      savingsVsBaselinePct: Number(savingsPct.toFixed(1)),
    }
  })

  // Top-level savings = best strategy vs baseline, over the full horizon.
  const savingsVsBaseline = round(baseline._horizonCost - best._horizonCost)
  const savingsVsBaselinePct = baseline._annualCost > 0
    ? Number((((baseline._annualCost - best._annualCost) / baseline._annualCost) * 100).toFixed(1))
    : 0

  return {
    rows,
    baselineName,
    bestName,
    savingsVsBaseline,
    savingsVsBaselinePct,
    horizonYears,
  }
}
