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
