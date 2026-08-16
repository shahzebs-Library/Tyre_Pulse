/**
 * boardScope - turning a REPORTING SCOPE (a set of countries) into the shapes a
 * consolidated board report can render honestly.
 *
 * The scope-to-query half already exists once, in `reportingScopeQuery.js`, and
 * is NOT restated here: which countries may be requested is decided there so the
 * two surfaces can never disagree about permissions. This module answers the
 * question that comes next, and only that one:
 *
 *     THE SCOPE SPANS SEVERAL COUNTRIES. WHAT MAY I PUT ON SCREEN?
 *
 * COUNTS AGGREGATE. MONEY DOES NOT. KSA reports in SAR, UAE in AED, Egypt in
 * EGP, and this app never adds them: a blended SAR+AED+EGP total has been a real
 * shipped defect here (it rendered "SAR 138,443,319", a number that is not an
 * amount of any currency). Every helper below that touches money therefore
 * reports PER COUNTRY, and the ones that cannot say the answer in one figure
 * return null so the caller renders "N/A" with a reason rather than a confident
 * blend. A vehicle count, an accident count or a compliance percentage carries
 * no currency, so aggregating those across the scope is honest and is left
 * alone.
 *
 * Currency comes from `governedCost.currencyForCountry`, which mirrors the
 * server's `country_currency` table. It is delegated rather than re-listed so a
 * new country cannot end up with two different currencies in two files.
 *
 * PURE: no I/O, no React, no Date.now().
 */
import { currencyForCountry, MIXED_CURRENCY } from './governedCost'

const txt = (v) => (v == null ? '' : String(v).trim())
const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The distinct currencies the scope reports in, in the order the countries were
 * given. A country with no known currency contributes nothing rather than a
 * guess, so an unrecognised country can never make a scope look single-currency
 * when it is not.
 */
export function scopeCurrencies(countries) {
  const out = []
  for (const c of Array.isArray(countries) ? countries : []) {
    const cur = currencyForCountry(c)
    if (cur && !out.includes(cur)) out.push(cur)
  }
  return out
}

/**
 * The ONE currency every figure in this scope is denominated in, or null when
 * there is not exactly one. Null is the signal to stop producing single money
 * totals - it never means "assume the house currency", which is precisely how
 * the blended-total defect happened.
 */
export function scopeCurrency(countries) {
  const list = scopeCurrencies(countries)
  return list.length === 1 ? list[0] : null
}

/** True when the scope spans more than one currency, so money must go per country. */
export function isMixedCurrencyScope(countries) {
  return scopeCurrencies(countries).length > 1
}

/**
 * The one-line reason a combined money figure is not shown, or '' when a single
 * total is legitimate. ASCII only, and it names the currencies so the reader can
 * check the claim rather than being asked to trust it.
 */
export function currencyScopeNote(countries) {
  const list = scopeCurrencies(countries)
  if (list.length > 1) {
    return `The countries in scope report in different currencies (${list.join(', ')}). `
      + 'Money is shown per country and is never added across currencies. '
      + 'Counts and rates carry no currency, so those are totalled across the scope.'
  }
  return ''
}

/**
 * Split rows into one bucket per country in scope, in scope order.
 *
 * Matching is case-insensitive, because a spelling difference between the
 * country register and a data row must not silently empty a country's panel.
 * Rows for a country not in scope are dropped, and rows with no country are
 * dropped too: these buckets exist to denominate MONEY, and a row that does not
 * say which country it belongs to cannot be given a currency.
 *
 * @returns {Array<{country:string, currency:string|null, rows:any[]}>}
 */
export function splitRowsByCountry(rows, countries, { field = 'country' } = {}) {
  const scope = (Array.isArray(countries) ? countries : []).map(txt).filter(Boolean)
  const index = new Map(scope.map((c, i) => [c.toLowerCase(), i]))
  const buckets = scope.map((c) => ({ country: c, currency: currencyForCountry(c), rows: [] }))
  for (const r of Array.isArray(rows) ? rows : []) {
    const i = index.get(txt(r?.[field]).toLowerCase())
    if (i != null) buckets[i].rows.push(r)
  }
  return buckets
}

/**
 * Per-country money entries ready to render side by side.
 * A country whose figure is missing keeps its entry with a null value, so the
 * reader sees that the country was in scope and reported nothing - which is a
 * different statement from the country having been left out.
 *
 * @param {Array<{country:string}>} entries
 * @param {(entry:any)=>any} pick  reads the amount off an entry
 * @returns {Array<{country:string, currency:string|null, value:number|null}>}
 */
export function perCountryMoney(entries, pick) {
  return (Array.isArray(entries) ? entries : []).map((e) => ({
    country: e?.country,
    currency: currencyForCountry(e?.country),
    value: num(typeof pick === 'function' ? pick(e) : e?.value),
  }))
}

/**
 * Merge per-country monthly series into ONE chart, with a dataset per country.
 *
 * This is the honest multi-currency chart: the series are drawn side by side and
 * labelled with their own currency, and they are never added into a single line.
 * The label carries the currency because the shared y-axis cannot - the caller
 * is expected to say so in a caption too.
 *
 * @param {Array<{country:string, byMonth:Array}>} entries
 * @param {(row:any)=>number} pick  the value to plot from a month row
 */
export function perCountryMonthlySeries(entries, pick) {
  const list = Array.isArray(entries) ? entries : []
  const months = []
  for (const e of list) {
    for (const m of e?.byMonth || []) {
      const key = txt(m?.month)
      if (key && !months.includes(key)) months.push(key)
    }
  }
  months.sort()
  return {
    labels: months,
    datasets: list.map((e) => {
      const by = new Map((e?.byMonth || []).map((m) => [txt(m?.month), m]))
      const cur = currencyForCountry(e?.country)
      return {
        label: cur ? `${e?.country} (${cur})` : String(e?.country || 'Unknown'),
        data: months.map((k) => (by.has(k) ? Number(pick(by.get(k))) || 0 : 0)),
      }
    }),
  }
}

/** Add up per-country monthly rows that share ONE currency, by month key. */
function mergeMonthly(entries) {
  const acc = new Map()
  for (const e of entries) {
    for (const m of e?.byMonth || []) {
      const key = txt(m?.month)
      if (!key) continue
      const cur = acc.get(key) || { month: key, tyre: 0, maintenance: 0 }
      cur.tyre += num(m?.tyre) ?? 0
      cur.maintenance += num(m?.maintenance) ?? 0
      acc.set(key, cur)
    }
  }
  return [...acc.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
}

/**
 * Combine one governed cost split per country into a single value the existing
 * cost surfaces already know how to render.
 *
 * The output is shape-compatible with `loadGovernedCostSplit`, so `CostValue`
 * and `splitTotals` keep working untouched:
 *   one country            the split is returned as it came, so a single-country
 *                          scope is byte-identical to the un-scoped page
 *   one currency, many     the countries are genuinely addable, so they are
 *                          added, and `blended` stays false
 *   several currencies     `blended` is true, the scalar totals are NULL rather
 *                          than a sum, and `byCountry` / `perCountry` carry the
 *                          real answer. A null total is what makes a caller that
 *                          forgot the rule render "N/A" instead of a blend.
 *
 * @param {Array<{country:string, split:object}>} splits
 */
export function mergeCostSplits(splits) {
  const list = (Array.isArray(splits) ? splits : []).filter((s) => s && s.split)
  if (!list.length) return null

  const perCountry = list.map(({ country, split }) => ({
    country,
    currency: currencyForCountry(country),
    tyre: num(split?.tyre) ?? 0,
    maintenance: num(split?.maintenance) ?? 0,
    combined: (num(split?.tyre) ?? 0) + (num(split?.maintenance) ?? 0),
    byMonth: Array.isArray(split?.byMonth) ? split.byMonth : [],
  }))

  if (list.length === 1) {
    // Exactly what the page loaded before a scope existed. Carrying the original
    // object through (rather than rebuilding it) means nothing downstream can
    // shift on a single-country scope.
    return { ...list[0].split, perCountry }
  }

  const currencies = [...new Set(perCountry.map((p) => p.currency).filter(Boolean))]
  const blended = currencies.length > 1

  return {
    blended,
    currency: blended ? MIXED_CURRENCY : (currencies[0] || null),
    // NULL, not 0: "we refuse to add these" and "these add up to nothing" are
    // opposite statements, and a 0 here would render as free.
    tyre: blended ? null : perCountry.reduce((s, p) => s + p.tyre, 0),
    maintenance: blended ? null : perCountry.reduce((s, p) => s + p.maintenance, 0),
    byMonth: blended ? [] : mergeMonthly(perCountry),
    byCountry: perCountry,
    perCountry,
    source: 'scope:merged',
  }
}

/**
 * Merge one `getFleetCpk` result per country into the single shape the page
 * renders. Safe to concatenate without any currency decision: every row this RPC
 * returns already carries its own country and currency, and the page renders one
 * tile per row, so nothing is ever added across them.
 */
export function mergeFleetCpk(results) {
  const list = (Array.isArray(results) ? results : []).filter(Boolean)
  const pull = (key) => list.flatMap((r) => (Array.isArray(r?.[key]) ? r[key] : []))
  return {
    perVehicle: pull('perVehicle'),
    byType: pull('byType'),
    fleet: pull('fleet'),
  }
}

/**
 * Assemble the per-country blocks of several multi-country aggregates into ONE
 * entry per country, ready to render as a deep report repeated down the page.
 *
 * This is what makes a multi-country scope show the FULL report rather than a
 * summary: each entry carries that country's own snapshot, comparison and
 * variance, so every existing single-country panel can be handed one entry
 * unchanged and stays correct - it is looking at one country in one currency,
 * exactly as it always has.
 *
 * COUNTRY ORDER COMES FROM THE SCOPE, not from any payload, so the report reads
 * in the order the reader chose and cannot be re-ordered by whichever aggregate
 * happened to answer first.
 *
 * A country that is in scope but missing from a given payload keeps its entry
 * with that part null. "This country reported nothing for this panel" and "this
 * country was left out of the report" are different statements, and only the
 * first one is true here.
 *
 * There is deliberately NO combining step: no scope total, no merged ranking, no
 * averaged rate. Entries sit side by side and are never added.
 *
 * @param {string[]} countries the scope, in order
 * @param {Record<string, Array<{country:string, currency:string|null, result:any}>>} blocksByPart
 *   e.g. { snap: [...], overview: [...], variance: [...] }
 * @returns {Array<{country:string, currency:string|null, [part:string]:any}>}
 */
export function scopeReportEntries(countries, blocksByPart = {}) {
  const scope = (Array.isArray(countries) ? countries : []).map(txt).filter(Boolean)
  const parts = Object.keys(blocksByPart || {})
  const index = {}
  for (const part of parts) {
    const list = Array.isArray(blocksByPart[part]) ? blocksByPart[part] : []
    index[part] = new Map(list.map((b) => [txt(b?.country).toLowerCase(), b]))
  }
  return scope.map((country) => {
    const entry = { country, currency: currencyForCountry(country) }
    for (const part of parts) {
      const block = index[part].get(country.toLowerCase())
      // `result` is the single-country payload verbatim; a block that carries no
      // result at all resolves to null rather than to an empty object, so a
      // panel renders its own honest empty state instead of zeros.
      entry[part] = block ? (block.result ?? block) : null
    }
    return entry
  })
}

/**
 * The countries a scope asked for that the server declined to report on, folded
 * across several multi-country payloads and de-duplicated.
 *
 * Worth surfacing rather than swallowing: a reader who selected three countries
 * and is shown two must be told which one is missing and why, or they will read
 * the report as covering everything they picked.
 */
export function scopeRefusedCountries(...payloads) {
  const out = []
  for (const p of payloads) {
    for (const c of (p && Array.isArray(p.refused) ? p.refused : [])) {
      const name = txt(c)
      if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name)
    }
  }
  return out
}

/**
 * Render per-country money on one line, for places that can only take a string
 * (a PDF cell, an export column). Returns 'N/A' when nothing is measurable, so
 * an empty scope never prints as a blank that reads like a zero.
 *
 * @param {Array<{country:string, currency:string|null, value:number|null}>} entries
 * @param {(value:number, currency:string|null)=>string} fmt
 */
export function formatPerCountryMoney(entries, fmt) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.value != null)
  if (!list.length) return 'N/A'
  return list.map((e) => `${e.country}: ${fmt(e.value, e.currency)}`).join('  |  ')
}
