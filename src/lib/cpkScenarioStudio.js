/**
 * cpkScenarioStudio.js - pure, no-I/O calc brain for the CPK "Scenario Studio".
 *
 * The CPK Intelligence page already loads the fleet data (get_fleet_cpk). The
 * Scenario Studio is a what-if demonstrator: a user MANUALLY OVERRIDES the km
 * total (and/or the hours total) as a plain number, scales tyre/maintenance costs,
 * excludes assets, and watches CPK recompute; multiple named scenarios can be saved
 * and compared. This file is the deterministic brain behind that UI so the honesty
 * rules (a CPK with no measured denominator is null "N/A", never a fabricated 0;
 * money is one country's currency, never blended) are unit-testable here, out of JSX.
 *
 * Data comes from getFleetCpk().perVehicle:
 *   [{ asset_no, vehicle_type, unit, distance_or_hours, tyre_cost,
 *      maintenance_cost, total_cost, cpk_tyre, cpk_total }]
 * where unit is 'km' or 'engine_hours'. The "km side" is every row whose unit is not
 * 'engine_hours'; the "hours side" is every row whose unit is 'engine_hours'.
 *
 * Pure and deterministic: no DOM, no network, no Date.now(), no Math.random().
 */

/** Finite Number, else null (an unmeasured value is null "N/A", never 0). */
export function num(v) {
  // Number(null) / Number('') are 0, which would hide a missing value as a real
  // zero; treat those (and anything non-finite) as null.
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Percent change of `now` vs `base`; null when it cannot be computed. */
export function pctDelta(now, base) {
  const n = num(now)
  const b = num(base)
  if (n == null || b == null || b === 0) return null
  return ((n - b) / b) * 100
}

/** Clamp a value to a finite number >= 0 (defaults to `dflt` when non-finite). */
function nonNeg(v, dflt = 0) {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return n < 0 ? 0 : n
}

/** cpk = cost / distance, but null when distance <= 0 (honest N/A, never 0). */
function cpkOf(cost, distance) {
  const d = Number(distance)
  if (!Number.isFinite(d) || d <= 0) return null
  const c = Number(cost)
  if (!Number.isFinite(c)) return null
  return c / d
}

/**
 * The default lever set. A UI seeds its state from this.
 * - kmTotalOverride / hoursTotalOverride: a MANUAL total that REPLACES the measured
 *   distance for that side (number). null means "use the measured distance".
 * - tyreCostPct / maintCostPct / tyrePricePct: percentage scalers, default 100.
 * - extraCost: absolute money added to the KM-side total cost.
 * - excludedAssets: asset_no strings removed from BOTH sides.
 */
export const DEFAULT_LEVERS = {
  kmTotalOverride: null,
  hoursTotalOverride: null,
  tyreCostPct: 100,
  maintCostPct: 100,
  extraCost: 0,
  excludedAssets: [],
  tyrePricePct: 100,
}

const isHoursRow = (r) => r?.unit === 'engine_hours'

/** Sum one side's rows into a SIDE view-model (assets carried for exclusion math). */
function summariseSide(rows) {
  const list = Array.isArray(rows) ? rows : []
  let distance = 0
  let tyreCost = 0
  let maintCost = 0
  let totalCost = 0
  const assets = list.map((r) => {
    const d = nonNeg(r?.distance_or_hours)
    const t = nonNeg(r?.tyre_cost)
    const m = nonNeg(r?.maintenance_cost)
    // Trust total_cost when present and finite; else fall back to tyre + maint.
    const rawTotal = Number(r?.total_cost)
    const tot = Number.isFinite(rawTotal) ? rawTotal : t + m
    distance += d
    tyreCost += t
    maintCost += m
    totalCost += tot
    return {
      asset_no: r?.asset_no ?? null,
      vehicle_type: r?.vehicle_type ?? null,
      distance: d,
      tyreCost: t,
      maintCost: m,
      totalCost: nonNeg(tot),
    }
  })
  return {
    distance,
    tyreCost,
    maintCost,
    totalCost,
    cpkTyre: cpkOf(tyreCost, distance),
    cpkTotal: cpkOf(totalCost, distance),
    assetCount: assets.length,
    assets,
  }
}

/**
 * Build the measured baseline from the loaded fleet data. Splits perVehicle into a
 * km side and an hours side, and computes each side's cost totals and CPKs (null
 * when a side has no measured distance).
 *
 * @param {object} args
 * @param {Array}  [args.perVehicle] authoritative per-asset rows (see file header)
 * @param {Array}  [args.byType]     rolled-up per-type rows (unused for maths; accepted for parity)
 * @param {Array}  [args.fleet]      [{ country, currency, km, hours }] - source of the currency label
 * @returns {{ currency:string, km:object, hours:object }}
 */
export function buildBaseline({ perVehicle = [], byType = [], fleet = [] } = {}) {
  const rows = Array.isArray(perVehicle) ? perVehicle : []
  const kmRows = rows.filter((r) => !isHoursRow(r))
  const hoursRows = rows.filter((r) => isHoursRow(r))
  const fleetRow = (Array.isArray(fleet) ? fleet : [])[0] || null
  const currency = fleetRow?.currency || fleetRow?.country || ''
  return {
    currency,
    km: summariseSide(kmRows),
    hours: summariseSide(hoursRows),
  }
}

/**
 * Apply levers to ONE baseline side.
 * @param {object} side       a SIDE from buildBaseline (km or hours)
 * @param {object} opts
 * @param {number|null} opts.override  manual total distance that WINS over the measured remaining distance
 * @param {number} opts.tyreCostPct
 * @param {number} opts.maintCostPct
 * @param {number} opts.tyrePricePct
 * @param {number} opts.extraCost      absolute cost added to totalCost (km side only)
 * @param {Set<string>} opts.excluded  asset_no values to remove
 */
function applyToSide(side, opts) {
  const { override, tyreCostPct, maintCostPct, tyrePricePct, extraCost, excluded } = opts
  const assets = Array.isArray(side?.assets) ? side.assets : []

  // Start from the side totals minus any excluded assets.
  let remainingDistance = 0
  let remainingTyre = 0
  let remainingMaint = 0
  for (const a of assets) {
    if (excluded.has(a.asset_no)) continue
    remainingDistance += nonNeg(a.distance)
    remainingTyre += nonNeg(a.tyreCost)
    remainingMaint += nonNeg(a.maintCost)
  }

  // The MANUAL total wins over the measured remaining distance.
  const distance = Number.isFinite(override) ? nonNeg(override) : remainingDistance

  const tyreCost = remainingTyre * (nonNeg(tyreCostPct, 100) / 100) * (nonNeg(tyrePricePct, 100) / 100)
  const maintCost = remainingMaint * (nonNeg(maintCostPct, 100) / 100)
  const totalCost = tyreCost + maintCost + nonNeg(extraCost)

  return {
    distance,
    tyreCost,
    maintCost,
    totalCost,
    cpkTyre: cpkOf(tyreCost, distance),
    cpkTotal: cpkOf(totalCost, distance),
  }
}

/** Delta of one recomputed side vs its baseline side. Fields are null when N/A. */
function sideDelta(base, now) {
  const baseCpk = num(base?.cpkTotal)
  const nowCpk = num(now?.cpkTotal)
  return {
    cpkTotalAbs: baseCpk == null || nowCpk == null ? null : nowCpk - baseCpk,
    cpkTotalPct: pctDelta(now?.cpkTotal, base?.cpkTotal),
    distanceAbs: num(now?.distance) == null || num(base?.distance) == null
      ? null
      : num(now.distance) - num(base.distance),
    totalCostAbs: num(now?.totalCost) == null || num(base?.totalCost) == null
      ? null
      : num(now.totalCost) - num(base.totalCost),
  }
}

/**
 * Apply the full lever set to a baseline, returning both recomputed sides, the
 * original baseline, and per-side deltas.
 *
 * Lever scope:
 *  - excludedAssets, tyreCostPct, maintCostPct, tyrePricePct apply to BOTH sides.
 *  - kmTotalOverride overrides the km side; hoursTotalOverride overrides the hours side.
 *  - extraCost is added to the KM side total only (a lump-sum add-on for the km demo).
 *
 * @param {object} baseline from buildBaseline
 * @param {object} [levers] partial lever set (merged over DEFAULT_LEVERS)
 * @returns {{ km:object, hours:object, base:object, delta:{ km:object, hours:object } }}
 */
export function applyLevers(baseline, levers = {}) {
  const base = baseline || buildBaseline()
  const L = { ...DEFAULT_LEVERS, ...(levers || {}) }
  const excluded = new Set(Array.isArray(L.excludedAssets) ? L.excludedAssets : [])

  const km = applyToSide(base.km || summariseSide([]), {
    override: L.kmTotalOverride,
    tyreCostPct: L.tyreCostPct,
    maintCostPct: L.maintCostPct,
    tyrePricePct: L.tyrePricePct,
    extraCost: L.extraCost,
    excluded,
  })
  const hours = applyToSide(base.hours || summariseSide([]), {
    override: L.hoursTotalOverride,
    tyreCostPct: L.tyreCostPct,
    maintCostPct: L.maintCostPct,
    tyrePricePct: L.tyrePricePct,
    extraCost: 0, // extraCost is a km-side lump sum only
    excluded,
  })

  return {
    km,
    hours,
    base,
    delta: {
      km: sideDelta(base.km, km),
      hours: sideDelta(base.hours, hours),
    },
  }
}

/**
 * Flatten a baseline plus a list of saved scenarios into comparison rows, one per
 * scenario, with a leading baseline row. Numeric fields are numbers or null; the UI
 * formats them. A scenario is { name, levers }.
 *
 * @param {object} baseline from buildBaseline
 * @param {Array}  [scenarios] [{ name, levers }]
 * @returns {Array<{ name:string, kmDistance:number|null, kmCpkTotal:number|null,
 *   hoursDistance:number|null, hoursCpkTotal:number|null, note:string }>}
 */
export function scenarioRows(baseline, scenarios = []) {
  const base = baseline || buildBaseline()
  const rows = [{
    name: 'Baseline (measured)',
    kmDistance: num(base?.km?.distance),
    kmCpkTotal: num(base?.km?.cpkTotal),
    hoursDistance: num(base?.hours?.distance),
    hoursCpkTotal: num(base?.hours?.cpkTotal),
    note: 'measured',
  }]
  for (const sc of Array.isArray(scenarios) ? scenarios : []) {
    const res = applyLevers(base, sc?.levers || {})
    rows.push({
      name: sc?.name || 'Scenario',
      kmDistance: num(res.km?.distance),
      kmCpkTotal: num(res.km?.cpkTotal),
      hoursDistance: num(res.hours?.distance),
      hoursCpkTotal: num(res.hours?.cpkTotal),
      note: 'what-if',
    })
  }
  return rows
}
