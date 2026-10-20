import { brandOf } from './partsExpense'

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

export function stockKind(description) {
  const d = String(description || '').toLowerCase()
  if (/\b(filter|lubricant|coolant|engine oil|hydraulic oil|labour|labor|service|fitting charge)\b/.test(d)) return null
  const size = /\d{3}\s*\/\s*\d{2}\s*r?\s*\d{2}|\d{2}\.\d{1,2}\s*[-r]\s*\d{2}|\d{4}\s*r\s*\d{2}/i.test(d)
  if (/\b(valve|tube|flap|patch|repair kit|nut|stud|glue|cement|gauge|lever|inflator|balancing weight|bead sealer|tyre paste|tire paste|tyre soap|tire soap)\b/.test(d) && (/\b(tyre|tire|wheel|rim)\b/.test(d) || size)) return 'accessory'
  if (/\b(rim|wheel disc)\b/.test(d)) return 'rim'
  if (size || /\b(tyre|tire)\b/.test(d)) return 'tyre'
  return null
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
      unit: stockItem(r).unit || '', stock: r, label: 'Existing stock',
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

export function stockDraft(option) {
  const meta = stockItem(option.stock)
  return {
    ...option, brand: option.brand || brandOf(option.name) || '', rowKey: option.key || crypto.randomUUID(),
    stock_id: option.stock?.id || null,
    expected_qty: option.stock?.stock_qty ?? null,
    expected_updated_at: option.stock?.updated_at || null,
    quantity: '', unit: stockUnit(option.unit) || (option.stock ? '' : 'PCS'),
    condition: meta.condition || (option.stock ? 'Unspecified' : 'New'),
    bin: meta.bin || '', size: option.size || tyreSizeFrom(option.name),
  }
}

export function entryErrors(lines, { site, country, mode, reference, confirmed = true }) {
  const errors = []
  if (!country || country === 'All') errors.push('Choose one country in the workspace header.')
  if (!site.trim()) errors.push('Choose a site / store.')
  if (!lines.length) errors.push('Add at least one item.')
  if (lines.length > 100) errors.push('Save no more than 100 items at once.')
  if (mode === 'receipt' && !reference.trim()) errors.push('Enter one receipt or delivery reference.')
  if (!confirmed) errors.push('Confirm the item details and physical quantities.')
  const keys = new Set()
  for (const row of lines) {
    const n = row.quantity === '' ? NaN : Number(row.quantity)
    if (!Number.isSafeInteger(n) || n < (mode === 'receipt' ? 1 : 0) || n > 2147483647) errors.push(`${row.name}: enter a whole ${mode === 'receipt' ? 'positive receipt quantity' : 'count of zero or more'}.`)
    if (!row.unit) errors.push(`${row.name}: confirm the unit of measure.`)
    if (!STOCK_KINDS.includes(row.kind)) errors.push(`${row.name}: choose tyre, rim or tyre/rim accessory.`)
    const key = row.stock_id || `${row.key}|${row.condition}|${row.bin.trim().toUpperCase()}`
    if (keys.has(key)) errors.push(`${row.name}: this item and location are already in the count.`)
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
