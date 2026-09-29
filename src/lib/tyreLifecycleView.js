/**
 * tyreLifecycleView - pure shaping for the Tyre Lifecycle Tracker page on the
 * Command Center kit.
 *
 * Joins each tyre record to its running-life row (active tyres only, from
 * get_tyre_running_life) so the register can show current km and life used,
 * judged by the SAME bands the Running and Remaining view uses (measureFor).
 * Nothing is invented: a tyre whose life cannot be measured reads null, which
 * the page renders as N/A. No clock, no network.
 */
import { measureFor } from './tyreRunningLife'
import { lifecycleStage, kmRun, cpk, lifecycleExportRows, EXPORT_COLS, EXPORT_HEADERS } from './tyreLifecycleAnalytics'
import { parsePosition } from './tyrePositions'
import { cleanRemovalReason } from './removalReason'

const up = (v) => String(v ?? '').trim().toUpperCase()
const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)

/** Join key between a tyre record and a running-life row. */
export function rlKey(serial, asset, position) {
  return `${up(serial)}|${up(asset)}|${up(position)}`
}

/** Index shaped running-life rows by serial, asset and position. */
export function indexRunningLife(rlRows = []) {
  const map = new Map()
  for (const r of rlRows) {
    if (!r) continue
    map.set(rlKey(r.serial, r.asset, r.position), r)
  }
  return map
}

/** Status pill for a row: removed stages keep their stage, active tyres use the life bands. */
export const STATUS_META = {
  'Near End': { tone: 'bad', note: 'Past or near the expected life' },
  Normal: { tone: 'good', note: 'Running within its expected life' },
  'In Service': { tone: 'info', note: 'Fitted, life not measurable yet' },
  Removed: { tone: 'muted' },
  'Retread Eligible': { tone: 'info' },
  Retreaded: { tone: 'info' },
  Scrapped: { tone: 'bad' },
}
export const STATUSES = Object.keys(STATUS_META)

export function lifeStatus(stage, band) {
  if (stage !== 'In Service') return stage
  if (band === 'overdue' || band === 'due-soon') return 'Near End'
  if (band === 'healthy' || band === 'mid-life') return 'Normal'
  return 'In Service'
}

/** Table rows with derived fields attached once. */
export function buildRows(records = [], rlIndex = new Map()) {
  return records.map((r) => {
    const stage = lifecycleStage(r)
    const rl = stage === 'In Service' ? rlIndex.get(rlKey(r.serial_number, r.asset_no, r.position)) : null
    const m = rl ? measureFor(rl) : null
    const band = m ? m.band : null
    return {
      ...r,
      _stage: stage,
      _km: kmRun(r),
      _cpk: cpk(r),
      _category: r.category || 'New',
      _band: band,
      _status: lifeStatus(stage, band),
      _lifePct: m && m.used != null ? Math.max(0, m.used) : null,
      _lifeDim: m ? m.dimension : null,
      _currentKm: rl ? rl.currentKm : null,
      _rl: rl || null,
    }
  })
}

/** KPI strip over the rows in scope. */
export function viewKpis(rows = []) {
  let active = 0; let nearEnd = 0
  for (const r of rows) {
    if (r._stage === 'In Service') {
      active += 1
      if (r._status === 'Near End') nearEnd += 1
    }
  }
  return {
    total: rows.length,
    active,
    nearEnd,
    inService: active - nearEnd,
    removed: rows.length - active,
  }
}

export const TABS = [
  { key: 'all', label: 'All Tyres' },
  { key: 'inService', label: 'In Service' },
  { key: 'removed', label: 'Removed' },
  { key: 'history', label: 'History' },
  { key: 'analytics', label: 'Analytics' },
]

export function tabRows(rows = [], tab = 'all') {
  if (tab === 'inService') return rows.filter((r) => r._stage === 'In Service')
  if (tab === 'removed') return rows.filter((r) => r._stage !== 'In Service')
  return rows
}

const lc = (v) => String(v ?? '').toLowerCase()

/** Search + dropdown + fitment date filters. Blank or 'All' means no filter. */
export function filterViewRows(rows = [], f = {}) {
  const q = lc(f.search).trim()
  const on = (v) => v && v !== 'All'
  return rows.filter((r) => {
    if (q && !(lc(r.serial_number).includes(q) || lc(r.asset_no).includes(q) || lc(r.brand).includes(q) || lc(r.size).includes(q))) return false
    if (on(f.vehicleType) && up(r.vehicle_type) !== up(f.vehicleType)) return false
    if (on(f.brand) && r.brand !== f.brand) return false
    if (on(f.position) && up(r.position) !== up(f.position)) return false
    if (on(f.status) && r._status !== f.status) return false
    if (on(f.site) && r.site !== f.site) return false
    if (on(f.category) && r._category !== f.category) return false
    if (f.from && (!r.issue_date || String(r.issue_date).slice(0, 10) < f.from)) return false
    if (f.to && (!r.issue_date || String(r.issue_date).slice(0, 10) > f.to)) return false
    return true
  })
}

const distinct = (rows, get) => [...new Set(rows.map(get).filter((v) => v != null && String(v).trim() !== ''))]
  .sort((a, b) => String(a).localeCompare(String(b)))

export function filterOptions(rows = []) {
  return {
    vehicleTypes: distinct(rows, (r) => (r.vehicle_type ? up(r.vehicle_type) : null)),
    brands: distinct(rows, (r) => r.brand),
    positions: distinct(rows, (r) => (r.position ? up(r.position) : null)),
    sites: distinct(rows, (r) => r.site),
  }
}

/** FL / FR / RL / RR corner of a position code, or null when it is not a wheel code. */
export function positionCorner(pos) {
  const p = parsePosition(pos)
  if (!p || !p.side) return null
  return `${p.axle === 'F' ? 'F' : 'R'}${p.side}`
}

export const CORNERS = ['FL', 'FR', 'RL', 'RR']
export const DIST_BUCKETS = [0, 20000, 40000, 60000, 80000, 100000, 120000]

/**
 * Life used (%) against distance run, by corner, for active tyres measured on
 * km. Each point is the average life used in a 20,000 km distance bucket.
 */
export function lifeProgression(rows = []) {
  const acc = Object.fromEntries(CORNERS.map((c) => [c, DIST_BUCKETS.map(() => [])]))
  let sample = 0
  for (const r of rows) {
    const rl = r._rl
    if (!rl) continue
    const km = num(rl.kmRun); const used = num(rl.lifeUsedPct)
    if (km == null || km < 0 || used == null) continue
    const c = positionCorner(r.position)
    if (!c) continue
    let i = DIST_BUCKETS.findIndex((b, j) => km >= b && (j === DIST_BUCKETS.length - 1 || km < DIST_BUCKETS[j + 1]))
    if (i < 0) i = 0
    acc[c][i].push(Math.max(0, used))
    sample += 1
  }
  const series = CORNERS.map((c) => ({ corner: c, points: acc[c].map((a, i) => (a.length ? { x: DIST_BUCKETS[i], y: mean(a), n: a.length } : null)).filter(Boolean) }))
  return { series, sample }
}

/** Removal reasons among removed tyres. Brand names leaked into the column are skipped. */
export function removalReasons(rows = [], top = 5) {
  const counts = new Map()
  let removed = 0; let unrecorded = 0
  for (const r of rows) {
    if (r._stage === 'In Service') continue
    removed += 1
    const reason = cleanRemovalReason(r.removal_reason)
    if (!reason) { unrecorded += 1; continue }
    const k = up(reason)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const head = sorted.slice(0, top).map(([label, count]) => ({ label, count }))
  const rest = sorted.slice(top).reduce((s, [, c]) => s + c, 0)
  if (rest) head.push({ label: 'OTHER', count: rest })
  return { segments: head, recorded: removed - unrecorded, removed, unrecorded }
}

/** Brands ranked by average measured life (km run), needing at least `min` tyres. */
export function topBrandsByLife(rows = [], { min = 5, limit = 6 } = {}) {
  const map = new Map()
  for (const r of rows) {
    if (!r.brand || r._km == null) continue
    if (!map.has(r.brand)) map.set(r.brand, [])
    map.get(r.brand).push(r._km)
  }
  return [...map.entries()]
    .filter(([, v]) => v.length >= min)
    .map(([brand, v]) => ({ brand, avgKm: mean(v), n: v.length }))
    .sort((a, b) => b.avgKm - a.avgKm || a.brand.localeCompare(b.brand))
    .slice(0, limit)
}

export const VIEW_EXPORT_COLS = [...EXPORT_COLS, 'status', 'life_used']
export const VIEW_EXPORT_HEADERS = [...EXPORT_HEADERS, 'Status', 'Life used %']

/** Export rows: the existing lifecycle export plus status and life used. */
export function viewExportRows(rows = []) {
  const base = lifecycleExportRows(rows)
  return base.map((b, i) => ({
    ...b,
    status: rows[i]._status,
    life_used: rows[i]._lifePct == null ? 'N/A' : Math.round(rows[i]._lifePct),
  }))
}
