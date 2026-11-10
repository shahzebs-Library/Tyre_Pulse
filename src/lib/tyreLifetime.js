/**
 * tyreLifetime.js - ONE physical tyre, however many times it was fitted.
 *
 * tyre_records holds one row per FITMENT. A tyre that was removed, stored and
 * fitted again (same or another vehicle) has several rows with the same serial.
 * Cost per km and tyre life must be measured per PHYSICAL TYRE:
 *   - purchase cost counted ONCE (owner rule "one tyre one price"): the first
 *     priced fitment. A later fitment carries no new purchase.
 *   - km = the sum of every completed fitment's km, each measured by the shared
 *     km rule (src/lib/tyreKm.js: placeholder "1" and over-class-cap readings are
 *     unknown, never guessed; a factory 0 fitment is real).
 * A row whose serial is not a real serial (a DOT batch code, a size, a
 * placeholder, an Excel-mangled number) cannot be tied to other rows, so it is
 * treated as its own tyre and its quantity is honoured.
 *
 * MIRROR: isStrongSerial() mirrors SQL public.tyre_serial_is_strong() - change both.
 */
import { tyreKmAssessment } from './tyreKm'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Real serial (one physical tyre) vs a shared code / size / placeholder. */
export function isStrongSerial(serial) {
  const s = String(serial ?? '').trim().toUpperCase()
  if (s.length < 6) return false
  // A real serial always carries a digit; letter-only values are placeholders
  // ("NO SERIAL", "NOT CLEAR", "#NAME?", "NEW TYRE").
  if (!/[0-9]/.test(s)) return false
  if (/^(DOT|NULL|N\/?A|-)/.test(s)) return false
  if (/^[0-9]{3}\//.test(s)) return false
  if (/[0-9]{2,3}\/[0-9]{2}\s*R/.test(s)) return false
  if (/E\+[0-9]+$/.test(s)) return false
  // 20261109150000: a month code (FEB-62), a size typed with spaces (195 R 15),
  // two serials in one cell, repeated digits and keyboard sequences.
  if (/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- /]?[0-9]{2,4}$/.test(s)) return false
  if (/^[0-9]{2,3}(\.[0-9]+)?\s*R\s*[0-9]{2}(\.[0-9])?($|[^0-9])/.test(s)) return false
  if (/[,;&]/.test(s)) return false
  if (/^([0-9])\1+$/.test(s)) return false
  if (SEQUENCES.has(s)) return false
  return true
}

const SEQUENCES = new Set(['123456', '1234567', '12345678', '123456789', '1234567890'])

/**
 * Fitment rows with each physical tyre's purchase price kept ONCE: the first
 * priced fitment keeps its price, a later fitment of the same real serial is
 * returned with cost_per_tyre null (it is the same tyre, refitted). Rows whose
 * serial is not a real serial are returned unchanged. Use this wherever money is
 * summed per fitment row (cost trends, scrap cost) so a refit is not bought twice.
 */
export function withOnePricePerTyre(records = []) {
  const firstPriced = new Map()
  records.forEach((r, i) => {
    if (!isStrongSerial(r?.serial_no) || !((num(r.cost_per_tyre) ?? 0) > 0)) return
    const key = `${String(r.country ?? '').trim().toUpperCase()}|${String(r.serial_no).trim().toUpperCase()}`
    const cur = firstPriced.get(key)
    if (cur == null || earlierFitment(r, records[cur])) firstPriced.set(key, i)
  })
  const keep = new Set(firstPriced.values())
  return records.map((r, i) => {
    if (!isStrongSerial(r?.serial_no) || !((num(r?.cost_per_tyre) ?? 0) > 0) || keep.has(i)) return r
    return { ...r, cost_per_tyre: null, _refit_price_dropped: true }
  })
}

/** km one completed fitment ran, by the shared rule; null when not measurable. */
export function fitmentKm(row) {
  const a = tyreKmAssessment(row)
  return a.status === 'measured' || a.status === 'factory' ? a.km : null
}

const dateOf = (r) => String(r?.issue_date ?? r?.fitment_date ?? '').slice(0, 10)

/**
 * Fitment order used by EVERY "first priced fitment" decision: date, then id.
 * withOnePricePerTyre used to break a same-date tie by input order while
 * toLifetimeTyres broke it by id, so a serial priced twice on the same day
 * (K507B403860: 950 on MP111, 766 on TM676) cost 766 in lifetime CPK and 950 in
 * scrap cost / cost trend / TCO. One comparator now decides both.
 */
export function compareFitments(a, b) {
  const da = dateOf(a); const db = dateOf(b)
  if (da !== db) return da < db ? -1 : 1
  const ia = String(a?.id ?? ''); const ib = String(b?.id ?? '')
  return ia < ib ? -1 : ia > ib ? 1 : 0
}
const earlierFitment = (a, b) => compareFitments(a, b) < 0

/**
 * Active fitment. MIRROR of SQL public.tyre_status_is_active(text): a status is
 * active when present and not removed / scrapped / written off / disposed.
 */
export function isActiveTyreStatus(status) {
  const s = String(status ?? '').trim().toLowerCase()
  if (!s) return false
  return !/remov|scrap|written|dispos/.test(s)
}

/** Physical-tyre key. MIRROR of the tyre_key column of SQL v_tyre_lifetime_fitments. */
export function tyreKey(row, index = 0) {
  return isStrongSerial(row?.serial_no)
    ? `${String(row.country ?? '').trim().toUpperCase()}|${String(row.serial_no).trim().toUpperCase()}`
    : `row:${row?.id ?? index}`
}

/**
 * Purchase cost status of one physical tyre (Phase 1 statuses, see BUSINESS_RULES T17):
 * ACTUAL | ESTIMATED | CONFIRMED_ZERO | DISPUTED | MISSING. A row may carry the
 * price source as `price_source` (tyre_price_backfill_log.source) or the
 * v_tyre_cost_status value as `cost_status`.
 */
function costStatusOf(ordered, priced, strong) {
  const pricedRows = ordered.filter((r) => (num(r.cost_per_tyre) ?? 0) > 0)
  if (strong && pricedRows.length > 1) return 'DISPUTED'
  if (priced) {
    const src = String(priced.price_source ?? priced.cost_status ?? '').toLowerCase()
    return src.includes('comparable') ? 'ESTIMATED' : 'ACTUAL'
  }
  if (ordered.some((r) => String(r.price_source ?? '').toLowerCase() === 'warranty')) return 'CONFIRMED_ZERO'
  return 'MISSING'
}

/**
 * Collapse fitment rows into physical tyres. MIRROR of SQL public.v_tyre_lifetime
 * (migration 20261109160000) - change both together.
 * Each result is the LATEST fitment row (so brand/site/asset reflect where the
 * tyre is now) plus:
 *   _key                 physical-tyre key (country|serial, or row:<id> for a weak serial)
 *   _cost                purchase price counted once (null when never priced) - rule T1
 *   _cost_status         ACTUAL | ESTIMATED | CONFIRMED_ZERO | DISPUTED | MISSING
 *   _life_km             validated km across all NON-OVERLAPPING fitments (null when none measurable)
 *   _qty                 tyres the row stands for (1 for a real serial)
 *   _fitments            number of fitment rows
 *   _vehicles            distinct vehicles it ran on
 *   _km_unknown_fitments completed fitments with no measurable km (rule T7)
 *   _overlapping_fitments fitments that started before an earlier fitment of the same
 *                        tyre ended (an unclosed rotation or a double entry); their km is
 *                        NOT added, so the same kilometres are never counted twice
 *   _km_coverage         'complete' | 'partial' | 'none'
 *   _km_partial          true when coverage is not complete but some km is known (kept for callers)
 *   _active              the tyre is still fitted
 *   _provisional         active, or km coverage not complete: the figure is not final
 *   _repair_cost / _retread_cost / _recovery  linked by real serial (options.extras)
 *   _full_cost           purchase + repairs + retreads - recoveries (null when not priced)
 *
 * options.extras: Map | object keyed by tyreKey -> { repair, retread, recovery }.
 */
export function toLifetimeTyres(records = [], options = {}) {
  const extras = options.extras instanceof Map ? options.extras : new Map(Object.entries(options.extras || {}))
  const groups = new Map()
  records.forEach((r, i) => {
    const strong = isStrongSerial(r?.serial_no)
    const key = tyreKey(r, i)
    if (!groups.has(key)) groups.set(key, { strong, rows: [] })
    groups.get(key).rows.push(r)
  })
  const out = []
  for (const [key, { strong, rows }] of groups.entries()) {
    const ordered = [...rows].sort(compareFitments)
    const priced = ordered.find((r) => (num(r.cost_per_tyre) ?? 0) > 0)
    let km = 0
    let anyKm = false
    let unknown = 0
    let overlapping = 0
    let active = false
    let prevEnd = null // latest end of any earlier fitment; Infinity = still fitted
    const vehicles = new Set()
    for (const r of ordered) {
      if (r.asset_no) vehicles.add(String(r.asset_no).trim().toUpperCase())
      const fit = dateOf(r)
      const rowActive = isActiveTyreStatus(r.status)
      if (rowActive) active = true
      const completed = Boolean(r.removal_date) || num(r.km_at_removal) != null
      const overlaps = Boolean(fit) && prevEnd != null && (prevEnd === Infinity || fit < prevEnd)
      if (overlaps) overlapping += 1
      const k = fitmentKm(r)
      if (k != null && k > 0) { if (!overlaps) { km += k; anyKm = true } }
      else if (completed) unknown += 1
      const end = r.removal_date ? String(r.removal_date).slice(0, 10) : (!completed && rowActive ? Infinity : null)
      if (end != null && (prevEnd == null || prevEnd !== Infinity && (end === Infinity || end > prevEnd))) prevEnd = end
    }
    const latest = ordered[ordered.length - 1]
    const cost = priced ? num(priced.cost_per_tyre) : null
    const ex = extras.get(key) || {}
    const repair = num(ex.repair) ?? 0
    const retread = num(ex.retread) ?? 0
    const recovery = num(ex.recovery) ?? 0
    const coverage = !anyKm ? 'none' : (unknown > 0 || overlapping > 0 ? 'partial' : 'complete')
    out.push({
      ...latest,
      _key: key,
      _cost: cost,
      _cost_status: costStatusOf(ordered, priced, strong),
      _life_km: anyKm ? km : null,
      _qty: strong ? 1 : Math.max(1, num(latest.qty) ?? 1),
      _fitments: ordered.length,
      _vehicles: vehicles.size,
      _km_unknown_fitments: unknown,
      _overlapping_fitments: overlapping,
      _km_coverage: coverage,
      _km_partial: coverage === 'partial',
      _active: active,
      _provisional: active || coverage !== 'complete',
      _repair_cost: repair,
      _retread_cost: retread,
      _recovery: recovery,
      _full_cost: cost != null && cost > 0 ? cost + repair + retread - recovery : null,
    })
  }
  return out
}

/**
 * Shape a row of SQL public.v_tyre_lifetime into the same object toLifetimeTyres()
 * returns, so a page can use the server definition without re-deriving it.
 */
export function fromLifetimeView(v = {}) {
  const cov = v.km_coverage || 'none'
  return {
    ...v,
    id: v.latest_id ?? v.id,
    _key: v.tyre_key,
    _cost: num(v.purchase_cost),
    _cost_status: v.purchase_cost_status || 'MISSING',
    _life_km: num(v.km_known),
    _qty: num(v.qty) ?? 1,
    _fitments: num(v.fitments) ?? 1,
    _vehicles: num(v.vehicles) ?? 0,
    _km_unknown_fitments: num(v.km_unknown_fitments) ?? 0,
    _overlapping_fitments: num(v.overlapping_fitments) ?? 0,
    _km_coverage: cov,
    _km_partial: cov === 'partial',
    _active: Boolean(v.is_active),
    _provisional: Boolean(v.provisional),
    _repair_cost: num(v.repair_cost) ?? 0,
    _retread_cost: num(v.retread_cost) ?? 0,
    _recovery: num(v.recovery) ?? 0,
    _full_cost: num(v.full_cost),
  }
}

/** True when a physical tyre has both a price and a measured life. */
export function hasLifetimeCpk(t) {
  return (num(t?._cost) ?? 0) > 0 && (num(t?._life_km) ?? 0) > 0
}

/** A. Purchase-only lifetime CPK of one physical tyre (null when not measurable). */
export function lifetimeCpk(t) {
  return hasLifetimeCpk(t) ? t._cost / t._life_km : null
}
export const purchaseLifetimeCpk = lifetimeCpk

/**
 * B. Full lifetime CPK of one physical tyre:
 * (purchase + linked repairs + linked retreads - confirmed recoveries) / validated km.
 */
export function fullLifetimeCpk(t) {
  if (!hasLifetimeCpk(t)) return null
  const full = num(t._full_cost) ?? t._cost
  return full / t._life_km
}

/**
 * Fleet cost per tyre-km, WEIGHTED (rule T8): total cost of the measurable tyres
 * divided by their total km. An average of per-tyre ratios would let one short,
 * expensive tyre swing the whole fleet figure.
 * options.basis: 'purchase' (default) | 'full'.
 */
export function weightedCpk(tyres = [], options = {}) {
  const full = options.basis === 'full'
  let cost = 0
  let km = 0
  for (const t of tyres) {
    if (!hasLifetimeCpk(t)) continue
    const c = full ? (num(t._full_cost) ?? t._cost) : t._cost
    cost += c * (t._qty || 1)
    km += t._life_km * (t._qty || 1)
  }
  return km > 0 ? cost / km : null
}

/**
 * One summary of a set of physical tyres: weighted purchase and full CPK, the cost
 * and km behind them, coverage and cost-status counts, and how much of the cost in
 * the CPK is ESTIMATED. Use this wherever a page shows lifetime CPK so every page
 * states the same coverage.
 */
export function lifetimeSummary(tyres = []) {
  const coverage = { complete: 0, partial: 0, none: 0 }
  const status = { ACTUAL: 0, ESTIMATED: 0, CONFIRMED_ZERO: 0, DISPUTED: 0, MISSING: 0 }
  let measurable = 0; let cost = 0; let fullCost = 0; let km = 0; let estimated = 0
  let provisional = 0; let overlapping = 0; let refitted = 0
  for (const t of tyres) {
    coverage[t._km_coverage || 'none'] = (coverage[t._km_coverage || 'none'] || 0) + 1
    status[t._cost_status || 'MISSING'] = (status[t._cost_status || 'MISSING'] || 0) + 1
    if (t._provisional) provisional += 1
    if ((t._overlapping_fitments || 0) > 0) overlapping += 1
    if ((t._fitments || 1) > 1) refitted += 1
    if (!hasLifetimeCpk(t)) continue
    const q = t._qty || 1
    measurable += 1
    cost += t._cost * q
    fullCost += (num(t._full_cost) ?? t._cost) * q
    km += t._life_km * q
    if (t._cost_status === 'ESTIMATED') estimated += t._cost * q
  }
  return {
    tyres: tyres.length,
    measurable,
    purchaseCost: cost,
    fullCost,
    km,
    cpkPurchase: km > 0 ? cost / km : null,
    cpkFull: km > 0 ? fullCost / km : null,
    estimatedCostInCpk: estimated,
    estimatedShare: cost > 0 ? estimated / cost : null,
    coverage,
    costStatus: status,
    provisional,
    tyresWithOverlap: overlapping,
    refittedTyres: refitted,
  }
}

/** Split physical tyres into FINAL (no longer fitted) and PROVISIONAL (still fitted). */
export function splitFinalProvisional(tyres = []) {
  const final = []; const provisional = []
  for (const t of tyres) (t._active ? provisional : final).push(t)
  return { final, provisional }
}

/**
 * The five CPK measurements. They are DIFFERENT numbers and must never be
 * combined or relabelled: every page that shows a CPK states which one.
 */
export const CPK_KIND = Object.freeze({
  PER_FITMENT: 'per_fitment',
  TYRE_LIFETIME: 'tyre_lifetime',
  FLEET_AGGREGATE: 'fleet_aggregate',
  FLEET_EXPENSE_PER_VEHICLE_KM: 'fleet_expense_per_vehicle_km',
  CPH: 'cph',
})

export const CPK_KIND_LABEL = Object.freeze({
  per_fitment: 'Per-fitment tyre CPK (one stint)',
  tyre_lifetime: 'Physical tyre lifetime CPK',
  fleet_aggregate: 'Fleet aggregate tyre CPK (weighted, per tyre-km)',
  fleet_expense_per_vehicle_km: 'Fleet expense per vehicle-km',
  cph: 'Cost per engine hour (hour-based assets)',
})
