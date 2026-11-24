/**
 * Warehouse floor workflow: put-away, picking and workshop handover. Pure, no I/O.
 *
 * Every stock change these screens make goes through an existing inv_* RPC:
 *   - put-away  = a same-site transfer (inv_transfer_dispatch, then
 *                 inv_transfer_receive) from a receiving area to a bin;
 *   - picking   = inv_issue against the job card's reservation;
 *   - handover  = recorded on that issue movement (source document = the job
 *                 card, the receiver named in the issue note), because no table
 *                 records a parts handover yet. The proposed table is in
 *                 docs/warehouse/09_FLOOR_WORKFLOW_DB_CHANGES.md.
 *
 * The server stays the authority on scope, permission and shortage. These
 * helpers only decide what is offered and what is sent.
 */

/** Location types goods are received into and put away FROM. */
export const PUTAWAY_SOURCE_TYPES = ['warehouse', 'zone', 'rack']
/** Location types goods are put away INTO. */
export const PUTAWAY_TARGET_TYPES = ['bin', 'shelf']

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
const text = (v) => String(v ?? '').trim()

/** Free stock on a balance line (on hand minus reserved), never below zero. */
export function freeQty(stock) {
  const onHand = num(stock?.qty_on_hand)
  if (onHand === null) return null
  return Math.max(0, onHand - (num(stock?.qty_reserved) || 0))
}

/** id -> location. */
export function locationIndex(locations = []) {
  const m = new Map()
  for (const l of locations || []) if (l?.id) m.set(l.id, l)
  return m
}

/** Ancestor ids of a location, nearest first (cycle safe). */
export function ancestorIds(loc, index) {
  const out = []
  const seen = new Set(loc?.id ? [loc.id] : [])
  let cur = loc?.parent_id ? index.get(loc.parent_id) : null
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.push(cur.id)
    cur = cur.parent_id ? index.get(cur.parent_id) : null
  }
  return out
}

/** "WH-01 > ZONE-A > BIN-03" for a location id; the code alone when there is no tree. */
export function locationPath(locationId, index, fallbackCode = '') {
  const loc = locationId ? index.get(locationId) : null
  if (!loc) return text(fallbackCode) || 'No location'
  const chain = [...ancestorIds(loc, index)].reverse().map((id) => index.get(id)?.code).filter(Boolean)
  return [...chain, loc.code].filter(Boolean).join(' > ')
}

/** Is this balance sitting in a receiving area (not yet in a bin)? */
export function isPutawaySource(loc) {
  return !!loc && loc.active !== false && PUTAWAY_SOURCE_TYPES.includes(loc.location_type)
}

/** Ids of active receiving-area locations, for the candidate read. */
export function putawaySourceIds(locations = []) {
  return (locations || []).filter(isPutawaySource).map((l) => l.id)
}

/**
 * Bins / shelves the stock may go to: active, same country and site, not the
 * location it is already in. Bins under the stock's own warehouse / zone come
 * first (`nearby`), then by path.
 */
export function putawayTargets(stock, locations = []) {
  if (!stock) return []
  const index = locationIndex(locations)
  return (locations || [])
    .filter((l) => l.active !== false && PUTAWAY_TARGET_TYPES.includes(l.location_type)
      && l.id !== stock.location_id && same(l.country, stock.country) && same(l.site, stock.site))
    .map((l) => ({
      ...l,
      path: locationPath(l.id, index, l.code),
      nearby: !!stock.location_id && ancestorIds(l, index).includes(stock.location_id),
    }))
    .sort((a, b) => (Number(b.nearby) - Number(a.nearby)) || a.path.localeCompare(b.path))
}

/**
 * Validate a put-away before sending it. `{ ok, qty, error }`.
 * Reserved stock is left where it is: only free stock can be put away.
 */
export function validatePutaway({ stock, target, qty }) {
  if (!stock) return { ok: false, error: 'Choose the stock line to put away.' }
  if (!stock.location_id) return { ok: false, error: 'This stock line has no location, so it cannot be moved. Give it a location first.' }
  if (!target) return { ok: false, error: 'Choose the bin or shelf to put it in.' }
  if (target.id === stock.location_id) return { ok: false, error: 'Choose a different location from the one it is in.' }
  if (!same(target.site, stock.site) || !same(target.country, stock.country)) {
    return { ok: false, error: 'Put-away stays inside one site. Use a transfer to move stock to another site.' }
  }
  const n = num(qty)
  if (n === null || n <= 0) return { ok: false, error: 'Enter a quantity above zero.' }
  const free = freeQty(stock)
  if (free !== null && n > free) return { ok: false, error: `Only ${free} is free to move (the rest is reserved).` }
  return { ok: true, qty: n }
}

/** Transfer lines still in transit, as the receive payload (received in full). */
export function putawayReceiveLines(transferLines = []) {
  return (transferLines || [])
    .map((l) => ({ line_id: l.id, received_qty: (num(l.qty_dispatched) || 0) - (num(l.qty_received) || 0) - (num(l.qty_returned) || 0) }))
    .filter((l) => l.line_id && l.received_qty > 0)
}

/** Where a put-away stands: 'start' -> 'receive' (dispatched, not yet in the bin) -> 'done'. */
export function putawayStage(state) {
  if (state?.done) return 'done'
  if (state?.transferId) return 'receive'
  return 'start'
}

// ── Picking ──────────────────────────────────────────────────────────────────

/** A job card number as typed, trimmed and with inner spaces collapsed. */
export function normaliseJobCard(v) {
  return text(v).replace(/\s+/g, ' ')
}

/** The spellings a job card may be stored under (as typed, and upper case). */
export function jobCardVariants(v) {
  const j = normaliseJobCard(v)
  if (!j) return []
  return [...new Set([j, j.toUpperCase()])]
}

/** Quantity of a reservation still to pick. */
export function reservationOpenQty(r) {
  const q = (num(r?.qty) || 0) - (num(r?.qty_released) || 0) - (num(r?.qty_consumed) || 0)
  return Math.max(0, Math.round(q * 1e6) / 1e6)
}

/**
 * One pick line per open reservation. `reservations` are stock_reservations
 * rows (pickable: confirming issues against the reservation). `holds` are
 * work-order reservation lines `{ reservation_id, stock_id, quantity }`, shown
 * for information only: inv_issue cannot consume them.
 */
export function buildPickList({ reservations = [], holds = [], balances = [], locations = [] } = {}) {
  const stock = new Map((balances || []).map((b) => [b.id, b]))
  const index = locationIndex(locations)
  const line = (b, extra) => ({
    stockId: b?.id || extra.stockId,
    itemId: b?.item_id || null,
    itemCode: b?.item_code || null,
    description: b?.description || null,
    site: b?.site || extra.site || null,
    country: b?.country || extra.country || null,
    locationId: b?.location_id || null,
    locationCode: b?.location_code || null,
    locationPath: b ? locationPath(b.location_id, index, b.location_code) : 'Stock line not visible',
    onHand: num(b?.qty_on_hand),
    uom: b?.uom || null,
    visible: !!b,
    ...extra,
  })
  const out = []
  for (const r of reservations || []) {
    if (r?.status && r.status !== 'active') continue
    const qty = reservationOpenQty(r)
    if (qty <= 0) continue
    out.push(line(stock.get(r.stock_id), {
      key: `r:${r.id}`, source: 'reservation', reservationId: r.id, stockId: r.stock_id, qty,
      site: r.site, country: r.country, reservedAt: r.created_at || null,
    }))
  }
  for (const h of holds || []) {
    const qty = num(h?.quantity)
    if (!qty || qty <= 0) continue
    out.push(line(stock.get(h.stock_id), {
      key: `w:${h.reservation_id}:${h.stock_id}`, source: 'work_order', reservationId: null, holdId: h.reservation_id, stockId: h.stock_id, qty,
    }))
  }
  return out.sort((a, b) => text(a.site).localeCompare(text(b.site))
    || a.locationPath.localeCompare(b.locationPath)
    || text(a.itemCode).localeCompare(text(b.itemCode)))
}

/** Pick lines grouped by site, then by location (walking order). */
export function groupPickList(lines = []) {
  const sites = new Map()
  for (const l of lines || []) {
    const s = l.site || 'No site'
    if (!sites.has(s)) sites.set(s, new Map())
    const locs = sites.get(s)
    const k = l.locationPath
    if (!locs.has(k)) locs.set(k, [])
    locs.get(k).push(l)
  }
  return [...sites.entries()].map(([site, locs]) => ({
    site,
    lineCount: [...locs.values()].reduce((n, ls) => n + ls.length, 0),
    locations: [...locs.entries()].map(([path, ls]) => ({ path, lines: ls, totalQty: ls.reduce((n, l) => n + (l.qty || 0), 0) })),
  }))
}

/** Rows for the printable pick list (PDF / Excel). */
export function pickExportRows(lines = [], jobCard = '') {
  return (lines || []).map((l, i) => ({
    no: i + 1,
    job_card: normaliseJobCard(jobCard),
    site: l.site || '',
    location: l.locationPath,
    item_code: l.itemCode || '',
    description: l.description || '',
    qty: l.qty,
    uom: l.uom || '',
    on_hand: l.onHand ?? '',
    source: l.source === 'reservation' ? 'Reservation' : 'Job card hold (not pickable here)',
    picked: '',
    received_by: '',
  }))
}

export const PICK_EXPORT_COLUMNS = [
  { key: 'no', header: '#' },
  { key: 'site', header: 'Site' },
  { key: 'location', header: 'Location / bin' },
  { key: 'item_code', header: 'Item code' },
  { key: 'description', header: 'Description' },
  { key: 'qty', header: 'Qty to pick' },
  { key: 'uom', header: 'Unit' },
  { key: 'on_hand', header: 'On hand' },
  { key: 'source', header: 'Source' },
  { key: 'picked', header: 'Picked qty' },
  { key: 'received_by', header: 'Received by' },
]

const HANDOVER_TAG = 'Handed to:'
const NOTE_MAX = 400

/** Strip the separator so a typed value can never forge another field. */
const field = (v, max = 120) => text(v).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, max)

/**
 * The issue note that records the handover. Format:
 *   "Pick for job card X | Handed to: NAME | Note: ..."
 */
export function handoverReason({ jobCard, receivedBy, note } = {}) {
  const parts = [`Pick for job card ${field(jobCard, 80)}`]
  if (field(receivedBy)) parts.push(`${HANDOVER_TAG} ${field(receivedBy)}`)
  if (field(note, 200)) parts.push(`Note: ${field(note, 200)}`)
  return parts.join(' | ').slice(0, NOTE_MAX)
}

/** Read the handover back out of an issue note. */
export function parseHandover(reason) {
  const r = text(reason)
  const parts = r.split(' | ').map((p) => p.trim())
  const get = (prefix) => {
    const p = parts.find((x) => x.toLowerCase().startsWith(prefix.toLowerCase()))
    return p ? p.slice(prefix.length).trim() || null : null
  }
  return {
    picked: /^pick for job card/i.test(r),
    receivedBy: get(HANDOVER_TAG),
    note: get('Note:'),
  }
}

/**
 * The inv_issue arguments for confirming one pick line. `{ ok, args, error }`.
 * Only a reservation line can be confirmed here; the issue consumes it.
 */
export function pickIssueArgs({ line, qty, jobCard, receivedBy, note }) {
  if (!line) return { ok: false, error: 'Choose a pick line.' }
  if (line.source !== 'reservation' || !line.reservationId) {
    return { ok: false, error: 'This line is a job card hold, not a stock reservation. Reserve the stock for the job card first, then pick it.' }
  }
  const jc = normaliseJobCard(jobCard)
  if (!jc) return { ok: false, error: 'The job card number is missing.' }
  const n = num(qty === '' || qty == null ? line.qty : qty)
  if (n === null || n <= 0) return { ok: false, error: 'Enter a quantity above zero.' }
  if (n > line.qty) return { ok: false, error: `Only ${line.qty} is reserved for this job card on this line.` }
  return {
    ok: true,
    args: {
      stockId: line.stockId, qty: n, reservationId: line.reservationId,
      reason: handoverReason({ jobCard: jc, receivedBy, note }),
      referenceNo: jc, sourceDocType: 'job_card', sourceDocId: jc,
    },
  }
}

// ── Handover ────────────────────────────────────────────────────────────────

/**
 * Handover record for a job card, from its issue / return movements.
 * `people` = profiles `{ id, full_name, username }`.
 */
export function summariseHandover(movements = [], people = []) {
  const names = new Map((people || []).map((p) => [p.id, p.full_name || p.username || null]))
  const rows = (movements || []).map((m) => {
    const h = parseHandover(m.reason)
    const isReturn = m.movement_type === 'issue_return'
    const actor = m.actor_id || m.created_by
    return {
      id: m.id,
      postedAt: m.posted_at || m.created_at || null,
      kind: isReturn ? 'Returned to store' : 'Issued',
      itemCode: m.item_code || null,
      location: m.location_code || m.site || null,
      site: m.site || null,
      qty: Math.abs(num(m.qty_change) || 0),
      givenBy: actor ? (names.get(actor) || 'Unknown user') : 'Not recorded',
      receivedBy: isReturn ? null : h.receivedBy,
      note: h.note,
      viaPick: h.picked,
    }
  })
  const byItem = new Map()
  for (const r of rows) {
    const k = r.itemCode || 'Unknown item'
    const cur = byItem.get(k) || { itemCode: k, issued: 0, returned: 0 }
    if (r.kind === 'Issued') cur.issued += r.qty
    else cur.returned += r.qty
    byItem.set(k, cur)
  }
  const items = [...byItem.values()].map((x) => ({ ...x, net: Math.round((x.issued - x.returned) * 1e6) / 1e6 }))
  return {
    rows,
    items,
    issuedCount: rows.filter((r) => r.kind === 'Issued').length,
    missingReceiver: rows.filter((r) => r.kind === 'Issued' && !r.receivedBy).length,
  }
}

export const HANDOVER_EXPORT_COLUMNS = [
  { key: 'postedAt', header: 'Date and time' },
  { key: 'kind', header: 'Movement' },
  { key: 'itemCode', header: 'Item code' },
  { key: 'location', header: 'From location' },
  { key: 'qty', header: 'Qty' },
  { key: 'givenBy', header: 'Given by' },
  { key: 'receivedBy', header: 'Received by' },
  { key: 'note', header: 'Note' },
]
