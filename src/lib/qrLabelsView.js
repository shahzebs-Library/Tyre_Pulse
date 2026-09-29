/**
 * qrLabelsView - pure view engine behind the redesigned QR Labels page.
 *
 * The page generates labels on demand from the tyre register and the fleet
 * register. There is NO label register in the database: no table records a
 * printed label, a scan, a print run or where a label was stuck (checked on the
 * live schema - the only scan-like tables are for OCR and RFID). So:
 *
 *   - "Active QR codes" and "Unassigned labels" have no source and read N/A;
 *   - the print queue and the list of generated batches live in the browser
 *     for this session only, and the page says so;
 *   - inventory, assignment and scan history tabs show an honest empty state.
 *
 * Label geometry stays in qrLabelLayout.js, code matching in qrBulkMatch.js
 * and the register filter in qrLabelsAnalytics.js. No I/O here.
 */
import { isTyrelessEquipment } from './vehicleTyreLayout'
import { filterLabelRows } from './qrLabelsAnalytics'

/** The three things a label can be made for. */
export const ITEM_TYPES = [
  { key: 'tyres', label: 'Tyres', sub: 'Tyre serial labels' },
  { key: 'vehicles', label: 'Vehicles', sub: 'Trucks, mixers, pumps, buses' },
  { key: 'equipment', label: 'Assets / Equipment', sub: 'Generators, plants, fixed gear' },
]

export function itemTypeLabel(type) {
  return ITEM_TYPES.find((t) => t.key === type)?.label || 'Items'
}

/**
 * A fleet record is equipment when it carries no tyres at all (generator,
 * plant, stationary pump...), using the same list the tyre diagram uses, so
 * the two pages can never disagree about what is a vehicle.
 */
export function fleetKind(row) {
  return isTyrelessEquipment(row?.vehicle_type) ? 'equipment' : 'vehicles'
}

export function splitFleet(rows) {
  const out = { vehicles: [], equipment: [] }
  for (const r of Array.isArray(rows) ? rows : []) out[fleetKind(r)].push(r)
  return out
}

/** Rows for the chosen item type. Tyres come from their own register. */
export function rowsForType(rows, type) {
  const list = Array.isArray(rows) ? rows : []
  if (type === 'tyres') return list
  return list.filter((r) => fleetKind(r) === type)
}

/** Which register a type reads. */
export function registerFor(type) {
  return type === 'tyres' ? 'tyres' : 'fleet'
}

/** Manufacturer of a row: tyre brand, or the vehicle make. */
export function makerOf(row, type) {
  const v = type === 'tyres' ? row?.brand : row?.make
  return v ? String(v).trim() : ''
}

/** Size or spec of a row: tyre size, or the vehicle type. */
export function sizeOf(row, type) {
  const v = type === 'tyres' ? row?.size : row?.vehicle_type
  return v ? String(v).trim() : ''
}

function distinctSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** Filter options built from the rows actually loaded, so none returns nothing. */
export function filterOptions(rows, type) {
  const list = Array.isArray(rows) ? rows : []
  return {
    sites: distinctSorted(list.map((r) => (r.site ? String(r.site) : ''))),
    makers: distinctSorted(list.map((r) => makerOf(r, type))),
    sizes: distinctSorted(list.map((r) => sizeOf(r, type))),
  }
}

/**
 * Register filter: the tested search / site / QR-state filter, then maker and
 * size. `mode` for the shared filter is 'tyres' or anything else (fleet).
 */
export function filterRegister(rows, { type, search = '', site = 'all', qr = 'all', maker = 'all', size = 'all' } = {}, ctx = {}) {
  const base = filterLabelRows(rows, { mode: type === 'tyres' ? 'tyres' : 'assets', search, site, qr }, ctx)
  return base.filter((r) => {
    if (maker !== 'all' && makerOf(r, type) !== maker) return false
    if (size !== 'all' && sizeOf(r, type) !== size) return false
    return true
  })
}

/** Status pill for a row: tyre risk, or the vehicle's operational status. */
export function rowStatus(row, type) {
  if (type === 'tyres') {
    const risk = row?.risk_level ? String(row.risk_level) : ''
    if (!risk) return null
    const k = risk.toLowerCase()
    const tone = /critical|high/.test(k) ? 'bad' : /medium|moderate/.test(k) ? 'warn' : /low|good/.test(k) ? 'good' : 'muted'
    return { label: risk, tone }
  }
  const s = row?.ops_status || row?.status
  if (!s) return null
  const k = String(s).toLowerCase()
  const tone = /break|down|scrap/.test(k) ? 'bad'
    : /idle|realloc|inactive|stand/.test(k) ? 'warn'
      : /run|active/.test(k) ? 'good' : 'muted'
  const label = String(s).replace(/_/g, ' ')
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone }
}

// ── Label design ──────────────────────────────────────────────────────────────

/** Size tabs, mapped onto the tested presets in qrLabelLayout plus a custom width. */
export const SIZE_TABS = [
  { key: 'md', label: 'Standard' },
  { key: 'sm', label: 'Compact' },
  { key: 'lg', label: 'Large' },
  { key: 'custom', label: 'Custom' },
]

/** QR error correction. Higher survives more damage but makes a denser code. */
export const QR_LEVELS = [
  { key: 'L', label: 'Low (7% damage)' },
  { key: 'M', label: 'Medium (15% damage)' },
  { key: 'Q', label: 'Quartile (25% damage)' },
  { key: 'H', label: 'High (30% damage)' },
]
export const DEFAULT_QR_LEVEL = 'M'

export function normalizeQrLevel(v) {
  return QR_LEVELS.some((l) => l.key === v) ? v : DEFAULT_QR_LEVEL
}

/**
 * What a label can carry. The code and the QR are always printed: a label
 * without either identifies nothing. The barcode is listed so the choice is
 * visible, and marked unavailable because no barcode generator is installed.
 */
export const LABEL_INFO = [
  { key: 'code', locked: true },
  { key: 'qr', locked: true },
  { key: 'barcode', unavailable: 'No barcode generator is installed, so labels carry the QR code only.' },
  { key: 'spec' },
  { key: 'ref' },
  { key: 'site' },
  { key: 'logo' },
  { key: 'custom' },
]

export const DEFAULT_LABEL_INFO = { spec: true, ref: true, site: true, logo: true, custom: false }

/** Label for an information toggle, worded for the item type. */
export function infoLabel(key, type) {
  const tyres = type === 'tyres'
  switch (key) {
    case 'code': return tyres ? 'Tyre ID (serial)' : 'Asset ID'
    case 'qr': return 'QR code'
    case 'barcode': return 'Barcode (optional)'
    case 'spec': return tyres ? 'Brand and size' : 'Type and make'
    case 'ref': return tyres ? 'Vehicle / asset no' : 'Plate / fleet no'
    case 'site': return 'Site / location'
    case 'logo': return 'Logo'
    case 'custom': return 'Custom text'
    default: return key
  }
}

export function normalizeLabelInfo(info) {
  const src = info && typeof info === 'object' ? info : {}
  const out = {}
  for (const k of Object.keys(DEFAULT_LABEL_INFO)) out[k] = typeof src[k] === 'boolean' ? src[k] : DEFAULT_LABEL_INFO[k]
  return out
}

const CUSTOM_TEXT_MAX = 40

/** Custom text is trimmed, single-line and capped so it cannot swamp a label. */
export function cleanCustomText(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, CUSTOM_TEXT_MAX)
}

/**
 * The secondary lines printed under the code, at most two. ASCII separators:
 * these go onto paper and into the PDF.
 */
export function labelDetailLines(item, type, info, customText) {
  const on = normalizeLabelInfo(info)
  const tyres = type === 'tyres'
  const parts1 = []
  const parts2 = []
  if (on.spec) {
    const spec = tyres ? [item?.brand, item?.size] : [item?.vehicle_type, item?.make]
    const s = spec.filter(Boolean).join(' ')
    if (s) parts1.push(s)
  }
  if (on.ref) {
    const ref = tyres
      ? [item?.asset_no, item?.position].filter(Boolean).join(' ')
      : (item?.registration_no || item?.fleet_number || '')
    if (ref) parts1.push(tyres ? `Asset ${ref}` : ref)
  }
  if (on.site && item?.site) parts2.push(String(item.site))
  if (on.custom) {
    const c = cleanCustomText(customText)
    if (c) parts2.push(c)
  }
  return [parts1.join(' | '), parts2.join(' | ')].filter(Boolean)
}

/** One printable label: everything a sheet needs, independent of page state. */
export function toEntry(item, type, { code, qr, info, customText } = {}) {
  return {
    key: `${type}:${item?.id}`,
    id: item?.id,
    type,
    val: code || '',
    lines: labelDetailLines(item, type, info, customText),
    qr: qr || null,
    row: item,
  }
}

export const COPIES = { min: 1, max: 20 }

export function clampCopies(n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return COPIES.min
  return Math.min(COPIES.max, Math.max(COPIES.min, v))
}

/** Repeat each label `copies` times, keeping copies of one label together. */
export function expandCopies(entries, copies) {
  const c = clampCopies(copies)
  const out = []
  for (const e of Array.isArray(entries) ? entries : []) {
    for (let i = 0; i < c; i++) out.push(c === 1 ? e : { ...e, copy: i + 1 })
  }
  return out
}

// ── Print queue (this session only) ───────────────────────────────────────────

/** Add entries to the queue, keyed so the same label is never queued twice. */
export function addToQueue(queue, entries, copies) {
  const next = new Map(queue instanceof Map ? queue : [])
  const c = clampCopies(copies)
  let added = 0
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e?.qr) continue
    if (!next.has(e.key)) added += 1
    next.set(e.key, { ...e, copies: c })
  }
  return { queue: next, added }
}

export function queueLabelCount(queue) {
  let n = 0
  for (const e of (queue instanceof Map ? queue.values() : [])) n += clampCopies(e.copies)
  return n
}

/** The queue as a flat list of labels to print, copies expanded. */
export function queueToPrint(queue) {
  const out = []
  for (const e of (queue instanceof Map ? queue.values() : [])) out.push(...expandCopies([e], e.copies))
  return out
}

// ── Batches generated this session ────────────────────────────────────────────

export const BATCH_ACTIONS = {
  generated: { label: 'Generated', tone: 'info' },
  printed: { label: 'Sent to printer', tone: 'good' },
  pdf: { label: 'PDF exported', tone: 'good' },
  excel: { label: 'Details exported', tone: 'muted' },
  queued: { label: 'Added to queue', tone: 'warn' },
}

function pad(n, w) { return String(n).padStart(w, '0') }

export function batchNumber(seq, at = new Date()) {
  const d = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date()
  return `QR-${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}-${pad(Math.max(1, Number(seq) || 1), 3)}`
}

export function makeBatch({ seq, type, items, labels, action, by, at = new Date() }) {
  return {
    id: `${batchNumber(seq, at)}-${action}`,
    batchNo: batchNumber(seq, at),
    type,
    items: Number(items) || 0,
    labels: Number(labels) || Number(items) || 0,
    action,
    by: by || 'You',
    at: at instanceof Date ? at.toISOString() : String(at),
  }
}

export function formatBatchTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── KPIs ──────────────────────────────────────────────────────────────────────

/**
 * Headline counts. Register counts are what CAN be labelled (a record with a
 * code), not labels that exist; the tile titles say so. Anything that would
 * need a label register is N/A.
 *
 * @param {{ tyres:number|null, fleet:Array|null, sessionLabels:number }} src
 */
export function buildQrKpis({ tyres = null, fleet = null, sessionLabels = 0 } = {}) {
  const split = Array.isArray(fleet) ? splitFleet(fleet) : null
  return {
    generated: Number(sessionLabels) || 0,
    tyres: tyres == null ? null : Number(tyres),
    vehicles: split ? split.vehicles.length : null,
    equipment: split ? split.equipment.length : null,
    active: null,
    unassigned: null,
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

export const PAGE_TABS = [
  { key: 'generate', label: 'Generate Labels' },
  { key: 'inventory', label: 'Label Inventory' },
  { key: 'assigned', label: 'Assigned Labels' },
  { key: 'scans', label: 'Scan History' },
  { key: 'prints', label: 'Print History' },
  { key: 'settings', label: 'Settings' },
]

/** Why each record-keeping tab is empty, in plain words. */
export const TAB_EMPTY = {
  inventory: {
    title: 'No label stock is kept',
    body: 'Labels are generated on demand from the tyre and fleet registers, so there is no pre-printed stock to count. A label inventory would appear here once printed label stock is recorded.',
  },
  assigned: {
    title: 'Labels are not assigned separately',
    body: 'Each label encodes the tyre serial or the asset code itself, so a scanned label always opens its own record. Assignments would appear here if blank labels were issued first and linked to an item later.',
  },
  scans: {
    title: 'QR scans are not recorded',
    body: 'The scanner looks the record up on each scan without keeping a log. A scan history would appear here once scans are saved with who scanned, where and when.',
  },
  prints: {
    title: 'No print runs yet in this session',
    body: 'Print runs, PDF exports and detail exports you make on this page are listed here. They are kept in this browser tab only and are not saved to the system.',
  },
}

// ── Device-saved templates ────────────────────────────────────────────────────

export function normalizeDesign(d) {
  const src = d && typeof d === 'object' ? d : {}
  return {
    size: SIZE_TABS.some((t) => t.key === src.size) ? src.size : 'md',
    customW: Number.isFinite(Number(src.customW)) ? Number(src.customW) : 50,
    info: normalizeLabelInfo(src.info),
    customText: cleanCustomText(src.customText),
    qrLevel: normalizeQrLevel(src.qrLevel),
    logo: src.logo === 'wordmark' ? 'wordmark' : 'company',
    copies: clampCopies(src.copies ?? 1),
  }
}

/** Upsert a named template; names compare case-insensitively. At most 12 kept. */
export function saveTemplate(list, name, design) {
  const n = String(name || '').trim().slice(0, 40)
  if (!n) return Array.isArray(list) ? list : []
  const rest = (Array.isArray(list) ? list : []).filter((t) => String(t.name).toLowerCase() !== n.toLowerCase())
  return [{ name: n, design: normalizeDesign(design) }, ...rest].slice(0, 12)
}
