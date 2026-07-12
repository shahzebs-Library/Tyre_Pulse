/**
 * Carbon Tracker — pure helpers (no I/O) for the fleet CO2 emissions module.
 *
 * CO2 is derived from REAL operational data, not a bespoke emissions table:
 * each fuel-usage row carries a distance (from the tyre records' fitment/removal
 * odometer) and/or an explicit litres figure. Diesel burned is converted to CO2
 * with the IPCC diesel emission factor.
 *
 *   CO2 (kg) = litres × DIESEL_KG_PER_L
 *
 * When a row has no explicit litres we estimate them from distance using a
 * documented fleet-average consumption assumption (heavy-truck L/100km). The
 * distance itself is real; only the L/100km conversion is an assumption, and it
 * is exposed as a constant so callers can override it. Rows with neither litres
 * nor a usable distance contribute nothing (no fabricated numbers).
 *
 * These functions are unit-tested; the page and service consume them so the
 * carbon maths lives in exactly one place.
 */

// IPCC diesel combustion emission factor (kg CO2 per litre). The single source
// of truth for the module — never inline 2.68 anywhere else.
export const DIESEL_KG_PER_L = 2.68

// Fleet-average heavy-truck consumption used to convert real distance → litres
// when a row has no metered litres. Overridable via computeCarbon opts.
export const DEFAULT_CONSUMPTION_L_PER_100KM = 35

// ~21 trees absorb one tonne of CO2 per year — used for an intuitive offset KPI.
export const TREES_PER_TONNE_CO2_YEAR = 21

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Coerce a value to a finite positive-or-zero number, else null. */
function num(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const round = (n, dp = 0) => {
  if (n == null || !Number.isFinite(n)) return 0
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Effective vehicle id for a row (tolerant of field naming). */
function vehicleOf(row) {
  return row?.vehicle ?? row?.asset_no ?? row?.asset ?? null
}

/** Effective site for a row. */
function siteOf(row) {
  return row?.site ?? row?.branch ?? row?.location ?? null
}

/** Effective ISO-ish date for a row. */
function dateOf(row) {
  return row?.date ?? row?.issue_date ?? row?.created_at ?? null
}

/** Effective distance (km) for a row. */
function distanceOf(row) {
  return num(row?.distance_km ?? row?.distance ?? row?.km ?? null)
}

/**
 * Litres attributed to a single row. Metered litres win; otherwise estimate
 * from real distance × consumption. Returns 0 when nothing usable is present.
 */
export function rowLitres(row, consumptionLper100km = DEFAULT_CONSUMPTION_L_PER_100KM) {
  const explicit = num(row?.litres ?? row?.liters ?? row?.quantity ?? null)
  if (explicit != null && explicit > 0) return explicit
  const dist = distanceOf(row)
  if (dist != null && dist > 0 && consumptionLper100km > 0) {
    return dist * (consumptionLper100km / 100)
  }
  return 0
}

/** Normalise a date to a { key:'YYYY-MM', label:'Mon YYYY' } bucket, or null. */
function monthBucket(raw) {
  if (!raw) return null
  const d = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = d.getMonth()
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTH_LABELS[m]} ${y}` }
}

/**
 * Aggregate fuel-usage rows into CO2 intelligence.
 *
 * @param {Array<object>} fuelRows  rows carrying { vehicle|asset_no, site, date, distance_km|litres }
 * @param {object} [opts]
 * @param {number} [opts.consumptionLper100km]  distance→litres assumption
 * @param {number} [opts.emissionFactor]        kg CO2 per litre (default diesel)
 * @returns {{ totalCo2:number, totalLitres:number, totalDistanceKm:number,
 *   vehicleCount:number, byMonth:Array, bySite:Array, byVehicle:Array }}
 */
export function computeCarbon(fuelRows, opts = {}) {
  const consumption = opts.consumptionLper100km ?? DEFAULT_CONSUMPTION_L_PER_100KM
  const factor = opts.emissionFactor ?? DIESEL_KG_PER_L
  const rows = Array.isArray(fuelRows) ? fuelRows : []

  let totalLitres = 0
  let totalDistanceKm = 0
  const months = new Map()   // key -> { key, label, litres, co2 }
  const sites = new Map()    // site -> { site, litres, co2, vehicles:Set }
  const vehicles = new Map() // vehicle -> { vehicle, site, litres, co2 }

  for (const row of rows) {
    const litres = rowLitres(row, consumption)
    if (litres <= 0) continue
    const co2 = litres * factor
    const dist = distanceOf(row) || 0
    totalLitres += litres
    totalDistanceKm += dist

    const mb = monthBucket(dateOf(row))
    if (mb) {
      const m = months.get(mb.key) || { key: mb.key, label: mb.label, litres: 0, co2: 0 }
      m.litres += litres; m.co2 += co2
      months.set(mb.key, m)
    }

    const site = siteOf(row) || 'Unassigned'
    const s = sites.get(site) || { site, litres: 0, co2: 0, vehicles: new Set() }
    s.litres += litres; s.co2 += co2
    const veh = vehicleOf(row)
    if (veh) s.vehicles.add(veh)
    sites.set(site, s)

    if (veh) {
      const v = vehicles.get(veh) || { vehicle: veh, site, litres: 0, co2: 0 }
      v.litres += litres; v.co2 += co2
      if (!v.site && site) v.site = site
      vehicles.set(veh, v)
    }
  }

  const byMonth = [...months.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => ({ key: m.key, label: m.label, litres: round(m.litres), co2: round(m.co2) }))

  const bySite = [...sites.values()]
    .map((s) => ({
      site: s.site,
      vehicles: s.vehicles.size,
      litres: round(s.litres),
      co2: round(s.co2),
    }))
    .sort((a, b) => b.co2 - a.co2)

  const byVehicle = [...vehicles.values()]
    .map((v) => ({
      vehicle: v.vehicle,
      site: v.site || 'Unassigned',
      litres: round(v.litres),
      co2: round(v.co2),
    }))
    .sort((a, b) => b.co2 - a.co2)

  return {
    totalCo2: round(totalLitres * factor),
    totalLitres: round(totalLitres),
    totalDistanceKm: round(totalDistanceKm),
    vehicleCount: vehicles.size,
    byMonth,
    bySite,
    byVehicle,
  }
}

/** Trees needed to offset a given CO2 mass (kg) over one year. */
export function treesToOffset(co2Kg) {
  const t = (num(co2Kg) || 0) / 1000
  return Math.max(0, Math.ceil(t * TREES_PER_TONNE_CO2_YEAR))
}
