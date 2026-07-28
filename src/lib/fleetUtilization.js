/**
 * fleetUtilization — the single pure engine behind the Fleet Utilization surface
 * (`/fleet-utilization`) and the per-asset utilization panel on Asset Detail.
 *
 * Source data is the telematics snapshot loaded into `asset_utilization` (V406):
 * per asset, per capture period — working / driving / idle time, distance,
 * utilization %, max speed and the latest odometer (`odo_end`, which also feeds
 * `vehicle_fleet.current_km` via the odometer pipe). Rows may or may not link to
 * a registered fleet asset (`linked_to_fleet`).
 *
 * Deterministic, no I/O, no Date.now(): every summary is a pure function of the
 * rows passed in so it is trivially testable and the page and the PDF export
 * always agree. Honest nulls — an unmeasurable average is null, never a
 * flattering zero. Money/units are never fabricated.
 */

/** Coerce to a finite number or null. */
export function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Seconds -> hours (1dp), or null. */
export function secondsToHours(sec) {
  const n = num(sec)
  return n == null ? null : Math.round((n / 3600) * 10) / 10
}

/** Mean of the finite values in a list, or null when none are measurable. */
export function mean(values) {
  const nums = (values || []).map(num).filter((n) => n != null)
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/** Sum of the finite values (0 when none — a total of nothing is genuinely 0). */
export function sum(values) {
  return (values || []).map(num).filter((n) => n != null).reduce((a, b) => a + b, 0)
}

/** Utilization band for a single row (by utilization %). */
export const BANDS = ['High', 'Medium', 'Low', 'Unknown']
export function bandOf(row) {
  const u = num(row?.utilization_pct)
  if (u == null) return 'Unknown'
  if (u >= 75) return 'High'
  if (u >= 40) return 'Medium'
  return 'Low'
}

/** Idle share for a row: prefer the reported idle %, else derive from seconds. */
export function idlePct(row) {
  const reported = num(row?.idle_pct)
  if (reported != null) return reported
  const idle = num(row?.idle_seconds)
  const working = num(row?.working_seconds)
  if (idle != null && working && working > 0) return Math.round((idle / working) * 1000) / 10
  return null
}

/**
 * Filter utilization rows. All criteria optional.
 * @param {Array} rows
 * @param {{search?:string, country?:string, band?:string, linkedOnly?:boolean, minIdle?:number}} f
 */
export function filterUtilization(rows, f = {}) {
  const q = (f.search || '').trim().toLowerCase()
  const country = f.country && f.country !== 'All' ? f.country : null
  return (rows || []).filter((r) => {
    if (country && r.country !== country) return false
    if (f.linkedOnly && !r.linked_to_fleet) return false
    if (f.band && f.band !== 'All' && bandOf(r) !== f.band) return false
    if (f.minIdle != null) {
      const ip = idlePct(r)
      if (ip == null || ip < f.minIdle) return false
    }
    if (q) {
      const hay = `${r.asset_no || ''} ${r.make || ''} ${r.model || ''} ${r.country || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Headline KPIs for a set of rows. Averages are null when unmeasurable. */
export function summarizeUtilization(rows) {
  const list = rows || []
  const withUtil = list.filter((r) => num(r.utilization_pct) != null)
  const linked = list.filter((r) => r.linked_to_fleet).length
  const idleValues = list.map(idlePct).filter((n) => n != null)
  return {
    assets: list.length,
    linked,
    unlinked: list.length - linked,
    avgUtilization: mean(withUtil.map((r) => r.utilization_pct)),
    avgIdlePct: idleValues.length ? mean(idleValues) : null,
    totalDistanceKm: sum(list.map((r) => r.distance_km)),
    totalWorkingHours: secondsToHours(sum(list.map((r) => r.working_seconds))),
    totalIdleHours: secondsToHours(sum(list.map((r) => r.idle_seconds))),
    withCurrentKm: list.filter((r) => num(r.current_km) != null || num(r.odo_end) != null).length,
    highIdle: list.filter((r) => { const ip = idlePct(r); return ip != null && ip >= 50 }).length,
  }
}

/** Count of rows per utilization band, for a distribution chart. */
export function bandDistribution(rows) {
  const out = { High: 0, Medium: 0, Low: 0, Unknown: 0 }
  ;(rows || []).forEach((r) => { out[bandOf(r)] += 1 })
  return BANDS.map((b) => ({ band: b, count: out[b] }))
}

/** Per-country roll-up (asset count, avg utilization, total distance). */
export function byCountry(rows) {
  const m = new Map()
  ;(rows || []).forEach((r) => {
    const k = r.country || 'Unknown'
    if (!m.has(k)) m.set(k, { country: k, assets: 0, utilVals: [], distance: 0 })
    const e = m.get(k)
    e.assets += 1
    const u = num(r.utilization_pct); if (u != null) e.utilVals.push(u)
    e.distance += num(r.distance_km) || 0
  })
  return [...m.values()]
    .map((e) => ({ country: e.country, assets: e.assets, avgUtilization: mean(e.utilVals), distance: e.distance }))
    .sort((a, b) => b.assets - a.assets)
}

/** Top N assets by a numeric field (distance / idle hours), descending. */
export function topBy(rows, field, n = 10) {
  const key = (r) => (field === 'idleHours' ? secondsToHours(r.idle_seconds) : num(r[field]))
  return (rows || [])
    .map((r) => ({ ...r, _v: key(r) }))
    .filter((r) => r._v != null)
    .sort((a, b) => b._v - a._v)
    .slice(0, n)
}
