/**
 * governedCost.js - THE definition of what a cost total means in Tyre Pulse.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Cost was re-derived inline at dozens of call sites, and that produced real,
 * repeated, shipped defects:
 *   - SAR + AED + EGP summed into one meaningless number, patched at four
 *     separate reader sites in a single session and then reintroduced.
 *   - Tyre spend reading 4.2M on the Tyre module and 13.0M on the Expense
 *     module, because one summed tyre_records.cost_per_tyre and the other read
 *     the classified expense grid.
 *   - A monthly trend that forgot the qty multiplier.
 * Patching readers does not fix a definition problem. This module IS the
 * definition; every cost surface should read it rather than restate it.
 *
 * This file is PURE - no I/O, no Supabase, no dates from the clock. The reader
 * that fetches rows lives in `src/lib/api/governedCost.js`.
 *
 * THE GOVERNING RULES (settled decisions - encoded here, not relitigated)
 * ----------------------------------------------------------------------
 * 1. Tyre cost total = the classified expense grid (parts_consumption.tyre_cost).
 *    NEVER sum(tyre_records.cost_per_tyre): 49% of tyre_records carry no price,
 *    and for UAE and Egypt that column is empty outright, so a cost_per_tyre
 *    total silently reports 0 tyre spend for two of three countries.
 * 2. Maintenance = grid spare_cost + oil_cost, plus work_orders labour + parts +
 *    lubricant + outside_repair EXCLUDING its tyre_cost, plus
 *    pm_service_records.total_cost.
 * 3. Line amount basis = Values (value_amount), then Total, then the largest
 *    split. Applied server-side by the classify trigger; named here so the
 *    basis is discoverable from the definition.
 * 4. NEVER add SAR + AED + EGP. A cross-country figure is returned per country
 *    or refused. This is enforced by construction below, not by convention.
 * 5. A missing denominator yields null, not zero. An unmeasurable cost per km
 *    is unknown; zero reads as "free".
 *
 * @module governedCost
 */

/* ------------------------------------------------------------------ *
 * Currency                                                            *
 * ------------------------------------------------------------------ */

/**
 * Country -> currency. Mirrors the `country_currency` table, which is the
 * server-side single place that decision lives (V366). Kept here so the pure
 * layer can validate without a round trip; the table stays authoritative, so a
 * new country is a row there plus an entry here.
 */
export const CURRENCY_BY_COUNTRY = Object.freeze({
  KSA: 'SAR',
  UAE: 'AED',
  Egypt: 'EGP',
})

/** The reporting base currency (country_currency.is_base). */
export const BASE_CURRENCY = 'SAR'

/**
 * Sentinel for "this figure has no single currency". Used when a scope spans
 * more than one country. It is deliberately NOT a currency code, so any
 * formatter that receives it renders something visibly wrong rather than
 * silently mislabelling a blend as SAR (the exact BoardOverview defect).
 */
export const MIXED_CURRENCY = 'MIXED'

/** Case- and whitespace-insensitive country lookup. */
export function currencyForCountry(country) {
  const key = String(country ?? '').trim().toLowerCase()
  if (!key) return null
  for (const [c, cur] of Object.entries(CURRENCY_BY_COUNTRY)) {
    if (c.toLowerCase() === key) return cur
  }
  return null
}

/** True when `country` is a real, single, known country (not All / blank). */
export function isSingleCountry(country) {
  return currencyForCountry(country) != null
}

/** Thrown when two different currencies are combined. Never caught internally. */
export class CurrencyMismatchError extends Error {
  constructor(a, b) {
    super(
      `Refusing to combine ${a} and ${b}. A cross-country cost figure must be ` +
      `reported per country. Use byCountry() and render one total per currency.`
    )
    this.name = 'CurrencyMismatchError'
    this.currencies = [a, b]
  }
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/* ------------------------------------------------------------------ *
 * Money - an amount that knows its currency                           *
 * ------------------------------------------------------------------ */

/**
 * A frozen { amount, currency } pair. Every governed figure is a Money, never
 * a bare number, so a currency can never be lost on the way to a screen.
 */
export function money(amount, currency) {
  if (!currency) throw new Error('money() requires a currency; an amount with no currency cannot be governed.')
  return Object.freeze({ amount: num(amount), currency: String(currency) })
}

/** True for a value produced by money(). */
export function isMoney(v) {
  return Boolean(v) && typeof v === 'object' && typeof v.currency === 'string' && typeof v.amount === 'number'
}

/**
 * Add two Money values. THIS IS THE GUARD: mismatched currencies throw rather
 * than producing a plausible-looking wrong number. Every aggregation in this
 * module funnels through here, so blending is impossible by construction.
 */
export function addMoney(a, b) {
  if (!isMoney(a) || !isMoney(b)) throw new Error('addMoney expects two Money values.')
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
  return money(a.amount + b.amount, a.currency)
}

/**
 * Sum a list of Money. `currency` is required so an EMPTY list still returns a
 * correctly-denominated zero instead of guessing (or throwing) at render time.
 */
export function sumMoney(list, currency) {
  const items = Array.isArray(list) ? list.filter(isMoney) : []
  if (!currency) {
    if (!items.length) throw new Error('sumMoney() of an empty list requires an explicit currency.')
    currency = items[0].currency
  }
  return items.reduce((acc, m) => addMoney(acc, m), money(0, currency))
}

/* ------------------------------------------------------------------ *
 * The cost taxonomy                                                   *
 * ------------------------------------------------------------------ */

/**
 * The three buckets the classify engine assigns every expense line to. These
 * are exhaustive and mutually exclusive: on live data
 * sum(line_cost) === sum(tyre_cost + spare_cost + oil_cost) to 0.00 variance
 * across all three countries. That identity is what makes EXCLUSION 3 below a
 * real hazard rather than a theoretical one.
 */
export const COST_BUCKETS = Object.freeze(['tyre', 'spare', 'oil'])

/** Grid column carrying each bucket's amount. */
export const BUCKET_COLUMN = Object.freeze({
  tyre: 'tyre_cost',
  spare: 'spare_cost',
  oil: 'oil_cost',
})

/**
 * The line amount basis, in precedence order. The classify trigger applies this
 * server-side; documented here so the definition is readable in one place.
 * `Total` is unreliable on its own: ~33% of rows carry Total = 0 while Values
 * holds the real amount, which is why Values wins.
 */
export const AMOUNT_BASIS = Object.freeze(['value_amount', 'total_parts', 'largest_split'])

/**
 * Display modes. Mirrors the legacy COST_MODES in costSources.js so the
 * one-click Tyres / Maintenance switch keeps behaving identically.
 */
export const COST_MODES = Object.freeze([
  { key: 'combined', label: 'Combined', buckets: ['tyre', 'spare', 'oil'] },
  { key: 'tyres', label: 'Tyres', buckets: ['tyre'] },
  { key: 'maintenance', label: 'Maintenance', buckets: ['spare', 'oil'] },
])

/** The buckets a mode covers (unknown mode falls back to combined). */
export function bucketsForMode(mode) {
  const m = COST_MODES.find((x) => x.key === mode) || COST_MODES[0]
  return m.buckets
}

/** Display label for a mode. */
export function costModeLabel(mode) {
  return (COST_MODES.find((m) => m.key === mode) || COST_MODES[0]).label
}

/* ------------------------------------------------------------------ *
 * Double-count exclusions - written as code, with the reason          *
 * ------------------------------------------------------------------ */

/**
 * Every exclusion that keeps a total honest. Exported so a reviewer can read
 * the rules without reading the arithmetic, and so tests can assert each one is
 * still enforced.
 */
export const EXCLUSIONS = Object.freeze([
  Object.freeze({
    id: 'wo_tyre_cost',
    rule: 'work_orders.tyre_cost is excluded from the maintenance total.',
    because:
      'The tyre bucket already counts that spend from the classified grid. ' +
      'Adding the work order tyre column on top counts the same tyre twice. ' +
      'Currently inert on live data (every work_orders.tyre_cost is null) but ' +
      'kept enforced: it is protective, and the column is importable.',
  }),
  Object.freeze({
    id: 'grid_supersedes_legacy',
    rule: 'When the classified grid covers a scope it is used ALONE; the legacy ' +
      'tyre_records / work_orders / pm_service_records sources are not added to it.',
    because:
      'They describe the same money from a different system of record. Summing ' +
      'both roughly doubles reported spend. Legacy is a fallback, never a supplement.',
  }),
  Object.freeze({
    id: 'total_is_buckets',
    rule: 'The grid total is tyre + spare + oil. line_cost is that same total, ' +
      'not a fourth addend.',
    because:
      'Verified on live data: sum(line_cost) equals sum(tyre+spare+oil) to 0.00 ' +
      'variance in all three countries. Adding line_cost to the buckets doubles ' +
      'the figure, and it looks plausible enough to ship.',
  }),
  Object.freeze({
    id: 'tyre_total_from_grid',
    rule: 'A tyre-cost TOTAL comes from the grid, never from ' +
      'sum(tyre_records.cost_per_tyre).',
    because:
      '49% of tyre_records rows carry no price. On live data the legacy sum is ' +
      'KSA 4.23M against the grid 11.30M, and UAE and Egypt sum to 0.00 while ' +
      'the grid holds 6.15M and 16.72M. Per-tyre CPK still legitimately uses ' +
      'cost_per_tyre; only the TOTAL is governed here.',
  }),
])

/** Look up one exclusion by id (throws on an unknown id - typos should fail loud). */
export function exclusion(id) {
  const found = EXCLUSIONS.find((e) => e.id === id)
  if (!found) throw new Error(`Unknown exclusion "${id}".`)
  return found
}

/**
 * The maintenance contribution of a work order, with EXCLUSION wo_tyre_cost
 * applied. Deliberately a named function so the exclusion is impossible to omit
 * by writing the addition out by hand at a call site.
 */
export function workOrderMaintenanceAmount(row) {
  // tyre_cost is intentionally absent from this sum - see exclusion('wo_tyre_cost').
  return num(row?.labour_cost) + num(row?.parts_cost) +
    num(row?.lubricant_cost) + num(row?.outside_repair_cost)
}

/* ------------------------------------------------------------------ *
 * costOf - the governed total over grid rows                          *
 * ------------------------------------------------------------------ */

/**
 * Resolve the currency for a set of rows in a scope.
 * - explicit single country wins
 * - otherwise derive from the rows; one distinct country -> its currency
 * - more than one country -> null, which callers must treat as "refuse"
 */
function resolveCurrency(rows, country) {
  if (isSingleCountry(country)) return currencyForCountry(country)
  const seen = new Set()
  for (const r of rows) {
    const c = currencyForCountry(r?.country)
    if (c) seen.add(c)
    else if (r?.currency) seen.add(String(r.currency))
    if (seen.size > 1) return null
  }
  return seen.size === 1 ? [...seen][0] : null
}

/**
 * THE governed total over classified grid rows.
 *
 * @param {Array<object>} rows  parts_consumption-shaped rows
 *   ({ country, tyre_cost, spare_cost, oil_cost }).
 * @param {{ mode?:string, country?:string }} [opts]
 *   mode: 'combined' | 'tyres' | 'maintenance' (default combined)
 *   country: a single country. Required when rows span more than one, because
 *   the answer would otherwise be a blend.
 * @returns {{amount:number, currency:string}} a Money.
 * @throws {CurrencyMismatchError} when the scope spans currencies and no single
 *   country was given. That is the point: the caller must pick a country or
 *   switch to byCountry().
 */
export function costOf(rows, { mode = 'combined', country } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const scoped = isSingleCountry(country)
    ? list.filter((r) => !r?.country || currencyForCountry(r.country) === currencyForCountry(country))
    : list

  const currency = resolveCurrency(scoped, country)
  if (!currency) {
    const found = [...new Set(scoped.map((r) => currencyForCountry(r?.country)).filter(Boolean))]
    if (found.length > 1) throw new CurrencyMismatchError(found[0], found[1])
    // No rows and no country: there is no currency to denominate a zero in.
    throw new Error(
      'costOf() needs a single country to denominate the total. ' +
      'Pass { country }, or use byCountry(rows) for a multi-country scope.'
    )
  }

  const buckets = bucketsForMode(mode)
  let amount = 0
  for (const r of scoped) {
    // Sum the BUCKET columns, never line_cost alongside them - see
    // exclusion('total_is_buckets').
    for (const b of buckets) amount += num(r?.[BUCKET_COLUMN[b]])
  }
  return money(amount, currency)
}

/**
 * The per-bucket breakdown for one country, as Money.
 * `maintenance` is spare + oil; `total` is tyre + spare + oil.
 */
export function bucketsOf(rows, { country } = {}) {
  const tyre = costOf(rows, { mode: 'tyres', country })
  const maintenance = costOf(rows, { mode: 'maintenance', country })
  const cur = tyre.currency
  // Scope spare/oil with the SAME country filter costOf applies. Summing them
  // over the unfiltered list would reintroduce the exact cross-currency blend
  // this module exists to prevent.
  const scoped = isSingleCountry(country)
    ? (Array.isArray(rows) ? rows : []).filter(
        (r) => !r?.country || currencyForCountry(r.country) === currencyForCountry(country))
    : (Array.isArray(rows) ? rows : [])
  const spare = money(scoped.reduce((s, r) => s + num(r?.spare_cost), 0), cur)
  const oil = money(scoped.reduce((s, r) => s + num(r?.oil_cost), 0), cur)
  return {
    tyre,
    spare,
    oil,
    maintenance,
    total: addMoney(tyre, maintenance),
    currency: cur,
  }
}

/* ------------------------------------------------------------------ *
 * byCountry - the ONLY safe cross-country container                   *
 * ------------------------------------------------------------------ */

/**
 * A multi-country cost result. It deliberately exposes NO scalar total and no
 * `amount`, so there is nothing for a template to render as one blended number.
 * The only way to get a figure out is per country.
 */
function makeCountryCostSet(entries) {
  const byCountry = Object.freeze({ ...entries })
  const countries = Object.keys(byCountry)
  return Object.freeze({
    kind: 'CountryCostSet',
    countries,
    byCountry,
    /** Money for one country, or null when that country is out of scope. */
    get(country) {
      const key = countries.find((c) => c.toLowerCase() === String(country ?? '').trim().toLowerCase())
      return key ? byCountry[key] : null
    },
    /** [{ country, currency, amount }] - render one row per currency. */
    rows() {
      return countries.map((c) => ({
        country: c,
        currency: byCountry[c].currency,
        amount: byCountry[c].amount,
      }))
    },
    /**
     * A combined figure is only meaningful when the whole set is one currency
     * (e.g. a single-country scope). Otherwise this THROWS rather than blending.
     */
    single() {
      if (countries.length === 0) {
        throw new Error('CountryCostSet is empty; there is no total to report.')
      }
      return sumMoney(countries.map((c) => byCountry[c]))
    },
    /** True when .single() is safe. Check this before offering a combined view. */
    get isSingleCurrency() {
      return new Set(countries.map((c) => byCountry[c].currency)).size === 1
    },
  })
}

/**
 * Split rows into a per-country governed total. This is the correct answer to
 * "what did the group spend" - three figures in three currencies, not one.
 *
 * @param {Array<object>} rows
 * @param {{ mode?:string }} [opts]
 * @returns {ReturnType<typeof makeCountryCostSet>}
 */
export function byCountry(rows, { mode = 'combined' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const groups = new Map()
  for (const r of list) {
    const c = String(r?.country ?? '').trim()
    if (!currencyForCountry(c)) continue // unknown country cannot be denominated
    const canonical = Object.keys(CURRENCY_BY_COUNTRY).find((k) => k.toLowerCase() === c.toLowerCase())
    if (!groups.has(canonical)) groups.set(canonical, [])
    groups.get(canonical).push(r)
  }
  const entries = {}
  for (const [c, rs] of groups) entries[c] = costOf(rs, { mode, country: c })
  return makeCountryCostSet(entries)
}

/** Build a CountryCostSet directly from server per-country rows. */
export function countryCostSetFrom(rows, pick = (r) => r?.total) {
  const entries = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    const cur = currencyForCountry(r?.country)
    if (!cur) continue
    const canonical = Object.keys(CURRENCY_BY_COUNTRY)
      .find((k) => k.toLowerCase() === String(r.country).trim().toLowerCase())
    entries[canonical] = money(pick(r), cur)
  }
  return makeCountryCostSet(entries)
}

/* ------------------------------------------------------------------ *
 * Per-unit cost - null denominators, never zero                       *
 * ------------------------------------------------------------------ */

/**
 * Cost per running unit (km, engine hour, m3).
 *
 * Returns null - NOT zero - when the denominator is missing, zero or
 * unmeasurable. An unmeasured fleet has an UNKNOWN cost per km; reporting 0
 * reads as "free" and has previously been shown on screen as if it were a good
 * result. Rule 5.
 *
 * @returns {{value:number|null, currency:string, unit:string, denominator:number|null}}
 */
export function perUnitCost(total, denominator, unit = 'km') {
  if (!isMoney(total)) throw new Error('perUnitCost expects a Money total.')
  const d = Number(denominator)
  const usable = Number.isFinite(d) && d > 0
  return Object.freeze({
    value: usable ? total.amount / d : null,
    currency: total.currency,
    unit,
    denominator: usable ? d : null,
  })
}

/**
 * Coverage-aware guard for a per-unit figure. A cost per km computed over 5% of
 * spend is coverage noise, not a trend; the server RPC uses the same 0.25 floor.
 */
export const MIN_COVERAGE = 0.25

export function isComparable(coveragePct, min = MIN_COVERAGE) {
  const c = Number(coveragePct)
  return Number.isFinite(c) && c >= min
}

/* ------------------------------------------------------------------ *
 * Formatting                                                          *
 * ------------------------------------------------------------------ */

/**
 * Format a Money for display. Always emits the currency, so a figure can never
 * be shown unlabelled (the BoardOverview defect where AED and EGP rendered as
 * "SAR" came from a formatter that dropped the currency argument).
 * Missing values render "N/A", never a dash and never 0.
 */
export function formatMoney(m, { maximumFractionDigits = 0, locale = 'en-US' } = {}) {
  if (!isMoney(m)) return 'N/A'
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(m.amount)
  return `${m.currency} ${n}`
}

/** Format a per-unit result; null value renders "N/A". */
export function formatPerUnit(pu, { maximumFractionDigits = 2, locale = 'en-US' } = {}) {
  if (!pu || pu.value == null) return 'N/A'
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(pu.value)
  return `${pu.currency} ${n} / ${pu.unit}`
}

/**
 * Render a CountryCostSet as display rows. Use this wherever a cross-country
 * total was previously shown as one number.
 */
export function formatCountrySet(set, opts) {
  if (!set || set.kind !== 'CountryCostSet') return []
  return set.rows().map((r) => ({
    country: r.country,
    currency: r.currency,
    amount: r.amount,
    display: formatMoney(money(r.amount, r.currency), opts),
  }))
}
