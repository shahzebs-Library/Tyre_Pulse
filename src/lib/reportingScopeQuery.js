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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPORT URL CONVENTION (adopt this on every shareable reporting page)
 * ─────────────────────────────────────────────────────────────────────────────
 * A reporting page must be linkable: a reader needs to send a colleague the
 * report they are looking at, and a browser refresh must come back to the same
 * report rather than to whatever was last stored. So the REPORTING SCOPE and the
 * page's own window controls live in QUERY PARAMETERS:
 *
 *     /expense-trends?scope=KSA,UAE&grain=month&from=2024-03&to=2025-12
 *
 *   scope   comma separated country NAMES, or the literal `All`
 *   grain   the period granularity, omitted while it is the page default
 *   from/to `YYYY` or `YYYY-MM`, omitted when the window is open-ended
 *
 * Four rules, and each one is a decision rather than a style preference:
 *
 *  1. QUERY PARAMETERS, NOT A ROUTE SEGMENT. The scope is a filter over one
 *     report, not a different resource, and it is optional and multi-valued.
 *     `/expense-trends/KSA,UAE` would fight the router the moment a second
 *     control (grain, date window) needed sharing.
 *
 *  2. NAMES, NEVER INTERNAL IDS. Country names are already on screen and in
 *     every export, so a link leaks nothing new. Organisation ids, user ids and
 *     site ids stay out of the URL: a shared link travels through chat and
 *     ticket systems and must not carry the tenant's internals.
 *
 *  3. THE WORKING CONTEXT IS NOT IN THE URL. Where you OPERATE is a property of
 *     you, not of the link, and is deliberately left in session/user state -
 *     otherwise opening a colleague's report link would silently re-point the
 *     operational selection of 212 other screens. Only the REPORTING scope, the
 *     thing the link is actually about, is shareable.
 *
 *  4. PERMISSION IS RE-CHECKED ON EVERY READ. A URL is untrusted input from
 *     whoever pasted it. `scopeFromParam` resolves it through the SAME
 *     `scopeCountries` the in-page control uses, so a link naming a country the
 *     reader may not see drops that country instead of widening anything. A link
 *     can therefore never become a way to reach another country's data. RLS
 *     remains the real boundary; this keeps the UI from even asking.
 *
 * A parameter that is absent, malformed, or resolves to nothing usable returns
 * null so the caller keeps its stored/default scope: an unreadable link must
 * still land on a VALID page, never on an empty or a widened one.
 */
import { scopeCountries, SCOPE_ALL } from './reportingScope'

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

/* ── The report URL (see THE REPORT URL CONVENTION at the top) ─────────────── */

/** Parameter names. Shared so two reporting pages cannot invent two spellings. */
export const SCOPE_PARAM = 'scope'
export const GRAIN_PARAM = 'grain'
export const FROM_PARAM = 'from'
export const TO_PARAM = 'to'

/**
 * Separator between country names. A comma reads naturally in an address bar and
 * survives copy/paste unescaped. No country in this system contains a comma; one
 * that did could not be represented here and would need its own encoding.
 */
export const SCOPE_SEPARATOR = ','

/**
 * Does this token mean "every country I may report on"?
 * MIRRORS the sentinel test inside reportingScope.js (which does not export it).
 * If that file ever accepts another spelling, widen this with it.
 */
function isAllToken(v) {
  const s = txt(v).toLowerCase()
  return s === String(SCOPE_ALL).toLowerCase() || s === '*'
}

/**
 * Split a `scope=` value into raw tokens. TEXT ONLY - no permission logic, so it
 * can be used before the profile has loaded. Blank entries are dropped, so
 * "KSA,,UAE" and "KSA, UAE" both read cleanly.
 */
export function parseScopeParam(raw) {
  return txt(raw).split(SCOPE_SEPARATOR).map(txt).filter(Boolean)
}

/**
 * Resolve a `scope=` value against what this profile may aggregate over.
 *
 * THIS IS THE PERMISSION SEAM FOR SHARED LINKS. The URL is untrusted input, so
 * every token goes through `scopeCountries` - the same resolver the in-page
 * control uses - and anything not permitted is dropped rather than requested.
 *
 * `scope` is null whenever the caller should keep the scope it already has:
 * an absent parameter, an unparseable one, or one naming only countries this
 * reader may not see. Falling back to the stored scope keeps the reader on a
 * VALID report; falling back to "All" would widen it, and falling back to
 * nothing would strand them on an empty page because of someone else's link.
 *
 * @returns {{scope:{countries:string[]}|null, countries:string[],
 *            requested:string[], dropped:string[], all:boolean}}
 */
export function scopeFromParam(raw, allowed) {
  const requested = parseScopeParam(raw)
  const all = requested.some(isAllToken)
  const countries = scopeCountries(requested, allowed)
  const dropped = requested.filter(
    (c) => !isAllToken(c) && !countries.some((k) => k.toLowerCase() === c.toLowerCase()),
  )
  return {
    // Keep the sentinel as the sentinel: a link that said "all countries" should
    // go on meaning that for the reader who opens it, bounded by their own
    // permissions rather than by the sender's.
    scope: countries.length ? { countries: all ? [SCOPE_ALL] : countries } : null,
    countries,
    requested,
    dropped,
    all,
  }
}

/**
 * The `scope=` value for a scope, or '' when there is nothing worth writing.
 * Canonical form: the sentinel stays `All`, anything else is spelled out in the
 * permitted order so the link records exactly which countries were reported on.
 */
export function scopeToParam(scope, allowed) {
  const countries = scopeCountries(scope, allowed)
  if (!countries.length) return ''
  const asked = Array.isArray(scope?.countries) ? scope.countries : []
  if (asked.some(isAllToken)) return SCOPE_ALL
  return countries.join(SCOPE_SEPARATOR)
}

/** A value restricted to a known set, else the fallback. Junk never reaches a query. */
export function oneOfParam(raw, options, fallback = '') {
  const v = txt(raw).toLowerCase()
  const hit = (Array.isArray(options) ? options : []).find((o) => txt(o).toLowerCase() === v)
  return hit ?? fallback
}

/**
 * Read a `from=` / `to=` value: 'YYYY' or 'YYYY-MM'. Anything else (including an
 * impossible month) reads as unset rather than as a wrong window.
 */
export function periodFromParam(raw) {
  const m = txt(raw).match(/^(\d{4})(?:-(\d{1,2}))?$/)
  if (!m) return { year: '', month: '' }
  const mo = m[2] == null ? null : Number(m[2])
  const month = mo != null && mo >= 1 && mo <= 12 ? String(mo).padStart(2, '0') : ''
  return { year: m[1], month }
}

/**
 * Write a `from=` / `to=` value.
 * A month with no year is NOT written, because it does not bound anything: the
 * report's window opens only once a year is chosen, so the link carries the
 * window that is actually in force rather than a control position that is not.
 */
export function periodToParam(year, month) {
  const y = txt(year)
  if (!/^\d{4}$/.test(y)) return ''
  const m = txt(month)
  return /^(0[1-9]|1[0-2])$/.test(m) ? `${y}-${m}` : y
}

/**
 * Everything a reporting page seeds itself from, read off a `location.search`
 * string. Deliberately does NO permission work: the profile may not have loaded
 * when a page first paints, so the scope is returned as RAW TEXT and resolved
 * separately through `scopeFromParam` once `allowed` is known.
 */
export function readReportUrl(search, { grains = [], defaultGrain = '' } = {}) {
  const p = new URLSearchParams(txt(search))
  return {
    scopeRaw: p.get(SCOPE_PARAM) || '',
    grain: oneOfParam(p.get(GRAIN_PARAM), grains, defaultGrain),
    from: periodFromParam(p.get(FROM_PARAM)),
    to: periodFromParam(p.get(TO_PARAM)),
  }
}

/**
 * The parameters a reporting page should be showing right now. An entry of ''
 * means REMOVE that parameter, so a default-valued control leaves the URL clean
 * and a bookmark stays short.
 *
 * The scope is written even at its default: the whole point is that the address
 * bar can be copied and sent, and a link that omits the scope would be read by
 * the recipient's stored scope instead of the sender's report.
 */
export function reportUrlParams({
  scope, allowed, grain, defaultGrain = '', from, to,
} = {}) {
  return {
    [SCOPE_PARAM]: scopeToParam(scope, allowed),
    [GRAIN_PARAM]: txt(grain) && txt(grain) !== txt(defaultGrain) ? txt(grain) : '',
    [FROM_PARAM]: periodToParam(from?.year, from?.month),
    [TO_PARAM]: periodToParam(to?.year, to?.month),
  }
}

/**
 * Apply those parameters to the current query string, returning a new
 * URLSearchParams. Parameters this page does not own are carried through
 * untouched, so a report link can sit beside anything else already in the URL.
 */
export function applyReportUrlParams(current, updates) {
  const next = new URLSearchParams(
    current instanceof URLSearchParams ? current.toString() : txt(current),
  )
  for (const [key, value] of Object.entries(updates || {})) {
    if (txt(value)) next.set(key, txt(value))
    else next.delete(key)
  }
  return next
}
