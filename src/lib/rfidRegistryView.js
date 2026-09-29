/**
 * RFID Registry view engine (pure, no I/O) behind /rfid-registry.
 *
 * The live `rfid_tags` table is the V132 shape: tag_id (the EPC / UID text),
 * tyre_serial, asset_no, site, status (active | unassigned | retired),
 * last_scanned_at and notes. It records NO item type, NO manufacturer, NO read
 * success counters and NO assignment log. Read events and alerts (V122) link
 * back by tag row id or by the tag UID text.
 *
 * Everything the page shows is derived here from those columns:
 *   - state: duplicate (same normalised tag id on more than one row), not found
 *     or lost (an open alert of a lost / not-seen kind), retired, assigned (a
 *     tyre serial or asset is mapped) or unassigned.
 *   - item type: tyre when a tyre serial is mapped, else the mapped asset's
 *     vehicle type from the fleet register (vehicle / equipment / trailer),
 *     else other.
 *   - last scanned, scan count and signal: from the tag's own last_scanned_at
 *     and its read events. No read events means scan count 0 only when the
 *     events feed was actually read; an unread feed is null (N/A).
 *
 * Nothing is invented: a figure with no source is null and renders N/A.
 */
import { normalizeTagId, RFID_STATUSES } from './rfid'
import { rssiBand } from './rfidRegistryAnalytics'

export { normalizeTagId, RFID_STATUSES }

export const TAG_STATES = ['assigned', 'unassigned', 'duplicate', 'lost', 'retired']
export const TAG_STATE_LABEL = {
  assigned: 'Assigned', unassigned: 'Unassigned', duplicate: 'Duplicate', lost: 'Not found', retired: 'Retired',
}
export const TAG_STATE_TONE = {
  assigned: 'good', unassigned: 'warn', duplicate: 'bad', lost: 'info', retired: 'muted',
}
export const ITEM_TYPES = ['tyre', 'vehicle', 'equipment', 'trailer', 'other']
export const ITEM_TYPE_LABEL = { tyre: 'Tyre', vehicle: 'Vehicle', equipment: 'Equipment', trailer: 'Trailer', other: 'Other' }
export const ITEM_TYPE_PLURAL = { tyre: 'Tyres', vehicle: 'Vehicles', equipment: 'Equipment', trailer: 'Trailers', other: 'Other' }

/** Register tabs that filter the tag table (the rest are separate views). */
export const REGISTER_TABS = { all: null, assigned: 'assigned', unassigned: 'unassigned', duplicate: 'duplicate', lost: 'lost' }

/** Alert types that mean a tag could not be found. */
const LOST_ALERT_RE = /lost|not[_\s-]?seen|missing|not[_\s-]?found/i
const EQUIPMENT_RE = /loader|pump|generator|plant|crane|fork|excavat|dozer|grader|roller|compressor|chiller|boom|batch|skid|reach|stacker|mixer plant|welding|lighting tower|tower/i
const TRAILER_RE = /trailer|semi|lowbed|low bed|tanker trailer/i

const DAY_MS = 86400000
const s = (v) => (v == null ? '' : String(v).trim())
const timeOf = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
const up = (v) => s(v).toUpperCase()

/** Vehicle type text -> vehicle | equipment | trailer, or null when blank. */
export function classifyVehicleType(type) {
  const t = s(type)
  if (!t) return null
  if (TRAILER_RE.test(t)) return 'trailer'
  if (EQUIPMENT_RE.test(t)) return 'equipment'
  return 'vehicle'
}

/** Normalised tag ids that appear on more than one tag row. */
export function duplicateTagIds(tags = []) {
  const seen = new Map()
  for (const t of tags) {
    const id = normalizeTagId(t?.tag_id)
    if (!id) continue
    seen.set(id, (seen.get(id) || 0) + 1)
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id))
}

/** Tag row ids and normalised UIDs with an OPEN lost / not-seen alert. */
export function lostTagKeys(alerts = []) {
  const ids = new Set()
  const uids = new Set()
  for (const a of alerts) {
    if (!a || a.resolved_at) continue
    if (!LOST_ALERT_RE.test(s(a.alert_type))) continue
    if (a.tag_id) ids.add(a.tag_id)
    const uid = normalizeTagId(a.tag_uid)
    if (uid) uids.add(uid)
  }
  return { ids, uids }
}

/** State of one tag given the duplicate and lost sets. */
export function tagState(tag, { dup = new Set(), lost = { ids: new Set(), uids: new Set() } } = {}) {
  const id = normalizeTagId(tag?.tag_id)
  if (id && dup.has(id)) return 'duplicate'
  if (lost.ids.has(tag?.id) || (id && lost.uids.has(id))) return 'lost'
  if (tag?.status === 'retired') return 'retired'
  return s(tag?.tyre_serial) || s(tag?.asset_no) ? 'assigned' : 'unassigned'
}

/** Group read events by tag row id and normalised UID. */
export function eventsByTag(events = []) {
  const byId = new Map()
  const byUid = new Map()
  for (const e of events || []) {
    if (!e) continue
    if (e.tag_id) { if (!byId.has(e.tag_id)) byId.set(e.tag_id, []); byId.get(e.tag_id).push(e) }
    const uid = normalizeTagId(e.tag_uid)
    if (uid) { if (!byUid.has(uid)) byUid.set(uid, []); byUid.get(uid).push(e) }
  }
  return { byId, byUid }
}

function eventsFor(tag, idx) {
  const a = idx.byId.get(tag.id) || []
  const b = idx.byUid.get(normalizeTagId(tag.tag_id)) || []
  if (!b.length) return a
  const seen = new Set(a.map((e) => e.id))
  return a.concat(b.filter((e) => !seen.has(e.id)))
}

/**
 * Flat rows for the register, detail panel and export.
 * @param {{ tags, tyresBySerial?: Map, fleetByAsset?: Map, events?: Array|null, alerts?: Array }} input
 * events === null means the read-events feed was not read, so scan counts are null.
 */
export function buildTagRows({ tags = [], tyresBySerial = new Map(), fleetByAsset = new Map(), events = null, alerts = [] } = {}) {
  const dup = duplicateTagIds(tags)
  const lost = lostTagKeys(alerts)
  const idx = eventsByTag(events || [])
  return tags.map((t) => {
    const serial = s(t.tyre_serial) || null
    const asset = s(t.asset_no) || null
    const tyre = serial ? tyresBySerial.get(up(serial)) || null : null
    const vehicle = asset ? fleetByAsset.get(up(asset)) || null : null
    const itemType = serial ? 'tyre' : (asset ? (classifyVehicleType(vehicle?.vehicle_type) || 'other') : 'other')
    const makeModel = serial
      ? (s(tyre?.brand) || null)
      : [s(vehicle?.make), s(vehicle?.model)].filter(Boolean).join(' ') || null
    const sizeSpec = serial ? (s(tyre?.size) || null) : (s(vehicle?.vehicle_type) || null)
    const evs = events == null ? null : eventsFor(t, idx)
    let latestRead = null
    let latestRssi = null
    let scanCount = null
    if (evs) {
      scanCount = 0
      for (const e of evs) {
        scanCount += Number(e.read_count) > 0 ? Number(e.read_count) : 1
        const tm = timeOf(e.read_at)
        if (tm != null && (latestRead == null || tm > latestRead)) { latestRead = tm; latestRssi = e.rssi }
      }
    }
    const ownScan = timeOf(t.last_scanned_at)
    const lastScannedMs = [ownScan, latestRead].filter((x) => x != null).reduce((m, x) => (m == null || x > m ? x : m), null)
    const band = rssiBand(latestRssi)
    const state = tagState(t, { dup, lost })
    return {
      id: t.id,
      tagId: s(t.tag_id) || null,
      itemType,
      itemLabel: ITEM_TYPE_LABEL[itemType],
      assetOrTyre: asset || serial,
      asset,
      serial,
      tyreAsset: s(tyre?.asset_no) || null,
      makeModel,
      sizeSpec,
      site: s(t.site) || s(tyre?.site) || s(vehicle?.site) || null,
      status: t.status || null,
      state,
      stateLabel: TAG_STATE_LABEL[state],
      stateTone: TAG_STATE_TONE[state],
      lastScannedMs,
      lastScannedAt: lastScannedMs == null ? null : new Date(lastScannedMs).toISOString(),
      scanCount,
      signal: band ? { key: band.key, label: band.label, rssi: Number(latestRssi) } : null,
      registeredAt: t.created_at || null,
      updatedAt: t.updated_at || null,
      notes: s(t.notes) || null,
      country: t.country || null,
      raw: t,
    }
  })
}

/** KPI and donut counts. Read success rate is not recorded, so it is null. */
export function summarizeTagRows(rows = []) {
  const byState = Object.fromEntries(TAG_STATES.map((k) => [k, 0]))
  for (const r of rows) byState[r.state] = (byState[r.state] || 0) + 1
  return {
    total: rows.length,
    byState,
    assigned: byState.assigned,
    unassigned: byState.unassigned,
    duplicate: byState.duplicate,
    lost: byState.lost,
    retired: byState.retired,
    readSuccessRate: null,
  }
}

/** Donut segments; retired only when present so the legend never shows a dead 0 row it does not need. */
export function stateSegments(summary, colors = {}) {
  return TAG_STATES
    .filter((k) => k !== 'retired' || summary.byState.retired > 0)
    .map((k) => ({ key: k, label: TAG_STATE_LABEL[k], count: summary.byState[k] || 0, color: colors[k] }))
}

/** Tag counts per item type in the mockup order. */
export function countByItemType(rows = []) {
  const out = Object.fromEntries(ITEM_TYPES.map((k) => [k, 0]))
  for (const r of rows) out[r.itemType] = (out[r.itemType] || 0) + 1
  return ITEM_TYPES.map((k) => ({ key: k, label: ITEM_TYPE_PLURAL[k], count: out[k] }))
}

/** Local calendar day key YYYY-MM-DD (never toISOString, which is UTC). */
export function dayKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Reads per day for the last `days` days ending today. Returns null when the
 * events feed was not read. avgPerDay is total / days.
 */
export function scanActivity(events, now = new Date(), days = 30) {
  if (events == null) return null
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const start = end - (days - 1) * DAY_MS
  const series = []
  const idx = new Map()
  for (let i = 0; i < days; i++) {
    const ms = start + i * DAY_MS
    const key = dayKey(ms)
    idx.set(key, series.length)
    series.push({ key, ms, count: 0 })
  }
  let total = 0
  for (const e of events) {
    const t = timeOf(e?.read_at)
    if (t == null) continue
    const i = idx.get(dayKey(t))
    if (i == null) continue
    const n = Number(e.read_count) > 0 ? Number(e.read_count) : 1
    series[i].count += n
    total += n
  }
  return { series, total, avgPerDay: Math.round((total / days) * 10) / 10 }
}

/** Register filter: tab state + item type + site + status + manufacturer (make) + search. */
export function filterTagRows(rows = [], { tab = 'all', type = 'all', site = 'all', status = 'all', make = 'all', search = '' } = {}) {
  const want = REGISTER_TABS[tab] ?? null
  const q = s(search).toLowerCase()
  return rows.filter((r) => {
    if (want && r.state !== want) return false
    if (type !== 'all' && r.itemType !== type) return false
    if (site !== 'all' && r.site !== site) return false
    if (status !== 'all' && r.state !== status) return false
    if (make !== 'all' && r.makeModel !== make) return false
    if (!q) return true
    return [r.tagId, r.asset, r.serial, r.makeModel, r.sizeSpec, r.site, r.notes].some((v) => s(v).toLowerCase().includes(q))
  })
}

/**
 * Assignment history from what the table records: when each tag was
 * registered (and what it was mapped to) and when it was last changed. The
 * previous mapping is not stored, so "from" is never filled in.
 */
export function assignmentHistory(rows = []) {
  const out = []
  for (const r of rows) {
    const created = timeOf(r.registeredAt)
    const updated = timeOf(r.updatedAt)
    const to = r.asset || r.serial || null
    if (created != null) out.push({ key: `${r.id}-c`, ms: created, tagId: r.tagId, action: to ? 'Registered and mapped' : 'Registered', to, rowId: r.id })
    if (updated != null && (created == null || updated - created > 60000)) out.push({ key: `${r.id}-u`, ms: updated, tagId: r.tagId, action: 'Record changed', to, rowId: r.id })
  }
  return out.sort((a, b) => b.ms - a.ms)
}

/** Tags registered per local day, newest first. */
export function registrationsByDay(rows = []) {
  const map = new Map()
  for (const r of rows) {
    const t = timeOf(r.registeredAt)
    if (t == null) continue
    const k = dayKey(t)
    const cur = map.get(k) || { key: k, ms: t, count: 0, mapped: 0 }
    cur.count += 1
    if (r.asset || r.serial) cur.mapped += 1
    map.set(k, cur)
  }
  return [...map.values()].sort((a, b) => b.ms - a.ms)
}

const HEADER_KEYS = {
  tag_id: /^(tag[\s_-]*(id|uid|no|number)?|rfid([\s_-]*(tag|id|uid))*|epc|uid)$/i,
  tyre_serial: /^(tyre|tire)?[\s_-]*serial([\s_-]*(no|number))?$|^serial[\s_-]*no$/i,
  asset_no: /^(asset|vehicle|fleet)[\s_-]*(no|number|code|id)?$/i,
  site: /^(site|location)$/i,
  status: /^status$/i,
  notes: /^(notes?|remarks?|comments?)$/i,
}

/** Map a header label to a tag field, or null. */
export function importField(header) {
  const h = s(header)
  for (const [field, re] of Object.entries(HEADER_KEYS)) if (re.test(h)) return field
  return null
}

/**
 * Turn parsed sheet rows into tag payloads. A row needs a tag id; an id
 * already registered or repeated in the file is skipped with a reason.
 */
export function planTagImport(sheetRows = [], existingIds = new Set()) {
  const valid = []
  const skipped = []
  const seen = new Set()
  sheetRows.forEach((row, i) => {
    const rec = {}
    for (const [h, v] of Object.entries(row || {})) {
      const f = importField(h)
      if (f && rec[f] == null && s(v)) rec[f] = s(v)
    }
    const id = normalizeTagId(rec.tag_id)
    const line = i + 2
    if (!id) { skipped.push({ line, reason: 'No tag ID' }); return }
    if (existingIds.has(id)) { skipped.push({ line, tagId: id, reason: 'Already registered' }); return }
    if (seen.has(id)) { skipped.push({ line, tagId: id, reason: 'Repeated in the file' }); return }
    seen.add(id)
    const status = RFID_STATUSES.includes(s(rec.status).toLowerCase()) ? s(rec.status).toLowerCase() : undefined
    valid.push({ tag_id: id, tyre_serial: rec.tyre_serial || null, asset_no: rec.asset_no || null, site: rec.site || null, status, notes: rec.notes || null })
  })
  return { valid, skipped }
}

export const TAG_EXPORT_COLUMNS = [
  ['tagId', 'RFID tag ID'], ['itemLabel', 'Type'], ['asset', 'Asset'], ['serial', 'Tyre serial'],
  ['makeModel', 'Make / model'], ['sizeSpec', 'Size / spec'], ['site', 'Site'], ['stateLabel', 'Status'],
  ['lastScannedAt', 'Last scanned'], ['scanCount', 'Scan count'], ['notes', 'Notes'],
]

/** Export rows with blanks as empty strings. */
export function tagExportRows(rows = []) {
  return rows.map((r) => Object.fromEntries(TAG_EXPORT_COLUMNS.map(([k]) => [k, r[k] == null ? '' : r[k]])))
}
