/**
 * stockReplenishmentAnalytics - pure engine behind /stock-replenishment.
 *
 * Consumption rates, days of cover, urgency bands, suggested order quantities,
 * the consumption charts and the purchase-order totals. No I/O; every clock
 * read is an injectable `now`, and month/day keys come from LOCAL calendar
 * getters (never toISOString, which is UTC).
 *
 * HONESTY
 *  - An item with stock but no consumption in the window has NO measurable
 *    cover: daysRemaining is null and urgency is 'Idle', never a fake 9999.
 *  - A unit cost that is not recorded on the stock row and cannot be derived
 *    from priced issues is null, so the estimated cost is null (N/A), not 0.
 *  - Averages over nothing are null.
 */

export const URGENCIES = Object.freeze(['Critical', 'Low', 'Normal', 'Overstocked', 'Idle'])
export const URGENCY_LABEL = Object.freeze({
  Critical: 'Critical', Low: 'Low', Normal: 'Normal', Overstocked: 'Overstocked', Idle: 'No usage',
})
export const CONSUMPTION_WINDOW_DAYS = 90
export const BUFFER_MONTHS = 2

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const qtyOf = (r) => { const q = num(r?.qty); return q !== null && q > 0 ? q : 1 }

/** YYYY-MM-DD for the LOCAL calendar day. */
export function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** The last `n` month keys (YYYY-MM), oldest first, ending with the month of `now`. */
export function monthKeys(now = new Date(), n = 6) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1) + i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}
export function daysAgo(now, days) {
  return localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days))
}
/** Lower bound for the tyre read: six months so all chart buckets populate. */
export function loadSince(now = new Date()) {
  return daysAgo(now, 183)
}

export const keyOf = (site, brand, size) => `${site}||${brand}||${size}`

/** Tyres issued per month per site+brand+size over the trailing window. */
export function consumptionRates(tyreRecords = [], now = new Date(), windowDays = CONSUMPTION_WINDOW_DAYS) {
  const since = daysAgo(now, windowDays)
  const counts = {}
  for (const r of tyreRecords || []) {
    const d = r?.issue_date ? String(r.issue_date).slice(0, 10) : null
    if (!d || d < since) continue
    const k = keyOf(r.site, r.brand, r.size)
    counts[k] = (counts[k] || 0) + qtyOf(r)
  }
  const months = windowDays / 30
  const rates = {}
  for (const [k, c] of Object.entries(counts)) rates[k] = c / months
  return rates
}

/** Weighted per-tyre cost by brand+size: sum(cost x qty) / sum(qty). */
export function avgUnitCosts(tyreRecords = []) {
  const sums = {}; const qtys = {}
  for (const r of tyreRecords || []) {
    const c = num(r?.cost_per_tyre)
    if (c === null || c <= 0) continue
    const k = `${r.brand}||${r.size}`
    const q = qtyOf(r)
    sums[k] = (sums[k] || 0) + c * q
    qtys[k] = (qtys[k] || 0) + q
  }
  const out = {}
  for (const k of Object.keys(sums)) out[k] = sums[k] / qtys[k]
  return out
}

/** Urgency from cover. Null cover with stock on hand = Idle (nothing is consuming it). */
export function computeUrgency(daysRemaining, leadTimeDays, available = 0) {
  if (daysRemaining === null || daysRemaining === undefined) return available > 0 ? 'Idle' : 'Critical'
  if (daysRemaining <= 0) return 'Critical'
  if (daysRemaining < Math.max(leadTimeDays, 30)) return 'Critical'
  if (daysRemaining < 60) return 'Low'
  if (daysRemaining > 180) return 'Overstocked'
  return 'Normal'
}

/** Enriched replenishment rows. */
export function buildMatrix(stockRows = [], rates = {}, unitCosts = {}, leadTimeDays = 7) {
  return (stockRows || []).map(item => {
    const cKey = keyOf(item.site, item.brand, item.size)
    const qty = num(item.quantity)
    const qtyInStock = qty === null ? 0 : Math.trunc(qty)
    // `stock` carries no on-order column; POs live in Procurement.
    const qtyOnOrder = 0
    const available = qtyInStock + qtyOnOrder
    const consumptionPerMonth = rates[cKey] || 0
    const consumptionPerDay = consumptionPerMonth / 30
    let daysRemaining
    if (consumptionPerDay < 0.001) daysRemaining = available > 0 ? null : 0
    else daysRemaining = Math.round(available / consumptionPerDay)
    const suggestedQty = Math.max(0, Math.round(consumptionPerMonth * BUFFER_MONTHS - available))
    const stockCost = num(item.unit_cost)
    const unitCost = stockCost !== null && stockCost > 0 ? stockCost : (unitCosts[`${item.brand}||${item.size}`] ?? null)
    return {
      ...item,
      qtyInStock,
      qtyOnOrder,
      consumptionPerMonth,
      consumptionPerDay,
      daysRemaining,
      suggestedQty,
      unitCost,
      unitCostSource: stockCost !== null && stockCost > 0 ? 'stock' : unitCost !== null ? 'issues' : null,
      estimatedCost: unitCost === null ? null : suggestedQty * unitCost,
      urgency: computeUrgency(daysRemaining, leadTimeDays, available),
      _key: cKey,
    }
  })
}

export function filterMatrix(rows = [], { activeCountry = 'All', site = 'All', urgency = 'All', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter(r => {
    // Server scopes by country null-safely; never drop a null-country row here.
    if (activeCountry && activeCountry !== 'All' && !(r.country == null || r.country === activeCountry)) return false
    if (site !== 'All' && r.site !== site) return false
    if (urgency !== 'All' && r.urgency !== urgency) return false
    if (q) {
      const hay = [r.brand, r.size, r.site].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Quantity actually planned for a row (override wins). */
export function plannedQty(row, overrides = {}) {
  return overrides[row._key] !== undefined ? overrides[row._key] : row.suggestedQty
}

export function summarizeMatrix(rows = [], overrides = {}) {
  let reorderValue = 0; let valued = 0; let unvalued = 0; let units = 0
  for (const r of rows) {
    const q = plannedQty(r, overrides)
    if (q > 0) {
      units += q
      if (r.unitCost === null) unvalued++
      else { reorderValue += q * r.unitCost; valued++ }
    }
  }
  const measured = rows.filter(r => r.daysRemaining !== null)
  const byUrgency = Object.fromEntries(URGENCIES.map(u => [u, 0]))
  for (const r of rows) byUrgency[r.urgency] = (byUrgency[r.urgency] || 0) + 1
  return {
    items: rows.length,
    needsReorder: rows.filter(r => r.daysRemaining !== null && r.daysRemaining < 30).length,
    reorderUnits: units,
    reorderValue: valued > 0 ? reorderValue : (unvalued > 0 ? null : 0),
    unvaluedLines: unvalued,
    avgDays: measured.length ? Math.round(measured.reduce((s, r) => s + r.daysRemaining, 0) / measured.length) : null,
    measuredItems: measured.length,
    stockouts: rows.filter(r => r.qtyInStock <= 0).length,
    overstocked: byUrgency.Overstocked,
    idle: byUrgency.Idle,
    byUrgency,
  }
}

/** Top sizes by issued volume, and per-month counts for each. */
export function consumptionBySize(tyreRecords = [], now = new Date(), months = 6, top = 5) {
  const keys = monthKeys(now, months)
  const totals = {}
  for (const r of tyreRecords || []) if (r?.size) totals[r.size] = (totals[r.size] || 0) + qtyOf(r)
  const sizes = Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([k]) => k)
  const series = sizes.map(size => ({
    size,
    data: keys.map(m => (tyreRecords || [])
      .filter(r => r.size === size && String(r.issue_date || '').startsWith(m))
      .reduce((s, r) => s + qtyOf(r), 0)),
  }))
  return { months: keys, series }
}

export function trendForSize(tyreRecords = [], size, now = new Date(), months = 6) {
  const keys = monthKeys(now, months)
  return {
    months: keys,
    data: keys.map(m => (tyreRecords || [])
      .filter(r => r.size === size && String(r.issue_date || '').startsWith(m))
      .reduce((s, r) => s + qtyOf(r), 0)),
  }
}

export function allSizes(tyreRecords = []) {
  return [...new Set((tyreRecords || []).map(r => r.size).filter(Boolean))].sort()
}

/** Size x site issued volume over the last `days`. Rows sorted by total, highest first. */
export function consumptionGrid(tyreRecords = [], now = new Date(), days = 30) {
  const since = daysAgo(now, days)
  const grid = {}
  const siteSet = new Set()
  for (const r of tyreRecords || []) {
    const d = r?.issue_date ? String(r.issue_date).slice(0, 10) : null
    if (!d || d < since || !r.size || !r.site) continue
    siteSet.add(r.site)
    grid[r.size] = grid[r.size] || {}
    grid[r.size][r.site] = (grid[r.size][r.site] || 0) + qtyOf(r)
  }
  const sites = [...siteSet].sort()
  const rows = Object.keys(grid).map(size => {
    const row = { size, total: 0 }
    for (const s of sites) { row[s] = grid[size][s] || 0; row.total += row[s] }
    return row
  }).sort((a, b) => b.total - a.total || a.size.localeCompare(b.size))
  return { sites, rows }
}

/** Largest month-to-average swing across the chart window, in %; null without volume. */
export function seasonalVariance(tyreRecords = [], now = new Date(), months = 6) {
  const keys = monthKeys(now, months)
  const counts = keys.map(m => (tyreRecords || []).filter(r => String(r.issue_date || '').startsWith(m)).reduce((s, r) => s + qtyOf(r), 0))
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length
  if (!(avg > 0)) return null
  return Math.max(...counts.map(c => Math.abs((c - avg) / avg))) * 100
}

export function orderTotals(lines = []) {
  const units = lines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0)
  const total = lines.reduce((s, l) => s + (parseFloat(l.totalCost) || 0), 0)
  return {
    lines: lines.length,
    units,
    total,
    sites: new Set(lines.map(l => l.site).filter(Boolean)).size,
    unpriced: lines.filter(l => !(parseFloat(l.unitCost) > 0)).length,
    missingSupplier: lines.filter(l => !String(l.supplier || '').trim()).length,
  }
}

export const MATRIX_EXPORT_COLS = ['brand', 'size', 'site', 'in_stock', 'daily_usage', 'days_left', 'planned_qty', 'unit_cost', 'est_cost', 'status']
export const MATRIX_EXPORT_HEADERS = ['Brand', 'Size', 'Site', 'In Stock', 'Daily Usage', 'Days Left', 'Planned Qty', 'Unit Cost', 'Est. Cost', 'Status']

export function matrixExportRows(rows = [], overrides = {}, moneyOk = true) {
  return rows.map(r => {
    const q = plannedQty(r, overrides)
    return {
      brand: r.brand || '',
      size: r.size || '',
      site: r.site || '',
      in_stock: r.qtyInStock,
      daily_usage: r.consumptionPerDay > 0 ? +r.consumptionPerDay.toFixed(2) : 0,
      days_left: r.daysRemaining === null ? 'N/A' : r.daysRemaining,
      planned_qty: q,
      unit_cost: !moneyOk || r.unitCost === null ? 'N/A' : +r.unitCost.toFixed(2),
      est_cost: !moneyOk || r.unitCost === null ? 'N/A' : Math.round(q * r.unitCost),
      status: URGENCY_LABEL[r.urgency] || r.urgency,
    }
  })
}
