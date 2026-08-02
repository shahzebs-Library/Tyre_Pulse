/**
 * brandSizeCpk.js - pure engine for the "brand & price by tyre size" value
 * comparison. Zero I/O; the caller (BrandPerformance page) fetches the rows via
 * src/lib/api/brandSizeCpk.js (the get_brand_size_cpk RPC, V446) and feeds them
 * here.
 *
 * The question this answers, in management's own words: "I buy one brand tyre at
 * 766 (Techking) and the same size at 860; which is better?" A cheaper tyre that
 * wears out fast can cost MORE per km than a pricier long-life tyre. So for each
 * tyre SIZE we line up every brand's purchase price against the cost-per-km (CPK)
 * it actually delivers, rank by real CPK (best value first), and spell out the
 * gap in plain English.
 *
 * HONESTY RULES baked in:
 *  - A brand with no life data (cpk == null) can NEVER be "best value" - it is
 *    ranked last and its recommendation says the CPK is not yet measurable.
 *  - "Cheapest" is purely the lowest purchase price; "best value" is the lowest
 *    real CPK. They are deliberately separate, because they are different facts.
 *  - When only one brand has a measurable CPK in a size, there is nothing to
 *    compare - we say so rather than crowning a winner by default.
 */

/** Coerce to a finite number, else null (never 0, which would be a real value). */
function num(v) {
  const n = typeof v === 'number' ? v : v == null ? NaN : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Round to `dp` decimals, null-safe. */
function round(v, dp = 2) {
  const n = num(v)
  if (n == null) return null
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/**
 * Normalise one RPC row into a stable shape with numeric fields.
 * @param {object} r
 */
export function normalizeRow(r = {}) {
  const price = num(r.avg_price)
  const life = num(r.avg_life_km)
  // Prefer the server-computed cpk; recompute defensively if absent but derivable.
  let cpk = num(r.cpk)
  if (cpk == null && price != null && life != null && life > 0) {
    cpk = price / life
  }
  return {
    size: (r.size == null ? '' : String(r.size)).trim(),
    brand: (r.brand == null ? '' : String(r.brand)).trim(),
    country: r.country == null ? '' : String(r.country),
    currency: r.currency == null ? '' : String(r.currency),
    tyres: num(r.tyres) || 0,
    avgPrice: price,
    medianPrice: num(r.median_price),
    avgLifeKm: life,
    cpk,
  }
}

/**
 * Group rows by size and, within each size, rank brands by real CPK (best value
 * first, null-CPK brands last). Flags the best-value brand (lowest measurable
 * CPK) and the cheapest brand (lowest purchase price), and computes a percentage
 * gap of each brand's CPK vs the best.
 *
 * @param {Array<object>} rows raw RPC rows (any country mix is fine; size labels
 *   already carry no country, so pass a single country's rows for a clean view).
 * @param {{ minTyres?:number }} [opts] minTyres: drop brand rows thinner than
 *   this many tyres before comparing (default 1 = keep everything). Thin data is
 *   surfaced via `thin` rather than silently hidden when minTyres is 1.
 * @returns {Array<{ size, currency, brands:Array, bestValueBrand, cheapestBrand,
 *   measurableBrands, thin }>} one entry per size, sorted by best CPK ascending
 *   (the sizes where the best available value is strongest come first), with
 *   size ties broken alphabetically.
 */
export function groupBySize(rows, opts = {}) {
  const minTyres = num(opts.minTyres) || 1
  const norm = (Array.isArray(rows) ? rows : [])
    .map(normalizeRow)
    .filter((r) => r.size && r.brand)

  const bySize = new Map()
  for (const r of norm) {
    if (r.tyres < minTyres) continue
    const key = r.size
    if (!bySize.has(key)) bySize.set(key, [])
    bySize.get(key).push(r)
  }

  const out = []
  for (const [size, brandRows] of bySize) {
    // Rank: measurable CPK ascending first, then null-CPK brands (never "best").
    const ranked = [...brandRows].sort((a, b) => {
      if (a.cpk == null && b.cpk == null) return b.tyres - a.tyres
      if (a.cpk == null) return 1
      if (b.cpk == null) return -1
      return a.cpk - b.cpk
    })
    const measurable = ranked.filter((r) => r.cpk != null)
    const bestCpk = measurable.length ? measurable[0].cpk : null
    const bestValueBrand = measurable.length ? measurable[0].brand : null

    // Cheapest by purchase price (avg_price), among rows that carry a price.
    const priced = ranked.filter((r) => r.avgPrice != null)
    let cheapestBrand = null
    if (priced.length) {
      cheapestBrand = priced.reduce((lo, r) => (r.avgPrice < lo.avgPrice ? r : lo), priced[0]).brand
    }

    const currency = ranked.find((r) => r.currency)?.currency || ''
    const brands = ranked.map((r) => ({
      ...r,
      isBestValue: bestValueBrand != null && r.brand === bestValueBrand && r.cpk != null,
      isCheapest: cheapestBrand != null && r.brand === cheapestBrand,
      // How much worse per km than the best value, as a percentage (null when
      // this brand or the best has no CPK).
      cpkGapPct:
        r.cpk != null && bestCpk != null && bestCpk > 0
          ? round(((r.cpk - bestCpk) / bestCpk) * 100, 1)
          : null,
    }))

    out.push({
      size,
      currency,
      brands,
      bestValueBrand,
      cheapestBrand,
      measurableBrands: measurable.length,
      // A size where fewer than 2 brands have a measurable CPK cannot really be
      // compared on value - the UI should say so.
      thin: measurable.length < 2,
    })
  }

  out.sort((a, b) => {
    const ca = a.brands.find((x) => x.cpk != null)?.cpk
    const cb = b.brands.find((x) => x.cpk != null)?.cpk
    if (ca == null && cb == null) return a.size.localeCompare(b.size)
    if (ca == null) return 1
    if (cb == null) return -1
    if (ca !== cb) return ca - cb
    return a.size.localeCompare(b.size)
  })
  return out
}

/**
 * Plain-English recommendation for one size group that management can read.
 * Compares the best-value brand against the cheapest-to-buy brand and states
 * whether buying cheap actually costs more per km.
 *
 * @param {object} group one entry from groupBySize()
 * @returns {string} a single honest sentence (never contains a dash character)
 */
export function recommendationFor(group) {
  if (!group || !Array.isArray(group.brands) || group.brands.length === 0) {
    return 'No priced tyres recorded for this size yet.'
  }
  const cur = group.currency ? group.currency + ' ' : ''
  const best = group.brands.find((b) => b.isBestValue)
  if (!best) {
    return 'No life data yet for this size, so cost per km cannot be measured. Compare on purchase price only.'
  }
  const cheapest = group.brands.find((b) => b.isCheapest)
  const priceOf = (b) => (b.avgPrice != null ? cur + fmtNum(b.avgPrice) : 'price N/A')
  const lifeOf = (b) => (b.avgLifeKm != null ? fmtNum(b.avgLifeKm) + ' km' : 'life N/A')

  // Only one measurable brand: nothing to compare against.
  if (group.measurableBrands < 2) {
    return (
      'Best value: ' +
      best.brand +
      ' at ' +
      priceOf(best) +
      ' delivering ' +
      lifeOf(best) +
      ' (' +
      fmtCpk(best.cpk, cur) +
      ' per km). Only one brand has life data at this size, so there is nothing to compare it against yet.'
    )
  }

  // Cheapest to buy is also the best value: buy it with confidence.
  if (cheapest && cheapest.brand === best.brand) {
    const worst = [...group.brands].reverse().find((b) => b.cpk != null && b.brand !== best.brand)
    let extra = ''
    if (worst && worst.cpkGapPct != null) {
      extra =
        ' The dearest per km here, ' +
        worst.brand +
        ', costs ' +
        fmtNum(worst.cpkGapPct) +
        ' percent more per km despite ' +
        (worst.avgPrice != null && best.avgPrice != null && worst.avgPrice > best.avgPrice
          ? 'a higher purchase price too.'
          : 'a similar purchase price.')
    }
    return (
      best.brand +
      ' is both the cheapest to buy (' +
      priceOf(best) +
      ') and the best value at ' +
      fmtCpk(best.cpk, cur) +
      ' per km (' +
      lifeOf(best) +
      ' life).' +
      extra
    )
  }

  // Cheapest to buy is NOT the best value: show the trap.
  if (cheapest && cheapest.cpk != null) {
    const gap = cheapest.cpkGapPct
    return (
      'Cheapest to buy is ' +
      cheapest.brand +
      ' at ' +
      priceOf(cheapest) +
      ', but it lasts only ' +
      lifeOf(cheapest) +
      ' so it costs ' +
      fmtCpk(cheapest.cpk, cur) +
      ' per km' +
      (gap != null ? ' (' + fmtNum(gap) + ' percent more per km than the best value)' : '') +
      '. Better value is ' +
      best.brand +
      ' at ' +
      priceOf(best) +
      ' returning ' +
      lifeOf(best) +
      ' for ' +
      fmtCpk(best.cpk, cur) +
      ' per km.'
    )
  }

  // Cheapest brand has no CPK: fall back to naming the best value.
  return (
    'Best value at this size is ' +
    best.brand +
    ' at ' +
    priceOf(best) +
    ' (' +
    lifeOf(best) +
    ', ' +
    fmtCpk(best.cpk, cur) +
    ' per km). ' +
    (cheapest ? cheapest.brand + ' is cheaper to buy but has no life data to judge its cost per km.' : '')
  )
}

/** Format an integer-ish number with thousands separators. */
function fmtNum(v) {
  const n = num(v)
  if (n == null) return 'N/A'
  return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(round(n, 1))
}

/** Format a CPK value to 3 decimals with an optional currency prefix. */
function fmtCpk(v, cur = '') {
  const n = num(v)
  if (n == null) return 'N/A'
  return (cur || '') + n.toFixed(3)
}

export { fmtNum as formatNumber, fmtCpk as formatCpk }
