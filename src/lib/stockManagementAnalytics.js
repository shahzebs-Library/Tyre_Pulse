/**
 * stockManagementAnalytics - pure engine behind /stock (Stock Management).
 *
 * Status bands, consumption velocity, days of cover, reorder suggestions, the
 * issue timeline and the KPI strip. No I/O; every clock-dependent helper takes
 * an injectable `now`, and date keys are built from LOCAL calendar getters
 * (never toISOString, which is UTC and shifts the day at +03:00).
 *
 * HONESTY: a figure that cannot be measured is null (N/A), never 0. Days of
 * cover is null when a site has no recorded consumption; the fleet average is
 * null when no item has a measurable cover.
 */

export const STATUSES = Object.freeze(['OK', 'Low', 'Critical'])

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** YYYY-MM-DD from the LOCAL calendar day of `d`. */
export function localDay(d) {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
export function todayStr(now = new Date()) { return localDay(now) }
export function offsetDate(days, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return localDay(d)
}
export function firstOfMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}
/** Start of the velocity window (default three months back). */
export function velocitySince(now = new Date(), months = 3) {
  return localDay(new Date(now.getFullYear(), now.getMonth() - months, now.getDate()))
}

/**
 * Status band. This is the SAME rule the save path writes to stock_status, so
 * it is kept byte-compatible with the historical inline version.
 */
export function deriveStatus(r) {
  if (r.stock_qty <= r.critical_level) return 'Critical'
  if (r.stock_qty <= r.min_level) return 'Low'
  return 'OK'
}

/**
 * Per-record velocity: issues at the record's site over the window, per month,
 * and days of cover at that rate. Sites with no issue have avgPerMonth 0 and
 * daysRemaining null (cover cannot be measured without consumption).
 */
export function buildVelocityMap(stockRecords = [], issues = [], months = 3) {
  const siteQty = {}
  for (const row of issues || []) {
    if (!row?.site) continue
    const q = num(row.qty)
    siteQty[row.site] = (siteQty[row.site] || 0) + (q === null ? 1 : q)
  }
  const out = {}
  for (const r of stockRecords || []) {
    const total = siteQty[r.site] ?? 0
    const avgPerMonth = +(total / months).toFixed(2)
    const qty = num(r.stock_qty)
    const daysRemaining = avgPerMonth > 0 && qty !== null ? Math.round((qty / avgPerMonth) * 30) : null
    out[r.id] = { avgPerMonth, daysRemaining }
  }
  return out
}

/** Reorder suggestion when cover is under 30 days, else null. */
export function reorderSuggestion(r, vel) {
  const days = vel?.daysRemaining ?? null
  if (days === null || days >= 30) return null
  const configured = num(r.reorder_qty)
  if (configured && configured > 0) return configured
  return Math.max(0, (num(r.min_level) || 0) * 2 - (num(r.stock_qty) || 0))
}

/** Cover band for colour + text, never colour alone. */
export function coverBand(days) {
  if (days === null || days === undefined) return 'unknown'
  if (days > 30) return 'healthy'
  if (days >= 10) return 'watch'
  return 'urgent'
}

/** Stock rows enriched with status, velocity and reorder suggestion. */
export function enrichStock(records = [], velocityMap = {}) {
  return (records || []).map(r => {
    const vel = velocityMap[r.id] || null
    return {
      ...r,
      status: deriveStatus(r),
      avgPerMonth: vel ? vel.avgPerMonth : null,
      daysRemaining: vel ? vel.daysRemaining : null,
      suggestion: reorderSuggestion(r, vel),
    }
  })
}

export function filterStock(rows = [], { search = '', site = 'all', status = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter(r => {
    if (site !== 'all' && r.site !== site) return false
    if (status !== 'all' && r.status !== status) return false
    if (q) {
      const hay = [r.site, r.description, r.management_action, r.brand, r.tyre_size, r.custom_data?.stock_item?.code].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** KPI strip over an enriched set. */
export function summarizeStock(rows = []) {
  const counts = { OK: 0, Low: 0, Critical: 0 }
  let units = 0; let unitsKnown = 0; let stockouts = 0; let atRisk = 0; let toReorder = 0
  const covers = []
  for (const r of rows) {
    counts[r.status] = (counts[r.status] || 0) + 1
    const q = num(r.stock_qty)
    if (q !== null) { units += q; unitsKnown++ ; if (q <= 0) stockouts++ }
    if (r.daysRemaining !== null && r.daysRemaining !== undefined) {
      covers.push(r.daysRemaining)
      if (r.daysRemaining < 30) atRisk++
    }
    if (r.suggestion !== null && r.suggestion !== undefined && r.suggestion > 0) toReorder += r.suggestion
  }
  return {
    items: rows.length,
    units: unitsKnown ? units : null,
    counts,
    stockouts,
    atRisk,
    toReorder,
    sites: new Set(rows.map(r => r.site).filter(Boolean)).size,
    avgCoverDays: covers.length ? Math.round(covers.reduce((a, b) => a + b, 0) / covers.length) : null,
    measuredCover: covers.length,
  }
}

/** Issue rows grouped by LOCAL date: negative qty counts as stock in. */
export function timelineByDate(records = []) {
  const map = {}
  for (const r of records || []) {
    const d = r?.issue_date ? String(r.issue_date).slice(0, 10) : null
    if (!d) continue
    if (!map[d]) map[d] = { in: 0, out: 0 }
    const qty = num(r.qty) ?? 1
    if (qty < 0) map[d].in += -qty
    else map[d].out += qty
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, in: v.in, out: v.out, net: v.in - v.out }))
}

/** Today vs yesterday issues and window totals. changePct null when yesterday was 0. */
export function timelineSummary(days = [], now = new Date()) {
  const today = todayStr(now)
  const yesterday = offsetDate(-1, now)
  const todayIssues = days.find(d => d.date === today)?.out ?? 0
  const yesterdayIssues = days.find(d => d.date === yesterday)?.out ?? 0
  const totalIn = days.reduce((s, d) => s + d.in, 0)
  const totalOut = days.reduce((s, d) => s + d.out, 0)
  const busiest = days.reduce((best, d) => (!best || d.out > best.out ? d : best), null)
  return {
    todayIssues,
    yesterdayIssues,
    changePct: yesterdayIssues > 0 ? ((todayIssues - yesterdayIssues) / yesterdayIssues) * 100 : null,
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    activeDays: days.length,
    busiest: busiest && busiest.out > 0 ? busiest : null,
  }
}

/** Current counted tyre stock. Only piece-based tyre lines can be summed safely. */
export function summarizeTyreStock(rows = []) {
  let pcs = 0
  let tyreLines = 0
  let nonPcsLines = 0
  const bySize = new Map()
  for (const row of rows || []) {
    const meta = row?.custom_data?.stock_item || {}
    const kind = String(meta.kind || '').toLowerCase()
    const description = String(row?.description || '')
    const inferredTyre = Boolean(row?.tyre_size) || /\b(tyre|tire)\b|\d{3}\s*\/\s*\d{2}\s*r?\s*\d{2}|\d{2}\.\d{1,2}\s*[-r]\s*\d{2}/i.test(description)
    if (kind ? kind !== 'tyre' : !inferredTyre) continue
    tyreLines++
    const unit = String(meta.unit || '').trim().toUpperCase()
    const descriptionSize = description.match(/\d{3}\s*\/\s*\d{2}\s*r?\s*\d{2}(?:\.\d)?|\d{2}\.\d{1,2}\s*[-r]\s*\d{2}(?:\.\d)?|\d{4}\s*r\s*\d{2}(?:\.\d)?|\d{2}\s*r\s*\d{2}(?:\.\d)?/i)?.[0]
    const size = String(meta.size || row?.tyre_size || descriptionSize || '').trim()
    const knownTyreSize = Boolean(size) || /\d{3}\s*\/\s*\d{2}\s*r?\s*\d{2}|\d{2}\.\d{1,2}\s*[-r]\s*\d{2}/i.test(description)
    const pieceUnit = ['PCS', 'PC', 'EA', 'EACH', 'PIECE', 'PIECES', 'NO', 'NOS'].includes(unit)
    if (!pieceUnit && !(unit === '' && knownTyreSize)) {
      nonPcsLines++
      continue
    }
    const qty = num(row?.stock_qty)
    if (qty === null) { nonPcsLines++; continue }
    pcs += qty
    const label = size || 'Size not recorded'
    bySize.set(label, (bySize.get(label) || 0) + qty)
  }
  return {
    pcs,
    tyreLines,
    nonPcsLines,
    bySize: [...bySize].map(([size, quantity]) => ({ size, quantity })).sort((a, b) => b.quantity - a.quantity || a.size.localeCompare(b.size)),
  }
}

/** Current piece-based tyre balances grouped into a site-by-size matrix. */
export function summarizeTyreStockBySite(rows = []) {
  const bySite = new Map()
  for (const row of rows || []) {
    const site = String(row?.site || '').trim() || 'Site not recorded'
    const country = String(row?.country || '').trim()
    const key = `${country}\u0001${site}`
    if (!bySite.has(key)) bySite.set(key, { site, country, rows: [] })
    bySite.get(key).rows.push(row)
  }
  const sites = [...bySite.values()].map(({ site, country, rows: siteRows }) => {
    const summary = summarizeTyreStock(siteRows)
    return { site, country, key: JSON.stringify([country, site]), total: summary.pcs, bySize: summary.bySize }
  }).filter(site => site.bySize.length > 0)
    .sort((a, b) => b.total - a.total || a.site.localeCompare(b.site) || a.country.localeCompare(b.country))
  const totals = summarizeTyreStock(rows)
  return { sites, sizes: totals.bySize.map(item => item.size), pcs: totals.pcs }
}

/** Tyre stock lines at or below their configured reorder threshold. */
export function lowTyreStockRows(rows = []) {
  return (rows || []).filter(row => {
    const meta = row?.custom_data?.stock_item || {}
    const kind = String(meta.kind || '').toLowerCase()
    const description = String(row?.description || '')
    const tyreSize = String(meta.size || row?.tyre_size || '')
    const inferredTyre = Boolean(tyreSize) || /\b(tyre|tire)\b|\d{3}\s*\/\s*\d{2}\s*r?\s*\d{2}|\d{2}\.\d{1,2}\s*[-r]\s*\d{2}/i.test(description)
    if (kind ? kind !== 'tyre' : !inferredTyre) return false
    const qty = num(row?.stock_qty)
    const minimum = num(row?.min_level)
    return qty !== null && minimum !== null && qty <= minimum
  })
}

/** Six-month tyre change/issue summary; positive quantities are issued, returns are excluded. */
export function tyreChangeSummary(records = [], now = new Date(), monthCount = 6) {
  const months = []
  for (let offset = monthCount - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    months.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      quantity: 0,
    })
  }
  const monthIndex = new Map(months.map((month, index) => [month.key, index]))
  const sizes = new Map()
  for (const row of records || []) {
    const date = String(row?.issue_date || '').slice(0, 10)
    const index = monthIndex.get(date.slice(0, 7))
    if (index === undefined) continue
    const rawQty = num(row?.qty)
    const qty = rawQty === null ? 1 : rawQty
    if (qty <= 0) continue
    months[index].quantity += qty
    const size = String(row?.size || '').trim() || 'Size not recorded'
    sizes.set(size, (sizes.get(size) || 0) + qty)
  }
  return {
    total: months.reduce((sum, month) => sum + month.quantity, 0),
    months,
    bySize: [...sizes].map(([size, quantity]) => ({ size, quantity })).sort((a, b) => b.quantity - a.quantity || a.size.localeCompare(b.size)),
  }
}

export const STOCK_EXPORT_COLS = ['site', 'description', 'stock_qty', 'min_level', 'critical_level', 'reorder_qty', 'status', 'velocity', 'days_left', 'suggestion', 'action']
export const STOCK_EXPORT_HEADERS = ['Site', 'Description', 'Stock Qty', 'Min Level', 'Critical Level', 'Reorder Qty', 'Status', 'Velocity (per month)', 'Days Left', 'Suggested Reorder', 'Action']

export function stockExportRows(rows = []) {
  return rows.map(r => ({
    site: r.site || '',
    description: r.description || '',
    stock_qty: r.stock_qty ?? '',
    min_level: r.min_level ?? '',
    critical_level: r.critical_level ?? '',
    reorder_qty: r.reorder_qty ?? '',
    status: r.status,
    velocity: r.avgPerMonth === null ? 'N/A' : r.avgPerMonth,
    days_left: r.daysRemaining === null ? 'N/A' : r.daysRemaining,
    suggestion: r.suggestion === null ? '' : r.suggestion,
    action: r.management_action || '',
  }))
}
