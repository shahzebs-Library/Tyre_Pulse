/**
 * Supplier Marketplace — pure, dependency-free domain logic for the Supplier
 * Marketplace module (/supplier-marketplace). Reduces supplier listings and
 * buyer RFQs into the KPI roll-ups, category breakdowns, supplier rankings and
 * saving estimates the page renders.
 *
 * No Supabase, no React — every function here is deterministic and unit-tested.
 * The service (`src/lib/api/marketplace.js`) and page
 * (`src/pages/SupplierMarketplace.jsx`) both build on these primitives so the
 * intelligence lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Round to 2 decimals, keeping null when the input is not numeric. */
function round2(n) {
  if (n == null || !Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

/**
 * Notional order value of a listing: unit_price × MOQ. Returns null when either
 * side is missing/non-numeric so callers never treat "unknown" as zero.
 *
 * @param {object} l  a listing row
 * @returns {number|null}
 */
export function listingValue(l) {
  const price = toFiniteNumber(l?.unit_price)
  const moq = toFiniteNumber(l?.moq)
  if (price == null || moq == null) return null
  return round2(price * moq)
}

/**
 * Summarise a set of listings for the KPI header:
 *   • totalListings      — number of rows
 *   • activeCount        — rows with status === 'active'
 *   • inStockCount       — rows flagged in_stock truthy
 *   • distinctSuppliers  — count of distinct supplier names
 *   • avgRating          — mean rating across rows that carry a numeric rating
 *                          (null when none do)
 *   • distinctCategories — count of distinct category values
 *
 * @param {Array<object>} rows
 */
export function summariseListings(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const suppliers = new Set()
  const categories = new Set()
  let activeCount = 0
  let inStockCount = 0
  let ratingSum = 0
  let ratingN = 0

  for (const r of list) {
    const supplier = r?.supplier != null ? String(r.supplier).trim() : ''
    if (supplier) suppliers.add(supplier)
    const category = r?.category != null ? String(r.category).trim() : ''
    if (category) categories.add(category)
    if (String(r?.status || '').trim() === 'active') activeCount += 1
    if (r?.in_stock === true || r?.in_stock === 'true' || r?.in_stock === 1) inStockCount += 1
    const rating = toFiniteNumber(r?.rating)
    if (rating != null) { ratingSum += rating; ratingN += 1 }
  }

  return {
    totalListings: list.length,
    activeCount,
    inStockCount,
    distinctSuppliers: suppliers.size,
    avgRating: ratingN > 0 ? round2(ratingSum / ratingN) : null,
    distinctCategories: categories.size,
  }
}

/**
 * Group listings by category. Each entry: { category, listings, avgPrice },
 * where avgPrice is the mean unit_price across rows in that category that carry
 * a numeric price (null when none do). Sorted by listings count descending,
 * then alphabetically for a stable order.
 *
 * @param {Array<object>} rows
 * @returns {Array<{category:string, listings:number, avgPrice:number|null}>}
 */
export function byCategory(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const category = r?.category != null && String(r.category).trim() !== ''
      ? String(r.category).trim()
      : 'uncategorised'
    let bucket = map.get(category)
    if (!bucket) { bucket = { category, listings: 0, priceSum: 0, priceN: 0 }; map.set(category, bucket) }
    bucket.listings += 1
    const price = toFiniteNumber(r?.unit_price)
    if (price != null) { bucket.priceSum += price; bucket.priceN += 1 }
  }
  return [...map.values()]
    .map((b) => ({
      category: b.category,
      listings: b.listings,
      avgPrice: b.priceN > 0 ? round2(b.priceSum / b.priceN) : null,
    }))
    .sort((a, b) => b.listings - a.listings || a.category.localeCompare(b.category))
}

/**
 * Rank suppliers by average rating. Each entry: { supplier, avgRating, listings }.
 * Only listings carrying a numeric rating contribute to avgRating; suppliers
 * with no rated listings are excluded (no rank without evidence). Sorted by
 * avgRating descending, then by listings descending, then alphabetically.
 *
 * @param {Array<object>} rows
 * @returns {Array<{supplier:string, avgRating:number, listings:number}>}
 */
export function topRatedSuppliers(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const supplier = r?.supplier != null ? String(r.supplier).trim() : ''
    if (!supplier) continue
    let bucket = map.get(supplier)
    if (!bucket) { bucket = { supplier, listings: 0, ratingSum: 0, ratingN: 0 }; map.set(supplier, bucket) }
    bucket.listings += 1
    const rating = toFiniteNumber(r?.rating)
    if (rating != null) { bucket.ratingSum += rating; bucket.ratingN += 1 }
  }
  return [...map.values()]
    .filter((b) => b.ratingN > 0)
    .map((b) => ({
      supplier: b.supplier,
      avgRating: round2(b.ratingSum / b.ratingN),
      listings: b.listings,
    }))
    .sort((a, b) => b.avgRating - a.avgRating || b.listings - a.listings || a.supplier.localeCompare(b.supplier))
}

/**
 * Summarise a set of RFQs for the KPI header:
 *   • totalRfqs      — number of rows
 *   • openCount      — rows with status === 'open'
 *   • awardedCount   — rows with status === 'awarded'
 *   • totalResponses — sum of responses_count across all rows
 *   • avgResponses   — mean responses_count per RFQ (0 when there are no rows)
 *
 * @param {Array<object>} rows
 */
export function summariseRfqs(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let openCount = 0
  let awardedCount = 0
  let totalResponses = 0

  for (const r of list) {
    const status = String(r?.status || '').trim()
    if (status === 'open') openCount += 1
    if (status === 'awarded') awardedCount += 1
    const responses = toFiniteNumber(r?.responses_count)
    if (responses != null) totalResponses += responses
  }

  return {
    totalRfqs: list.length,
    openCount,
    awardedCount,
    totalResponses,
    avgResponses: list.length > 0 ? round2(totalResponses / list.length) : 0,
  }
}

/**
 * Potential saving on an RFQ: target_price − best_quote, but only when both are
 * present and the delta is positive (the best quote came in under target).
 * Returns 0 otherwise, so it can be summed safely across a set of RFQs.
 *
 * @param {object} rfq  an RFQ row
 * @returns {number}
 */
export function potentialSaving(rfq) {
  const target = toFiniteNumber(rfq?.target_price)
  const best = toFiniteNumber(rfq?.best_quote)
  if (target == null || best == null) return 0
  const saving = target - best
  return saving > 0 ? round2(saving) : 0
}
