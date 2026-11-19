/**
 * Opening balance batches (pure).
 *
 * Owner rule (contract, correction 2): the 43 existing stock rows are NOT
 * assumed correct. An opening balance is an import batch with provenance,
 * column mapping, missing-cost flags and an INDEPENDENT approval. Nothing here
 * invents a historical movement; a line with no cost is flagged
 * `missing_cost`, never priced at 0.
 */
import { sumByCurrency } from './inventoryMoney'

export const OB_FIELDS = [
  { key: 'item_code', required: true, synonyms: ['item code', 'item', 'material', 'material code', 'part no', 'part number', 'code', 'sku'] },
  { key: 'description', required: false, synonyms: ['description', 'item description', 'name', 'material description'] },
  { key: 'location_code', required: true, synonyms: ['location', 'location code', 'bin', 'bin code', 'store location'] },
  { key: 'site', required: false, synonyms: ['site', 'store', 'warehouse', 'branch'] },
  { key: 'qty', required: true, synonyms: ['qty', 'quantity', 'on hand', 'qty on hand', 'balance', 'stock qty', 'count'] },
  { key: 'uom', required: false, synonyms: ['uom', 'unit', 'unit of measure'] },
  { key: 'unit_cost', required: false, synonyms: ['unit cost', 'cost', 'avg cost', 'average cost', 'rate', 'price'] },
  { key: 'currency', required: false, synonyms: ['currency', 'ccy'] },
  { key: 'condition', required: false, synonyms: ['condition', 'state'] },
  { key: 'serial_no', required: false, synonyms: ['serial', 'serial no', 'serial number'] },
]

const norm = (s) => String(s || '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Header list -> { fieldKey: headerName }. Exact synonym match only, no guessing. */
export function mapHeaders(headers) {
  const mapping = {}
  const used = new Set()
  for (const f of OB_FIELDS) {
    const hit = (headers || []).find((h) => !used.has(h) && (norm(h) === f.key.replace(/_/g, ' ') || f.synonyms.includes(norm(h))))
    if (hit) { mapping[f.key] = hit; used.add(hit) }
  }
  return mapping
}

export function missingRequired(mapping) {
  return OB_FIELDS.filter((f) => f.required && !mapping?.[f.key]).map((f) => f.key)
}

const num = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/,/g, '').trim()
  if (s === '') return null
  const x = Number(s)
  return Number.isFinite(x) ? x : NaN
}

/**
 * Raw rows -> batch lines with per-line issues.
 *  - qty must be a number >= 0 (no negative physical stock, no override);
 *  - no unit cost -> `missing_cost: true`, unit_cost stays NULL;
 *  - the same item + location twice in one file is a duplicate, flagged.
 */
export function mapRows(rows, mapping, { defaultCurrency = null, defaultSite = null } = {}) {
  const seen = new Map()
  return (rows || []).map((raw, i) => {
    const get = (k) => (mapping?.[k] ? raw?.[mapping[k]] : undefined)
    const issues = []
    const item = String(get('item_code') ?? '').trim()
    const loc = String(get('location_code') ?? '').trim()
    const qty = num(get('qty'))
    const cost = num(get('unit_cost'))
    if (!item) issues.push('missing_item')
    if (!loc) issues.push('missing_location')
    if (qty === null) issues.push('missing_qty')
    else if (Number.isNaN(qty)) issues.push('bad_qty')
    else if (qty < 0) issues.push('negative_qty')
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) issues.push('bad_cost')
    const key = `${item.toUpperCase()}|${loc.toUpperCase()}|${String(get('serial_no') ?? '').trim().toUpperCase()}`
    if (item && loc) {
      if (seen.has(key)) issues.push('duplicate')
      else seen.set(key, i)
    }
    const currency = String(get('currency') ?? '').trim().toUpperCase() || defaultCurrency || null
    const validCost = cost !== null && !Number.isNaN(cost) && cost >= 0
    return {
      line_no: i + 1,
      item_code: item || null,
      description: String(get('description') ?? '').trim() || null,
      location_code: loc || null,
      site: String(get('site') ?? '').trim() || defaultSite || null,
      qty: qty !== null && !Number.isNaN(qty) ? qty : null,
      uom: String(get('uom') ?? '').trim() || null,
      unit_cost: validCost ? cost : null,
      currency,
      condition: String(get('condition') ?? '').trim().toLowerCase() || 'new',
      serial_no: String(get('serial_no') ?? '').trim() || null,
      missing_cost: !validCost,
      issues,
      blocking: issues.length > 0,
    }
  })
}

/** Batch header numbers. Value per currency, priced share stated beside it. */
export function summarizeBatch(lines) {
  const list = lines || []
  const blocking = list.filter((l) => l.issues?.length).length
  const missingCost = list.filter((l) => l.missing_cost).length
  const value = sumByCurrency(list.filter((l) => !l.issues?.length), (l) => (l.unit_cost === null || l.qty === null ? null : l.qty * l.unit_cost), (l) => l.currency)
  return {
    lines: list.length,
    ready: list.length - blocking,
    blocking,
    missingCost,
    pricedPct: list.length ? Math.round(((list.length - missingCost) / list.length) * 1000) / 10 : null,
    value,
  }
}

export const OB_STATUSES = ['draft', 'mapped', 'submitted', 'approved', 'rejected', 'posted']

/** Independent approval: the person who created or submitted cannot approve. */
export function canApproveBatch(batch, userId, can = () => false) {
  if (!batch || !userId) return { ok: false, reason: 'inventory.approve.noUser' }
  if (batch.status !== 'submitted') return { ok: false, reason: 'inventory.opening.notSubmitted' }
  if (!can('adjustment_approve')) return { ok: false, reason: 'inventory.approve.noCapability' }
  if ([batch.created_by, batch.submitted_by].filter(Boolean).includes(userId)) {
    return { ok: false, reason: 'inventory.approve.segregation' }
  }
  return { ok: true, reason: null }
}
