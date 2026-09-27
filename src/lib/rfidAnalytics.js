/**
 * RFID register analytics (pure, no I/O) behind the /rfid page.
 *
 * Distinct from src/lib/rfidRegistryAnalytics.js, which serves /rfid-registry
 * on the reader/alert schema. This engine shapes the simple `rfid_tags`
 * register: tag mapping state, scan freshness, data-quality flags (the same
 * tyre serial mapped to more than one tag), filters, the KPI strip, chart
 * series and export rows.
 *
 * Honesty: a share with an empty denominator is null (N/A), never 0% or 100%.
 * A tag with no scan timestamp is "never scanned", not "scanned 0 days ago".
 * `now` is injectable so every time-based figure is deterministic in tests.
 */
import { normalizeTagId, RFID_STATUSES, RFID_STATUS_META } from './rfid'

/** A tag not seen by a reader for longer than this is treated as stale. */
export const STALE_SCAN_DAYS = 30

export const MAPPING_KEYS = ['full', 'tyre', 'asset', 'none']
export const MAPPING_LABEL = {
  full: 'Tyre and asset',
  tyre: 'Tyre only',
  asset: 'Asset only',
  none: 'Not mapped',
}
export const SCAN_KEYS = ['recent', 'stale', 'never']
export const SCAN_LABEL = {
  recent: `Seen in last ${STALE_SCAN_DAYS} days`,
  stale: `Not seen for over ${STALE_SCAN_DAYS} days`,
  never: 'Never scanned',
}

export const EMPTY_RFID_FILTERS = { search: '', status: 'all', site: '', mapping: 'all', scan: 'all', duplicatesOnly: false }

const DAY_MS = 86400000
const str = (v) => (v == null ? '' : String(v).trim())
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null)
const timeOf = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
const nowMsOf = (now) => (now instanceof Date ? now.getTime() : Number.isFinite(Number(now)) ? Number(now) : Date.now())

export function statusLabel(s) {
  return RFID_STATUS_META[s]?.label || (str(s) ? str(s) : 'N/A')
}

/** Mapping state of a tag from its tyre serial and asset columns. */
export function mappingOf(row) {
  const tyre = Boolean(str(row?.tyre_serial))
  const asset = Boolean(str(row?.asset_no))
  if (tyre && asset) return 'full'
  if (tyre) return 'tyre'
  if (asset) return 'asset'
  return 'none'
}

/** Whole days since the last scan, or null when never scanned / unparseable / future. */
export function daysSinceScan(row, now = new Date()) {
  const t = timeOf(row?.last_scanned_at)
  if (t == null) return null
  const d = (nowMsOf(now) - t) / DAY_MS
  if (d < 0) return 0
  return Math.floor(d)
}

export function scanStateOf(row, now = new Date()) {
  const d = daysSinceScan(row, now)
  if (d == null) return 'never'
  return d > STALE_SCAN_DAYS ? 'stale' : 'recent'
}

/** Serial -> count, for serials mapped to more than one tag (upper-cased). */
export function duplicateSerials(rows = []) {
  const counts = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = str(r?.tyre_serial).toUpperCase()
    if (!s) continue
    counts.set(s, (counts.get(s) || 0) + 1)
  }
  const out = new Map()
  for (const [s, n] of counts) if (n > 1) out.set(s, n)
  return out
}

/** Decorate every row once with derived fields used by filters, table and export. */
export function enrichTags(rows = [], now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const dups = duplicateSerials(list)
  return list.map((r) => {
    const serial = str(r?.tyre_serial).toUpperCase()
    return {
      ...r,
      _tag: normalizeTagId(r?.tag_id),
      _mapping: mappingOf(r),
      _scanDays: daysSinceScan(r, now),
      _scan: scanStateOf(r, now),
      _duplicate: Boolean(serial && dups.has(serial)),
      _statusLabel: statusLabel(r?.status),
    }
  })
}

export function siteOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => str(r?.site)).filter(Boolean))].sort()
}

export function activeRfidFilterCount(f = EMPTY_RFID_FILTERS) {
  let n = 0
  if (str(f.search)) n++
  if (f.status && f.status !== 'all') n++
  if (f.site) n++
  if (f.mapping && f.mapping !== 'all') n++
  if (f.scan && f.scan !== 'all') n++
  if (f.duplicatesOnly) n++
  return n
}

export function filterTags(enriched = [], f = EMPTY_RFID_FILTERS) {
  const q = str(f.search).toLowerCase()
  return (Array.isArray(enriched) ? enriched : []).filter((r) => {
    if (f.status && f.status !== 'all' && r.status !== f.status) return false
    if (f.site && str(r.site) !== f.site) return false
    if (f.mapping && f.mapping !== 'all' && r._mapping !== f.mapping) return false
    if (f.scan && f.scan !== 'all' && r._scan !== f.scan) return false
    if (f.duplicatesOnly && !r._duplicate) return false
    if (q) {
      const hay = `${r.tag_id || ''} ${r._tag || ''} ${r.tyre_serial || ''} ${r.asset_no || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** KPI strip over an enriched set. Shares are null when nothing is registered. */
export function rfidKpis(enriched = []) {
  const list = Array.isArray(enriched) ? enriched : []
  const byStatus = Object.fromEntries(RFID_STATUSES.map((s) => [s, 0]))
  const byMapping = Object.fromEntries(MAPPING_KEYS.map((k) => [k, 0]))
  const byScan = Object.fromEntries(SCAN_KEYS.map((k) => [k, 0]))
  const assets = new Set()
  let duplicates = 0
  for (const r of list) {
    if (byStatus[r.status] != null) byStatus[r.status] += 1
    if (byMapping[r._mapping] != null) byMapping[r._mapping] += 1
    if (byScan[r._scan] != null) byScan[r._scan] += 1
    if (r._duplicate) duplicates += 1
    const a = str(r.asset_no).toUpperCase()
    if (a) assets.add(a)
  }
  const total = list.length
  const mapped = total - byMapping.none
  return {
    total,
    byStatus,
    byMapping,
    byScan,
    mapped,
    unmapped: byMapping.none,
    mappedPct: pct(mapped, total),
    assets: assets.size,
    neverScanned: byScan.never,
    stale: byScan.stale,
    scannedRecentlyPct: pct(byScan.recent, total),
    duplicates,
  }
}

/** Tags per site, largest first. Blank site buckets as "No site". */
export function tagsBySite(enriched = [], limit = 10) {
  const m = new Map()
  for (const r of Array.isArray(enriched) ? enriched : []) {
    const s = str(r.site) || 'No site'
    m.set(s, (m.get(s) || 0) + 1)
  }
  return [...m.entries()]
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
    .slice(0, limit)
}

export const RFID_EXPORT_COLUMNS = [
  ['tag_id', 'Tag ID'], ['tyre_serial', 'Tyre serial'], ['asset_no', 'Asset'], ['site', 'Site'],
  ['status', 'Status'], ['mapping', 'Mapping'], ['scan', 'Scan state'], ['days_since_scan', 'Days since scan'],
  ['duplicate', 'Serial on another tag'], ['last_scanned_at', 'Last scanned'], ['created_at', 'Registered'],
]

export function rfidExportRows(enriched = []) {
  return (Array.isArray(enriched) ? enriched : []).map((r) => ({
    tag_id: r.tag_id || '',
    tyre_serial: r.tyre_serial || '',
    asset_no: r.asset_no || '',
    site: r.site || '',
    status: r._statusLabel,
    mapping: MAPPING_LABEL[r._mapping] || '',
    scan: SCAN_LABEL[r._scan] || '',
    days_since_scan: r._scanDays == null ? 'N/A' : r._scanDays,
    duplicate: r._duplicate ? 'Yes' : 'No',
    last_scanned_at: r.last_scanned_at || '',
    created_at: r.created_at || '',
  }))
}
