import { brandOf } from './partsExpense'
import { textFn } from './wmsText'

// Item descriptions are suggestions, never evidence of a quantity in a store.
export const STOCK_KINDS = ['tyre', 'rim', 'accessory']
export const STOCK_KIND_LABELS = { tyre: 'Tyres', rim: 'Rims', accessory: 'Tyre / rim accessories' }
export function stockUnit(value) {
  const unit = String(value || '').trim().toUpperCase()
  if (['EA', 'EACH', 'PC', 'PIECE', 'PIECES', 'NO', 'NOS'].includes(unit)) return 'PCS'
  return ['PCS', 'SET', 'PAIR', 'BOX', 'KG', 'L'].includes(unit) ? unit : ''
}
export const stockItem = row => row?.custom_data?.stock_item || {}
export const normalizeStockText = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Mirrors public.stock_item_kind (database). Part numbers such as
// 9617234210/0034305981 used to read as a tyre size, so brake boosters and
// window regulators were offered as tyres; a size now needs clear edges, and
// named non-tyre assemblies are excluded.
const NON_TYRE_PART = /\b(brake|clutch|exhaust|intake|relay|butterfly|solenoid|governor|dryer|drier|injector|radiator|gear|pump|hydraulic|steering|suspension|cylinder|piston|compressor|unloader|check valve|safety valve|tipping|tipper)\b/
const TYRE_SIZE = /(?<![0-9/])\d{3}\s*\/\s*\d{2}\s*r?\s*\d{2}(?:\.\d)?(?!\d)|(?<![0-9.])\d{2}\.\d{1,2}\s*[-r]\s*\d{2}(?!\d)|(?<!\d)\d{4}\s*r\s*\d{2}(?!\d)/i
export function stockKind(description) {
  const d = String(description || '').toLowerCase()
  if (/\b(filter|lubricant|coolant|engine oil|hydraulic oil|labour|labor|service|fitting charge)\b/.test(d)) return null
  if (NON_TYRE_PART.test(d)) return null
  const size = TYRE_SIZE.test(d)
  if (/\b(valve|tube|flap|patch|repair kit|nut|stud|glue|cement|gauge|lever|inflator|balancing weight|bead sealer|tyre paste|tire paste|tyre soap|tire soap)\b/.test(d) && (/\b(tyre|tire|wheel|rim|tubeless)\b/.test(d) || size)) return 'accessory'
  if (/\b(rim|wheel disc)\b/.test(d)) return 'rim'
  if (size || /\b(tyre|tire)\b/.test(d)) return 'tyre'
  return null
}

/** Pack size written in the description, e.g. "260 ML" or "650 G". */
export function packSizeFrom(description) {
  const m = String(description || '').match(/(\d+(?:\.\d+)?)\s*(ml|ltrs?|litres?|liters?|l|gms?|grams?|g|kgs?)\b/i)
  if (!m) return ''
  const unit = m[2].toLowerCase()
  const label = /^m/.test(unit) ? 'ML' : /^l/.test(unit) ? 'L' : /^k/.test(unit) ? 'KG' : 'G'
  return `${m[1]} ${label}`
}

/**
 * Suggest a unit of measure for a stock item, with the reason shown to the
 * user. Order: a unit recorded on the item, a unit already used for the same
 * item in stock, then a rule from what the item is. Never silent: the result
 * always says where the unit came from, and the user can change it.
 * Units are limited to what the stock ledger accepts (PCS SET PAIR BOX KG L);
 * quantities are whole numbers, so tins and tubes are counted per piece.
 * Pass `t` to get the reason in the user's language (English otherwise).
 * @returns {{unit:string, basis:'recorded'|'learned'|'rule', reason:string, pack:string}}
 */
export function suggestStockUnit({ name = '', kind = null, unit = '', learnedUnit = '', t } = {}) {
  const tx = textFn(t)
  const r = (key, vars) => tx(`wmsmsgprocure.stock.unit.${key}`, vars)
  const pack = packSizeFrom(name)
  const recorded = stockUnit(unit)
  if (recorded) return { unit: recorded, basis: 'recorded', reason: r('recorded'), pack }
  const learned = stockUnit(learnedUnit)
  if (learned) return { unit: learned, basis: 'learned', reason: r('learned'), pack }
  const d = String(name || '').toLowerCase()
  const k = kind || stockKind(name)
  if (/\bpairs?\b/.test(d)) return { unit: 'PAIR', basis: 'rule', reason: r('pair'), pack }
  if (/\b(box|boxes|pkt|packet|pack|carton|ctn)\b/.test(d)) return { unit: 'BOX', basis: 'rule', reason: r('box'), pack }
  if (/\b(kit|set)\b/.test(d)) return { unit: 'SET', basis: 'rule', reason: r('set'), pack }
  if (k === 'tyre') return { unit: 'PCS', basis: 'rule', reason: r('tyre'), pack }
  if (k === 'rim') return { unit: 'PCS', basis: 'rule', reason: r('rim'), pack }
  if (/\b(glue|cement|sealer|paste|soap|solution)\b/.test(d)) {
    if (pack) return { unit: 'PCS', basis: 'rule', reason: r('perTin', { pack }), pack }
    if (/\b(paste|soap)\b/.test(d)) return { unit: 'KG', basis: 'rule', reason: r('paste'), pack }
    return { unit: 'PCS', basis: 'rule', reason: r('tinNoPack'), pack }
  }
  if (/\bbalancing weight\b/.test(d)) {
    if (/\bkgs?\b/.test(d) && !/\d+\s*g\b/.test(d)) return { unit: 'KG', basis: 'rule', reason: r('looseWeights'), pack }
    return { unit: 'PCS', basis: 'rule', reason: r('weights'), pack }
  }
  return { unit: 'PCS', basis: 'rule', reason: r('oneByOne'), pack }
}

export function tyreSizeFrom(description) {
  return String(description || '').match(/\d{3}\s*\/\s*\d{2}\s*r?\s*\d{2}(?:\.\d)?|\d{2}\.\d{1,2}\s*[-r]\s*\d{2}|\d{4}\s*r\s*\d{2}/i)?.[0] || ''
}

export function existingStockOptions(records, site, query) {
  const q = normalizeStockText(query)
  if (q.length < 2) return []
  return records.filter(r => r.site === site && (stockItem(r).kind || stockKind(r.description)) &&
    normalizeStockText([r.description, r.brand, r.tyre_size, stockItem(r).code].join(' ')).includes(q))
    .slice(0, 20).map(r => ({
      key: `stock:${r.id}`, source: 'stock', source_id: r.id, name: r.description,
      code: stockItem(r).code || '', kind: stockItem(r).kind || stockKind(r.description),
      brand: r.brand || '', size: r.tyre_size || tyreSizeFrom(r.description),
      unit: stockItem(r).unit || stockUnit(r.uom) || '', stock: r, label: 'Existing stock',
    }))
}

export function mergeStockSuggestions(local, remote) {
  // A code match identifies an existing item only; condition/bin remain explicit.
  const seen = new Set()
  return [...local, ...remote].filter(r => {
    const key = r.key || `${r.source}:${r.source_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function stockDraft(option, t) {
  const meta = stockItem(option.stock)
  const guess = suggestStockUnit({ name: option.name, kind: option.kind, unit: option.unit, learnedUnit: option.learned_unit, t })
  return {
    ...option, brand: option.brand || brandOf(option.name) || '', rowKey: option.key || crypto.randomUUID(),
    stock_id: option.stock?.id || null,
    expected_qty: option.stock?.stock_qty ?? null,
    expected_updated_at: option.stock?.updated_at || null,
    // A balance already on the shelf is never given an assumed unit: a wrong
    // unit would misstate it. The rule-based guess is offered for one-click
    // confirmation instead. New items take the suggestion, shown with why.
    ...(option.stock && guess.basis === 'rule'
      ? { unit: '', suggestedUnit: guess.unit, unitBasis: 'confirm', unitReason: guess.reason }
      : { unit: guess.unit, unitBasis: guess.basis, unitReason: guess.reason }),
    quantity: '', pack: guess.pack,
    condition: meta.condition || (option.stock ? 'Unspecified' : 'New'),
    bin: meta.bin || '', size: option.size || tyreSizeFrom(option.name),
  }
}

export function entryErrors(lines, { site, country, mode, reference, confirmed = true, t }) {
  const tx = textFn(t)
  const e = (key, vars) => tx(`wmsmsgprocure.stock.err.${key}`, vars)
  const errors = []
  if (!country || country === 'All') errors.push(e('chooseCountry'))
  if (!site.trim()) errors.push(e('chooseSite'))
  if (!lines.length) errors.push(e('addItem'))
  if (lines.length > 100) errors.push(e('max100'))
  if (mode === 'receipt' && !reference.trim()) errors.push(e('reference'))
  if (!confirmed) errors.push(e('confirm'))
  const keys = new Set()
  for (const row of lines) {
    const n = row.quantity === '' ? NaN : Number(row.quantity)
    if (!Number.isSafeInteger(n) || n < (mode === 'receipt' ? 1 : 0) || n > 2147483647) errors.push(e(mode === 'receipt' ? 'qtyReceipt' : 'qtyCount', { name: row.name }))
    if (!row.unit) errors.push(e('unit', { name: row.name }))
    if (!STOCK_KINDS.includes(row.kind)) errors.push(e('kind', { name: row.name }))
    const key = row.stock_id || `${row.key}|${row.condition}|${row.bin.trim().toUpperCase()}`
    if (keys.has(key)) errors.push(e('duplicate', { name: row.name }))
    keys.add(key)
  }
  return [...new Set(errors)]
}

export function entryPayload(lines) {
  return lines.map(r => ({
    stock_id: r.stock_id, expected_qty: r.expected_qty, expected_updated_at: r.expected_updated_at,
    source: r.source, source_id: r.source_id, name: r.name, code: r.code || '',
    kind: r.kind, brand: r.brand || '', size: r.size || '', unit: r.unit,
    condition: r.condition, bin: r.bin.trim(), quantity: Number(r.quantity),
  }))
}
