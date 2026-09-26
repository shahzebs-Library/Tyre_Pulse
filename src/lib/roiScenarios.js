/**
 * roiScenarios - pure helpers for the ROI Calculator:
 *   1. seed the model's fleet inputs from REAL measured CPK (get_fleet_cpk),
 *   2. keep named scenarios on this device (localStorage, never trusted blindly),
 *   3. compare scenarios side by side.
 *
 * Only inputs the data genuinely measures are seeded. Everything else stays an
 * assumption and is labelled as such; nothing is invented. A scenario carries
 * its currency, and scenarios in different currencies are never totalled.
 */
import { computeTyreRoi, ROI_DEFAULTS } from './tyreRoi'

export const SCENARIO_KEY = 'tp_roi_scenarios_v1'
export const MAX_SCENARIOS = 20

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)

/** Whole days in an inclusive ISO date window, or null. */
export function windowDays(from, to) {
  if (!from || !to) return null
  const a = new Date(`${from}T00:00:00Z`).getTime(); const b = new Date(`${to}T00:00:00Z`).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return Math.round((b - a) / 86400000) + 1
}

/**
 * Seed inputs from a get_fleet_cpk result for ONE country.
 * @param {{fleet:Array, perVehicle:Array}} cpk
 * @param {{country:string, from:string, to:string}} scope
 * @returns {{ok:boolean, reason?:string, inputs:object, seeded:object, currency:string|null}}
 */
export function seedFromFleetCpk(cpk, { country, from, to } = {}) {
  const empty = { ok: false, inputs: {}, seeded: {}, currency: null }
  if (!country || country === 'All') return { ...empty, reason: 'Pick one country. Money in different currencies cannot be combined into one model.' }
  const row = (cpk?.fleet || []).find(f => f?.country === country) || null
  const km = row?.km
  if (!row || !km) return { ...empty, reason: 'No measured CPK for this country and period.' }
  const totalKm = num(km.total_km ?? km.total)
  const cpkTyre = num(km.cpk_tyre)
  const vehicles = (cpk?.perVehicle || []).filter(v => (v.unit || 'km') === 'km' && Number(v.distance_or_hours) > 0).length
  const days = windowDays(from, to)
  const inputs = {}; const seeded = {}
  if (cpkTyre != null && cpkTyre > 0) { inputs.current_cpkm = Number(cpkTyre.toFixed(4)); seeded.current_cpkm = `Measured tyre CPK, ${from} to ${to}` }
  if (vehicles > 0) { inputs.fleet_size = vehicles; seeded.fleet_size = 'Road vehicles with measured km in the period' }
  if (vehicles > 0 && totalKm != null && totalKm > 0 && days) {
    inputs.daily_km_per_vehicle = Math.round(totalKm / vehicles / days)
    seeded.daily_km_per_vehicle = `Measured tyre km / vehicles / ${days} days`
  }
  if (!Object.keys(inputs).length) return { ...empty, currency: row.currency || null, reason: 'The measured CPK carries no usable km or cost for this period.' }
  return { ok: true, inputs, seeded, currency: row.currency || null, coveragePct: num(km.coverage_pct) }
}

/** Parse whatever is in storage into a safe scenario list. */
export function parseScenarios(raw) {
  let list
  try { list = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return [] }
  if (!Array.isArray(list)) return []
  return list.filter(s => s && typeof s.name === 'string' && s.name.trim() && s.inputs && typeof s.inputs === 'object')
    .slice(0, MAX_SCENARIOS)
    .map(s => ({
      id: String(s.id || s.name),
      name: s.name.trim().slice(0, 80),
      country: s.country || null,
      currency: s.currency || null,
      savedAt: s.savedAt || null,
      inputs: Object.fromEntries(Object.keys(ROI_DEFAULTS).map(k => [k, num(s.inputs[k]) ?? ROI_DEFAULTS[k]])),
    }))
}

export function loadScenarios(storage = globalThis.localStorage) {
  try { return parseScenarios(storage?.getItem(SCENARIO_KEY) ?? '[]') } catch { return [] }
}

export function persistScenarios(list, storage = globalThis.localStorage) {
  try { storage?.setItem(SCENARIO_KEY, JSON.stringify(list.slice(0, MAX_SCENARIOS))); return true } catch { return false }
}

/** Add or replace (by name) a scenario; newest first. */
export function upsertScenario(list, { name, inputs, country, currency }, now = new Date()) {
  const clean = String(name || '').trim().slice(0, 80)
  if (!clean) throw new Error('Give the scenario a name.')
  const entry = { id: `${now.getTime()}`, name: clean, country: country || null, currency: currency || null, savedAt: now.toISOString(), inputs: { ...inputs } }
  return [entry, ...list.filter(s => s.name.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_SCENARIOS)
}

export function removeScenario(list, id) {
  return list.filter(s => s.id !== id)
}

/** One comparison row per scenario, computed with the same ROI model. */
export function compareScenarios(list = []) {
  return list.map(s => {
    const r = computeTyreRoi(s.inputs)
    return {
      id: s.id, name: s.name, country: s.country || 'N/A', currency: s.currency || 'N/A',
      fleet_size: s.inputs.fleet_size, current_cpkm: s.inputs.current_cpkm,
      net_benefit: r.netAnnualBenefit, roi_pct: r.roi,
      payback_months: r.paybackMonths == null ? 'N/A' : r.paybackMonths,
      savings: r.totalAnnualSavings, programme_cost: r.programmeAnnualCost,
    }
  })
}

/** True when the comparison spans more than one currency (totals must not be shown). */
export function mixedCurrency(rows = []) {
  return new Set(rows.map(r => r.currency)).size > 1
}
