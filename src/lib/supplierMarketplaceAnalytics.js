/**
 * supplierMarketplaceAnalytics.js - pure analytics for /supplier-marketplace.
 *
 * The listing and RFQ roll-ups, supplier ranking and per-RFQ saving live in
 * `marketplace.js` and are REUSED. This module adds filtering and the
 * currency-safe views the page needs.
 *
 * CURRENCY RULE: listings and RFQs each carry their own currency (SAR, AED,
 * EGP, ...). Money is NEVER summed or averaged across currencies. Prices and
 * savings are grouped per currency; a row with no currency is reported under
 * "Currency not recorded" rather than being assumed to be SAR.
 *
 * HONESTY NOTES
 * - Averages and rates are null (never 0) when nothing is measurable.
 * - Time-dependent functions take an injectable `now`.
 */
import {
  summariseListings, summariseRfqs, topRatedSuppliers, potentialSaving, toFiniteNumber,
} from './marketplace'

export const LISTING_CATEGORIES = ['tyre', 'retread', 'parts', 'service', 'other']
export const LISTING_STATUSES = ['active', 'out_of_stock', 'archived']
export const RFQ_STATUSES = ['open', 'quoting', 'awarded', 'closed', 'cancelled']
export const NO_CURRENCY = 'Currency not recorded'

const DAY = 86400000
const round2 = (n) => Math.round(n * 100) / 100

function toMs(v) {
  if (v == null || v === '') return null
  const s = String(v)
  const t = new Date(s.length === 10 ? `${s}T00:00:00Z` : s).getTime()
  return Number.isFinite(t) ? t : null
}
function nowMs(now) { return (now instanceof Date ? now.getTime() : toMs(now)) ?? Date.now() }
function pct(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : null }
export const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '')
export const currencyOf = (r) => String(r?.currency || '').trim().toUpperCase() || NO_CURRENCY
const statusOf = (r) => String(r?.status || '').trim()

/** Filter listings by category / status / stock / currency / text. */
export function filterListings(rows = [], f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.category && r?.category !== f.category) return false
    if (f.status && statusOf(r) !== f.status) return false
    if (f.stock === 'in' && r?.in_stock === false) return false
    if (f.stock === 'out' && r?.in_stock !== false) return false
    if (f.currency && currencyOf(r) !== f.currency) return false
    if (q) {
      const hay = `${r?.supplier || ''} ${r?.product_name || ''} ${r?.brand || ''} ${r?.size_spec || ''} ${r?.listing_no || ''} ${r?.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** An RFQ is overdue when it is still open or quoting and its needed-by date has passed. */
export function isOverdueRfq(r, { now } = {}) {
  const s = statusOf(r)
  if (s !== 'open' && s !== 'quoting') return false
  const need = toMs(r?.needed_by)
  return need != null && need + DAY - 1 < nowMs(now)
}

/** Filter RFQs by category / status / currency / overdue / text. */
export function filterRfqs(rows = [], f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.category && r?.category !== f.category) return false
    if (f.status && statusOf(r) !== f.status) return false
    if (f.currency && currencyOf(r) !== f.currency) return false
    if (f.overdueOnly && !isOverdueRfq(r, { now: f.now })) return false
    if (q) {
      const hay = `${r?.product_name || ''} ${r?.rfq_no || ''} ${r?.category || ''} ${r?.awarded_supplier || ''} ${r?.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Listing KPIs; lead time and rating averages are null when unmeasured. */
export function listingKpis(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseListings(list)
  let leadSum = 0
  let leadN = 0
  let priced = 0
  const currencies = new Set()
  for (const r of list) {
    const lead = toFiniteNumber(r?.lead_time_days)
    if (lead != null) { leadSum += lead; leadN += 1 }
    if (toFiniteNumber(r?.unit_price) != null) { priced += 1; currencies.add(currencyOf(r)) }
  }
  return {
    ...base,
    avgLeadDays: leadN ? Math.round((leadSum / leadN) * 10) / 10 : null,
    inStockRate: pct(base.inStockCount, list.length),
    pricedListings: priced,
    currencies: [...currencies].sort(),
  }
}

/** RFQ KPIs; savings are returned PER CURRENCY, never as one blended figure. */
export function rfqKpis(rows = [], { now } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseRfqs(list)
  let overdue = 0
  let decided = 0
  let withResponses = 0
  for (const r of list) {
    if (isOverdueRfq(r, { now })) overdue += 1
    const s = statusOf(r)
    if (s === 'awarded' || s === 'closed' || s === 'cancelled') decided += 1
    if (toFiniteNumber(r?.responses_count) != null) withResponses += 1
  }
  return {
    ...base,
    avgResponses: withResponses ? base.avgResponses : null,
    overdueCount: overdue,
    awardRate: pct(base.awardedCount, decided),
    savingsByCurrency: savingsByCurrency(list),
  }
}

/** Sum of potential saving grouped by currency: [{ currency, saving, rfqs }]. */
export function savingsByCurrency(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = potentialSaving(r)
    if (!(s > 0)) continue
    const c = currencyOf(r)
    const b = map.get(c) || { currency: c, saving: 0, rfqs: 0 }
    b.saving = round2(b.saving + s)
    b.rfqs += 1
    map.set(c, b)
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency))
}

/**
 * Category x currency price view: one row per (category, currency) with the
 * listing count and the average unit price in THAT currency only.
 */
export function categoryPriceByCurrency(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const category = String(r?.category || '').trim() || 'uncategorised'
    const c = currencyOf(r)
    const key = `${category}|${c}`
    const b = map.get(key) || { category, currency: c, listings: 0, sum: 0, n: 0, min: null, max: null }
    b.listings += 1
    const p = toFiniteNumber(r?.unit_price)
    if (p != null) {
      b.sum += p; b.n += 1
      b.min = b.min == null ? p : Math.min(b.min, p)
      b.max = b.max == null ? p : Math.max(b.max, p)
    }
    map.set(key, b)
  }
  return [...map.values()]
    .map((b) => ({ category: b.category, currency: b.currency, listings: b.listings, avgPrice: b.n ? round2(b.sum / b.n) : null, minPrice: b.min, maxPrice: b.max }))
    .sort((a, b) => b.listings - a.listings || a.category.localeCompare(b.category) || a.currency.localeCompare(b.currency))
}

/** RFQ funnel counts in workflow order. */
export function rfqFunnel(rows = []) {
  const counts = Object.fromEntries(RFQ_STATUSES.map((s) => [s, 0]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = statusOf(r)
    if (s in counts) counts[s] += 1
  }
  return RFQ_STATUSES.map((s) => ({ key: s, label: titleCase(s), count: counts[s] }))
}

export { topRatedSuppliers, potentialSaving }

export const LISTING_EXPORT_COLUMNS = [
  ['supplier', 'Supplier'], ['listing_no', 'Listing number'], ['category', 'Category'], ['product_name', 'Product'],
  ['brand', 'Brand'], ['size_spec', 'Size or spec'], ['unit_price', 'Unit price'], ['currency', 'Currency'],
  ['moq', 'MOQ'], ['lead_time_days', 'Lead time (days)'], ['rating', 'Rating'], ['in_stock', 'In stock'], ['status', 'Status'],
]
export const RFQ_EXPORT_COLUMNS = [
  ['rfq_no', 'RFQ number'], ['product_name', 'Product'], ['category', 'Category'], ['quantity', 'Quantity'],
  ['target_price', 'Target price'], ['best_quote', 'Best quote'], ['currency', 'Currency'], ['potential_saving', 'Potential saving'],
  ['needed_by', 'Needed by'], ['overdue', 'Overdue'], ['responses_count', 'Responses'], ['awarded_supplier', 'Awarded supplier'], ['status', 'Status'],
]

export function listingExportRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    supplier: r?.supplier || '', listing_no: r?.listing_no || '', category: titleCase(r?.category),
    product_name: r?.product_name || '', brand: r?.brand || '', size_spec: r?.size_spec || '',
    unit_price: toFiniteNumber(r?.unit_price) ?? '', currency: r?.currency || '',
    moq: toFiniteNumber(r?.moq) ?? '', lead_time_days: toFiniteNumber(r?.lead_time_days) ?? '',
    rating: toFiniteNumber(r?.rating) ?? '', in_stock: r?.in_stock === false ? 'No' : 'Yes', status: titleCase(r?.status),
  }))
}

export function rfqExportRows(rows = [], { now } = {}) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const s = potentialSaving(r)
    return {
      rfq_no: r?.rfq_no || '', product_name: r?.product_name || '', category: r?.category || '',
      quantity: toFiniteNumber(r?.quantity) ?? '', target_price: toFiniteNumber(r?.target_price) ?? '',
      best_quote: toFiniteNumber(r?.best_quote) ?? '', currency: r?.currency || '',
      potential_saving: s > 0 ? s : '', needed_by: r?.needed_by || '',
      overdue: isOverdueRfq(r, { now }) ? 'Yes' : 'No',
      responses_count: toFiniteNumber(r?.responses_count) ?? '', awarded_supplier: r?.awarded_supplier || '',
      status: titleCase(r?.status),
    }
  })
}
