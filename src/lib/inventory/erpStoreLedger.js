/**
 * ERP "Stores Ledger" upload (Ramco report CSOL-IMS-013-1).
 *
 * The owner exports one Stores Ledger per warehouse from the ERP and uploads it
 * as-is. This module reads that exact layout and works out, against what Tyre
 * Pulse already holds, what would change:
 *   - item codes the Material Master does not have yet (with a suggested category),
 *   - item names where the ERP wording is fuller or different,
 *   - items in the file still marked "unclassified" (a suggested category),
 *   - per item, the stock quantity that would be set at that store.
 *
 * Everything here is pure: no reads, no writes. The server function
 * inv_erp_ledger_post re-reads stock itself and computes the real change, so a
 * stale screen can never post a wrong quantity.
 *
 * Owner rules this follows (2026-11-26):
 *   - the file layout is the standard upload format;
 *   - the owner's own upload needs no second approval;
 *   - rates are kept with the upload only, never written as stock cost;
 *   - a missing rate is unvalued, never 0;
 *   - codes match exactly (upper case, trimmed), never by a fuzzy guess;
 *   - a negative ERP quantity cannot be counted and is held back.
 */
import { categoryFromCode, hasTyreSize, isLubricant, isNonTyrePart } from '../classificationBrain'

export const LEDGER_REPORT_ID = 'CSOL-IMS-013-1'

/** The header row of the report, as the ERP writes it (trimmed, lower case). */
export const LEDGER_HEADER = ['item code', 'item description', '', 'warehouse', 'zone', 'bin', 'cb qty', 'rate', '', 'value']

/**
 * Warehouse spellings in the ERP that differ from the Tyre Pulse location code.
 * Only spellings checked by hand belong here; anything else must match exactly.
 */
export const WAREHOUSE_ALIASES = Object.freeze({
  'DIRYAH-ST2': 'DIRIYAH-ST2',
})

const clean = (v) => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
const lower = (v) => clean(v).toLowerCase()

/** Upper-case, trimmed item code; '' becomes null. */
export function normCode(v) {
  const c = clean(v).toUpperCase()
  return c || null
}

/** A number as the ERP prints it ("1,234.50", " 2 ", "-3"); null when it is not a number. */
export function toNumber(v) {
  const s = clean(v).replace(/,/g, '')
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** dd/mm/yyyy -> yyyy-mm-dd, else null. */
export function toIsoDate(v) {
  const m = clean(v).match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const dd = Number(d); const mm = Number(mo)
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

function findHeaderRow(aoa) {
  const limit = Math.min(aoa.length, 15)
  for (let i = 0; i < limit; i += 1) {
    const row = (aoa[i] || []).map(lower)
    if (row[0] === 'item code' && row[1] === 'item description' && row.includes('warehouse') && row.includes('cb qty')) return i
  }
  return -1
}

/** True when the sheet is a Stores Ledger export. */
export function isStoreLedger(aoa) {
  return Array.isArray(aoa) && findHeaderRow(aoa) >= 0
}

function readMeta(aoa, headerIdx) {
  const meta = { reportId: null, currency: null, from: null, to: null, bu: null, ou: null }
  for (let i = 0; i < headerIdx; i += 1) {
    const row = aoa[i] || []
    row.forEach((cell, j) => {
      const k = lower(cell)
      if (k.startsWith('report id')) meta.reportId = clean(row[j + 1]) || null
      else if (k.startsWith('currency')) meta.currency = clean(row[j + 1]).toUpperCase() || null
      else if (k.startsWith('bu name')) meta.bu = clean(row[j + 1]) || null
      else if (k.startsWith('ou name')) meta.ou = clean(row[j + 1]) || null
      else if (k.startsWith('date from')) {
        const rest = row.slice(j + 1).map(clean).filter(Boolean)
        meta.from = toIsoDate(rest[0])
        meta.to = toIsoDate(rest[1])
      }
    })
  }
  return meta
}

/**
 * Read a Stores Ledger sheet (array of rows, as parseWorkbookRaw returns).
 * Returns { ok, meta, lines, rejected, warnings, error }.
 * Lines with the same code in the same warehouse are added together.
 */
export function parseStoreLedger(aoa, { filename = '' } = {}) {
  const headerIdx = Array.isArray(aoa) ? findHeaderRow(aoa) : -1
  if (headerIdx < 0) {
    return { ok: false, error: 'not_ledger', meta: null, lines: [], rejected: [], warnings: [] }
  }
  const head = (aoa[headerIdx] || []).map(lower)
  const col = (name) => head.indexOf(name)
  const iCode = col('item code'); const iDesc = col('item description'); const iWh = col('warehouse')
  const iZone = col('zone'); const iBin = col('bin'); const iQty = col('cb qty'); const iRate = col('rate'); const iVal = col('value')

  const meta = { ...readMeta(aoa, headerIdx), filename }
  const rejected = []
  const warnings = []
  const byKey = new Map()

  for (let r = headerIdx + 1; r < aoa.length; r += 1) {
    const row = aoa[r] || []
    const first = lower(row[iCode])
    if (!row.some((c) => clean(c))) continue
    if (first === '<end of report>' || first.startsWith('<end')) break
    const wh = normCode(row[iWh])
    // Total rows carry no warehouse.
    if (first === 'total' || !wh) continue
    const code = normCode(row[iCode])
    if (!code) { rejected.push({ row: r + 1, reason: 'no_code' }); continue }
    const qty = toNumber(row[iQty])
    if (qty === null) { rejected.push({ row: r + 1, code, reason: 'bad_qty' }); continue }
    const rateRaw = toNumber(row[iRate])
    const valueRaw = toNumber(row[iVal])
    const zone = lower(row[iZone]) === 'null' ? null : clean(row[iZone]) || null
    const bin = lower(row[iBin]) === 'null' ? null : clean(row[iBin]) || null
    const key = `${wh}|${code}`
    const prev = byKey.get(key)
    if (prev) {
      prev.qty += qty
      prev.value = prev.value === null || valueRaw === null ? null : prev.value + valueRaw
      prev.rows.push(r + 1)
      continue
    }
    byKey.set(key, {
      code, description: clean(row[iDesc]) || null, warehouse: wh, zone, bin, qty,
      // A rate of 0 or less is not a price: the line stays unvalued.
      rate: rateRaw !== null && rateRaw > 0 ? rateRaw : null,
      value: valueRaw, rows: [r + 1],
    })
  }

  const lines = [...byKey.values()].map((l) => ({ ...l, qty: Math.round(l.qty * 1e4) / 1e4 }))
  if (meta.reportId && meta.reportId !== LEDGER_REPORT_ID) warnings.push('other_report')
  if (!lines.length) warnings.push('no_lines')
  const warehouses = [...new Set(lines.map((l) => l.warehouse))]
  if (warehouses.length > 1) warnings.push('several_warehouses')
  if (lines.some((l) => l.qty < 0)) warnings.push('negative_qty')
  if (lines.some((l) => l.rows.length > 1)) warnings.push('repeated_codes')
  meta.warehouses = warehouses
  return { ok: true, meta, lines, rejected, warnings, error: null }
}

/**
 * The Tyre Pulse location for an ERP warehouse code: an exact code match, or a
 * spelling listed in WAREHOUSE_ALIASES. Returns null when neither matches, so an
 * unknown store is shown to the owner instead of guessed.
 */
export function resolveLocation(warehouse, locations = []) {
  const wh = normCode(warehouse)
  if (!wh) return null
  const codes = [wh, WAREHOUSE_ALIASES[wh]].filter(Boolean)
  for (const c of codes) {
    const hit = locations.find((l) => normCode(l.code) === c && l.active !== false)
    if (hit) return { ...hit, via: c === wh ? 'exact' : 'alias' }
  }
  return null
}

/* ---------------------------------------------------------------- classify */

// Keyword -> subcategory for spare parts, checked in this order. A part name
// that mentions a system ("BRAKE", "CLUTCH") belongs to that system.
const SPARE_SUBCATS = [
  [/\b(brake|abs|air dryer|relay pressure valve|exhaust brake)\b/i, 'Brake system'],
  [/\b(clutch|gear ?box|gear ring|shift cable|release bearing|transmission|propeller|differential)\b/i, 'Transmission'],
  [/\b(leaf spring|drag link|tie rod|shock|suspension|steering|king pin|stabili[sz]er)\b/i, 'Suspension'],
  [/\b(piston|ram|swing|plunger|hopper|s ?valve|concrete|delivery pipe|wear plate|cutting ring)\b/i, 'Pump'],
  [/\b(hydraulic|cylinder|hyd\.?|valve block)\b/i, 'Hydraulic'],
  [/\b(alternator|starter|relay|solenoid|sensor|switch|wiper|lamp|light|bulb|battery|harness|fuse|motor)\b/i, 'Electrical'],
  [/\b(engine|fan|water pump|oil seal|gasket|injector|turbo|radiator|thermostat|belt|exhaust)\b/i, 'Engine'],
  [/\b(drum|mixer|roller|chute)\b/i, 'Drum / mixer'],
  [/\b(mirror|door|glass|bumper|panel|seat|cabin|body)\b/i, 'Body'],
]

const CONSUMABLE_RE = /\b(drill bit|cutting disc|grinding disc|welding|electrode|gloves?|tape|paint|thinner|cleaner|silicone|sealant|cement|brush|rag|bolt|nut|washer|screw|rivet|cable tie|spray)\b/i
const FILTER_RE = /\b(fuel ?filter|oil filter|air filter|hydraulic filter|filter element|cartridge|separator|fuelfilter|filter)\b/i
const FILTER_PART_RE = /\b(housing|cover|bracket|head|base|seat)\b/i

/**
 * Suggest a Material Master category (and subcategory) for an item.
 * Evidence in this order, each with the reason shown to the owner:
 *   1. the ERP code range (the strongest signal in this data);
 *   2. what the description says (tyre size, lubricant, filter, consumable);
 *   3. the reviewed items sharing the same code prefix, by majority;
 *   4. otherwise a spare part.
 * Returns { category, subcategory, reason, confidence }.
 */
export function suggestMaterialClass(code, description, { neighbours } = {}) {
  const desc = clean(description)
  const fromCode = categoryFromCode(normCode(code) || '')
  const sub = subcategoryFor(fromCode?.category, desc)
  if (fromCode && fromCode.category !== 'spare_part') {
    return { category: fromCode.category, subcategory: sub, reason: `code_range:${fromCode.note}`, confidence: 0.95 }
  }
  if (hasTyreSize(desc) && /\b(tyre|tire)\b/i.test(desc) && !isNonTyrePart(desc)) {
    return { category: 'tyre', subcategory: null, reason: 'description:tyre', confidence: 0.9 }
  }
  if (isLubricant(desc)) {
    return { category: 'lubricant', subcategory: subcategoryFor('lubricant', desc), reason: 'description:lubricant', confidence: 0.85 }
  }
  if (FILTER_RE.test(desc) && !FILTER_PART_RE.test(desc)) {
    return { category: 'filter', subcategory: subcategoryFor('filter', desc), reason: 'description:filter', confidence: 0.85 }
  }
  if (CONSUMABLE_RE.test(desc)) {
    return { category: 'consumable', subcategory: subcategoryFor('consumable', desc), reason: 'description:consumable', confidence: 0.75 }
  }
  if (fromCode) {
    return { category: 'spare_part', subcategory: subcategoryFor('spare_part', desc), reason: `code_range:${fromCode.note}`, confidence: 0.9 }
  }
  const pref = (normCode(code) || '').slice(0, 3)
  const counts = neighbours?.get?.(pref)
  if (counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || []
    if (best && total >= 5 && n / total >= 0.8) {
      return { category: best, subcategory: subcategoryFor(best, desc), reason: `neighbours:${pref}`, confidence: Math.min(0.85, 0.5 + n / total / 2) }
    }
  }
  return { category: 'spare_part', subcategory: subcategoryFor('spare_part', desc), reason: 'default', confidence: 0.5 }
}

function subcategoryFor(category, desc) {
  if (!category || !desc) return null
  if (category === 'spare_part') return SPARE_SUBCATS.find(([re]) => re.test(desc))?.[1] || null
  if (category === 'filter') {
    if (/\bfuel/i.test(desc)) return 'Fuel filter'
    if (/\bair\b/i.test(desc)) return 'Air filter'
    if (/\bhyd/i.test(desc)) return 'Hydraulic filter'
    if (/\boil\b/i.test(desc)) return 'Oil filter'
    return null
  }
  if (category === 'lubricant') {
    if (/\bgrease\b/i.test(desc)) return 'Grease'
    if (/\bcoolant|cooliant|antifreeze\b/i.test(desc)) return 'Coolant'
    if (/\bhydraulic\b/i.test(desc)) return 'Hydraulic oil'
    if (/\bgear\b/i.test(desc)) return 'Gear oil'
    if (/\bengine\b/i.test(desc)) return 'Engine oil'
    return null
  }
  if (category === 'consumable') {
    if (/\b(bolt|nut|washer|screw|rivet)\b/i.test(desc)) return 'Fastener'
    if (/\b(silicone|sealant|cement)\b/i.test(desc)) return 'Sealant'
    if (/\b(welding|electrode)\b/i.test(desc)) return 'Welding'
    if (/\b(cleaner|rag|brush)\b/i.test(desc)) return 'Cleaning'
    return null
  }
  return null
}

/** Reviewed master rows counted by category per 3-character code prefix. */
export function buildNeighbours(masterRows = []) {
  const map = new Map()
  for (const r of masterRows) {
    if (!r?.reviewed || !r.category || r.category === 'unclassified') continue
    const p = (normCode(r.item_code) || '').slice(0, 3)
    if (!p) continue
    const m = map.get(p) || {}
    m[r.category] = (m[r.category] || 0) + 1
    map.set(p, m)
  }
  return map
}

/**
 * Should the ERP name replace the current one? Only when it says more or says
 * something different. A shorter name that the current one already starts with
 * (the ERP cut it off) never replaces the fuller one.
 */
export function shouldRename(current, erpName) {
  const a = clean(current).toUpperCase()
  const b = clean(erpName).toUpperCase()
  if (!b || a === b) return false
  if (!a) return true
  if (a.startsWith(b)) return false
  return true
}

/* ------------------------------------------------------------------- plan */

/**
 * Work out what the upload would change for ONE warehouse.
 * @param {object} p
 * @param {Array} p.lines          parsed ledger lines for this warehouse
 * @param {Array} p.master         material_master rows {id, item_code, item_name, category, reviewed} for the country
 * @param {Array} p.stock          stock_records at the location {id, item_id, item_code, description, qty_on_hand, qty_reserved}
 * @param {Map}   [p.neighbours]   buildNeighbours(master) for the whole country
 * @returns plan
 */
export function buildLedgerPlan({ lines = [], master = [], stock = [], neighbours } = {}) {
  const byCode = new Map(master.map((m) => [normCode(m.item_code), m]))
  const stockByItem = new Map(stock.filter((s) => s.item_id).map((s) => [s.item_id, s]))
  const nb = neighbours || buildNeighbours(master)

  const newItems = []
  const renames = []
  const reclassify = []
  const changes = []
  const unchanged = []
  const held = []
  const fileItemIds = new Set()

  for (const l of lines) {
    const m = byCode.get(l.code)
    if (!m) {
      const s = suggestMaterialClass(l.code, l.description, { neighbours: nb })
      newItems.push({ code: l.code, item_name: l.description, ...s })
    } else {
      if (shouldRename(m.item_name, l.description)) renames.push({ code: l.code, item_id: m.id, from: m.item_name || null, to: l.description })
      if ((m.category || 'unclassified') === 'unclassified' && !m.reviewed) {
        const s = suggestMaterialClass(l.code, l.description || m.item_name, { neighbours: nb })
        reclassify.push({ code: l.code, item_id: m.id, name: l.description || m.item_name, ...s })
      }
    }
    if (l.qty < 0) { held.push({ code: l.code, description: l.description, qty: l.qty, reason: 'negative_qty' }); continue }
    const rec = m ? stockByItem.get(m.id) : null
    if (m) fileItemIds.add(m.id)
    const onHand = Number(rec?.qty_on_hand ?? 0)
    const reserved = Number(rec?.qty_reserved ?? 0)
    if (rec && l.qty < reserved) { held.push({ code: l.code, description: l.description, qty: l.qty, reason: 'below_reserved' }); continue }
    const delta = Math.round((l.qty - onHand) * 1e4) / 1e4
    const row = { code: l.code, description: l.description, item_id: m?.id || null, stock_id: rec?.id || null, on_hand: rec ? onHand : null, erp_qty: l.qty, delta, rate: l.rate, is_new_item: !m }
    if (delta === 0) unchanged.push(row)
    else changes.push(row)
  }

  // Stock Tyre Pulse holds at this store that the ERP file does not list.
  const missing = stock
    .filter((s) => s.item_id && !fileItemIds.has(s.item_id) && Number(s.qty_on_hand) > 0)
    .map((s) => ({ stock_id: s.id, item_id: s.item_id, code: s.item_code || null, description: s.description || null, on_hand: Number(s.qty_on_hand), reserved: Number(s.qty_reserved || 0) }))

  const totals = {
    lines: lines.length,
    increase: changes.filter((c) => c.delta > 0).reduce((a, c) => a + c.delta, 0),
    decrease: changes.filter((c) => c.delta < 0).reduce((a, c) => a + c.delta, 0),
    unvaluedLines: lines.filter((l) => l.rate === null).length,
  }
  return { newItems, renames, reclassify, changes, unchanged, held, missing, totals }
}

/**
 * The payload for inv_erp_ledger_post. Only what the owner ticked is sent; the
 * server recomputes every quantity change from live stock.
 */
export function buildPostPayload({ meta, location, country, lines, plan, choices = {}, sha256, idempotencyKey }) {
  const pick = (list, key) => (choices[key] ? list.filter((x) => choices[key].has(x.code)) : list)
  return {
    idempotency_key: idempotencyKey,
    filename: meta?.filename || null,
    file_sha256: sha256,
    report_id: meta?.reportId || null,
    currency: meta?.currency || null,
    period_from: meta?.from || null,
    period_to: meta?.to || null,
    warehouse: lines[0]?.warehouse || null,
    location_id: location?.id || null,
    country,
    zero_missing: Boolean(choices.zeroMissing),
    lines: lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty, rate: l.rate, value: l.value })),
    new_items: pick(plan.newItems, 'newItems').map((n) => ({ code: n.code, item_name: n.item_name, category: n.category, subcategory: n.subcategory })),
    renames: pick(plan.renames, 'renames').map((r) => ({ code: r.code, item_name: r.to })),
    reclassify: pick(plan.reclassify, 'reclassify').map((r) => ({ code: r.code, category: r.category, subcategory: r.subcategory })),
  }
}

/** sha256 of the file bytes as lower-case hex (browser or Node). */
export async function sha256Hex(buffer) {
  const data = buffer instanceof ArrayBuffer ? buffer : buffer?.buffer ? buffer : new Uint8Array(buffer)
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('This browser cannot fingerprint the file.')
  const digest = await subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
