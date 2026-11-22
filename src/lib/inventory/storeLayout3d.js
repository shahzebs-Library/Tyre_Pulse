/**
 * Store 3D layout (pure, no I/O, no three.js).
 *
 * Turns one store's inventory_locations tree into boxes the 3D view draws:
 * each shipping container is a 20 ft standard box (5.9 x 2.35 x 2.39 m inside,
 * or 12.03 m long when its name says 40ft) with a rack on the left wall, one on
 * the right wall, the centre aisle empty and the door at one end; each small
 * room is a box
 * with its racks in rows. Shelves stack up the rack and bins sit side by side
 * on a shelf. Bin colour comes from real data only:
 *   counted  a physical-inventory capture was recorded at the bin today
 *   low      on hand is at or below the line's reorder point / minimum
 *   stock    something is on hand
 *   empty    nothing on hand (or nothing recorded)
 */

export const CONTAINER_SIZES = {
  '20ft': { length: 5.9, width: 2.35, height: 2.39 },
  '40ft': { length: 12.03, width: 2.35, height: 2.39 },
}
export const CONTAINER = CONTAINER_SIZES['20ft']

/** A container is 20 ft unless its name records 40 ft (the bulk template writes it). */
export function containerSize(name) {
  return /\b40\s*-?\s*f(oo)?t\b/i.test(String(name || '')) ? '40ft' : '20ft'
}
export const ROOM = { length: 5, width: 4, height: 2.6 }
export const BIN_STATUSES = ['empty', 'stock', 'low', 'counted']
const RACK_DEPTH = 0.6
const GAP = 1.5

const up = (s) => String(s || '').trim().toUpperCase()
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export function isContainerCode(code) {
  return /-C\d{1,4}$/.test(up(code))
}

function sameDay(a, b) {
  const x = new Date(a)
  if (Number.isNaN(x.getTime())) return false
  return x.getFullYear() === b.getFullYear() && x.getMonth() === b.getMonth() && x.getDate() === b.getDate()
}

/**
 * Per-location stock facts. balances: v_inv_balances rows; captures: rows with
 * location_id + captured_at. Returns Map(locationId -> { qty, low, counted, lines }).
 */
export function binFacts(balances = [], captures = [], now = new Date()) {
  const out = new Map()
  const get = (id) => {
    if (!out.has(id)) out.set(id, { qty: 0, low: false, counted: false, lines: [] })
    return out.get(id)
  }
  for (const b of balances || []) {
    if (!b?.location_id) continue
    const f = get(b.location_id)
    const qty = num(b.qty_on_hand)
    f.qty += qty
    const floor = b.reorder_point ?? b.min_qty
    if (floor !== null && floor !== undefined && qty > 0 && qty <= num(floor)) f.low = true
    f.lines.push({ id: b.id, code: b.item_code, description: b.description, qty, uom: b.uom || null, condition: b.condition || null })
  }
  for (const c of captures || []) {
    if (!c?.location_id) continue
    if (sameDay(c.captured_at, now)) get(c.location_id).counted = true
  }
  return out
}

export function binStatus(fact) {
  if (!fact) return 'empty'
  if (fact.counted) return 'counted'
  if (fact.qty > 0 && fact.low) return 'low'
  if (fact.qty > 0) return 'stock'
  return 'empty'
}

function childrenOf(rows) {
  const map = new Map()
  for (const r of rows) {
    const k = r.parent_id || null
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  for (const list of map.values()) list.sort((a, b) => up(a.code).localeCompare(up(b.code)))
  return map
}

function placeRack(rack, kids, facts, { x, z, length, height, rotation }) {
  const shelves = (kids.get(rack.id) || []).filter((r) => r.location_type === 'shelf')
  const looseBins = (kids.get(rack.id) || []).filter((r) => r.location_type === 'bin')
  const levels = shelves.length ? shelves : (looseBins.length ? [{ id: `${rack.id}:loose`, code: rack.code, virtual: true }] : [])
  const levelH = levels.length ? (height - 0.2) / levels.length : height
  const bins = []
  levels.forEach((shelf, si) => {
    const list = shelf.virtual ? looseBins : (kids.get(shelf.id) || []).filter((r) => r.location_type === 'bin')
    const w = list.length ? (length - 0.1) / list.length : length
    list.forEach((bin, bi) => {
      const f = facts.get(bin.id)
      bins.push({
        id: bin.id, code: bin.code, name: bin.name, shelfCode: shelf.code, status: binStatus(f), qty: f?.qty ?? 0,
        lines: f?.lines || [],
        // local to the rack: along its length (u), up (v)
        u: -length / 2 + 0.05 + w * bi + w / 2, v: 0.1 + levelH * si + levelH / 2,
        size: [Math.max(0.05, w * 0.86), Math.max(0.05, levelH * 0.7), RACK_DEPTH * 0.8],
      })
    })
  })
  return { id: rack.id, code: rack.code, name: rack.name, x, z, length, height, depth: RACK_DEPTH, rotation, shelves: levels.length, bins }
}

/**
 * Build the scene description for one store.
 * rows: inventory_locations rows (any site; only `site` is used).
 * Returns { zones: [...], bins: n, empty: boolean }.
 */
export function buildStoreLayout(rows = [], site, facts = new Map()) {
  const s = up(site)
  const mine = (rows || []).filter((r) => up(r.site) === s && r.active !== false)
  const kids = childrenOf(mine)
  const zoneRows = mine.filter((r) => r.location_type === 'zone' || r.location_type === 'warehouse')
    .filter((r) => (kids.get(r.id) || []).some((k) => k.location_type === 'rack'))
  // Racks not under a zone are drawn together in one room so nothing is hidden.
  const loose = mine.filter((r) => r.location_type === 'rack' && !(r.parent_id && zoneRows.some((z) => z.id === r.parent_id)))

  const groups = zoneRows.map((z) => ({ zone: z, racks: (kids.get(z.id) || []).filter((r) => r.location_type === 'rack') }))
  if (loose.length) groups.push({ zone: { id: `${s}:loose`, code: s, name: null, virtual: true }, racks: loose })

  const zones = []
  let cursor = 0
  for (const g of groups) {
    const container = !g.zone.virtual && isContainerCode(g.zone.code)
    const size = container ? containerSize(g.zone.name) : null
    const dims = container ? CONTAINER_SIZES[size] : {
      length: Math.max(ROOM.length, Math.ceil(g.racks.length / 2) * 2.6),
      width: ROOM.width,
      height: ROOM.height,
    }
    const racks = []
    if (container) {
      // Left wall then right wall, along the full length.
      g.racks.slice(0, 4).forEach((r, i) => {
        const side = i % 2 === 0 ? -1 : 1
        racks.push(placeRack(r, kids, facts, {
          // Racks stop short of the door end (+x) so the doorway stays clear.
          x: -0.3, z: side * (dims.width / 2 - RACK_DEPTH / 2 - 0.05), length: dims.length - 0.9, height: dims.height - 0.1, rotation: 0,
        }))
      })
    } else {
      g.racks.forEach((r, i) => {
        const row = Math.floor(i / 2)
        const side = i % 2 === 0 ? -1 : 1
        racks.push(placeRack(r, kids, facts, {
          x: -dims.length / 2 + 1.3 + row * 2.6, z: side * (dims.width / 2 - RACK_DEPTH / 2 - 0.1), length: 2.2, height: dims.height - 0.2, rotation: 0,
        }))
      })
    }
    zones.push({
      id: g.zone.id, code: g.zone.code, name: g.zone.name, kind: container ? 'container' : 'room', size, virtual: !!g.zone.virtual,
      ...dims, x: 0, z: cursor + dims.width / 2, racks,
    })
    cursor += dims.width + GAP
  }
  // Centre the row of zones on the origin.
  const span = cursor - GAP
  for (const z of zones) z.z -= span / 2
  const bins = zones.reduce((n, z) => n + z.racks.reduce((m, r) => m + r.bins.length, 0), 0)
  return { zones, bins, span: Math.max(span, 0), empty: zones.length === 0 }
}

export function statusCounts(layout) {
  const out = Object.fromEntries(BIN_STATUSES.map((k) => [k, 0]))
  for (const z of layout?.zones || []) for (const r of z.racks) for (const b of r.bins) out[b.status] += 1
  return out
}
