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
  return true
}

/** km one completed fitment ran, by the shared rule; null when not measurable. */
export function fitmentKm(row) {
  const a = tyreKmAssessment(row)
  return a.status === 'measured' || a.status === 'factory' ? a.km : null
}

const dateOf = (r) => String(r?.issue_date ?? r?.fitment_date ?? '').slice(0, 10)

/**
 * Collapse fitment rows into physical tyres.
 * Each result is the LATEST fitment row (so brand/site/asset reflect where the
 * tyre is now) plus:
 *   _cost       purchase price counted once (null when never priced)
 *   _life_km    km across all completed fitments (null when none measurable)
 *   _qty        tyres the row stands for (1 for a real serial)
 *   _fitments   number of fitment rows
 *   _vehicles   distinct vehicles it ran on
 *   _km_partial true when a completed fitment had no measurable km
 */
export function toLifetimeTyres(records = []) {
  const groups = new Map()
  records.forEach((r, i) => {
    const strong = isStrongSerial(r?.serial_no)
    const key = strong
      ? `${String(r.country ?? '').trim().toUpperCase()}|${String(r.serial_no).trim().toUpperCase()}`
      : `row:${i}`
    if (!groups.has(key)) groups.set(key, { strong, rows: [] })
    groups.get(key).rows.push(r)
  })
  const out = []
  for (const { strong, rows } of groups.values()) {
    const ordered = [...rows].sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : 0))
    const priced = ordered.find((r) => (num(r.cost_per_tyre) ?? 0) > 0)
    let km = 0
    let anyKm = false
    let partial = false
    const vehicles = new Set()
    for (const r of ordered) {
      if (r.asset_no) vehicles.add(String(r.asset_no).trim().toUpperCase())
      const k = fitmentKm(r)
      if (k != null && k > 0) { km += k; anyKm = true }
      else if (r.removal_date || num(r.km_at_removal) != null) partial = true
    }
    const latest = ordered[ordered.length - 1]
    out.push({
      ...latest,
      _cost: priced ? num(priced.cost_per_tyre) : null,
      _life_km: anyKm ? km : null,
      _qty: strong ? 1 : Math.max(1, num(latest.qty) ?? 1),
      _fitments: ordered.length,
      _vehicles: vehicles.size,
      _km_partial: partial,
    })
  }
  return out
}

/** True when a physical tyre has both a price and a measured life. */
export function hasLifetimeCpk(t) {
  return (num(t?._cost) ?? 0) > 0 && (num(t?._life_km) ?? 0) > 0
}

/** Cost per km of one physical tyre (null when not measurable). */
export function lifetimeCpk(t) {
  return hasLifetimeCpk(t) ? t._cost / t._life_km : null
}

/**
 * Fleet cost per tyre-km, WEIGHTED: total purchase cost of the measurable tyres
 * divided by their total km. An average of per-tyre ratios would let one short,
 * expensive tyre swing the whole fleet figure.
 */
export function weightedCpk(tyres = []) {
  let cost = 0
  let km = 0
  for (const t of tyres) {
    if (!hasLifetimeCpk(t)) continue
    cost += t._cost * (t._qty || 1)
    km += t._life_km * (t._qty || 1)
  }
  return km > 0 ? cost / km : null
}
