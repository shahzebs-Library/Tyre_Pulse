/**
 * Inspection Planner coverage analytics - pure, I/O-free.
 *
 * The planner's work queue knows only the assets that already appear in
 * inspection or tyre records. This module measures coverage against the FLEET
 * REGISTER instead, so an asset nobody has ever inspected is visible as a gap
 * rather than absent. Region is read through the site register (siteRegionMap)
 * - it is never a column on an inspection.
 *
 * Honesty rules, tested:
 *  - Only ACTIVE register assets are measured (Inactive/Retired/Transferred are
 *    historical and would inflate the gap).
 *  - An asset whose site the register cannot place in a region reports region
 *    '' and is grouped as "Region not set", never swept into a real region.
 *  - A group with no assets has a null rate, never 0% or 100%.
 */

const DAY_MS = 86400000
export const COVERAGE_STATES = Object.freeze(['covered', 'overdue', 'never'])
export const COVERAGE_LABEL = Object.freeze({ covered: 'Covered', overdue: 'Overdue', never: 'Never inspected' })
export const NO_REGION = 'Region not set'
export const NO_TYPE = 'Type not recorded'
export const NO_SITE = 'Site not recorded'

const key = (country, asset) => `${String(country || '').trim().toUpperCase()}|${String(asset || '').trim().toUpperCase()}`
const day = (v) => (v ? String(v).slice(0, 10) : '')

/** Register rows that are in service today. Blank status counts as active. */
export function isActiveAsset(row) {
  const s = String(row?.status || '').trim().toLowerCase()
  return !s || s === 'active'
}

function daysBetween(fromDay, today) {
  const a = Date.parse(`${fromDay}T00:00:00Z`), b = Date.parse(`${today}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.round((b - a) / DAY_MS))
}

/**
 * One row per active register asset with its last inspection and coverage state.
 * @param {{ fleet: object[], inspections: object[], today: string, interval: number, regionOf?: Function }} args
 *   regionOf(site) is INJECTED (the page passes regionForSite over the site
 *   register) so this module stays pure. Without it every region is ''.
 */
export function coverageByAsset({ fleet = [], inspections = [], today, interval = 30, regionOf } = {}) {
  const last = new Map()
  for (const r of inspections) {
    const d = day(r.inspection_date)
    if (!d || (today && d > today)) continue
    const k = key(r.country, r.asset_no)
    const prev = last.get(k)
    if (!prev || d > prev.date) last.set(k, { date: d, inspector: r.inspector_name || r.inspector || '' })
  }
  return fleet.filter(isActiveAsset).map((f) => {
    const hit = last.get(key(f.country, f.asset_no))
    const daysSince = hit ? daysBetween(hit.date, today) : null
    const state = !hit ? 'never' : daysSince > interval ? 'overdue' : 'covered'
    return {
      asset_no: f.asset_no,
      country: f.country || '',
      site: f.site || '',
      region: typeof regionOf === 'function' ? (regionOf(f.site) || '') : '',
      vehicle_type: f.vehicle_type || '',
      last_inspection: hit?.date || null,
      last_inspector: hit?.inspector || null,
      days_since: daysSince,
      state,
    }
  })
}

const DIM = {
  region: (r) => r.region || NO_REGION,
  site: (r) => r.site || NO_SITE,
  vehicle_type: (r) => r.vehicle_type || NO_TYPE,
}

/** Coverage grouped by region, site or vehicle type, worst rate first. */
export function groupCoverage(rows = [], dim = 'region') {
  const fn = DIM[dim] || DIM.region
  const map = new Map()
  for (const r of rows) {
    const k = fn(r)
    const g = map.get(k) || { key: k, assets: 0, covered: 0, overdue: 0, never: 0 }
    g.assets++
    g[r.state]++
    map.set(k, g)
  }
  return [...map.values()]
    .map((g) => ({ ...g, ratePct: g.assets ? Math.round((g.covered / g.assets) * 1000) / 10 : null }))
    .sort((a, b) => (a.ratePct ?? 101) - (b.ratePct ?? 101) || b.assets - a.assets || a.key.localeCompare(b.key))
}

export function coverageTotals(rows = []) {
  const t = { assets: rows.length, covered: 0, overdue: 0, never: 0 }
  for (const r of rows) t[r.state]++
  return { ...t, ratePct: t.assets ? Math.round((t.covered / t.assets) * 1000) / 10 : null }
}

export function filterCoverage(rows = [], { search = '', region = '', site = '', vehicleType = '', state = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => (!region || (r.region || NO_REGION) === region)
    && (!site || (r.site || NO_SITE) === site)
    && (!vehicleType || (r.vehicle_type || NO_TYPE) === vehicleType)
    && (!state || r.state === state)
    && (!q || `${r.asset_no} ${r.site} ${r.vehicle_type} ${r.last_inspector || ''}`.toLowerCase().includes(q)))
}

/** Overdue and never-inspected first, longest gap first. */
export function sortCoverage(rows = [], sortKey = 'days_since', dir = 'desc') {
  const m = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sortKey === 'days_since') {
      // never inspected is the longest possible gap
      const x = a.state === 'never' ? Infinity : a.days_since ?? -1
      const y = b.state === 'never' ? Infinity : b.days_since ?? -1
      if (x === y) return String(a.asset_no).localeCompare(String(b.asset_no))
      return m * (x > y ? 1 : -1)
    }
    return m * String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''))
  })
}

/**
 * Inspector workload over the last `days` days: readings recorded and distinct
 * assets touched. Schedule appointments (upcoming and missed) are counted from
 * the planner schedule when supplied.
 */
export function inspectorWorkload(inspections = [], schedule = [], { today, days = 30 } = {}) {
  const start = today ? new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10) : ''
  const map = new Map()
  const get = (name) => {
    if (!map.has(name)) map.set(name, { name, readings: 0, assets: new Set(), upcoming: 0, missed: 0 })
    return map.get(name)
  }
  for (const r of inspections) {
    const name = String(r.inspector_name || r.inspector || '').trim()
    const d = day(r.inspection_date)
    if (!name || !d || (start && d < start) || (today && d > today)) continue
    const e = get(name)
    e.readings++
    e.assets.add(key(r.country, r.asset_no))
  }
  for (const s of schedule) {
    const name = String(s.inspector_name || '').trim()
    if (!name || !['Scheduled', 'In Progress'].includes(s.status || 'Scheduled')) continue
    const e = get(name)
    if (day(s.inspection_date) >= today) e.upcoming++
    else e.missed++
  }
  return [...map.values()]
    .map((e) => ({ name: e.name, readings: e.readings, assets: e.assets.size, upcoming: e.upcoming, missed: e.missed }))
    .sort((a, b) => b.readings - a.readings || b.upcoming - a.upcoming || a.name.localeCompare(b.name))
}
