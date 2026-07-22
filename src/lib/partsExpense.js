/**
 * Parts / Maintenance expense engine - the pure logic behind the in-app Expense
 * Import (src/pages/ExpenseImport.jsx) and Expense Report (src/pages/ExpenseReport.jsx).
 *
 * Source = the Ramco "grid details" export (one row per item issued against a work
 * order). Each line carries an amount in `Values` plus the ERP's own split across
 * Spare Parts / Trye (tyre) / Oil / Total. That split is frequently wrong: a real
 * tyre's cost is sometimes filed under Spare Parts, and non-tyre items are sometimes
 * dumped in the Trye column. This engine takes the ONE authoritative amount (Values,
 * falling back to Total then the largest split) and re-buckets it to the correct
 * category BY THE ITEM ITSELF - so a tyre amount sitting in Spare is moved to tyres,
 * and a non-tyre amount sitting in Trye is moved out. This mirrors the DB trigger
 * `classify_parts_consumption()` exactly so the client preview equals the stored result.
 *
 * @module partsExpense
 */

/** Canonical destination columns on public.parts_consumption (raw import columns). */
export const PARTS_FIELDS = Object.freeze([
  'issue_number', 'work_order_no', 'txn_date', 'asset_code', 'asset_description',
  'asset_type', 'store_code', 'cost_center', 'item_code', 'qty', 'item_description',
  'value_amount', 'spare_parts_amount', 'tyre_amount', 'oil_amount', 'total_amount',
  'source_row',
])

/** Normalise a header cell for matching (lowercase, trim, collapse whitespace). */
function normHeader(h) {
  return String(h ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Map a normalised header to a destination field. Uses tolerant contains-matching so
 * truncated Ramco headers ("Total Parts Consumptio") and minor spelling ("Trye") map.
 * @param {string} h @returns {string|null}
 */
export function fieldForHeader(h) {
  const n = normHeader(h)
  if (!n) return null
  if (n === '#' || n === 'no' || n === 'sr' || n === 'sno' || n === 's no') return 'source_row'
  if (n.includes('issue') && n.includes('number')) return 'issue_number'
  if ((n.includes('work order') || n === 'wo' || n.includes('job card')) && !n.includes('type')) return 'work_order_no'
  if (n.includes('transaction') || n === 'date' || n.includes('txn')) return 'txn_date'
  if (n.includes('asset') && (n.includes('code') || n === 'asset')) return 'asset_code'
  if (n.includes('asset') && n.includes('desc')) return 'asset_description'
  if (n.includes('asset') && n.includes('type')) return 'asset_type'
  if (n.includes('store')) return 'store_code'
  if (n.includes('cost cent')) return 'cost_center'
  if (n.includes('itemcode') || (n.includes('item') && n.includes('code'))) return 'item_code'
  if (n === 'qty' || n.includes('quantity')) return 'qty'
  if (n.includes('item') && n.includes('desc')) return 'item_description'
  if (n.includes('total')) return 'total_amount'          // before "value" so "total value" -> total
  if (n === 'values' || n === 'value' || n.includes('value')) return 'value_amount'
  if (n.includes('spare')) return 'spare_parts_amount'
  if (n === 'trye' || n === 'tyre' || n === 'tire' || n.includes('tyre') || n.includes('tire')) return 'tyre_amount'
  if (n.includes('oil')) return 'oil_amount'
  return null
}

/**
 * Build a header->columnIndex map from the first row of a parsed sheet.
 * @param {Array<any>} headerRow
 * @returns {{ map: Record<string, number>, missing: string[] }}
 */
export function buildHeaderMap(headerRow = []) {
  const map = {}
  headerRow.forEach((h, i) => {
    const f = fieldForHeader(h)
    if (f && !(f in map)) map[f] = i
  })
  const required = ['item_description', 'value_amount']
  const missing = required.filter((f) => !(f in map))
  return { map, missing }
}

/** Tolerant numeric parse: strips commas/currency, blank/"NULL" -> null. */
export function toNum(v) {
  if (v == null) return null
  const s = String(v).replace(/[^0-9.\-]/g, '')
  if (s === '' || s === '-' || s === '.') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const TYRE_WORD = /(tyre|tire)/i
const TYRE_SIZE = /[0-9]{3}\s*[/x-]?\s*[0-9]{2}\s*r\s*[0-9]{2}|[0-9]{3}\/[0-9]{2}r|r\s?[0-9]{2}\.5/i
const OIL_WORD = /(engine oil|gear oil|hydraulic oil|lubric|grease|coolant|\batf\b|brake fluid)/i

/**
 * Classify one line. Mirrors the SQL trigger:
 *   lineCost = Values || Total || max(split) || 0  (a zero falls through)
 *   category = tyre when the item names a tyre AND carries a tyre size,
 *              oil when oil amount present (and not a tyre) or an oil keyword,
 *              else spare. The amount is placed in that one bucket.
 * @param {{description:string, value:*, spare:*, tyre:*, oil:*, total:*}} row
 * @returns {{ category:'tyre'|'spare'|'oil', lineCost:number, tyreCost:number, spareCost:number, oilCost:number }}
 */
export function classifyLine({ description, value, spare, tyre, oil, total } = {}) {
  const v = toNum(value) || 0
  const t = toNum(total) || 0
  const sp = toNum(spare) || 0
  const ty = toNum(tyre) || 0
  const oi = toNum(oil) || 0
  const lineCost = v || t || Math.max(sp, ty, oi) || 0
  const d = String(description ?? '')
  const isTyre = TYRE_WORD.test(d) && TYRE_SIZE.test(d)
  const isOil = (oi > 0 && !TYRE_WORD.test(d)) || OIL_WORD.test(d)
  let category = 'spare'
  if (isTyre) category = 'tyre'
  else if (isOil) category = 'oil'
  return {
    category,
    lineCost,
    tyreCost: category === 'tyre' ? lineCost : 0,
    spareCost: category === 'spare' ? lineCost : 0,
    oilCost: category === 'oil' ? lineCost : 0,
  }
}

/**
 * Summarise parsed grid rows for the import preview. `rows` are objects keyed by the
 * PARTS_FIELDS (raw string values). Returns totals + the intelligence counters.
 * @param {Array<Object>} rows
 */
export function summarizeRows(rows = []) {
  let total = 0, tyre = 0, spare = 0, oil = 0
  let tyreLines = 0, spareLines = 0, oilLines = 0
  let reassignedToTyre = 0, reassignedFromTyre = 0, priced = 0
  for (const r of rows) {
    const c = classifyLine({
      description: r.item_description, value: r.value_amount, spare: r.spare_parts_amount,
      tyre: r.tyre_amount, oil: r.oil_amount, total: r.total_amount,
    })
    total += c.lineCost; tyre += c.tyreCost; spare += c.spareCost; oil += c.oilCost
    if (c.lineCost > 0) priced += 1
    if (c.category === 'tyre') { tyreLines += 1; if (!(toNum(r.tyre_amount) > 0)) reassignedToTyre += 1 }
    else { if (toNum(r.tyre_amount) > 0) reassignedFromTyre += 1 }
    if (c.category === 'spare') spareLines += 1
    if (c.category === 'oil') oilLines += 1
  }
  return {
    rows: rows.length, total, tyre, spare, oil,
    tyreLines, spareLines, oilLines, priced,
    reassignedToTyre, reassignedFromTyre,
  }
}

/**
 * Turn a parsed sheet (array-of-arrays, first row headers) into destination row
 * objects, dropping fully-empty rows. Amount/text values are kept as trimmed strings
 * (the DB trigger casts + classifies). `country` stamps every row.
 * @param {Array<Array<any>>} aoa
 * @param {{ country?:string }} [opts]
 * @returns {{ rows: Array<Object>, headerMap: Record<string,number>, missing: string[] }}
 */
export function rowsFromSheet(aoa = [], { country = null } = {}) {
  if (!Array.isArray(aoa) || aoa.length < 2) return { rows: [], headerMap: {}, missing: ['item_description', 'value_amount'] }
  const { map, missing } = buildHeaderMap(aoa[0])
  const clean = (v) => String(v == null ? '' : v).replace(/["\r\n\t]/g, ' ').replace(/&#[0-9]+;/g, ' ').replace(/ {2,}/g, ' ').trim()
  const rows = []
  for (let i = 1; i < aoa.length; i += 1) {
    const src = aoa[i]
    if (!src || src.every((c) => c == null || String(c).trim() === '')) continue
    const row = {}
    for (const f of PARTS_FIELDS) {
      const idx = map[f]
      row[f] = idx == null ? '' : clean(src[idx])
    }
    if (!row.item_description && !row.value_amount && !row.work_order_no) continue
    if (country) row.country = country
    rows.push(row)
  }
  return { rows, headerMap: map, missing }
}

/**
 * Adapter for a sheet parsed by src/lib/import/parseWorkbook.js, whose shape is
 * `{ columns:[{index,header}], rows:[{<header>:value}] }`. Maps each column header to
 * a destination field and projects every row to a PARTS_FIELDS object.
 * @param {{ columns?:Array<{index:number,header:string}>, rows?:Array<Object> }} sheet
 * @param {{ country?:string }} [opts]
 * @returns {{ rows: Array<Object>, missing: string[], mappedFields: string[] }}
 */
export function rowsFromParsedSheet(sheet, { country = null } = {}) {
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : []
  const src = Array.isArray(sheet?.rows) ? sheet.rows : []
  const fieldByHeader = {}
  for (const col of columns) {
    const f = fieldForHeader(col.header)
    if (f && !(f in fieldByHeader)) fieldByHeader[col.header] = f
  }
  const mappedFields = Array.from(new Set(Object.values(fieldByHeader)))
  const missing = ['item_description', 'value_amount'].filter((f) => !mappedFields.includes(f))
  const clean = (v) => String(v == null ? '' : v).replace(/["\r\n\t]/g, ' ').replace(/&#[0-9]+;/g, ' ').replace(/ {2,}/g, ' ').trim()
  const out = []
  for (const r of src) {
    const row = {}
    for (const f of PARTS_FIELDS) row[f] = ''
    for (const [header, f] of Object.entries(fieldByHeader)) row[f] = clean(r[header])
    if (!row.item_description && !row.value_amount && !row.work_order_no) continue
    if (country) row.country = country
    out.push(row)
  }
  return { rows: out, missing, mappedFields }
}
