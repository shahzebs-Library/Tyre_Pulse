/**
 * procurementAnalytics.js - pure engine behind /procurement (purchase orders).
 *
 * Line-item maths, the two filter scopes (every filter vs every filter except
 * status), the KPI strip, the whole-register budget position, the vendor and
 * status charts and the cumulative spend-vs-budget series.
 *
 * Rules: no I/O; `now` injectable wherever the calendar matters; an average
 * with nothing to measure is null (the page renders N/A), never 0.
 */

export const PO_STATUSES = ['Draft', 'Submitted', 'Approved', 'Ordered', 'Partial Delivery', 'Delivered', 'Cancelled', 'Closed']
export const PO_PRIORITIES = ['Urgent', 'High', 'Normal', 'Low']
export const SPEND_STATUSES = ['Delivered', 'Closed']
export const IN_TRANSIT_STATUSES = ['Ordered', 'Partial Delivery']
export const PIPELINE_STATUSES = ['Submitted', 'Approved', 'Ordered', 'Partial Delivery']

const money = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
const isoDay = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const isoMonth = (d) => isoDay(d).slice(0, 7)

export function calcItemTotal(item = {}) {
  return (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)
}

export function calcSubtotal(items = []) {
  return (items || []).reduce((s, it) => s + calcItemTotal(it), 0)
}

/** Whole days from a to b, null when either is missing or unparseable. */
export function daysBetween(a, b) {
  if (!a || !b) return null
  const ms = new Date(b) - new Date(a)
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null
}

/** Units received vs ordered across a PO's lines; null when nothing ordered. */
export function receiptProgress(items = []) {
  const ordered = (items || []).reduce((s, it) => s + (parseFloat(it.quantity) || 0), 0)
  const received = (items || []).reduce((s, it) => s + (parseFloat(it.received_qty) || 0), 0)
  return { ordered, received, pct: ordered > 0 ? Math.min(100, (received / ordered) * 100) : null }
}

/** Every filter EXCEPT status (the status chart holds out its own dimension). */
export function filterOrdersBase(orders = [], { search = '', vendor = 'All', site = 'All', from = '', to = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return orders.filter(o => {
    if (q && ![o.po_number, o.vendor_name, o.site, o.budget_code, o.requested_by]
      .some(v => String(v || '').toLowerCase().includes(q))) return false
    if (vendor !== 'All' && o.vendor_name !== vendor) return false
    if (site !== 'All' && o.site !== site) return false
    if (from && !(o.order_date && o.order_date >= from)) return false
    if (to && !(o.order_date && o.order_date <= to)) return false
    return true
  })
}

/** Status filter, newest order first. */
export function filterOrdersByStatus(orders = [], status = 'All') {
  return (status === 'All' ? [...orders] : orders.filter(o => o.status === status))
    .sort((a, b) => String(b.order_date || '').localeCompare(String(a.order_date || '')))
}

/** KPI strip over the filtered register. */
export function procurementKpis(orders = [], { now = new Date() } = {}) {
  const yearStart = `${new Date(now).getFullYear()}-01-01`
  const leadTimes = orders
    .filter(o => o.actual_delivery && o.order_date)
    .map(o => daysBetween(o.order_date, o.actual_delivery))
    .filter(v => v !== null && v >= 0)
  return {
    totalPOs: orders.filter(o => o.order_date && o.order_date >= yearStart).length,
    spend: orders.filter(o => SPEND_STATUSES.includes(o.status)).reduce((s, o) => s + money(o.total_amount), 0),
    pendingDelivery: orders.filter(o => IN_TRANSIT_STATUSES.includes(o.status)).length,
    pendingValue: orders.filter(o => PIPELINE_STATUSES.includes(o.status)).reduce((s, o) => s + money(o.total_amount), 0),
    avgLeadTime: leadTimes.length ? Math.round(leadTimes.reduce((s, v) => s + v, 0) / leadTimes.length) : null,
    leadTimeSample: leadTimes.length,
  }
}

/** Whole-register spend against the single annual budget. */
export function budgetPosition(orders = [], budget = 0) {
  const spend = orders.filter(o => SPEND_STATUSES.includes(o.status)).reduce((s, o) => s + money(o.total_amount), 0)
  const b = money(budget)
  return { spend, remaining: b > 0 ? b - spend : null, variance: b > 0 ? (spend / b) * 100 : null }
}

/** Delivered spend per month for the top N vendors over the last `months` months. */
export function vendorMonthlySpend(orders = [], { now = new Date(), months = 6, top = 5 } = {}) {
  const ref = new Date(now)
  const keys = Array.from({ length: months }, (_, i) => isoMonth(new Date(ref.getFullYear(), ref.getMonth() - (months - 1) + i, 1)))
  const spendRows = orders.filter(o => SPEND_STATUSES.includes(o.status))
  const totals = {}
  spendRows.forEach(o => { const v = o.vendor_name || 'Unknown'; totals[v] = (totals[v] || 0) + money(o.total_amount) })
  const vendors = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, top).map(([k]) => k)
  return {
    months: keys,
    series: vendors.map(vendor => ({
      vendor,
      data: keys.map(m => spendRows
        .filter(o => (o.vendor_name || 'Unknown') === vendor && String(o.order_date || '').startsWith(m))
        .reduce((s, o) => s + money(o.total_amount), 0)),
    })),
  }
}

export function statusCounts(orders = []) {
  const counts = {}
  orders.forEach(o => { const s = o.status || 'Draft'; counts[s] = (counts[s] || 0) + 1 })
  return counts
}

/** Cumulative delivered spend and straight-line budget for the calendar year of `now`. */
export function cumulativeSpend(orders = [], budget = 0, { now = new Date() } = {}) {
  const year = new Date(now).getFullYear()
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  let cum = 0
  const spend = months.map(m => {
    cum += orders
      .filter(o => SPEND_STATUSES.includes(o.status) && String(o.order_date || '').startsWith(m))
      .reduce((s, o) => s + money(o.total_amount), 0)
    return cum
  })
  const b = money(budget)
  const budgetLine = b > 0 ? months.map((_, i) => (b / 12) * (i + 1)) : null
  return { months, spend, budget: budgetLine }
}

export function optionsOf(orders = [], key) {
  return ['All', ...[...new Set(orders.map(o => o[key]).filter(Boolean))].sort()]
}

/** Excel rows for the filtered register. */
export function orderExportRows(orders = []) {
  return orders.map(o => ({
    'PO Number': o.po_number || '',
    Vendor: o.vendor_name || '',
    'Order Date': o.order_date || '',
    'Expected Delivery': o.expected_delivery || '',
    'Actual Delivery': o.actual_delivery || '',
    Status: o.status || '',
    Priority: o.priority || '',
    Items: (o.items || []).length,
    Subtotal: money(o.subtotal),
    Tax: money(o.tax_amount),
    Total: money(o.total_amount),
    Site: o.site || '',
    Country: o.country || '',
    'Budget Code': o.budget_code || '',
    'Requested By': o.requested_by || '',
    'Approved By': o.approved_by || '',
  }))
}
