/**
 * fuelEfficiencyView - pure shaping for the rebuilt Fuel Efficiency page (owner
 * mockup "Fuel Efficiency"). Builds on fuelEfficiencyAnalytics (the modelled
 * tyre-condition fuel penalty) and never re-derives its rules.
 *
 * Honesty: this app records NO fuel volume (fuel_transactions is empty), so a
 * measured km/L, fuel cost per km, litres used or emissions do not exist. Those
 * places read "Not recorded" with FUEL_DATA_REASON. What IS real are the tyre
 * pressure and tread readings; everything derived from them is a MODELLED
 * estimate and is labelled so. Scenario outputs are user-input what-ifs.
 *
 * No I/O, no React.
 */
import { FUEL_CONSTANTS, baseMonthlyFuel } from './fuelEfficiencyAnalytics'

const C = FUEL_CONSTANTS

export const FUEL_DATA_REASON = 'No fuel volume is recorded yet (no fuel transactions), so measured km/L, fuel cost per km and emissions cannot be calculated.'

const num = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const round = (v, dp = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp)
const mean = (xs) => {
  const ys = xs.filter((v) => v != null && Number.isFinite(v))
  return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : null
}

/** Status of one vehicle from its tyre readings (never "Good" when unmeasured). */
export function vehicleStatus(v) {
  if (!v || v.penaltyPct == null) return { key: 'unmeasured', label: 'Not measured', tone: 'muted' }
  if ((v.avgTread != null && v.avgTread <= C.TREAD_WORN_MM) || v.penaltyPct >= 3) return { key: 'service', label: 'Service soon', tone: 'bad' }
  if (v.penaltyPct >= 1.5 || (v.compliancePct != null && v.compliancePct < 75)) return { key: 'check', label: 'Check tyres', tone: 'warn' }
  return { key: 'good', label: 'Good', tone: 'good' }
}

export const STATUS_OPTIONS = [
  { key: 'good', label: 'Good' },
  { key: 'check', label: 'Check tyres' },
  { key: 'service', label: 'Service soon' },
  { key: 'unmeasured', label: 'Not measured' },
]

/** Priority of a savings opportunity by modelled penalty. */
export function priorityOf(penaltyPct) {
  if (penaltyPct == null) return null
  if (penaltyPct >= 3) return { label: 'High', tone: 'bad' }
  if (penaltyPct >= 1.5) return { label: 'Medium', tone: 'warn' }
  return { label: 'Low', tone: 'good' }
}

/** Vehicles with the largest modelled fuel waste first (cost when priced, else penalty). */
export function savingsOpportunities(vehicles = [], limit = 5) {
  return (Array.isArray(vehicles) ? vehicles : [])
    .filter((v) => v.penaltyPct != null && v.penaltyPct > 0)
    .sort((a, b) => (b.annualExtraCost ?? -1) - (a.annualExtraCost ?? -1) || b.penaltyPct - a.penaltyPct)
    .slice(0, limit)
    .map((v) => ({ ...v, priority: priorityOf(v.penaltyPct) }))
}

/** Best tyre condition first: lowest modelled penalty among measured vehicles. */
export function topPerformers(vehicles = [], limit = 5) {
  return (Array.isArray(vehicles) ? vehicles : [])
    .filter((v) => v.penaltyPct != null)
    .sort((a, b) => a.penaltyPct - b.penaltyPct || b.measuredTyres - a.measuredTyres || String(a.asset_no).localeCompare(String(b.asset_no)))
    .slice(0, limit)
}

/** Mean modelled penalty per site from its measured vehicles. */
export function sitePenalty(vehicles = []) {
  const m = new Map()
  for (const v of Array.isArray(vehicles) ? vehicles : []) {
    const s = v.site || 'Site not recorded'
    const e = m.get(s) || { site: s, vehicles: 0, penalties: [] }
    e.vehicles += 1
    if (v.penaltyPct != null) e.penalties.push(v.penaltyPct)
    m.set(s, e)
  }
  return [...m.values()]
    .map((e) => ({ site: e.site, vehicles: e.vehicles, measuredVehicles: e.penalties.length, penaltyPct: round(mean(e.penalties), 2) }))
    .filter((e) => e.penaltyPct != null)
    .sort((a, b) => a.penaltyPct - b.penaltyPct || a.site.localeCompare(b.site))
}

/** Fleet mean modelled penalty across measured vehicles (null when none). */
export function fleetPenaltyPct(vehicles = []) {
  return round(mean((Array.isArray(vehicles) ? vehicles : []).map((v) => v.penaltyPct)), 2)
}

/**
 * Tread vs modelled penalty points banded by tread depth, plus a least-squares
 * line and R squared. Bands: worn (< 5 mm), monitor (5 to 8 mm), good (> 8 mm).
 */
export function treadBands(enriched = []) {
  const pts = (Array.isArray(enriched) ? enriched : [])
    .map((t) => ({ x: num(t.tread_depth), y: t.extraFuelPct }))
    .filter((p) => p.x != null && p.x > 0 && p.y != null)
  const bands = { worn: [], monitor: [], good: [] }
  for (const p of pts) (p.x < 5 ? bands.worn : p.x <= 8 ? bands.monitor : bands.good).push(p)
  let line = null
  let r2 = null
  if (pts.length >= 3) {
    const n = pts.length
    const mx = pts.reduce((s, p) => s + p.x, 0) / n
    const my = pts.reduce((s, p) => s + p.y, 0) / n
    const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
    const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
    const syy = pts.reduce((s, p) => s + (p.y - my) ** 2, 0)
    if (sxx > 0) {
      const slope = sxy / sxx
      const icpt = my - slope * mx
      const xs = pts.map((p) => p.x)
      const lo = Math.min(...xs)
      const hi = Math.max(...xs)
      line = [{ x: lo, y: round(slope * lo + icpt, 3) }, { x: hi, y: round(slope * hi + icpt, 3) }]
      r2 = syy > 0 ? round((sxy * sxy) / (sxx * syy), 2) : null
    }
  }
  return { ...bands, line, r2, points: pts.length }
}

/**
 * Scenario "replace worn tyres": the modelled saving if every tyre at or below
 * 3 mm lost its tread penalty. Needs consumption and monthly km (price for cost).
 */
export function wornReplacementSavings(enriched = [], { consumptionL100, monthlyKm, pricePerL } = {}) {
  const base = baseMonthlyFuel(consumptionL100, monthlyKm)
  const byVehicle = new Map()
  let wornTyres = 0
  for (const t of Array.isArray(enriched) ? enriched : []) {
    if (!t?.asset_no || !t.measured) continue
    const pressPen = t.pressDev == null ? 0 : (t.pressDev / 0.10) * C.UNDER_INFLATION_FUEL_PCT_PER_10PCT
    const td = num(t.tread_depth)
    const worn = td != null && td <= C.TREAD_WORN_MM
    if (worn) wornTyres += 1
    const after = worn ? pressPen : t.penalty
    const e = byVehicle.get(t.asset_no) || { before: [], after: [], worn: false }
    e.before.push(t.penalty)
    e.after.push(after)
    if (worn) e.worn = true
    byVehicle.set(t.asset_no, e)
  }
  const affected = [...byVehicle.values()].filter((e) => e.worn)
  const deltaFraction = affected.reduce((s, e) => s + (mean(e.before) - mean(e.after)), 0)
  if (base == null) return { monthlyLitres: null, monthlyCost: null, annualCost: null, vehicles: affected.length, wornTyres }
  const litres = deltaFraction * base
  const price = num(pricePerL)
  const cost = price == null ? null : litres * price
  return {
    monthlyLitres: round(litres, 0),
    monthlyCost: round(cost, 2),
    annualCost: cost == null ? null : round(cost * 12, 2),
    vehicles: affected.length,
    wornTyres,
  }
}

/** Annual litres, cost and CO2 from a monthly saving (each null when unknown). */
export function scenarioOutputs(saving) {
  const monthly = saving?.monthlyLitres
  const annualLitres = monthly == null ? null : Math.round(monthly * 12)
  return {
    annualCost: saving?.annualCost ?? null,
    annualLitres,
    co2Tonnes: annualLitres == null ? null : round((annualLitres * C.CO2_KG_PER_LITER) / 1000, 1),
  }
}

/** Free-text + site + status filter for the details table. */
export function filterVehicles(vehicles = [], { search = '', site = '', status = '' } = {}) {
  const q = String(search).trim().toLowerCase()
  return (Array.isArray(vehicles) ? vehicles : []).filter((v) => {
    if (site && (v.site || '') !== site) return false
    if (status && vehicleStatus(v).key !== status) return false
    if (q && !`${v.asset_no || ''} ${v.site || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}
