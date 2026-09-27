/**
 * vehicleHandoverAnalytics.js - pure analytics for /vehicle-handover (no I/O).
 *
 * The damage count and the base roll-up live in `handoverReports.js` and are
 * REUSED here, never re-derived. This module adds what the page needs on top:
 * filtering, the honest-null KPI set, the condition mix, the monthly trend, the
 * vehicles still out (latest handover is a check-out) and export rows.
 *
 * HONESTY NOTES
 * - Every rate is null when its denominator is zero (an empty register must
 *   never read as "0% poor", which looks like a clean fleet).
 * - Average fuel level only counts reports that carry a fuel reading.
 * - "Still out" is derived from each asset's LATEST dated handover; an asset
 *   whose reports carry no date cannot be placed in time and is not counted.
 * - Time-dependent functions take an injectable `now`.
 */
import { damageCount, summariseHandovers, toFiniteNumber } from './handoverReports'

export const HANDOVER_TYPES = ['checkout', 'checkin']
export const HANDOVER_TYPE_LABEL = { checkout: 'Check-out', checkin: 'Check-in' }
export const CONDITIONS = ['excellent', 'good', 'fair', 'poor']
export const CONDITION_LABEL = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' }
export const CLEANLINESS = ['clean', 'acceptable', 'dirty']
export const NOT_RATED = 'Not rated'

const DAY = 86400000

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
function nowMs(now) { return toMs(now ?? new Date()) ?? Date.now() }
function pct(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : null }
function monthKey(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Filter handovers by country / type / condition / cleanliness / text / date range. */
export function filterHandovers(rows = [], f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  const fromMs = toMs(f.from)
  const toEnd = toMs(f.to)
  const toMsEnd = toEnd == null ? null : toEnd + DAY - 1
  return list.filter((r) => {
    if (f.country && r?.country !== f.country) return false
    if (f.type && r?.handover_type !== f.type) return false
    if (f.condition) {
      if (f.condition === NOT_RATED ? CONDITIONS.includes(r?.condition_rating) : r?.condition_rating !== f.condition) return false
    }
    if (f.cleanliness && r?.cleanliness !== f.cleanliness) return false
    if (f.damagedOnly && damageCount(r) <= 0) return false
    if (fromMs != null || toMsEnd != null) {
      const t = toMs(r?.handover_at)
      if (t == null) return false
      if (fromMs != null && t < fromMs) return false
      if (toMsEnd != null && t > toMsEnd) return false
    }
    if (q) {
      const hay = `${r?.asset_no || ''} ${r?.report_no || ''} ${r?.from_driver || ''} ${r?.to_driver || ''} ${r?.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Assets whose latest DATED handover is a check-out (the vehicle has not come back). */
export function vehiclesStillOut(rows = []) {
  const latest = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    const t = toMs(r?.handover_at)
    if (!asset || t == null) continue
    const cur = latest.get(asset)
    if (!cur || t > cur.t) latest.set(asset, { t, row: r })
  }
  return [...latest.values()]
    .filter((x) => x.row.handover_type === 'checkout')
    .sort((a, b) => a.t - b.t)
    .map((x) => x.row)
}

/** KPI set for the page header. Rates are null (never 0) when unmeasurable. */
export function handoverKpis(rows = [], { now } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseHandovers(list)
  const n = nowMs(now)
  let rated = 0
  let poorOrFair = 0
  let damaged = 0
  let fuelSum = 0
  let fuelN = 0
  let last30 = 0
  const drivers = new Set()
  for (const r of list) {
    if (CONDITIONS.includes(r?.condition_rating)) {
      rated += 1
      if (r.condition_rating === 'poor' || r.condition_rating === 'fair') poorOrFair += 1
    }
    if (damageCount(r) > 0) damaged += 1
    const fuel = toFiniteNumber(r?.fuel_level_pct)
    if (fuel != null) { fuelSum += fuel; fuelN += 1 }
    const t = toMs(r?.handover_at)
    if (t != null && t <= n && n - t <= 30 * DAY) last30 += 1
    for (const d of [r?.from_driver, r?.to_driver]) {
      const k = d != null ? String(d).trim() : ''
      if (k) drivers.add(k.toLowerCase())
    }
  }
  return {
    ...base,
    ratedReports: rated,
    poorRate: pct(base.poorConditionCount, rated),
    belowGoodRate: pct(poorOrFair, rated),
    damagedReports: damaged,
    damageRate: pct(damaged, list.length),
    avgFuelPct: fuelN ? Math.round((fuelSum / fuelN) * 10) / 10 : null,
    last30Days: last30,
    distinctDrivers: drivers.size,
    stillOut: vehiclesStillOut(list).length,
  }
}

/** Condition mix in ladder order plus a Not rated bucket. */
export function conditionMix(rows = []) {
  const out = CONDITIONS.map((c) => ({ key: c, label: CONDITION_LABEL[c], count: 0 }))
  const notRated = { key: NOT_RATED, label: NOT_RATED, count: 0 }
  for (const r of Array.isArray(rows) ? rows : []) {
    const i = CONDITIONS.indexOf(r?.condition_rating)
    if (i >= 0) out[i].count += 1
    else notRated.count += 1
  }
  return notRated.count ? [...out, notRated] : out
}

/** Last `months` calendar months (UTC) ending at `now`: check-outs, check-ins, damages. */
export function monthlyHandoverTrend(rows = [], { now, months = 12 } = {}) {
  const end = new Date(nowMs(now))
  const keys = []
  for (let i = months - 1; i >= 0; i--) {
    keys.push(monthKey(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)))
  }
  const map = new Map(keys.map((k) => [k, { month: k, checkouts: 0, checkins: 0, damages: 0 }]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = toMs(r?.handover_at)
    if (t == null) continue
    const b = map.get(monthKey(t))
    if (!b) continue
    if (r.handover_type === 'checkout') b.checkouts += 1
    else if (r.handover_type === 'checkin') b.checkins += 1
    b.damages += damageCount(r)
  }
  return keys.map((k) => map.get(k))
}

/** Assets ranked by damages logged (then poor reports). */
export function assetDamageLeaders(rows = [], limit = 8) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (!asset) continue
    const b = map.get(asset) || { asset, reports: 0, damages: 0, poor: 0 }
    b.reports += 1
    b.damages += damageCount(r)
    if (r.condition_rating === 'poor') b.poor += 1
    map.set(asset, b)
  }
  return [...map.values()]
    .filter((b) => b.damages > 0 || b.poor > 0)
    .sort((a, b) => b.damages - a.damages || b.poor - a.poor || a.asset.localeCompare(b.asset))
    .slice(0, limit)
}

export const HANDOVER_EXPORT_COLUMNS = [
  ['report_no', 'Report #'], ['asset_no', 'Asset'], ['handover_type', 'Type'],
  ['from_driver', 'From driver'], ['to_driver', 'To driver'], ['handover_at', 'Handover at'],
  ['odometer_km', 'Odometer (km)'], ['fuel_level_pct', 'Fuel (%)'], ['condition_rating', 'Condition'],
  ['damage_count', 'Damages'], ['cleanliness', 'Cleanliness'], ['notes', 'Notes'],
]

/** Flat export rows; blanks stay blank (never a fabricated 0). */
export function handoverExportRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    report_no: r?.report_no || '',
    asset_no: r?.asset_no || '',
    handover_type: HANDOVER_TYPE_LABEL[r?.handover_type] || r?.handover_type || '',
    from_driver: r?.from_driver || '',
    to_driver: r?.to_driver || '',
    handover_at: r?.handover_at || '',
    odometer_km: toFiniteNumber(r?.odometer_km) ?? '',
    fuel_level_pct: toFiniteNumber(r?.fuel_level_pct) ?? '',
    condition_rating: CONDITION_LABEL[r?.condition_rating] || r?.condition_rating || '',
    damage_count: damageCount(r),
    cleanliness: r?.cleanliness || '',
    notes: r?.notes || '',
  }))
}
