/**
 * Fuel Efficiency analytics - pure helpers (no I/O, deterministic).
 *
 * Models the fuel cost of tyre condition (under-inflation and worn tread) for
 * the /fuel-efficiency page. Every figure here is a MODELLED ESTIMATE built on
 * published rolling-resistance rules of thumb; the page says so.
 *
 * HONESTY RULES
 * - A tyre with neither a pressure reading nor a tread depth is UNMEASURED: its
 *   penalty is null and it is left out of every cost figure, never counted as a
 *   perfect tyre.
 * - Pressure compliance is null when no tyre in scope carries a reading. It is
 *   never a fabricated 100% or 0%.
 * - Litre figures need a monthly distance; cost figures also need a fuel price.
 *   When either input is missing the dependent figure is null (N/A), never a
 *   default price or a guessed distance.
 * - Vehicle impact is the MEAN penalty of its measured tyres applied to the
 *   vehicle's fuel, not the sum over tyres: a 12-tyre truck does not burn its
 *   monthly fuel twelve times over.
 * - Time-dependent functions take an injectable `now`.
 */

export const FUEL_CONSTANTS = Object.freeze({
  UNDER_INFLATION_FUEL_PCT_PER_10PCT: 0.02, // +2% fuel per 10% under-inflation
  WORN_TREAD_FUEL_PENALTY_PCT: 0.03, // <=3mm vs >8mm = +3% fuel
  CO2_KG_PER_LITER: 2.68, // diesel combustion
  TREES_PER_TONNE_CO2_YEAR: 21, // ~21 mature trees absorb 1 tonne CO2 per year
  NOMINAL_PRESSURE_PSI: 110, // typical truck tyre nominal
  TREAD_NEW_MM: 8,
  TREAD_WORN_MM: 3,
  COMPLIANT_DEVIATION: 0.05, // within 5% below nominal counts as compliant
  DEFAULT_CONSUMPTION_L_100KM: 35, // heavy truck baseline, user editable
})

const C = FUEL_CONSTANTS

function num(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function round(v, dp = 1) {
  if (v == null || !Number.isFinite(v)) return null
  const f = 10 ** dp
  return Math.round(v * f) / f
}

function mean(list) {
  const xs = list.filter((v) => v != null && Number.isFinite(v))
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null
}

/** Fraction below nominal (0 when at or above nominal), or null with no reading. */
export function pressureDeviation(reading, nominal = C.NOMINAL_PRESSURE_PSI) {
  const r = num(reading)
  if (r == null || r <= 0) return null
  return Math.max(0, (nominal - r) / nominal)
}

/** Fuel penalty contribution of tread depth (fraction), or null with no reading. */
export function treadPenalty(treadMm) {
  const td = num(treadMm)
  if (td == null || td < 0) return null
  if (td <= C.TREAD_WORN_MM) return C.WORN_TREAD_FUEL_PENALTY_PCT
  if (td < C.TREAD_NEW_MM) {
    return C.WORN_TREAD_FUEL_PENALTY_PCT * (C.TREAD_NEW_MM - td) / (C.TREAD_NEW_MM - C.TREAD_WORN_MM)
  }
  return 0
}

/**
 * The modelled fuel penalty for one tyre record:
 * { penalty, pressDev, treadPen, measured }. `penalty` is null when neither a
 * pressure nor a tread reading exists.
 */
export function tyreFuelPenalty(record) {
  const pressDev = pressureDeviation(record?.pressure_reading)
  const treadPen = treadPenalty(record?.tread_depth)
  const pressPen = pressDev == null ? null : (pressDev / 0.10) * C.UNDER_INFLATION_FUEL_PCT_PER_10PCT
  const measured = pressPen != null || treadPen != null
  return {
    penalty: measured ? (pressPen ?? 0) + (treadPen ?? 0) : null,
    pressDev,
    treadPen,
    measured,
  }
}

/**
 * Monthly distance per vehicle derived from removed tyres' km run, assuming an
 * average tyre spends about three months on the vehicle. Returns
 * { km, samples } with km null when no tyre carries both readings.
 */
export function deriveMonthlyKm(records) {
  const pairs = (Array.isArray(records) ? records : []).filter((r) => {
    const a = num(r?.km_at_fitment)
    const b = num(r?.km_at_removal)
    return a != null && b != null && b > a
  })
  if (!pairs.length) return { km: null, samples: 0 }
  const total = pairs.reduce((s, r) => s + (num(r.km_at_removal) - num(r.km_at_fitment)), 0)
  return { km: Math.round(total / pairs.length / 3), samples: pairs.length }
}

/** Monthly fuel of one vehicle in litres, or null when an input is missing. */
export function baseMonthlyFuel(consumptionL100, monthlyKm) {
  const c = num(consumptionL100)
  const k = num(monthlyKm)
  if (c == null || k == null || c <= 0 || k <= 0) return null
  return (c / 100) * k
}

/** Distinct site values (sorted) present in the records. */
export function fuelSites(records) {
  return [...new Set((Array.isArray(records) ? records : []).map((r) => r?.site).filter(Boolean))].sort()
}

/** Narrow the tyre records by site and free text (asset, serial, brand, position). */
export function filterFuelRecords(records, { site = '', search = '' } = {}) {
  const q = String(search ?? '').trim().toLowerCase()
  return (Array.isArray(records) ? records : []).filter((r) => {
    if (site && (r?.site || '') !== site) return false
    if (q) {
      const hay = `${r?.asset_no || ''} ${r?.serial_number || r?.serial_no || ''} ${r?.brand || ''} ${r?.position || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Per tyre: penalty, deviation and modelled extra fuel % (null when unmeasured). */
export function enrichTyres(records) {
  return (Array.isArray(records) ? records : []).map((r) => {
    const p = tyreFuelPenalty(r)
    return {
      ...r,
      penalty: p.penalty,
      pressDev: p.pressDev,
      measured: p.measured,
      hasPressure: p.pressDev != null,
      compliant: p.pressDev == null ? null : p.pressDev < C.COMPLIANT_DEVIATION,
      underInflatedPct: p.pressDev == null ? null : round(p.pressDev * 100, 1),
      extraFuelPct: p.penalty == null ? null : round(p.penalty * 100, 2),
    }
  })
}

function complianceOf(tyres) {
  const withP = tyres.filter((t) => t.hasPressure)
  if (!withP.length) return null
  return round((withP.filter((t) => t.compliant).length / withP.length) * 100, 1)
}

/**
 * Per vehicle metrics. `inputs` = { consumptionL100, monthlyKm, pricePerL }.
 * Litres and cost are null whenever an input is missing or no tyre on the
 * vehicle is measured.
 */
export function vehicleMetrics(enriched, inputs = {}) {
  const base = baseMonthlyFuel(inputs.consumptionL100, inputs.monthlyKm)
  const price = num(inputs.pricePerL)
  const map = new Map()
  for (const t of Array.isArray(enriched) ? enriched : []) {
    if (!t?.asset_no) continue
    if (!map.has(t.asset_no)) map.set(t.asset_no, { asset_no: t.asset_no, site: t.site || null, tyres: [] })
    map.get(t.asset_no).tyres.push(t)
  }
  return [...map.values()].map((v) => {
    const measured = v.tyres.filter((t) => t.measured)
    const penalty = mean(measured.map((t) => t.penalty))
    const litres = penalty == null || base == null ? null : penalty * base
    const cost = litres == null || price == null ? null : litres * price
    const devs = v.tyres.filter((t) => t.hasPressure).map((t) => t.pressDev * 100)
    const treads = v.tyres.map((t) => num(t.tread_depth)).filter((x) => x != null)
    return {
      asset_no: v.asset_no,
      site: v.site,
      tyreCount: v.tyres.length,
      measuredTyres: measured.length,
      pressureReadings: devs.length,
      avgDevPct: devs.length ? round(mean(devs), 1) : null,
      avgTread: treads.length ? round(mean(treads), 1) : null,
      compliancePct: complianceOf(v.tyres),
      penaltyPct: penalty == null ? null : round(penalty * 100, 2),
      extraLitresMonth: round(litres, 1),
      extraCostMonth: round(cost, 2),
      annualExtraCost: cost == null ? null : round(cost * 12, 2),
    }
  }).sort((a, b) => (b.extraCostMonth ?? b.penaltyPct ?? -1) - (a.extraCostMonth ?? a.penaltyPct ?? -1))
}

/** Roll the vehicles and tyres up by site. Compliance comes from tyre readings. */
export function siteMetrics(enriched, vehicles) {
  const bySite = new Map()
  for (const t of Array.isArray(enriched) ? enriched : []) {
    const s = t?.site || 'Unrecorded'
    if (!bySite.has(s)) bySite.set(s, { site: s, tyres: [], vehicles: [] })
    bySite.get(s).tyres.push(t)
  }
  for (const v of Array.isArray(vehicles) ? vehicles : []) {
    const s = v?.site || 'Unrecorded'
    if (!bySite.has(s)) bySite.set(s, { site: s, tyres: [], vehicles: [] })
    bySite.get(s).vehicles.push(v)
  }
  return [...bySite.values()].map((s) => {
    const treads = s.tyres.map((t) => num(t.tread_depth)).filter((x) => x != null)
    const devs = s.tyres.filter((t) => t.hasPressure).map((t) => t.pressDev * 100)
    const litres = s.vehicles.map((v) => v.extraLitresMonth).filter((x) => x != null)
    const costs = s.vehicles.map((v) => v.extraCostMonth).filter((x) => x != null)
    const cost = costs.length ? costs.reduce((a, b) => a + b, 0) : null
    return {
      site: s.site,
      vehicles: s.vehicles.length,
      tyres: s.tyres.length,
      measuredTyres: s.tyres.filter((t) => t.measured).length,
      compliancePct: complianceOf(s.tyres),
      avgDevPct: devs.length ? round(mean(devs), 1) : null,
      avgTread: treads.length ? round(mean(treads), 1) : null,
      extraLitresMonth: litres.length ? round(litres.reduce((a, b) => a + b, 0), 0) : null,
      extraCostMonth: round(cost, 2),
      annualExtraCost: cost == null ? null : round(cost * 12, 0),
    }
  }).sort((a, b) => (b.annualExtraCost ?? -1) - (a.annualExtraCost ?? -1) || (a.compliancePct ?? 101) - (b.compliancePct ?? 101))
}

/** Fleet KPIs. Every figure is null when its inputs or readings are missing. */
export function fuelKpis(enriched, vehicles, inputs = {}) {
  const tyres = Array.isArray(enriched) ? enriched : []
  const vs = Array.isArray(vehicles) ? vehicles : []
  const withP = tyres.filter((t) => t.hasPressure)
  const avgDev = withP.length ? mean(withP.map((t) => t.pressDev)) : null
  const compliancePct = complianceOf(tyres)
  const litresList = vs.map((v) => v.extraLitresMonth).filter((x) => x != null)
  const costList = vs.map((v) => v.extraCostMonth).filter((x) => x != null)
  const extraLitres = litresList.length ? litresList.reduce((a, b) => a + b, 0) : null
  const extraCost = costList.length ? costList.reduce((a, b) => a + b, 0) : null
  const worn = tyres.filter((t) => {
    const td = num(t.tread_depth)
    return td != null && td <= C.TREAD_WORN_MM
  }).length
  return {
    tyres: tyres.length,
    measuredTyres: tyres.filter((t) => t.measured).length,
    pressureReadings: withP.length,
    treadReadings: tyres.filter((t) => num(t.tread_depth) != null).length,
    pressureCoveragePct: tyres.length ? round((withP.length / tyres.length) * 100, 1) : null,
    compliancePct,
    avgDevPct: avgDev == null ? null : round(avgDev * 100, 1),
    rrScore: avgDev == null ? null : round(Math.min(10, avgDev * 100 / 10 * 10), 1),
    extraLitresMonth: extraLitres == null ? null : Math.round(extraLitres),
    extraCostMonth: round(extraCost, 2),
    co2TonnesMonth: extraLitres == null ? null : round((extraLitres * C.CO2_KG_PER_LITER) / 1000, 2),
    wornTyres: worn,
    vehicles: vs.length,
  }
}

/**
 * Modelled saving from raising pressure compliance to `targetPct`.
 * Needs a current compliance, fuel per vehicle and a fleet size; the monetary
 * half also needs a price. Returns { monthlyLitres, monthlyCost, annualCost }.
 */
export function complianceSavings(compliancePct, targetPct, { fleetSize, consumptionL100, monthlyKm, pricePerL } = {}) {
  const base = baseMonthlyFuel(consumptionL100, monthlyKm)
  const fleet = num(fleetSize)
  const cur = num(compliancePct)
  const tgt = num(targetPct)
  if (base == null || fleet == null || fleet <= 0 || cur == null || tgt == null) {
    return { monthlyLitres: null, monthlyCost: null, annualCost: null }
  }
  const improvement = Math.max(0, (tgt - cur) / 100)
  const litres = improvement * C.UNDER_INFLATION_FUEL_PCT_PER_10PCT * base * fleet
  const price = num(pricePerL)
  const cost = price == null ? null : litres * price
  return {
    monthlyLitres: round(litres, 0),
    monthlyCost: round(cost, 2),
    annualCost: cost == null ? null : round(cost * 12, 2),
  }
}

/** Scatter points (tread vs modelled penalty) per site plus a least-squares line. */
export function treadScatter(enriched, { perSiteCap = 200 } = {}) {
  const pts = (Array.isArray(enriched) ? enriched : [])
    .filter((t) => num(t.tread_depth) > 0 && t.extraFuelPct != null)
  const sites = [...new Set(pts.map((t) => t.site || 'Unrecorded'))].sort()
  const series = sites.map((site) => ({
    site,
    points: pts.filter((t) => (t.site || 'Unrecorded') === site)
      .filter((_, i) => i < perSiteCap)
      .map((t) => ({ x: num(t.tread_depth), y: t.extraFuelPct })),
  }))
  let trend = null
  if (pts.length >= 2) {
    const xy = pts.map((t) => ({ x: num(t.tread_depth), y: t.extraFuelPct }))
    const n = xy.length
    const sx = xy.reduce((s, p) => s + p.x, 0)
    const sy = xy.reduce((s, p) => s + p.y, 0)
    const sxx = xy.reduce((s, p) => s + p.x * p.x, 0)
    const sxy = xy.reduce((s, p) => s + p.x * p.y, 0)
    const den = n * sxx - sx * sx
    if (den !== 0) {
      const slope = (n * sxy - sx * sy) / den
      const intercept = (sy - slope * sx) / n
      trend = [1, 4, 8, 12].map((x) => ({ x, y: Math.max(0, round(slope * x + intercept, 3)) }))
    }
  }
  return { series, trend, points: pts.length }
}

/**
 * Twelve calendar months ending with `now`: mean modelled penalty of the
 * measured tyres fitted in each month. A month with no measured tyre is null.
 */
export function monthlyPenaltyTrend(enriched, now = Date.now(), months = 12) {
  const end = new Date(now)
  const out = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1))
    out.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, count: 0, measured: 0, sum: 0 })
  }
  const index = new Map(out.map((m) => [m.key, m]))
  for (const t of Array.isArray(enriched) ? enriched : []) {
    const k = typeof t?.issue_date === 'string' ? t.issue_date.slice(0, 7) : null
    const m = k && index.get(k)
    if (!m) continue
    m.count += 1
    if (t.extraFuelPct != null) { m.measured += 1; m.sum += t.extraFuelPct }
  }
  return out.map((m) => ({ key: m.key, count: m.count, measured: m.measured, avgPenaltyPct: m.measured ? round(m.sum / m.measured, 2) : null }))
}

/** Environmental framing of the monthly excess litres. */
export function environmentalImpact(kpis, consumptionL100) {
  if (!kpis || kpis.extraLitresMonth == null) return null
  const co2 = kpis.co2TonnesMonth ?? 0
  const c = num(consumptionL100)
  return {
    co2TonnesMonth: co2,
    co2KgMonth: Math.round(co2 * 1000),
    treesNeeded: Math.ceil(co2 * 12 * C.TREES_PER_TONNE_CO2_YEAR),
    equivalentKm: c && c > 0 ? Math.round((kpis.extraLitresMonth / c) * 100) : null,
  }
}

/**
 * Data-driven recommendations only. Each entry: { key, impact, text }.
 * No recommendation quotes a saving the model cannot compute.
 */
export function fuelRecommendations({ kpis, sites = [], fmtMoney = (v) => String(v) } = {}) {
  if (!kpis || !kpis.tyres) return []
  const recs = []
  if (kpis.pressureCoveragePct != null && kpis.pressureCoveragePct < 50) {
    recs.push({
      key: 'coverage',
      impact: 'High',
      text: `Only ${kpis.pressureCoveragePct}% of tyres in scope carry a pressure reading. Log pressures at every inspection so the fuel impact can be measured rather than inferred.`,
    })
  }
  const worstSite = sites.filter((s) => s.compliancePct != null).sort((a, b) => a.compliancePct - b.compliancePct)[0]
  if (worstSite && worstSite.compliancePct < 90) {
    const cost = worstSite.extraCostMonth
    recs.push({
      key: 'site',
      impact: worstSite.compliancePct < 75 ? 'Critical' : 'High',
      text: `${worstSite.site} has the lowest pressure compliance at ${worstSite.compliancePct}%.${cost != null ? ` Its modelled tyre-related fuel waste is ${fmtMoney(cost)} per month.` : ''} Prioritise a pressure audit there.`,
    })
  }
  if (kpis.wornTyres > 0) {
    recs.push({
      key: 'worn',
      impact: 'Critical',
      text: `${kpis.wornTyres} tyre${kpis.wornTyres === 1 ? ' is' : 's are'} at or below ${C.TREAD_WORN_MM} mm tread, adding about ${Math.round(C.WORN_TREAD_FUEL_PENALTY_PCT * 100)}% fuel each. Schedule replacement.`,
    })
  }
  if (kpis.avgDevPct != null && kpis.avgDevPct > 10) {
    recs.push({
      key: 'pressure',
      impact: 'High',
      text: `Average under-inflation is ${kpis.avgDevPct}% below nominal. Every 10% under-inflation costs about ${Math.round(C.UNDER_INFLATION_FUEL_PCT_PER_10PCT * 100)}% more fuel.`,
    })
  }
  return recs
}
