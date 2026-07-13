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

/* ═══════════════════════════════════════════════════════════════════════════
 * TYRE-LIFECYCLE ESG MODEL (restored from tyre_saas carbon_lifecycle service)
 * ---------------------------------------------------------------------------
 * A second, complementary carbon view: instead of tailpipe fuel combustion it
 * scores the EMBEDDED / lifecycle carbon of the tyre estate — manufacturing,
 * sea-freight to the UAE, and end-of-life — and quantifies the CO2 AVOIDED by
 * retreading versus buying new, plus the extra CO2 burned by running
 * under-inflated tyres. It rolls up into a 0–100 ESG score with a
 * certification-ready flag for GCC sustainability reporting.
 *
 * Formulas + constants are ported VERBATIM from the original FastAPI service
 * (backend/routes/carbon.py + services/carbon_lifecycle.py). The one input the
 * flat schema lacks — an explicit `application_class` per tyre — is derived by
 * joining each tyre's asset to `vehicle_fleet.vehicle_type` and mapping the
 * free-text type onto the seven canonical classes (classOfVehicleType). No
 * value is fabricated: where a signal is absent the roll-up degrades honestly
 * (retread derivation is flagged when it came only from free-text reasons).
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * CO2 factors in kg CO2e. Manufacturing is per-class; the rest are per-tyre or
 * per-event scalars. Ported verbatim from carbon.py CO2_FACTORS (GCC logistics
 * industry averages — Michelin & Bridgestone lifecycle studies).
 */
export const CO2_FACTORS = Object.freeze({
  manufacturing: Object.freeze({
    heavy_truck: 32.0,
    trailer: 28.0,
    bus: 30.0,
    light_vehicle: 18.0,
    van: 16.0,
    pickup: 14.0,
    default: 25.0,
  }),
  transport_to_uae: 2.5, // sea freight, per tyre
  end_of_life: 5.0, // landfill, per tyre
  retread_saving: 20.0, // CO2 saved per retread vs a new tyre (~68% of manufacturing)
  underinflation_per_10k_km: 8.0, // extra CO2 from ~10% under-inflation over 10k km
})

/** kg CO2 per km by vehicle class (UAE / GCC averages) — for the by-class view. */
export const EMISSIONS_FACTOR_KG_PER_KM = Object.freeze({
  heavy_truck: 0.95,
  trailer: 0.85,
  bus: 0.90,
  light_vehicle: 0.18,
  van: 0.24,
  pickup: 0.28,
  default: 0.30,
})

/** The seven canonical vehicle classes the manufacturing/emission maps key on. */
export const VEHICLE_CLASSES = Object.freeze([
  'heavy_truck', 'trailer', 'bus', 'light_vehicle', 'van', 'pickup', 'default',
])

// Lifecycle roll-up assumptions (ported from carbon.py). Documented + exported
// so callers can audit / override them rather than meeting inlined magic.
export const KG_CO2_PER_TREE_YEAR = 22 // 1 mature tree absorbs ~22 kg CO2/yr — the lifecycle model's tree factor (distinct from the fuel view's planting-density TREES_PER_TONNE_CO2_YEAR)
export const DRIVING_KG_CO2_PER_KM = 0.12 // avg passenger car ~120 g CO2/km
export const FLEET_AVG_KM_PER_DAY = 400 // UAE heavy-truck daily average
export const AVG_TYRES_PER_VEHICLE = 18 // fleet average axle/tyre count
export const LOW_PRESSURE_THRESHOLD = 85 // psi below which a fitted tyre is "under-inflated"

/**
 * CO2 (kg) of putting ONE new tyre of the given class into service =
 * manufacturing(class) + transport-to-UAE + end-of-life. Verbatim _co2_new_tyre.
 */
export function co2NewTyre(vehicleClass) {
  const mfg = CO2_FACTORS.manufacturing[vehicleClass] ?? CO2_FACTORS.manufacturing.default
  return mfg + CO2_FACTORS.transport_to_uae + CO2_FACTORS.end_of_life
}

/**
 * Map a free-text `vehicle_type` onto one of the seven canonical classes.
 * Order matters (most specific first). Unknown/empty → 'default'.
 */
export function classOfVehicleType(vehicleType) {
  const t = String(vehicleType ?? '').toLowerCase().trim()
  if (!t) return 'default'
  if (/trailer|semi[-\s]?trailer|flat\s?bed|low\s?bed|reefer|curtain/.test(t)) return 'trailer'
  if (/\bbus\b|coach|minibus|shuttle/.test(t)) return 'bus'
  if (/pick.?up|\bpickup\b|\bute\b|double\s?cab|single\s?cab|\bd\/?cab\b/.test(t)) return 'pickup'
  if (/\bvan\b|panel\s?van|cargo\s?van|minivan|\bpanel\b/.test(t)) return 'van'
  if (/truck|lorry|\bhgv\b|prime\s?mover|tractor|tipper|tanker|mixer|dump|hauler|rigid|\bftl\b|heavy/.test(t)) return 'heavy_truck'
  if (/car|sedan|saloon|\bsuv\b|4x4|4wd|hatch|light|\blv\b|jeep|estate|wagon|forklift|loader|excavator/.test(t)) return 'light_vehicle'
  return 'default'
}

// ── Lifecycle intensity bands (from carbon_lifecycle.py) ─────────────────────

const _INTENSITY_BANDS = [
  [0.25, 'compliant', 'Compliant', 'none'],
  [0.45, 'elevated', 'Elevated', 'low'],
  [0.70, 'high', 'High emissions', 'medium'],
  [Infinity, 'critical', 'Critical', 'high'],
]

/**
 * Classify a fleet carbon intensity (kg CO2e / km) into a lifecycle band.
 * null / negative → unknown. Verbatim compute_carbon_band.
 */
export function intensityBand(intensityKgPerKm) {
  if (intensityKgPerKm == null || !Number.isFinite(intensityKgPerKm) || intensityKgPerKm < 0) {
    return { band: 'unknown', label: 'No data', urgency: 'none', intensityKgPerKm: null }
  }
  for (const [threshold, band, label, urgency] of _INTENSITY_BANDS) {
    if (intensityKgPerKm <= threshold) {
      return {
        band,
        label: `${label} — ${intensityKgPerKm.toFixed(2)} kg CO₂/km`,
        urgency,
        intensityKgPerKm: round(intensityKgPerKm, 3),
      }
    }
  }
  return { band: 'critical', label: 'Critical', urgency: 'high', intensityKgPerKm: round(intensityKgPerKm, 3) }
}

/**
 * Classify a retread rate (%) into a saving band. Verbatim
 * compute_retread_saving_band, but taking the already-computed percentage.
 */
export function retreadSavingBand(pct) {
  if (pct == null || !Number.isFinite(pct)) {
    return { band: 'unknown', label: 'No tyres', urgency: 'none', retreadPct: null }
  }
  const p = round(pct, 1)
  if (p >= 30) return { band: 'excellent', label: `${p}% retreaded`, urgency: 'none', retreadPct: p }
  if (p >= 15) return { band: 'good', label: `${p}% retreaded`, urgency: 'none', retreadPct: p }
  if (p >= 5) return { band: 'low', label: `Low retread rate ${p}%`, urgency: 'low', retreadPct: p }
  return { band: 'minimal', label: `Minimal retreading ${p}%`, urgency: 'medium', retreadPct: p }
}

// ── Roll-up helpers ──────────────────────────────────────────────────────────

const RETREAD_RE = /retread|remould|remold|recap|re-?tread/i
const SCRAP_RE = /scrap|write.?off|condemn|dispos/i
const REMOVED_RE = /remov|scrap|dispos|write.?off|condemn|retire/i
const ACTIVE_RE = /active|in.?service|in.?use|operational|running|available/i

/** Physical-tyre count for a record: honour qty when > 0, else count the row as 1. */
function tyreCountOf(row) {
  const q = num(row?.qty)
  return q != null && q > 0 ? q : 1
}

/** True when a tyre row represents a retread (category first, then free text). */
function isRetreadRow(row) {
  const cat = String(row?.category ?? '').toLowerCase().trim()
  if (cat === 'retread' || cat === 'retreaded') return { retread: true, fromText: false }
  const txt = `${row?.reason_for_removal ?? ''} ${row?.removal_reason ?? ''} ${row?.remarks ?? ''} ${row?.category ?? ''}`
  if (RETREAD_RE.test(txt)) return { retread: true, fromText: true }
  return { retread: false, fromText: false }
}

const inWindow = (dateStr, cutoff) => {
  if (!cutoff) return true
  if (!dateStr) return false
  const d = new Date(dateStr)
  return !Number.isNaN(d.getTime()) && d >= cutoff
}

/**
 * Roll up the tyre-lifecycle ESG carbon model.
 *
 * @param {object} input
 * @param {Array<object>} input.tyres     tyre_records rows (asset_no, qty, category,
 *   status, pressure_reading, reason_for_removal/removal_reason, issue_date, …)
 * @param {Array<object>} input.vehicles  vehicle_fleet rows (asset_no, vehicle_type,
 *   status, is_active, current_km)
 * @param {number} [input.periodDays=365] window (days) for "new tyres this period"
 * @returns {object} full dashboard payload (see fields below)
 */
export function computeLifecycleCarbon({ tyres = [], vehicles = [], periodDays = 365 } = {}) {
  const tyreRows = Array.isArray(tyres) ? tyres : []
  const vehicleRows = Array.isArray(vehicles) ? vehicles : []
  const days = Number.isFinite(periodDays) && periodDays > 0 ? periodDays : 365
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  cutoff.setHours(0, 0, 0, 0)

  // asset_no → vehicle_type (for the class join). Active-vehicle count too.
  const typeByAsset = new Map()
  let activeVehicles = 0
  const emissionsByClass = new Map() // class → { vehicles, km, co2 }
  for (const v of vehicleRows) {
    const asset = v?.asset_no
    if (asset != null && !typeByAsset.has(asset)) typeByAsset.set(asset, v?.vehicle_type ?? null)
    const active = typeof v?.is_active === 'boolean'
      ? v.is_active
      : ACTIVE_RE.test(String(v?.status ?? '')) || (v?.is_active == null && v?.status == null)
    if (!active) continue
    activeVehicles += 1
    const cls = classOfVehicleType(v?.vehicle_type)
    const km = num(v?.current_km) || 0
    const g = emissionsByClass.get(cls) || { vehicles: 0, km: 0, co2: 0 }
    g.vehicles += 1
    g.km += km
    g.co2 += km * (EMISSIONS_FACTOR_KG_PER_KM[cls] ?? EMISSIONS_FACTOR_KG_PER_KM.default)
    emissionsByClass.set(cls, g)
  }

  const classOfTyre = (row) => classOfVehicleType(typeByAsset.get(row?.asset_no))

  // 1. New tyres in period → manufacturing + transport + EoL, grouped by class.
  const countByClass = new Map()
  let newTyresPeriod = 0
  for (const row of tyreRows) {
    if (!inWindow(row?.issue_date ?? row?.fitment_date ?? null, cutoff)) continue
    const cls = classOfTyre(row)
    const c = tyreCountOf(row)
    countByClass.set(cls, (countByClass.get(cls) || 0) + c)
    newTyresPeriod += c
  }
  let totalCo2New = 0
  const tyreBreakdown = []
  for (const cls of VEHICLE_CLASSES) {
    const count = countByClass.get(cls)
    if (!count) continue
    const each = co2NewTyre(cls)
    const total = count * each
    totalCo2New += total
    tyreBreakdown.push({
      applicationClass: cls,
      count,
      co2PerTyreKg: round(each, 1),
      totalCo2Kg: round(total, 1),
    })
  }
  tyreBreakdown.sort((a, b) => b.totalCo2Kg - a.totalCo2Kg)

  // 2. Retreads performed → CO2 avoided vs buying new (all in-scope tyres).
  let retreadCount = 0
  let retreadFromCategory = 0
  let retreadFromText = 0
  // 3. Low-pressure fitted tyres, 4. scrapped tyres — single pass.
  let lowPressure = 0
  let scrappedCount = 0
  for (const row of tyreRows) {
    const c = tyreCountOf(row)
    const rt = isRetreadRow(row)
    if (rt.retread) {
      retreadCount += c
      if (rt.fromText) retreadFromText += c
      else retreadFromCategory += c
    }
    const status = String(row?.status ?? '')
    const scrapped = SCRAP_RE.test(status)
    if (scrapped) scrappedCount += c
    const inService = status !== '' && !REMOVED_RE.test(status)
    const psi = num(row?.pressure_reading)
    if (inService && psi != null && psi > 0 && psi < LOW_PRESSURE_THRESHOLD) lowPressure += c
  }
  const co2SavedRetreading = retreadCount * CO2_FACTORS.retread_saving
  const retreadFromTextOnly = retreadFromText > 0 && retreadFromCategory === 0

  // 3b. Under-inflation CO2 impact over the fleet's period km.
  const fleetKmPeriod = activeVehicles * FLEET_AVG_KM_PER_DAY * days
  const co2Underinflation = lowPressure * (fleetKmPeriod / 10000) * CO2_FACTORS.underinflation_per_10k_km

  // 4b. Scrapped end-of-life CO2.
  const co2Scrapped = scrappedCount * CO2_FACTORS.end_of_life

  // 5. Net carbon.
  const totalCo2Gross = totalCo2New + co2Underinflation + co2Scrapped
  const totalCo2Net = totalCo2Gross - co2SavedRetreading

  // 6. ESG score (0–100). Verbatim weighting from carbon.py.
  const retreadRate = (retreadCount / Math.max(scrappedCount + retreadCount, 1)) * 100
  const pressureCompliance = 100 - (lowPressure / Math.max(activeVehicles * AVG_TYRES_PER_VEHICLE, 1)) * 100
  const esgScore = round(
    Math.min(retreadRate, 100) * 0.4 +
    Math.min(pressureCompliance, 100) * 0.4 +
    Math.min(Math.max(100 - totalCo2Net / Math.max(activeVehicles, 1) / 10, 0), 100) * 0.2,
    1,
  )

  // 7. Equivalents (1 tree ≈ 22 kg CO2/yr; avg car 120 g CO2/km).
  const treesSaved = Math.round(co2SavedRetreading / KG_CO2_PER_TREE_YEAR)
  const treesEmitted = Math.round(totalCo2Net / KG_CO2_PER_TREE_YEAR)
  const drivingEquivalentKm = Math.round(totalCo2Net / DRIVING_KG_CO2_PER_KM)

  // By-class emissions view (lifetime odometer × per-km factor).
  const byClassEmissions = [...emissionsByClass.entries()]
    .map(([cls, g]) => ({
      applicationClass: cls,
      vehicles: g.vehicles,
      km: round(g.km, 0),
      co2Kg: round(g.co2, 1),
      co2Tonnes: round(g.co2 / 1000, 2),
      emissionsFactor: EMISSIONS_FACTOR_KG_PER_KM[cls] ?? EMISSIONS_FACTOR_KG_PER_KM.default,
    }))
    .sort((a, b) => b.co2Kg - a.co2Kg)

  const totalEmissionsCo2 = byClassEmissions.reduce((s, r) => s + r.co2Kg, 0)
  const totalFleetKm = byClassEmissions.reduce((s, r) => s + r.km, 0)
  const fleetIntensityKgPerKm = totalFleetKm > 0 ? round(totalEmissionsCo2 / totalFleetKm, 3) : null

  // Monthly trend (last 12 months) of new-tyre embedded CO2 (manufacturing default).
  const monthlyTrend = _monthlyLifecycleTrend(tyreRows)
  const reductionVsPriorPct = _reductionVsPrior(monthlyTrend)

  return {
    periodDays: days,
    summary: {
      totalCo2NewKg: round(totalCo2New, 1),
      totalCo2GrossKg: round(totalCo2Gross, 1),
      totalCo2NetKg: round(totalCo2Net, 1),
      co2SavedRetreadingKg: round(co2SavedRetreading, 1),
      co2FromUnderinflationKg: round(co2Underinflation, 1),
      co2FromScrappedKg: round(co2Scrapped, 1),
      esgScore,
      retreadRatePct: round(retreadRate, 1),
      pressureCompliancePct: round(Math.max(0, Math.min(100, pressureCompliance)), 1),
      certificationReady: esgScore >= 70,
    },
    equivalents: {
      treesEmitted,
      treesSavedRetreading: treesSaved,
      drivingEquivalentKm,
    },
    intensity: {
      fleetIntensityKgPerKm,
      band: intensityBand(fleetIntensityKgPerKm),
    },
    retreadBand: retreadSavingBand(scrappedCount + retreadCount > 0 ? retreadRate : null),
    tyreBreakdown,
    byClassEmissions,
    fleetStats: {
      totalVehicles: activeVehicles,
      newTyresPeriod,
      retreadsPeriod: retreadCount,
      scrappedPeriod: scrappedCount,
      lowPressureCurrently: lowPressure,
    },
    monthlyTrend,
    reductionVsPriorPct,
    retreadFromTextOnly,
    co2Factors: CO2_FACTORS,
  }
}

/** Last-12-months new-tyre embedded-CO2 trend (manufacturing default per tyre). */
function _monthlyLifecycleTrend(tyreRows) {
  const now = new Date()
  const buckets = []
  const index = new Map()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const b = { month: key, label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, newTyres: 0, estimatedCo2Kg: 0 }
    buckets.push(b)
    index.set(key, b)
  }
  const each = CO2_FACTORS.manufacturing.default
  for (const row of tyreRows) {
    const raw = row?.issue_date ?? row?.fitment_date ?? null
    const b = monthBucket(raw)
    if (!b) continue
    const bucket = index.get(b.key)
    if (!bucket) continue
    const c = tyreCountOf(row)
    bucket.newTyres += c
    bucket.estimatedCo2Kg += c * each
  }
  return buckets.map((b) => ({ ...b, estimatedCo2Kg: round(b.estimatedCo2Kg, 1) }))
}

/** Reduction % of the last half of the 12-month trend vs the first half. */
function _reductionVsPrior(monthlyTrend) {
  const m = Array.isArray(monthlyTrend) ? monthlyTrend : []
  if (m.length < 6) return null
  const half = Math.floor(m.length / 2)
  const earlier = m.slice(0, half).reduce((s, x) => s + (x.estimatedCo2Kg || 0), 0)
  const later = m.slice(half).reduce((s, x) => s + (x.estimatedCo2Kg || 0), 0)
  if (earlier === 0) return null
  return Math.round(((earlier - later) / earlier) * 100)
}
