/**
 * Telematics analytics - pure, dependency-free device-fleet intelligence for the
 * Telematics Device Registry module (/telematics-devices).
 *
 * This layer turns raw `telematics_devices` rows (real columns only:
 * device_id, provider, sim_number, asset_no, install_date, last_seen_at,
 * status, site, country, created_at) into the health/connectivity/coverage
 * intelligence the page renders. It performs NO I/O and takes an injected clock
 * (`now`) and freshness threshold so every function is deterministic and unit
 * testable. It composes the existing primitives in `./telematicsDevices`
 * (deviceOnline / hoursSinceSeen / toDate / DEVICE_STATUSES) - the single source
 * of truth for status vocab and online logic - rather than re-deriving them.
 *
 * HONESTY RULES (no fabrication):
 *  - A device with no `last_seen_at` is "never reported" (never counted online).
 *  - Fleet coverage % is null when the caller cannot supply a real fleet total.
 *  - Connectivity metrics are omitted/`null` for devices lacking a heartbeat,
 *    never invented.
 */
import {
  DEVICE_STATUSES,
  DEVICE_STATUS_META,
  DEFAULT_ONLINE_THRESHOLD_HOURS,
  deviceOnline,
  hoursSinceSeen,
  toDate,
} from './telematicsDevices'

// Re-export the shared primitives so the page has a single import surface.
export {
  DEVICE_STATUSES,
  DEVICE_STATUS_META,
  DEFAULT_ONLINE_THRESHOLD_HOURS,
  deviceOnline,
  hoursSinceSeen,
  toDate,
}

/** Default staleness window (hours) - re-exported name for clarity at the page. */
export const DEFAULT_STALE_THRESHOLD_HOURS = DEFAULT_ONLINE_THRESHOLD_HOURS

/** Normalise a device's status to a known token (defaults to 'active'). */
export function normStatus(status) {
  return DEVICE_STATUSES.includes(status) ? status : 'active'
}

/** Trimmed non-empty string, or '' . */
function s(v) {
  return v == null ? '' : String(v).trim()
}

/**
 * Age buckets for connectivity health, ordered from freshest to stalest, with a
 * terminal "never" bucket. Upper bound is in hours; null = open-ended.
 */
export const AGE_BUCKETS = [
  { key: 'live', label: 'Under 1h', maxHours: 1 },
  { key: 'today', label: '1 to 24h', maxHours: 24 },
  { key: 'week', label: '1 to 7d', maxHours: 24 * 7 },
  { key: 'month', label: '7 to 30d', maxHours: 24 * 30 },
  { key: 'stale', label: 'Over 30d', maxHours: null },
  { key: 'never', label: 'Never', maxHours: null },
]

/**
 * Bucket a single device by heartbeat age. Decommissioned devices with no
 * heartbeat fall into 'never'; otherwise the freshest matching band wins.
 * Returns one of the AGE_BUCKETS keys.
 */
export function heartbeatBucket(device, now) {
  const h = hoursSinceSeen(device, now)
  if (h == null) return 'never'
  for (const b of AGE_BUCKETS) {
    if (b.key === 'never') continue
    if (b.maxHours == null) return 'stale'
    if (h < b.maxHours) return b.key
  }
  return 'stale'
}

/**
 * Status distribution across the device set. Always returns every canonical
 * status key (0 when absent) plus a total, so charts have a stable domain.
 */
export function statusDistribution(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = {}
  for (const st of DEVICE_STATUSES) counts[st] = 0
  for (const r of list) counts[normStatus(r?.status)] += 1
  return {
    counts,
    total: list.length,
    items: DEVICE_STATUSES.map((key) => ({
      key,
      label: DEVICE_STATUS_META[key]?.label || key,
      count: counts[key],
      pct: list.length ? Math.round((counts[key] / list.length) * 1000) / 10 : 0,
    })),
  }
}

/**
 * Connectivity summary: online / offline / never, plus the ordered age-bucket
 * breakdown. Decommissioned devices are excluded from the online/offline split
 * (they are not expected to report) but surfaced separately as `decommissioned`.
 */
export function connectivity(rows = [], now, thresholdHours = DEFAULT_STALE_THRESHOLD_HOURS) {
  const list = Array.isArray(rows) ? rows : []
  const bucketCounts = {}
  for (const b of AGE_BUCKETS) bucketCounts[b.key] = 0

  let online = 0
  let offline = 0
  let never = 0
  let decommissioned = 0
  let expected = 0 // devices we expect a heartbeat from (not decommissioned)

  for (const r of list) {
    const status = normStatus(r?.status)
    const isDecom = status === 'decommissioned'
    if (isDecom) decommissioned += 1

    const bucket = heartbeatBucket(r, now)
    bucketCounts[bucket] += 1

    if (bucket === 'never') never += 1

    if (!isDecom) {
      expected += 1
      if (deviceOnline(r, now, thresholdHours)) online += 1
      else offline += 1
    }
  }

  const onlinePct = expected ? Math.round((online / expected) * 1000) / 10 : null
  return {
    online,
    offline,
    never,
    decommissioned,
    expected,
    onlinePct,
    buckets: AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: bucketCounts[b.key] })),
    hasHeartbeatData: list.some((r) => toDate(r?.last_seen_at)),
  }
}

/**
 * Distinct assets covered by a working (non-decommissioned) device, plus a fleet
 * coverage percentage when a real fleet total is supplied. When `totalAssets`
 * is not a positive number the percentage is `null` (honest: we do not guess).
 */
export function fleetCoverage(rows = [], totalAssets) {
  const list = Array.isArray(rows) ? rows : []
  const covered = new Set()
  const assigned = new Set()
  for (const r of list) {
    const asset = s(r?.asset_no)
    if (!asset) continue
    assigned.add(asset)
    if (normStatus(r?.status) !== 'decommissioned') covered.add(asset)
  }
  const total = Number.isFinite(totalAssets) && totalAssets > 0 ? Math.floor(totalAssets) : null
  return {
    assetsCovered: covered.size,
    assetsAssigned: assigned.size,
    totalAssets: total,
    coveragePct: total ? Math.round((covered.size / total) * 1000) / 10 : null,
    uncovered: total ? Math.max(0, total - covered.size) : null,
  }
}

/** Devices with no asset mapping (spares / awaiting fitment). */
export function unassignedCount(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return list.reduce((n, r) => (s(r?.asset_no) ? n : n + 1), 0)
}

/**
 * Generic grouping helper -> array of { key, label, total, online, offline,
 * never, active } sorted by total desc. `keyFn` extracts the raw group value;
 * blank values collapse into `blankLabel`.
 */
function groupBy(rows, keyFn, now, thresholdHours, blankLabel) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const raw = s(keyFn(r))
    const key = raw || blankLabel
    let g = map.get(key)
    if (!g) {
      g = { key, label: key, total: 0, online: 0, offline: 0, never: 0, active: 0 }
      map.set(key, g)
    }
    g.total += 1
    const status = normStatus(r?.status)
    if (status === 'active') g.active += 1
    if (heartbeatBucket(r, now) === 'never') g.never += 1
    if (status !== 'decommissioned') {
      if (deviceOnline(r, now, thresholdHours)) g.online += 1
      else g.offline += 1
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
}

/** Breakdown by provider / vendor (blank -> "Unknown"). */
export function byVendor(rows = [], now, thresholdHours = DEFAULT_STALE_THRESHOLD_HOURS) {
  return groupBy(rows, (r) => r?.provider, now, thresholdHours, 'Unknown')
}

/** Breakdown by depot / site (blank -> "Unassigned"). */
export function bySite(rows = [], now, thresholdHours = DEFAULT_STALE_THRESHOLD_HOURS) {
  return groupBy(rows, (r) => r?.site, now, thresholdHours, 'Unassigned')
}

/**
 * Install pipeline: how many devices are installed (have an install_date) vs
 * pending, plus recent installs bucketed by YYYY-MM (most recent `months` only).
 */
export function installPipeline(rows = [], now, months = 6) {
  const list = Array.isArray(rows) ? rows : []
  let installed = 0
  let pending = 0
  const monthMap = new Map()
  for (const r of list) {
    const d = toDate(r?.install_date)
    if (d) {
      installed += 1
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(ym, (monthMap.get(ym) || 0) + 1)
    } else {
      pending += 1
    }
  }
  const recent = [...monthMap.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-Math.max(1, months))
  return { installed, pending, recent }
}

/**
 * Data-quality flags over the registry (honest completeness signals, never
 * fabricated). Each entry: { key, label, count }. Only non-zero flags returned.
 */
export function dataQualityFlags(rows = [], now, thresholdHours = DEFAULT_STALE_THRESHOLD_HOURS) {
  const list = Array.isArray(rows) ? rows : []
  const seen = new Map() // device_id -> count
  const assetSeen = new Map() // asset_no -> count (active mappings)
  let noHeartbeat = 0
  let noSim = 0
  let noAsset = 0
  let staleActive = 0 // status active but offline beyond threshold

  for (const r of list) {
    const id = s(r?.device_id).toLowerCase()
    if (id) seen.set(id, (seen.get(id) || 0) + 1)
    if (!toDate(r?.last_seen_at)) noHeartbeat += 1
    if (!s(r?.sim_number)) noSim += 1
    const asset = s(r?.asset_no)
    if (!asset) noAsset += 1
    if (normStatus(r?.status) === 'active') {
      if (!deviceOnline(r, now, thresholdHours)) staleActive += 1
      if (asset) assetSeen.set(asset, (assetSeen.get(asset) || 0) + 1)
    }
  }

  const dupIds = [...seen.values()].filter((n) => n > 1).length
  const dupAssets = [...assetSeen.values()].filter((n) => n > 1).length

  const all = [
    { key: 'staleActive', label: 'Active but offline (stale)', count: staleActive },
    { key: 'noHeartbeat', label: 'Never reported in', count: noHeartbeat },
    { key: 'noAsset', label: 'Not mapped to an asset', count: noAsset },
    { key: 'noSim', label: 'Missing SIM number', count: noSim },
    { key: 'dupIds', label: 'Duplicate device IDs', count: dupIds },
    { key: 'dupAssets', label: 'Asset with 2+ active devices', count: dupAssets },
  ]
  return all.filter((f) => f.count > 0)
}

/**
 * Filter device rows for the table. All predicates are AND-combined; empty
 * predicates match everything. `search` matches device_id / provider /
 * sim_number / asset_no / site (case-insensitive substring).
 */
export function filterDevices(rows = [], { status = 'all', site = '', vendor = '', connectivity: conn = 'all', search = '' } = {}, now, thresholdHours = DEFAULT_STALE_THRESHOLD_HOURS) {
  const list = Array.isArray(rows) ? rows : []
  const q = s(search).toLowerCase()
  return list.filter((r) => {
    if (status !== 'all' && normStatus(r?.status) !== status) return false
    if (site && s(r?.site) !== site) return false
    if (vendor && (s(r?.provider) || 'Unknown') !== vendor) return false
    if (conn === 'online' && !(normStatus(r?.status) !== 'decommissioned' && deviceOnline(r, now, thresholdHours))) return false
    if (conn === 'offline' && !(normStatus(r?.status) !== 'decommissioned' && !deviceOnline(r, now, thresholdHours))) return false
    if (conn === 'never' && toDate(r?.last_seen_at)) return false
    if (q) {
      const hay = `${s(r?.device_id)} ${s(r?.provider)} ${s(r?.sim_number)} ${s(r?.asset_no)} ${s(r?.site)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Valid sort keys for the registry table. */
export const SORT_KEYS = ['device_id', 'provider', 'asset_no', 'site', 'install_date', 'last_seen', 'status']

/**
 * Stable sort of device rows. `key` in SORT_KEYS; `dir` = 'asc' | 'desc'.
 * 'last_seen' sorts by recency (newest first when desc); nulls sort last.
 */
export function sortDevices(rows = [], key = 'last_seen', dir = 'desc') {
  const list = Array.isArray(rows) ? [...rows] : []
  const mult = dir === 'asc' ? 1 : -1
  const val = (r) => {
    switch (key) {
      case 'last_seen': {
        const d = toDate(r?.last_seen_at)
        return d ? d.getTime() : null
      }
      case 'install_date': {
        const d = toDate(r?.install_date)
        return d ? d.getTime() : null
      }
      case 'status':
        return normStatus(r?.status)
      default:
        return s(r?.[key]).toLowerCase()
    }
  }
  return list
    .map((r, i) => ({ r, i, v: val(r) }))
    .sort((a, b) => {
      // Nulls always last regardless of direction.
      const an = a.v == null || a.v === ''
      const bn = b.v == null || b.v === ''
      if (an && bn) return a.i - b.i
      if (an) return 1
      if (bn) return -1
      if (typeof a.v === 'number' && typeof b.v === 'number') {
        return (a.v - b.v) * mult || a.i - b.i
      }
      return String(a.v).localeCompare(String(b.v)) * mult || a.i - b.i
    })
    .map((x) => x.r)
}

/**
 * Top-level KPI + intelligence bundle for the page. Injects `now`, a tunable
 * `thresholdHours`, and an optional real `totalAssets` (fleet size) for the
 * coverage %. Returns everything the header, charts and callouts need.
 */
export function analyzeTelematics(rows = [], { now = Date.now(), thresholdHours = DEFAULT_STALE_THRESHOLD_HOURS, totalAssets } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const status = statusDistribution(list)
  const conn = connectivity(list, now, thresholdHours)
  const coverage = fleetCoverage(list, totalAssets)
  const unassigned = unassignedCount(list)
  const activePct = list.length ? Math.round((status.counts.active / list.length) * 1000) / 10 : 0

  return {
    total: list.length,
    thresholdHours,
    status,
    connectivity: conn,
    coverage,
    unassigned,
    activePct,
    vendors: byVendor(list, now, thresholdHours),
    sites: bySite(list, now, thresholdHours),
    pipeline: installPipeline(list, now),
    flags: dataQualityFlags(list, now, thresholdHours),
    kpis: {
      total: list.length,
      active: status.counts.active,
      activePct,
      online: conn.online,
      offlineStale: conn.offline,
      never: conn.never,
      assetsCovered: coverage.assetsCovered,
      coveragePct: coverage.coveragePct,
      unassigned,
    },
  }
}
