/**
 * Total Cost of Ownership (TCO) model — pure, currency-agnostic. An executive
 * what-if engine that projects the lifetime cost of running a fleet of vehicles
 * over an ownership period, decomposed into capital depreciation, fuel,
 * maintenance, tyres, insurance and downtime, then reduced by the recovered
 * residual value. Returns fleet + per-vehicle totals, a cost breakdown[], a
 * per-year projection[], cost-per-km and net/residual figures.
 *
 * All money is raw numbers; callers format with the active currency. Every
 * output is null-safe on empty / garbage input.
 *
 * (Cost model ported from FleetIQ's TCO calculator — fuel, maintenance, tyre
 * and downtime components — extended into a full ownership what-if with
 * depreciation and residual recovery.)
 */

export const TCO_DEFAULTS = {
  // Fleet scope
  vehicle_count: 25,
  ownership_years: 5,
  annual_km: 60000, // per vehicle
  // Capital
  purchase_price: 320000, // per vehicle
  residual_value_pct: 30, // % of purchase price recovered at end of life
  // Fuel
  fuel_price: 3.2, // per litre
  fuel_consumption: 28, // litres per 100 km
  // Maintenance
  maintenance_per_year: 12000, // per vehicle, excl. tyres
  // Tyres
  tyres_per_vehicle: 6,
  tyre_cost: 1400, // each
  tyre_life_km: 90000,
  // Insurance
  insurance_per_year: 9000, // per vehicle
  // Downtime
  downtime_days_per_year: 8, // per vehicle
  downtime_cost_per_day: 1500,
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

const round = (n) => Math.round(n)

/**
 * @param {object} rawInputs partial overrides of TCO_DEFAULTS
 * @returns {object} fleet + per-vehicle totals, breakdown[], projection[], KPIs
 */
export function computeTco(rawInputs = {}) {
  const f = {}
  for (const k of Object.keys(TCO_DEFAULTS)) f[k] = num(rawInputs[k] ?? TCO_DEFAULTS[k])

  const vehicles = Math.max(0, f.vehicle_count)
  const years = Math.max(0, f.ownership_years)

  // Distance over the ownership period.
  const kmPerVehicleLifetime = f.annual_km * years
  const fleetLifetimeKm = kmPerVehicleLifetime * vehicles

  // --- Capital / depreciation (per vehicle over life) ---
  const residualPerVehicle = f.purchase_price * (Math.min(100, Math.max(0, f.residual_value_pct)) / 100)
  const depreciationPerVehicle = f.purchase_price - residualPerVehicle

  // --- Operating components (per vehicle, per year) ---
  const fuelPerYear = (f.annual_km / 100) * f.fuel_consumption * f.fuel_price
  const maintenancePerYear = f.maintenance_per_year
  const tyresPerYear = f.tyre_life_km > 0
    ? (f.annual_km / f.tyre_life_km) * f.tyres_per_vehicle * f.tyre_cost
    : 0
  const insurancePerYear = f.insurance_per_year
  const downtimePerYear = f.downtime_days_per_year * f.downtime_cost_per_day

  const operatingPerVehiclePerYear =
    fuelPerYear + maintenancePerYear + tyresPerYear + insurancePerYear + downtimePerYear

  // --- Fleet-wide lifetime totals per component ---
  const depreciation = depreciationPerVehicle * vehicles
  const fuel = fuelPerYear * years * vehicles
  const maintenance = maintenancePerYear * years * vehicles
  const tyres = tyresPerYear * years * vehicles
  const insurance = insurancePerYear * years * vehicles
  const downtime = downtimePerYear * years * vehicles

  const totalTco = depreciation + fuel + maintenance + tyres + insurance + downtime

  // --- Derived figures ---
  const residualValue = residualPerVehicle * vehicles
  const grossCapital = f.purchase_price * vehicles
  const tcoPerVehicle = vehicles > 0 ? totalTco / vehicles : 0
  const tcoPerYear = years > 0 ? totalTco / years : 0
  const costPerKm = fleetLifetimeKm > 0 ? totalTco / fleetLifetimeKm : 0
  const costPerVehicleKm = kmPerVehicleLifetime > 0 ? tcoPerVehicle / kmPerVehicleLifetime : 0

  const breakdown = [
    { name: 'Depreciation', value: round(depreciation) },
    { name: 'Fuel', value: round(fuel) },
    { name: 'Maintenance', value: round(maintenance) },
    { name: 'Tyres', value: round(tyres) },
    { name: 'Insurance', value: round(insurance) },
    { name: 'Downtime', value: round(downtime) },
  ].filter((b) => b.value > 0)

  // Per-year cumulative projection (depreciation amortised linearly).
  const depreciationPerYear = years > 0 ? depreciation / years : 0
  const operatingFleetPerYear = operatingPerVehiclePerYear * vehicles
  const projection = []
  const yearCount = Math.min(30, Math.max(0, Math.round(years)))
  let cumulative = 0
  for (let y = 1; y <= yearCount; y++) {
    const annual = operatingFleetPerYear + depreciationPerYear
    cumulative += annual
    projection.push({
      year: `Year ${y}`,
      operating: round(operatingFleetPerYear),
      depreciation: round(depreciationPerYear),
      annual: round(annual),
      cumulative: round(cumulative),
    })
  }

  return {
    // scope
    vehicles: round(vehicles),
    ownershipYears: round(years),
    fleetLifetimeKm: round(fleetLifetimeKm),
    kmPerVehicleLifetime: round(kmPerVehicleLifetime),
    // totals
    totalTco: round(totalTco),
    tcoPerVehicle: round(tcoPerVehicle),
    tcoPerYear: round(tcoPerYear),
    // KPIs
    costPerKm: Number(costPerKm.toFixed(4)),
    costPerVehicleKm: Number(costPerVehicleKm.toFixed(4)),
    // capital / residual
    grossCapital: round(grossCapital),
    residualValue: round(residualValue),
    netCapital: round(grossCapital - residualValue),
    // components
    depreciation: round(depreciation),
    fuel: round(fuel),
    maintenance: round(maintenance),
    tyres: round(tyres),
    insurance: round(insurance),
    downtime: round(downtime),
    breakdown,
    projection,
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * FLEET ACTUALS ENGINE — real-data TCO from tyre_records + vehicle_fleet.
 *
 * Ported VERBATIM from tyre_saas backend/routes/tco_calculator.py, adapted to
 * this app's flat `tyre_records` columns. Unlike computeTco() above (a what-if
 * projection the user drives with inputs), this derives actual spend and
 * cost-per-km from recorded tyre procurement and odometer stints — no fabricated
 * numbers. Money is raw; callers format with the active currency.
 *
 * Honest scope: only TYRE procurement is a real cost here. Labour, fuel and
 * depreciation have NO per-asset source columns in this dataset, so they are
 * omitted (not estimated) on the actuals side — depreciation/fuel/labour stay in
 * the what-if calculator. Savings-potential uses the same GCC assumption
 * constants as the original engine, applied to REAL fleet/tyre counts.
 *
 * CPK note: the canonical fleet CPK number is computed by the Engineering-KPI
 * engine (src/lib/kpiEngine.js `computeCpkFleet`, mean of per-record cpk). The
 * per-asset cost_per_km here is an ASSET-level drill-down (Σ tyre cost ÷ Σ km),
 * consistent with — but coarser than — that canonical per-record figure. This
 * module never re-implements the fleet-CPK headline; the page reads it from
 * kpiEngine.
 * ─────────────────────────────────────────────────────────────────────────── */

/** GCC industry assumption constants (from tco_calculator.py DEFAULT_ASSUMPTIONS). */
export const TCO_ASSUMPTIONS = {
  avg_tyre_cost: 850, // AED — fallback when no recorded cost_per_tyre exists
  fuel_price: 2.89, // AED / litre — used only by the pressure/TPMS savings formula
}

/** Static GCC TCO benchmarks (AED/km) by vehicle type, keyed by a match pattern. */
export const GCC_TCO_BENCHMARKS = [
  { type: 'Light Commercial Van', costPerKm: 0.85, match: /van|lcv|pickup|light/i },
  { type: 'Rigid Truck 7.5T', costPerKm: 1.45, match: /rigid|7\.?5\s?t|medium/i },
  { type: 'Semi-Trailer 40T', costPerKm: 2.10, match: /semi|trailer|artic|40\s?t|prime/i },
  { type: 'City Bus', costPerKm: 3.50, match: /bus|coach|transit/i },
  { type: 'Construction', costPerKm: 5.20, match: /construct|excavat|loader|dozer|dumper|off-?road/i },
]

/** CPK performance bands as ratio-to-reference ceilings (from tco_engine.py CPKM_BANDS). */
export const CPK_BANDS = [
  ['excellent', 0.80],
  ['good', 1.00],
  ['average', 1.20],
  ['poor', 1.50],
]

// Null-distinct numeric coercion (the module's `num` above returns 0 for junk,
// which would hide "no data" — here we must tell 0 apart from missing).
const nn = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const round3 = (n) => (n == null ? null : Math.round(n * 1000) / 1000)
const clamp = (min, max, v) => Math.min(max, Math.max(min, v))
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0)
const monthKey = (d) => {
  if (!d) return null
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}
const groupBy = (arr, keyFn) =>
  arr.reduce((acc, item) => {
    const k = keyFn(item) ?? 'Unknown'
    ;(acc[k] ||= []).push(item)
    return acc
  }, {})

/** Recorded tyre spend for one record: cost_per_tyre × qty (when qty > 0). */
export function recordTyreCost(r) {
  const cost = nn(r?.cost_per_tyre) ?? 0
  const qty = nn(r?.qty)
  return qty != null && qty > 0 ? cost * qty : cost
}

/** Full km for one record: the fitment→removal stint when valid, else total_km. */
export function recordKm(r) {
  const fit = nn(r?.km_at_fitment)
  const rem = nn(r?.km_at_removal)
  if (fit != null && rem != null && rem > fit) return rem - fit
  const tk = nn(r?.total_km)
  return tk != null && tk > 0 ? tk : 0
}

/** Stint-only km (used for monthly CPK, where total_km can't be attributed to a month). */
function recordStintKm(r) {
  const fit = nn(r?.km_at_fitment)
  const rem = nn(r?.km_at_removal)
  return fit != null && rem != null && rem > fit ? rem - fit : 0
}

const isScrapped = (r) =>
  /scrap/i.test(String(r?.status ?? '')) || /scrap/i.test(String(r?.category ?? ''))

const isActiveVehicle = (v) => {
  if (typeof v?.is_active === 'boolean') return v.is_active
  const s = String(v?.status ?? '').toLowerCase()
  if (!s) return true // no status field → assume in-service (honest default for count)
  return /active|in.?service|operational|running/.test(s) && !/inactive|disposed|sold|scrap/.test(s)
}

/**
 * Per-asset actual TCO. Groups records by asset_no; each asset gets total tyre
 * procurement, total km, and asset-level cost_per_km (rounded 3dp, km>0 guarded
 * → null). Sorted by tyre_procurement (TCO) descending.
 * @param {object[]} records tyre_records rows
 * @param {{vehicleTypeByAsset?:Record<string,string>}} [opts]
 */
export function computeAssetsActualTco(records = [], { vehicleTypeByAsset = {} } = {}) {
  const groups = groupBy((records || []).filter(Boolean), (r) => r.asset_no ?? 'Unknown')
  return Object.entries(groups)
    .map(([asset_no, rows]) => {
      const tyre_procurement = rows.reduce((s, r) => s + recordTyreCost(r), 0)
      const km = rows.reduce((s, r) => s + recordKm(r), 0)
      const cost_per_km = km > 0 ? round3(tyre_procurement / km) : null
      return {
        asset_no,
        vehicle_type: vehicleTypeByAsset[asset_no] ?? null,
        tyre_procurement: Math.round(tyre_procurement),
        km: Math.round(km),
        cost_per_km,
        tyre_count: rows.length,
      }
    })
    .sort((a, b) => b.tyre_procurement - a.tyre_procurement)
}

/**
 * Fleet rollup across per-asset rows: total TCO, total km, blended
 * fleet_cost_per_km (total/total), and fleet_avg_cpkm (mean of per-asset cpk —
 * the reference used for the percentile/band drill-down).
 */
export function computeFleetActualRollup(assets = []) {
  const total_tco = assets.reduce((s, a) => s + (a.tyre_procurement || 0), 0)
  const total_km = assets.reduce((s, a) => s + (a.km || 0), 0)
  const cpks = assets.filter((a) => a.cost_per_km != null).map((a) => a.cost_per_km)
  return {
    total_tco: Math.round(total_tco),
    total_km: Math.round(total_km),
    fleet_cost_per_km: total_km > 0 ? round3(total_tco / total_km) : null,
    fleet_avg_cpkm: cpks.length ? round3(mean(cpks)) : null,
    asset_count: assets.length,
    assets_with_cpk: cpks.length,
  }
}

/**
 * Peer percentile for an asset's cpk vs the fleet average (higher = cheaper than
 * peers). clamp(1, 99, round(50 + (avg − cpk)/avg × 50)). null when unknown.
 */
export function cpkPercentile(cpk, fleetAvg) {
  if (cpk == null || fleetAvg == null || fleetAvg <= 0) return null
  return clamp(1, 99, Math.round(50 + ((fleetAvg - cpk) / fleetAvg) * 50))
}

/** Performance band from cpk vs a reference (fleet avg). null when unknown. */
export function cpkBand(cpk, ref) {
  if (cpk == null || ref == null || ref <= 0) return null
  const ratio = cpk / ref
  for (const [band, ceiling] of CPK_BANDS) if (ratio <= ceiling) return band
  return 'critical'
}

/**
 * Monthly CPK trend. Buckets tyre spend by YYYY-MM of removal_date (falling back
 * to issue_date); month km is the sum of that month's fitment→removal stints
 * only. cpk is null ('—') when the month has spend but no attributable km.
 */
export function computeMonthlyActualCpk(records = []) {
  const buckets = {}
  for (const r of (records || []).filter(Boolean)) {
    const key = monthKey(r.removal_date || r.issue_date)
    if (!key) continue
    ;(buckets[key] ||= { month: key, cost: 0, km: 0 })
    buckets[key].cost += recordTyreCost(r)
    buckets[key].km += recordStintKm(r)
  }
  return Object.values(buckets)
    .map((b) => ({
      month: b.month,
      cost: Math.round(b.cost),
      km: Math.round(b.km),
      cpk: b.km > 0 ? round3(b.cost / b.km) : null,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * Tyre spend broken down by fitting position (the only real cost dimension on
 * the actuals side). Drives the cost-breakdown doughnut.
 */
export function computeSpendByPosition(records = []) {
  const groups = groupBy((records || []).filter(Boolean), (r) => {
    const p = String(r.position ?? '').trim()
    return p || 'Unspecified'
  })
  return Object.entries(groups)
    .map(([label, rows]) => ({ label, amount: Math.round(rows.reduce((s, r) => s + recordTyreCost(r), 0)) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount)
}

/**
 * Derive the real counts the savings-potential formulas need.
 * vehicleCount = distinct active assets (fleet), tyreCount = non-scrapped tyre
 * records, avgTyreCost = mean recorded cost_per_tyre (>0) or the 850 default.
 */
export function deriveSavingsInputs(records = [], activeAssets = null) {
  const rows = (records || []).filter(Boolean)
  const distinctAssets = new Set(rows.map((r) => r.asset_no).filter(Boolean)).size
  const vehicleCount = activeAssets && activeAssets.size > 0 ? activeAssets.size : distinctAssets
  const tyreCount = rows.filter((r) => !isScrapped(r)).length
  const costs = rows.map((r) => nn(r.cost_per_tyre)).filter((c) => c != null && c > 0)
  const avgTyreCost = costs.length ? Math.round(mean(costs)) : TCO_ASSUMPTIONS.avg_tyre_cost
  return { vehicleCount, tyreCount, avgTyreCost }
}

/**
 * Annual savings potential across five best-practice initiatives. Formulas
 * ported verbatim from tco_calculator.py `savings_potential`.
 */
export function computeSavingsPotential({ vehicleCount = 0, tyreCount = 0, avgTyreCost = TCO_ASSUMPTIONS.avg_tyre_cost } = {}) {
  const vc = Math.max(0, vehicleCount)
  const cost = avgTyreCost
  const rotation = vc * 4 * cost * 0.08
  const pressure = (vc * 250 * 365 * 0.28) / 100 * TCO_ASSUMPTIONS.fuel_price * 0.03
  const retread = vc * 2 * cost * 0.55
  const earlyDetect = tyreCount * cost * 0.05
  const procurement = vc * 4 * cost * 0.06
  const total = rotation + pressure + retread + earlyDetect + procurement
  return {
    vehicleCount: vc,
    tyreCount,
    avgTyreCost: cost,
    initiatives: [
      { initiative: 'Tyre Rotation Optimisation', annual: Math.round(rotation), how: '8% longer tyre life via rotation patterns' },
      { initiative: 'Pressure Compliance (TPMS)', annual: Math.round(pressure), how: '3% fuel saving at correct inflation' },
      { initiative: 'Retread Programme', annual: Math.round(retread), how: '55% cost saving vs new tyre purchase' },
      { initiative: 'Early Failure Detection', annual: Math.round(earlyDetect), how: '5% fewer emergency replacements' },
      { initiative: 'Consolidated Procurement', annual: Math.round(procurement), how: '6% better pricing via volume buying' },
    ],
    total: Math.round(total),
    perVehicle: vc > 0 ? Math.round(total / vc) : 0,
  }
}

/**
 * GCC benchmark comparison. For each static benchmark type, computes the fleet's
 * actual mean cost_per_km across assets whose vehicle_type matches, plus the
 * variance vs the benchmark. actualCpk is null when no matching asset has km.
 */
export function computeGccBenchmarks(assets = []) {
  return GCC_TCO_BENCHMARKS.map((b) => {
    const matched = assets.filter((a) => a.vehicle_type && b.match.test(String(a.vehicle_type)) && a.cost_per_km != null)
    const actualCpk = matched.length ? round3(mean(matched.map((a) => a.cost_per_km))) : null
    const variancePct = actualCpk != null && b.costPerKm > 0
      ? Math.round(((actualCpk - b.costPerKm) / b.costPerKm) * 100)
      : null
    return {
      type: b.type,
      benchmarkCpk: b.costPerKm,
      actualCpk,
      assetCount: matched.length,
      variancePct,
    }
  })
}

/**
 * Full Fleet-Actuals bundle for the page. Joins vehicle_type from the fleet
 * roster, tracks the active-asset set, and returns every derived surface in a
 * single deterministic pass.
 * @param {object[]} records tyre_records rows
 * @param {{fleet?:object[]}} [opts] vehicle_fleet roster (asset_no, vehicle_type, is_active/status)
 */
export function computeFleetActuals(records = [], { fleet = [] } = {}) {
  const rows = (records || []).filter(Boolean)
  const vehicleTypeByAsset = {}
  const activeAssets = new Set()
  for (const v of fleet || []) {
    if (!v?.asset_no) continue
    vehicleTypeByAsset[v.asset_no] = v.vehicle_type ?? v.type ?? null
    if (isActiveVehicle(v)) activeAssets.add(v.asset_no)
  }

  const baseAssets = computeAssetsActualTco(rows, { vehicleTypeByAsset })
  const rollup = computeFleetActualRollup(baseAssets)
  const assets = baseAssets.map((a) => ({
    ...a,
    percentile: cpkPercentile(a.cost_per_km, rollup.fleet_avg_cpkm),
    band: cpkBand(a.cost_per_km, rollup.fleet_avg_cpkm),
  }))

  return {
    assets,
    rollup,
    monthly: computeMonthlyActualCpk(rows),
    breakdown: computeSpendByPosition(rows),
    savings: computeSavingsPotential(deriveSavingsInputs(rows, activeAssets)),
    benchmarks: computeGccBenchmarks(assets),
    meta: {
      recordCount: rows.length,
      activeVehicleCount: activeAssets.size,
      assetCount: baseAssets.length,
    },
  }
}
