/**
 * vehicleCheckInOutAnalytics - page-level analytics for Vehicle Check In/Out.
 *
 * The headline counters come from `summarizeCheckInOut` in
 * `./vehicleCheckInOut`; this module adds the handover intelligence the
 * register needs:
 *   - one filter predicate for table, KPIs and exports
 *   - handover pairing: each check-out matched to the NEXT check-in of the same
 *     asset gives time out and km driven. A missing or backwards odometer gives
 *     null km (and a backwards one is flagged), never a fabricated 0.
 *   - vehicles still out and how long, with an overdue threshold
 *   - a daily out / in trend and export shaping
 *
 * No I/O, no React. `now` is injected.
 */
import { summarizeCheckInOut, DIRECTIONS, STATUSES } from './vehicleCheckInOut'

export { DIRECTIONS, STATUSES }

/** A vehicle still checked out after this many hours is overdue for return. */
export const OVERDUE_HOURS = 24
const HOUR_MS = 3600000
const lc = (v) => String(v ?? '').trim().toLowerCase()

export const DIRECTION_LABEL = { out: 'Checked out', in: 'Checked in' }
export const STATUS_LABEL = { open: 'Open', closed: 'Closed' }

function t(v) {
  if (!v) return null
  const x = new Date(v).getTime()
  return Number.isFinite(x) ? x : null
}
function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const assetKey = (r) => String(r?.asset_no || '').trim().toUpperCase()

export function filterHandovers(rows = [], f = {}) {
  const q = lc(f.search)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.direction && f.direction !== 'all' && r.direction !== f.direction) return false
    if (f.status && f.status !== 'all' && r.status !== f.status) return false
    if (f.asset && r.asset_no !== f.asset) return false
    if (f.site && (r.site || '') !== f.site) return false
    if (f.from || f.to) {
      const d = r.checked_at ? String(r.checked_at).slice(0, 10) : ''
      if (!d) return false
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
    }
    if (q) {
      const hay = [r.asset_no, r.driver_name, r.site, r.condition_notes, r.fuel_level].map(lc).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Pair each check-out with the next check-in of the same asset (chronological).
 * Returns completed handovers with hours out and km driven.
 */
export function pairHandovers(rows = []) {
  const byAsset = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = assetKey(r)
    if (!k || t(r.checked_at) == null) continue
    if (!byAsset.has(k)) byAsset.set(k, [])
    byAsset.get(k).push(r)
  }
  const pairs = []
  for (const list of byAsset.values()) {
    list.sort((a, b) => t(a.checked_at) - t(b.checked_at))
    let open = null
    for (const r of list) {
      if (r.direction === 'out') { open = r; continue }
      if (r.direction === 'in' && open) {
        const outKm = num(open.odometer_km)
        const inKm = num(r.odometer_km)
        const delta = outKm != null && inKm != null ? inKm - outKm : null
        pairs.push({
          asset_no: open.asset_no,
          driver_name: open.driver_name || r.driver_name || null,
          outAt: open.checked_at,
          inAt: r.checked_at,
          hoursOut: Math.round(((t(r.checked_at) - t(open.checked_at)) / HOUR_MS) * 10) / 10,
          kmDriven: delta != null && delta >= 0 ? delta : null,
          odometerBackwards: delta != null && delta < 0,
          fuelOut: open.fuel_level || null,
          fuelIn: r.fuel_level || null,
        })
        open = null
      }
    }
  }
  return pairs.sort((a, b) => t(b.inAt) - t(a.inAt))
}

/** Open check-outs, longest out first, with hours out and an overdue flag. */
export function currentlyOut(rows = [], { now = Date.now(), overdueHours = OVERDUE_HOURS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r.direction === 'out' && r.status !== 'closed')
    .map((r) => {
      const at = t(r.checked_at)
      const hoursOut = at != null && at <= nowMs ? Math.round(((nowMs - at) / HOUR_MS) * 10) / 10 : null
      return { ...r, hoursOut, overdue: hoursOut != null && hoursOut > overdueHours }
    })
    .sort((a, b) => (b.hoursOut ?? -1) - (a.hoursOut ?? -1))
}

export function handoverKpis(rows = [], { now = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const base = summarizeCheckInOut(list)
  const pairs = pairHandovers(list)
  const out = currentlyOut(list, { now })
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const dayStart = new Date(nowMs); dayStart.setHours(0, 0, 0, 0)
  const hours = pairs.map((p) => p.hoursOut).filter((h) => h != null && h >= 0)
  const kms = pairs.map((p) => p.kmDriven).filter((k) => k != null)
  let withOdo = 0
  let withFuel = 0
  let today = 0
  for (const r of list) {
    if (num(r.odometer_km) != null) withOdo += 1
    if (r.fuel_level) withFuel += 1
    const x = t(r.checked_at)
    if (x != null && x >= dayStart.getTime() && x <= nowMs) today += 1
  }
  return {
    ...base,
    completedHandovers: pairs.length,
    overdueCount: out.filter((r) => r.overdue).length,
    avgHoursOut: hours.length ? Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 10) / 10 : null,
    totalKmDriven: kms.length ? kms.reduce((s, k) => s + k, 0) : null,
    odometerBackwards: pairs.filter((p) => p.odometerBackwards).length,
    odometerCoveragePct: list.length ? Math.round((withOdo / list.length) * 100) : null,
    fuelCoveragePct: list.length ? Math.round((withFuel / list.length) * 100) : null,
    todayCount: today,
  }
}

/** Check-outs and check-ins per day for the last `days` days ending today. */
export function dailyTrend(rows = [], { now = Date.now(), days = 14 } = {}) {
  const end = new Date(now instanceof Date ? now.getTime() : Number(now))
  const keys = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end); d.setDate(d.getDate() - i)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  const m = new Map(keys.map((k) => [k, { day: k, out: 0, in: 0 }]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const x = t(r.checked_at)
    if (x == null) continue
    const d = new Date(x)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const b = m.get(k)
    if (b) b[r.direction === 'in' ? 'in' : 'out'] += 1
  }
  return keys.map((k) => m.get(k))
}

export const EXPORT_COLS = ['checked_at', 'direction', 'status', 'asset_no', 'driver_name', 'odometer_km', 'fuel_level', 'site', 'condition_notes']
export const EXPORT_HEADERS = ['Date/Time', 'Direction', 'Status', 'Asset', 'Driver', 'Odometer (km)', 'Fuel', 'Site', 'Condition notes']

export function handoverExportRows(rows = [], fmt = (v) => v || 'N/A') {
  return (rows || []).map((r) => ({
    checked_at: r.checked_at ? fmt(r.checked_at) : 'N/A',
    direction: DIRECTION_LABEL[r.direction] || 'N/A',
    status: STATUS_LABEL[r.status] || 'N/A',
    asset_no: r.asset_no || 'N/A',
    driver_name: r.driver_name || 'N/A',
    odometer_km: num(r.odometer_km) ?? 'N/A',
    fuel_level: r.fuel_level || 'N/A',
    site: r.site || 'N/A',
    condition_notes: r.condition_notes || '',
  }))
}
