/**
 * tyrePriceRules.js - the JS mirror of the V401 price rules.
 *
 * MIRRORS SQL `tyre_price_is_repair` and `tyre_price_is_warranty`. Change both
 * together, exactly like `classificationBrain.js` mirrors `brain_classify`. The
 * SQL is what actually decides; this exists so the UI can explain a decision and
 * so the rules are testable without a database.
 *
 * WHOLE WORD, ALWAYS. Substring matching is what once made "Shell RIMula" match
 * "rim" and file engine oil as a wheel rim. Plurals are listed, never implied.
 */

/** A repair is a service performed ON a tyre, never the price OF one. */
export const REPAIR_WORDS = [
  'repair', 'repairs', 'repairing',
  'puncture', 'punctures',
  'patch', 'patches', 'patching',
  'retread', 'retreads', 'remould', 'remold',
]

/** Prefixes that mean the same thing with a suffix attached (vulcanizing, ...). */
export const REPAIR_STEMS = ['vulcaniz', 'vulcanis']

/** A replacement that cost nothing. The answer is zero, not unknown. */
export const WARRANTY_WORDS = [
  'warranty', 'warrantee', 'guarantee',
  'free of charge', 'no charge', 'zero charge',
  'foc', 'f.o.c',
  'replacement claim', 'under claim',
]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word test, tolerant of the punctuation these descriptions carry. */
function hasWord(text, word) {
  if (!text) return false
  const re = new RegExp(`(^|[^a-z0-9])${escape(word)}([^a-z0-9]|$)`, 'i')
  return re.test(String(text))
}

function hasStem(text, stem) {
  if (!text) return false
  const re = new RegExp(`(^|[^a-z0-9])${escape(stem)}[a-z]*([^a-z0-9]|$)`, 'i')
  return re.test(String(text))
}

/**
 * Is this line a tyre REPAIR rather than a tyre purchase?
 *
 * Measured on the live data: Egypt carries 35 such lines worth EGP 155,504
 * ("Repair TIRE 315/80R22.5", "Repair TIRE 385/65/R22.5") sitting in the tyre
 * bucket. Using one of those as a tyre's purchase price would be wrong twice
 * over - it prices a tyre from a repair, and treats a repair as a purchase.
 */
export function isTyreRepair(description) {
  const t = String(description || '')
  if (!t) return false
  return REPAIR_WORDS.some((w) => hasWord(t, w)) || REPAIR_STEMS.some((s) => hasStem(t, s))
}

/**
 * Was this replaced under warranty?
 *
 * HONEST NOTE: no warranty wording exists anywhere in the live expense grid
 * today - the probe returns zero rows in all three countries. The rule is here
 * for when that data arrives, and every surface reports the count so it never
 * looks like it did something it did not.
 */
export function isTyreWarranty(description) {
  const t = String(description || '')
  if (!t) return false
  return WARRANTY_WORDS.some((w) => hasWord(t, w))
}

/**
 * The price of ONE tyre from a line covering several.
 *
 * This is the whole V327 bug in one function: that version used the line total
 * as the per-tyre price. 29% of tyre lines cover more than one tyre - up to 20 -
 * so it overstated the price 2.5x in KSA, 3.1x in UAE and 5.1x in Egypt.
 *
 * Returns null rather than a number when the quantity is missing or zero: a
 * price with no idea how many tyres it covers is not a per-tyre price.
 */
export function unitPrice(lineValue, qty) {
  const v = Number(lineValue)
  const q = Number(qty)
  if (!Number.isFinite(v) || !Number.isFinite(q) || q <= 0) return null
  if (v <= 0) return null
  return Math.round((v / q) * 100) / 100
}

/**
 * The order the sources are tried, strongest first. Warranty outranks a measured
 * price on purpose: if a tyre was replaced free, what an equivalent tyre costs
 * is not what this one cost.
 */
export const SOURCE_ORDER = ['warranty', 'own_jobcard', 'comparable']

/** Rank a source, for sorting a mixed list by how much to trust it. */
export const sourceRank = (s) => {
  const i = SOURCE_ORDER.indexOf(s)
  return i === -1 ? SOURCE_ORDER.length : i
}

/**
 * How much confidence a comparable price deserves, given how many tyres it rests
 * on. A median of one is a copy of a single row, not an average.
 */
export function comparableStrength(samples) {
  const n = Number(samples)
  if (!Number.isFinite(n) || n <= 0) return { key: 'none', label: 'No comparison' }
  if (n === 1) return { key: 'single', label: 'Based on one earlier tyre' }
  if (n < 5) return { key: 'thin', label: `Based on ${n} earlier tyres` }
  return { key: 'solid', label: `Based on ${n} earlier tyres` }
}
