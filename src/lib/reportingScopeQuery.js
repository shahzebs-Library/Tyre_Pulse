/**
 * reportingScopeQuery - turning a REPORTING SCOPE into the two decisions an
 * analytics page actually has to get right:
 *
 *   1. WHICH COUNTRIES DO WE ASK THE SERVER FOR?
 *      A scope may never widen access. Permission filtering is delegated to
 *      `scopeCountries` (which reads the same allowed tree the working context
 *      uses), so this module cannot drift from it. A scope that resolves to
 *      nothing produces NO requests - it must never quietly fall back to "All",
 *      because that would report on countries the reader did not ask for.
 *
 *   2. MAY THESE COUNTRIES SHARE ONE MONEY FIGURE?
 *      KSA reports in SAR, UAE in AED, Egypt in EGP, and this app never adds
 *      them together. A blended SAR+AED+EGP total has been a real shipped defect
 *      here (it read about 138M and meant nothing). `scopeMoneyTotal` therefore
 *      returns a NULL total plus `mixedCurrency` whenever more than one currency
 *      is in scope, and the caller renders "N/A" with the reason rather than a
 *      confident number.
 *
 * COUNTS ARE DIFFERENT and are deliberately allowed to aggregate: a line count,
 * a record count or a rate carries no currency, so summing it across countries
 * is honest. Only money is withheld.
 *
 * Contract note: the money shape mirrors `insurancePortfolio.sumMoney`
 * ({ total, currency, mixedCurrency, byCurrency }) so the two read identically
 * to a maintainer. It is kept separate rather than imported because that module
 * pulls in the whole insurance matching engine, which has no business in an
 * expense bundle.
 *
 * PURE: no I/O, no React, no Date.now().
 */
import { scopeCountries } from './reportingScope'

const txt = (v) => (v == null ? '' : String(v).trim())

/** A finite number, or null. Never coerces a blank or a bad value to 0. */
export function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The countries a report should REQUEST for this scope, in allowed order.
 *
 * This is the single seam between "what the user picked" and "what we ask the
 * database for". Every entry is guaranteed to be a country the profile may
 * aggregate over; anything else is dropped rather than requested. RLS remains
 * the real boundary, but a report must not even ask for what it may not have.
 *
 * @param {object|string[]|string} scope   a reporting scope ({ countries: [...] })
 * @param {string[]} allowed               allowedScopeCountries for this profile
 * @returns {string[]} canonical country names, possibly empty
 */
export function scopeRequestCountries(scope, allowed) {
  return scopeCountries(scope, allowed)
}

/**
 * A stable dependency key for a resolved country list, so an effect re-runs when
 * the SET changes but not when an equal array is rebuilt.
 */
export function scopeQueryKey(countries) {
  return (Array.isArray(countries) ? countries : []).map(txt).filter(Boolean).join('|')
}

/**
 * Keep only the rows whose country is in scope. Belt and braces: the page
 * already requests one country at a time, so this only matters if a source ever
 * returns more than it was asked for. Matching is case-insensitive so a
 * spelling difference between the register and the data can never silently
 * blank a report.
 */
export function rowsInScope(rows, countries, { field = 'country' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const wanted = new Set((Array.isArray(countries) ? countries : []).map((c) => txt(c).toLowerCase()))
  if (wanted.size === 0) return []
  return list.filter((r) => wanted.has(txt(r?.[field]).toLowerCase()))
}

/**
 * Sum a money field across per-country entries WITHOUT ever blending currencies.
 *
 * More than one currency in scope means the total is NULL and `mixedCurrency` is
 * true, with a per-currency breakdown so the caller can print each side by side.
 * An entry with no usable figure is counted in `missing`, so a total over 1 of 3
 * countries is never mistaken for full coverage.
 *
 * @param {Array<{currency?:string}>} entries
 * @returns {{total:number|null, currency:string|null, mixedCurrency:boolean,
 *            byCurrency:Object, currencies:string[], counted:number, missing:number}}
 */
export function scopeMoneyTotal(entries, { valueField = 'total', currencyField = 'currency' } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const byCurrency = new Map()
  let counted = 0
  let missing = 0
  for (const e of list) {
    const v = num(e?.[valueField])
    const cur = txt(e?.[currencyField])
    // No currency means we cannot say what the number is denominated in, so it
    // is unusable for a total rather than assumed to be the house currency.
    if (v == null || !cur) { missing += 1; continue }
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + v)
    counted += 1
  }
  const currencies = [...byCurrency.keys()].sort()
  const single = currencies.length === 1
  return {
    total: single ? byCurrency.get(currencies[0]) : null,
    currency: single ? currencies[0] : null,
    mixedCurrency: currencies.length > 1,
    byCurrency: Object.fromEntries(byCurrency),
    currencies,
    counted,
    missing,
  }
}

/**
 * The one-line reason a combined money figure is not shown, or '' when a single
 * total is legitimate. ASCII only, and it names the currencies so the reader can
 * see why rather than being told to trust it.
 */
export function moneyTotalNote(money) {
  if (!money) return ''
  if (money.mixedCurrency) {
    return `Currencies differ across the countries in scope (${money.currencies.join(', ')}). `
      + 'Spend is reported per country below and is never added across currencies.'
  }
  if (money.total == null) return 'No spend could be measured for the countries in scope.'
  if (money.missing > 0) {
    return `Covers ${money.counted} of ${money.counted + money.missing} countries in scope; `
      + 'the rest reported no usable figure.'
  }
  return ''
}

/**
 * Sum a plain count across per-country entries. Counts carry no currency, so
 * aggregating them across a multi-country scope is honest. Returns null when
 * nothing countable was present, never a flattering 0.
 */
export function scopeCount(entries, field = 'lines') {
  const list = Array.isArray(entries) ? entries : []
  let sum = 0
  let seen = 0
  for (const e of list) {
    const v = num(e?.[field])
    if (v == null) continue
    sum += v
    seen += 1
  }
  return seen > 0 ? sum : null
}
