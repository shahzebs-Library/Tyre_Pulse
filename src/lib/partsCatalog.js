/**
 * Parts Catalog — pure, side-effect-free helpers.
 *
 * Kept free of Supabase/React so they are trivially unit-testable and reusable
 * across the page, exports and any future analytics. All inputs are defensive:
 * malformed rows never throw.
 */

/** Coerce a value to a finite number, or null when it isn't numeric. */
function toNum(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * A part is "low stock" when both on-hand quantity and reorder level are known
 * numbers and on-hand has fallen to or below the reorder level. When either
 * value is missing there is no reorder signal, so it is NOT low stock.
 * @param {object} part
 * @returns {boolean}
 */
export function partIsLowStock(part) {
  if (!part || typeof part !== 'object') return false
  const qty = toNum(part.on_hand_qty)
  const reorder = toNum(part.reorder_level)
  if (qty == null || reorder == null) return false
  return qty <= reorder
}

/**
 * Aggregate a set of parts into the KPIs the catalog surfaces.
 *
 * @param {Array<object>} rows
 * @returns {{
 *   total: number,
 *   active: number,
 *   discontinued: number,
 *   lowStock: number,
 *   inventoryValue: number,
 *   categories: string[],
 *   categoryCount: number,
 * }}
 */
export function summarizeParts(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const categories = new Set()
  let active = 0
  let discontinued = 0
  let lowStock = 0
  let inventoryValue = 0

  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    if (r.status === 'discontinued') discontinued += 1
    else active += 1

    if (partIsLowStock(r)) lowStock += 1

    const cost = toNum(r.unit_cost)
    const qty = toNum(r.on_hand_qty)
    if (cost != null && qty != null) inventoryValue += cost * qty

    const cat = typeof r.category === 'string' ? r.category.trim() : ''
    if (cat) categories.add(cat)
  }

  const categoryList = [...categories].sort()
  return {
    total: list.length,
    active,
    discontinued,
    lowStock,
    inventoryValue: Math.round(inventoryValue * 100) / 100,
    categories: categoryList,
    categoryCount: categoryList.length,
  }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Buffer above the reorder point below which a part is considered "low" (a soft
 * early warning) rather than "ok". On-hand between reorder and reorder*BUFFER is
 * "low"; at or below reorder is "below_reorder". Documented, not fabricated data.
 */
export const LOW_STOCK_BUFFER = 1.5

/** Multiple of the reorder point used as the replenish-up-to target quantity. */
export const REORDER_TARGET_MULTIPLE = 2

/** Human-facing metadata for each stock-status class. ASCII-only labels. */
export const STOCK_STATUS_META = {
  out: { label: 'Out of stock', color: '#ef4444', order: 0 },
  below_reorder: { label: 'Below reorder', color: '#f97316', order: 1 },
  low: { label: 'Low', color: '#f59e0b', order: 2 },
  ok: { label: 'OK', color: '#10b981', order: 3 },
  unknown: { label: 'Unknown', color: '#64748b', order: 4 },
}
export const STOCK_STATUS_KEYS = ['out', 'below_reorder', 'low', 'ok', 'unknown']

/**
 * Classify a part's stock position from on-hand quantity vs its reorder level.
 *   out           - quantity known and at or below zero
 *   below_reorder - reorder level known and 0 < qty <= reorder
 *   low           - reorder known and reorder < qty <= reorder * LOW_STOCK_BUFFER
 *   ok            - quantity known and comfortably above the reorder buffer
 *   unknown       - on-hand quantity is not a known number
 * When no reorder level exists there is no reorder signal: a positive quantity
 * is "ok", zero/negative is still "out".
 * @param {object} part
 * @returns {'out'|'below_reorder'|'low'|'ok'|'unknown'}
 */
export function partStockStatus(part) {
  if (!part || typeof part !== 'object') return 'unknown'
  const qty = toNum(part.on_hand_qty)
  if (qty == null) return 'unknown'
  if (qty <= 0) return 'out'
  const reorder = toNum(part.reorder_level)
  if (reorder == null || reorder <= 0) return 'ok'
  if (qty <= reorder) return 'below_reorder'
  if (qty <= reorder * LOW_STOCK_BUFFER) return 'low'
  return 'ok'
}

/** Line inventory value for a part (unit_cost * on_hand_qty), or null if unknown. */
export function partLineValue(part) {
  if (!part || typeof part !== 'object') return null
  const cost = toNum(part.unit_cost)
  const qty = toNum(part.on_hand_qty)
  if (cost == null || qty == null) return null
  return round2(cost * qty)
}

/**
 * Total inventory valuation and a per-category breakdown (value + count + share
 * of total). Parts with unknown cost or quantity contribute 0 value but are
 * still counted. Categories sorted by value descending.
 * @param {Array<object>} rows
 */
export function inventoryValuation(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byCat = new Map()
  let total = 0
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const v = partLineValue(r) || 0
    total += v
    const cat = (typeof r.category === 'string' && r.category.trim()) || 'uncategorized'
    const cur = byCat.get(cat) || { category: cat, value: 0, count: 0 }
    cur.value += v
    cur.count += 1
    byCat.set(cat, cur)
  }
  total = round2(total)
  const byCategory = [...byCat.values()]
    .map((c) => ({
      ...c,
      value: round2(c.value),
      share: total > 0 ? round2((c.value / total) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value || a.category.localeCompare(b.category))
  return { total, byCategory }
}

/** Count of parts in each stock-status class (all keys present, zero-filled). */
export function stockStatusCounts(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const out = { out: 0, below_reorder: 0, low: 0, ok: 0, unknown: 0 }
  for (const r of list) out[partStockStatus(r)] += 1
  return out
}

/**
 * Parts at or below their reorder point (out or below_reorder), each with a
 * suggested order quantity to replenish up to REORDER_TARGET_MULTIPLE * reorder.
 * Excludes discontinued parts (no point reordering) and parts with no reorder
 * level. Sorted most-urgent first (out before below_reorder, then by shortfall).
 * @param {Array<object>} rows
 */
export function reorderList(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const out = []
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    if (r.status === 'discontinued') continue
    const reorder = toNum(r.reorder_level)
    if (reorder == null || reorder <= 0) continue
    const qty = toNum(r.on_hand_qty)
    if (qty == null) continue
    const status = partStockStatus(r)
    if (status !== 'out' && status !== 'below_reorder') continue
    const target = reorder * REORDER_TARGET_MULTIPLE
    const suggestedQty = Math.max(Math.ceil(target - qty), 1)
    const cost = toNum(r.unit_cost)
    out.push({
      id: r.id,
      part_no: r.part_no,
      name: r.name || '',
      category: r.category || '',
      supplier: r.supplier || '',
      uom: r.uom || '',
      on_hand_qty: qty,
      reorder_level: reorder,
      status,
      suggestedQty,
      estimatedCost: cost == null ? null : round2(cost * suggestedQty),
    })
  }
  return out.sort(
    (a, b) =>
      STOCK_STATUS_META[a.status].order - STOCK_STATUS_META[b.status].order ||
      b.reorder_level - b.on_hand_qty - (a.reorder_level - a.on_hand_qty) ||
      String(a.part_no).localeCompare(String(b.part_no)),
  )
}

/**
 * ABC (Pareto) analysis by inventory value contribution. Parts ranked by line
 * value descending; cumulative share drives the class:
 *   A - top ~80% of value, B - next ~15%, C - final ~5% (and any zero-value part).
 * Returns every part tagged with value/cumShare/abcClass plus a class summary.
 * Parts with unknown value (0) fall to class C and are noted separately.
 * @param {Array<object>} rows
 * @param {{ aCut?:number, bCut?:number }} [cuts] cumulative-share cutoffs (0..1)
 */
export function abcAnalysis(rows = [], { aCut = 0.8, bCut = 0.95 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const withVal = list
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({ part: r, value: partLineValue(r) || 0 }))
  const total = round2(withVal.reduce((s, x) => s + x.value, 0))
  const ranked = withVal.slice().sort((a, b) => b.value - a.value)

  const summary = {
    A: { count: 0, value: 0 },
    B: { count: 0, value: 0 },
    C: { count: 0, value: 0 },
  }
  let cum = 0
  const items = ranked.map(({ part, value }) => {
    let abcClass
    if (value <= 0 || total <= 0) {
      abcClass = 'C'
    } else {
      const beforeShare = cum / total
      cum += value
      if (beforeShare < aCut) abcClass = 'A'
      else if (beforeShare < bCut) abcClass = 'B'
      else abcClass = 'C'
    }
    const cumShare = total > 0 ? round2((cum / total) * 100) : 0
    summary[abcClass].count += 1
    summary[abcClass].value = round2(summary[abcClass].value + value)
    return {
      id: part.id,
      part_no: part.part_no,
      name: part.name || '',
      category: part.category || '',
      value: round2(value),
      cumShare,
      abcClass,
    }
  })
  return { total, items, summary }
}

/** Map from part id -> ABC class, for annotating table rows / exports. */
export function abcClassByPart(rows = []) {
  const map = new Map()
  for (const it of abcAnalysis(rows).items) map.set(it.id, it.abcClass)
  return map
}

/** Count of parts per category, sorted by count descending. */
export function countsByCategory(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const m = new Map()
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const cat = (typeof r.category === 'string' && r.category.trim()) || 'uncategorized'
    m.set(cat, (m.get(cat) || 0) + 1)
  }
  return [...m.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

/** Count of parts per supplier (blank supplier grouped as "unassigned"). */
export function countsBySupplier(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const m = new Map()
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const s = (typeof r.supplier === 'string' && r.supplier.trim()) || 'unassigned'
    m.set(s, (m.get(s) || 0) + 1)
  }
  return [...m.entries()]
    .map(([supplier, count]) => ({ supplier, count }))
    .sort((a, b) => b.count - a.count || a.supplier.localeCompare(b.supplier))
}

/**
 * Data-quality flags across the catalog: parts missing unit cost, missing
 * reorder level, or carrying a negative on-hand quantity. Returns counts plus
 * the offending part identifiers so the page can surface honest warnings.
 * @param {Array<object>} rows
 */
export function dataQualityFlags(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const missingCost = []
  const missingReorder = []
  const negativeQty = []
  const missingCategory = []
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const tag = { id: r.id, part_no: r.part_no, name: r.name || '' }
    if (toNum(r.unit_cost) == null) missingCost.push(tag)
    if (toNum(r.reorder_level) == null) missingReorder.push(tag)
    const qty = toNum(r.on_hand_qty)
    if (qty != null && qty < 0) negativeQty.push(tag)
    if (!(typeof r.category === 'string' && r.category.trim())) missingCategory.push(tag)
  }
  const totalIssues =
    missingCost.length + missingReorder.length + negativeQty.length + missingCategory.length
  return {
    missingCost,
    missingReorder,
    negativeQty,
    missingCategory,
    counts: {
      missingCost: missingCost.length,
      missingReorder: missingReorder.length,
      negativeQty: negativeQty.length,
      missingCategory: missingCategory.length,
    },
    totalIssues,
  }
}

/**
 * Compose the full analytics bundle the page renders in one pass. Pure and
 * defensive - safe to call with [] (honest zero/empty results).
 * @param {Array<object>} rows
 */
export function buildPartsAnalytics(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const summary = summarizeParts(list)
  const valuation = inventoryValuation(list)
  const statusCounts = stockStatusCounts(list)
  const reorder = reorderList(list)
  const abc = abcAnalysis(list)
  return {
    summary,
    valuation,
    statusCounts,
    reorder,
    abc,
    byCategory: countsByCategory(list),
    bySupplier: countsBySupplier(list),
    dataQuality: dataQualityFlags(list),
    kpis: {
      totalSkus: summary.total,
      inventoryValue: valuation.total,
      outOfStock: statusCounts.out,
      belowReorder: statusCounts.out + statusCounts.below_reorder,
    },
  }
}
