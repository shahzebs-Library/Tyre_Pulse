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
