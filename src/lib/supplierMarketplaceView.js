/**
 * Supplier Marketplace page view model (pure, no I/O, injectable `now`).
 *
 * Shapes `marketplace_listings` + `marketplace_rfqs` rows for the redesigned
 * Supplier Marketplace screen: headline tiles, the listing filter bar, the
 * selected-listing detail panel, the side-by-side comparison, the sourcing
 * funnel and the recent RFQ feed. The base roll-ups stay in
 * `supplierMarketplaceAnalytics.js` / `marketplace.js`; this module only adds
 * what the new layout needs.
 *
 * Honesty rules:
 *   - money is grouped per currency and never summed across currencies;
 *   - a value with no source column reads "Not recorded", never a guess;
 *   - an average over zero measured rows is null, never 0.
 */
import { currencyOf, titleCase } from './supplierMarketplaceAnalytics'
import { toFiniteNumber } from './marketplace'

const DAY = 86400000
const text = (v) => (v == null ? '' : String(v).trim())
const statusOf = (r) => text(r?.status).toLowerCase()
const toTime = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

export const NOT_RECORDED = 'Not recorded'

/** Period options for the RFQ / listing window (created_at based). */
export const PERIODS = Object.freeze([
  { key: 'all', label: 'All time', days: null },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last 12 months', days: 365 },
])

/** Keep rows created inside the period. A row with no created_at only survives "All time". */
export function inPeriod(rows = [], period = 'all', now = new Date()) {
  const p = PERIODS.find((x) => x.key === period)
  const list = Array.isArray(rows) ? rows : []
  if (!p || p.days == null) return list
  const end = new Date(now).getTime()
  const start = end - p.days * DAY
  return list.filter((r) => {
    const t = toTime(r?.created_at)
    return t != null && t >= start && t <= end
  })
}

/** Lead time buckets for the "Delivery time" filter. */
export const LEAD_BUCKETS = Object.freeze([
  { key: '', label: 'Any' },
  { key: 'le7', label: '7 days or less' },
  { key: 'le14', label: '14 days or less' },
  { key: 'gt14', label: 'More than 14 days' },
])
export const RATING_FLOORS = Object.freeze([
  { key: '', label: 'Any rating' },
  { key: '4', label: '4+ stars' },
  { key: '3', label: '3+ stars' },
])

/** Brand and country choices that actually occur in the loaded listings. */
export function listingOptions(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const uniq = (fn) => [...new Set(list.map(fn).map(text).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  return { brands: uniq((r) => r?.brand), countries: uniq((r) => r?.country) }
}

/** Extra listing filters the new filter bar adds on top of filterListings(). */
export function applyListingExtras(rows = [], f = {}) {
  const brand = text(f.brand).toLowerCase()
  const country = text(f.country)
  const floor = toFiniteNumber(f.minRating)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (brand && text(r?.brand).toLowerCase() !== brand) return false
    if (country && text(r?.country) !== country) return false
    if (floor != null) {
      const rating = toFiniteNumber(r?.rating)
      if (rating == null || rating < floor) return false
    }
    if (f.lead) {
      const lead = toFiniteNumber(r?.lead_time_days)
      if (lead == null) return false
      if (f.lead === 'le7' && lead > 7) return false
      if (f.lead === 'le14' && lead > 14) return false
      if (f.lead === 'gt14' && lead <= 14) return false
    }
    return true
  })
}

/** Stock label + tone for one listing. */
export function stockState(r) {
  if (!r) return { label: NOT_RECORDED, tone: 'muted' }
  if (statusOf(r) === 'archived') return { label: 'Archived', tone: 'muted' }
  if (r.in_stock === false || statusOf(r) === 'out_of_stock') return { label: 'Out of stock', tone: 'bad' }
  if (r.in_stock === true) return { label: 'In stock', tone: 'good' }
  return { label: NOT_RECORDED, tone: 'muted' }
}

/** Sum of a value per currency. Rows without the value are counted as unpriced. */
function perCurrency(rows, valueOf) {
  const map = new Map()
  let unpriced = 0
  for (const r of rows) {
    const v = valueOf(r)
    if (v == null) { unpriced += 1; continue }
    const c = currencyOf(r)
    map.set(c, (map.get(c) || 0) + v)
  }
  return {
    values: [...map.entries()].map(([currency, value]) => ({ currency, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    unpriced,
  }
}

/** Awarded value of an RFQ: best quote x quantity, or null when either is missing. */
export function awardedValue(rfq) {
  const q = toFiniteNumber(rfq?.quantity)
  const p = toFiniteNumber(rfq?.best_quote)
  if (q == null || p == null) return null
  return Math.round(q * p * 100) / 100
}

/**
 * Headline tiles. Every value is null when not measurable.
 *   activeListings  - listings with status active
 *   openRfqs        - RFQs still open or quoting
 *   responses       - sum of responses_count over RFQs that recorded one
 *   avgLeadDays     - mean lead time over listings that recorded one
 *   awarded         - awarded value per currency (best quote x quantity)
 */
export function headlineTiles(listings = [], rfqs = []) {
  const L = Array.isArray(listings) ? listings : []
  const R = Array.isArray(rfqs) ? rfqs : []
  let respSum = 0; let respN = 0
  for (const r of R) {
    const n = toFiniteNumber(r?.responses_count)
    if (n != null) { respSum += n; respN += 1 }
  }
  let leadSum = 0; let leadN = 0
  for (const l of L) {
    const n = toFiniteNumber(l?.lead_time_days)
    if (n != null) { leadSum += n; leadN += 1 }
  }
  const awardedRows = R.filter((r) => statusOf(r) === 'awarded')
  const awarded = perCurrency(awardedRows, awardedValue)
  return {
    totalListings: L.length,
    activeListings: L.filter((l) => statusOf(l) === 'active').length,
    openRfqs: R.filter((r) => ['open', 'quoting'].includes(statusOf(r))).length,
    responses: respN ? respSum : null,
    rfqsWithResponses: respN,
    avgLeadDays: leadN ? Math.round((leadSum / leadN) * 10) / 10 : null,
    awarded: awarded.values,
    awardedCount: awardedRows.length,
    awardedUnpriced: awarded.unpriced,
  }
}

/** Format a per-currency list for a tile, e.g. "SAR 12,400" or two lines. */
export function moneyLines(values = []) {
  return (Array.isArray(values) ? values : []).map((v) => `${v.currency === 'Currency not recorded' ? '' : `${v.currency} `}${Number(v.value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
}

/**
 * Sourcing funnel built only from stages the RFQ register records:
 * created -> responses received -> quote recorded -> awarded.
 * Supplier invitations and shortlists have no column, so they are not drawn.
 */
export function sourcingFunnel(rfqs = []) {
  const R = Array.isArray(rfqs) ? rfqs : []
  const created = R.length
  const responded = R.filter((r) => (toFiniteNumber(r?.responses_count) || 0) > 0).length
  const quoted = R.filter((r) => toFiniteNumber(r?.best_quote) != null).length
  const awarded = R.filter((r) => statusOf(r) === 'awarded').length
  const pct = (n) => (created ? Math.round((n / created) * 100) : null)
  return [
    { key: 'created', label: 'RFQs created', count: created, pct: pct(created), tone: 'green' },
    { key: 'responded', label: 'Responses received', count: responded, pct: pct(responded), tone: 'amber' },
    { key: 'quoted', label: 'Best quote recorded', count: quoted, pct: pct(quoted), tone: 'orange' },
    { key: 'awarded', label: 'Supplier awarded', count: awarded, pct: pct(awarded), tone: 'red' },
  ]
}

/** "Today", "1 day ago", "5 days ago", "2 weeks ago", or a date. */
export function ageLabel(value, now = new Date()) {
  const t = toTime(value)
  if (t == null) return NOT_RECORDED
  const days = Math.floor((new Date(now).getTime() - t) / DAY)
  if (days < 0) return new Date(t).toISOString().slice(0, 10)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return new Date(t).toISOString().slice(0, 10)
}

export const RFQ_TONE = Object.freeze({ open: 'info', quoting: 'warn', awarded: 'good', closed: 'muted', cancelled: 'bad' })

/** Newest RFQs first, with display fields. */
export function recentRfqs(rfqs = [], { limit = 5, now = new Date() } = {}) {
  return [...(Array.isArray(rfqs) ? rfqs : [])]
    .sort((a, b) => (toTime(b?.created_at) ?? -Infinity) - (toTime(a?.created_at) ?? -Infinity))
    .slice(0, limit)
    .map((r) => {
      const qty = toFiniteNumber(r?.quantity)
      const resp = toFiniteNumber(r?.responses_count)
      return {
        id: r.id,
        rfqNo: text(r?.rfq_no) || 'No RFQ number',
        title: [text(r?.product_name) || NOT_RECORDED, qty != null ? `(${qty} units)` : ''].filter(Boolean).join(' '),
        responses: resp == null ? 'Responses not recorded' : `${resp} response${resp === 1 ? '' : 's'}`,
        status: statusOf(r) || 'open',
        statusLabel: titleCase(statusOf(r) || 'open'),
        tone: RFQ_TONE[statusOf(r)] || 'muted',
        age: ageLabel(r?.created_at, now),
        raw: r,
      }
    })
}

/**
 * Side-by-side comparison of chosen listings. "Total" is unit price x MOQ (the
 * smallest order the supplier accepts). The cheapest / fastest flags are
 * decided inside one currency only, so two prices in different currencies are
 * never ranked against each other.
 */
export function compareListings(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => {
    const price = toFiniteNumber(r?.unit_price)
    const moq = toFiniteNumber(r?.moq)
    return {
      id: r.id,
      supplier: text(r?.supplier) || NOT_RECORDED,
      product: [text(r?.product_name), text(r?.size_spec)].filter(Boolean).join(', ') || NOT_RECORDED,
      currency: currencyOf(r),
      price,
      lead: toFiniteNumber(r?.lead_time_days),
      moq,
      total: price != null && moq != null ? Math.round(price * moq * 100) / 100 : null,
      rating: toFiniteNumber(r?.rating),
    }
  })
  const best = (key, cur) => {
    const vals = list.filter((x) => x.currency === cur && x[key] != null).map((x) => x[key])
    return vals.length ? Math.min(...vals) : null
  }
  const currencies = [...new Set(list.map((x) => x.currency))]
  return {
    rows: list.map((x) => ({
      ...x,
      cheapest: list.length > 1 && x.price != null && x.price === best('price', x.currency),
      fastest: list.length > 1 && x.lead != null && x.lead === best('lead', x.currency),
    })),
    mixedCurrency: currencies.length > 1,
  }
}

/** Field list for the selected-listing panel. Missing values read "Not recorded". */
export function listingDetailFields(r) {
  if (!r) return []
  const price = toFiniteNumber(r.unit_price)
  const v = (x) => (text(x) ? text(x) : NOT_RECORDED)
  const stock = stockState(r)
  return [
    { label: 'Item', value: [text(r.product_name), text(r.size_spec)].filter(Boolean).join(', ') || NOT_RECORDED },
    { label: 'Brand', value: v(r.brand) },
    { label: 'Price', value: price == null ? NOT_RECORDED : `${moneyLines([{ currency: currencyOf(r), value: price }])[0]} / unit` },
    { label: 'MOQ', value: toFiniteNumber(r.moq) == null ? NOT_RECORDED : `${toFiniteNumber(r.moq)} units` },
    { label: 'Lead time', value: toFiniteNumber(r.lead_time_days) == null ? NOT_RECORDED : `${toFiniteNumber(r.lead_time_days)} days` },
    { label: 'Stock availability', value: stock.label, tone: stock.tone },
    { label: 'Country', value: v(r.country) },
    { label: 'Category', value: titleCase(r.category) || NOT_RECORDED },
    { label: 'Listing number', value: v(r.listing_no) },
    { label: 'Certifications', value: NOT_RECORDED, note: 'No certification field on listings' },
    { label: 'Notes', value: v(r.notes) },
  ]
}

/** Supplier roll-up for the "Supplier info" tab. */
export function supplierProfile(listings = [], supplier) {
  const name = text(supplier).toLowerCase()
  const mine = (Array.isArray(listings) ? listings : []).filter((l) => text(l?.supplier).toLowerCase() === name)
  const ratings = mine.map((l) => toFiniteNumber(l?.rating)).filter((x) => x != null)
  return {
    listings: mine.length,
    inStock: mine.filter((l) => l?.in_stock === true).length,
    categories: [...new Set(mine.map((l) => titleCase(l?.category)).filter(Boolean))],
    avgRating: ratings.length ? Math.round((ratings.reduce((s, x) => s + x, 0) / ratings.length) * 10) / 10 : null,
  }
}

/**
 * "Pricing" tab: the same item (product name or size) offered by other
 * listings, cheapest first within each currency. This is a cross-supplier
 * price comparison, not a price history (the table keeps no price history).
 */
export function samePriceBook(listings = [], r) {
  if (!r) return []
  const key = (x) => (text(x?.size_spec) || text(x?.product_name)).toLowerCase()
  const k = key(r)
  if (!k) return []
  return (Array.isArray(listings) ? listings : [])
    .filter((x) => key(x) === k && toFiniteNumber(x?.unit_price) != null)
    .map((x) => ({ id: x.id, supplier: text(x.supplier) || NOT_RECORDED, currency: currencyOf(x), price: toFiniteNumber(x.unit_price), self: x.id === r.id }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.price - b.price)
}

