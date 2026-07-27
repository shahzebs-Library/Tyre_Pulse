/**
 * governedCost (service) - THE reader for every cost total.
 *
 * This composes the cost RPCs that already exist. It deliberately adds NO new
 * aggregate RPC: the four below already cover every shape a cost surface needs,
 * and a fifth would just be a fourth place for the definition to drift.
 *
 *   get_expense_by_country(from,to)              per-country totals. The ONLY
 *                                                safe cross-country read - it
 *                                                returns one row per currency.
 *   get_cost_cpk_overview(country,site,from,to)  single scope, deep: current /
 *                                                previous / last-year windows,
 *                                                cost per km with coverage,
 *                                                monthly series, breakdowns.
 *   get_parts_expense_snapshot(site,country,..)  the classified grid split
 *                                                (tyre / spare / oil) + monthly.
 *   get_tyre_cost_by_asset(country,from,to)      authoritative per-asset tyre cost.
 *
 * Everything is returned as governed Money / CountryCostSet values from
 * `src/lib/governedCost.js`, so a currency can never be dropped between the
 * database and the screen.
 *
 * NOTE on the site parameter: get_parts_expense_snapshot filters on
 * `store_code` while get_cost_cpk_overview filters on `site`. They are
 * different vocabularies (the store->site map exists precisely because of
 * this). loadGovernedCost uses the `site` column via get_cost_cpk_overview.
 */
import { supabase } from './_client'
import {
  money,
  byCountry as pureByCountry,
  countryCostSetFrom,
  currencyForCountry,
  isSingleCountry,
  perUnitCost,
  isComparable,
  bucketsForMode,
  MIXED_CURRENCY,
} from '../governedCost'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const scope = (v) => (v && v !== 'All' ? String(v) : null)

/**
 * Per-country governed totals. Use this for ANY all-countries figure.
 *
 * Returns a CountryCostSet, which has no scalar total - so a caller physically
 * cannot render a blended SAR+AED+EGP number from it.
 *
 * @param {{from?:string, to?:string, mode?:string}} [opts]
 * @returns {Promise<{set:object, rows:Array, ok:boolean}>}
 */
export async function loadCostByCountry({ from, to, mode = 'combined' } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_expense_by_country', {
      p_from: from || null,
      p_to: to || null,
    })
    if (error || !Array.isArray(data)) return { ok: false, set: countryCostSetFrom([]), rows: [] }

    const buckets = bucketsForMode(mode)
    // Pick the mode's amount from the server row rather than re-summing:
    // tyre/spare/oil are already the governed buckets, and `total` is their
    // sum (verified 0.00 variance), never a fourth addend.
    const pick = (r) => buckets.reduce((s, b) => s + num(r?.[b]), 0)

    const set = countryCostSetFrom(data, pick)
    return {
      ok: true,
      set,
      rows: data.map((r) => ({
        country: r.country,
        currency: currencyForCountry(r.country),
        tyre: num(r.tyre),
        spare: num(r.spare),
        oil: num(r.oil),
        maintenance: num(r.spare) + num(r.oil),
        total: num(r.total),
        lines: num(r.lines),
      })),
    }
  } catch {
    return { ok: false, set: countryCostSetFrom([]), rows: [] }
  }
}

/**
 * The governed cost view for ONE scope.
 *
 * When `country` is a single country every figure is Money in that country's
 * currency. When it is All / omitted the totals are NOT summed: `set` carries
 * the per-country split and `currency` is MIXED, so a caller must choose.
 *
 * @param {{country?:string, site?:string, from?:string, to?:string, mode?:string}} [opts]
 */
export async function loadGovernedCost({ country, site, from, to, mode = 'combined' } = {}) {
  const single = isSingleCountry(scope(country))
  const currency = single ? currencyForCountry(country) : MIXED_CURRENCY

  const [overviewRes, byCountryRes] = await Promise.all([
    supabase
      .rpc('get_cost_cpk_overview', {
        p_country: scope(country),
        p_site: scope(site),
        p_from: from || null,
        p_to: to || null,
      })
      .then((r) => r, () => ({ data: null, error: true })),
    // Always load the per-country split: it is what a multi-country scope must
    // show instead of a blend, and it is cheap.
    loadCostByCountry({ from, to, mode }),
  ])

  const ov = overviewRes?.data
  if (!ov || ov.ok === false) {
    return {
      ok: false,
      reason: ov?.reason || 'unavailable',
      currency,
      blended: !single,
      set: byCountryRes.set,
      byCountry: byCountryRes.rows,
      totals: null,
      monthly: [],
      perUnit: null,
      breakdowns: {},
    }
  }

  const cur = single ? currency : (ov.currency || MIXED_CURRENCY)
  const asMoney = (n) => money(n, cur)

  const cur0 = ov.totals?.current || {}
  const prev0 = ov.totals?.previous || {}
  const buckets = bucketsForMode(mode)
  const modeAmount = (t) => buckets.reduce((s, b) => s + num(t?.[b]), 0)

  const cpk = ov.cpk?.current || {}

  return {
    ok: true,
    /** true when the scope spans currencies: DO NOT render a single total. */
    blended: !single,
    currency: cur,
    country: scope(country),
    site: scope(site),
    windows: ov.windows || null,
    generatedAt: ov.generated_at || null,

    /** Per-country split - always present, and the only safe multi-country view. */
    set: byCountryRes.set,
    byCountry: byCountryRes.rows,

    /**
     * Governed Money totals for the current window. Only meaningful when
     * `blended` is false; when it is true these are per-currency-ambiguous and
     * a caller should read `byCountry` instead.
     */
    totals: {
      tyre: asMoney(cur0.tyre),
      spare: asMoney(cur0.spare),
      oil: asMoney(cur0.oil),
      maintenance: asMoney(num(cur0.spare) + num(cur0.oil)),
      total: asMoney(cur0.total),
      mode: asMoney(modeAmount(cur0)),
      lines: num(cur0.lines),
      assets: num(cur0.assets),
    },
    previous: {
      tyre: asMoney(prev0.tyre),
      maintenance: asMoney(num(prev0.spare) + num(prev0.oil)),
      total: asMoney(prev0.total),
      mode: asMoney(modeAmount(prev0)),
    },

    /**
     * Cost per km. `value` is null - never 0 - when the fleet is unmeasured.
     * `comparable` is false when coverage is below the floor, i.e. the number
     * exists but should not be trended.
     */
    perUnit: {
      ...perUnitCost(asMoney(cpk.spend_matched), cpk.km, 'km'),
      km: cpk.km == null ? null : num(cpk.km),
      assetsMeasured: num(cpk.assets_measured),
      coverage: cpk.coverage_pct == null ? null : num(cpk.coverage_pct),
      comparable: isComparable(cpk.coverage_pct),
    },

    /** [{ month, tyre, spare, oil, maintenance, total }] raw numbers in `currency`. */
    monthly: (ov.monthly || []).map((m) => ({
      month: m.m,
      tyre: num(m.tyre),
      spare: num(m.spare),
      oil: num(m.oil),
      maintenance: num(m.spare) + num(m.oil),
      total: num(m.total),
      value: buckets.reduce((s, b) => s + num(m[b]), 0),
    })),

    breakdowns: {
      bySite: ov.by_site || [],
      byCostCenter: ov.by_cost_center || [],
      byAssetType: ov.by_asset_type || [],
      byAsset: ov.by_asset || [],
      byItem: ov.by_item || [],
      byEvidence: ov.by_evidence || [],
    },
  }
}

/**
 * Governed Tyres-vs-Maintenance split, byte-compatible with the legacy
 * `loadCostSplit` shape ({ tyre, maintenance, totals, byMonth }) so an existing
 * call site can adopt it without changing its rendering, while additionally
 * getting `currency`, `blended` and the per-country `set`.
 *
 * Falls back to the legacy loadCostSplit when the grid has nothing for the
 * scope (site-scoped store-code vocabulary, or an un-migrated org).
 */
export async function loadGovernedCostSplit({ country, site, from, to } = {}) {
  const g = await loadGovernedCost({ country, site, from, to })
  if (g.ok && g.totals && g.totals.total.amount > 0) {
    return {
      tyre: g.totals.tyre.amount,
      maintenance: g.totals.maintenance.amount,
      totals: { tyre: g.totals.tyre.amount, maintenance: g.totals.maintenance.amount },
      byMonth: g.monthly.map((m) => ({
        month: m.month,
        tyre: m.tyre,
        maintenance: m.maintenance,
      })),
      currency: g.currency,
      blended: g.blended,
      set: g.set,
      source: 'governed:parts_consumption',
    }
  }
  const { loadCostSplit } = await import('./costSummary')
  const legacy = await loadCostSplit({ country, site, from, to })
  return {
    ...legacy,
    currency: isSingleCountry(scope(country)) ? currencyForCountry(country) : MIXED_CURRENCY,
    blended: !isSingleCountry(scope(country)),
    source: legacy.source || 'legacy',
  }
}

/**
 * Authoritative per-asset TYRE cost from the grid, as governed Money.
 * Requires a single country - a per-asset figure in a mixed scope would be a
 * blend, and assets do move between countries.
 */
export async function loadGovernedTyreByAsset({ country, from, to } = {}) {
  if (!isSingleCountry(scope(country))) {
    return { ok: false, reason: 'country_required', map: new Map(), currency: MIXED_CURRENCY }
  }
  const cur = currencyForCountry(country)
  try {
    const { data, error } = await supabase.rpc('get_tyre_cost_by_asset', {
      p_country: scope(country),
      p_from: from || null,
      p_to: to || null,
    })
    if (error || !Array.isArray(data)) return { ok: false, map: new Map(), currency: cur }
    const map = new Map()
    let total = 0
    for (const r of data) {
      const key = String(r.asset_code || '').trim().toUpperCase()
      if (!key) continue
      map.set(key, money(r.tyre_cost, cur))
      total += num(r.tyre_cost)
    }
    return { ok: true, map, total: money(total, cur), currency: cur }
  } catch {
    return { ok: false, map: new Map(), currency: cur }
  }
}

export { pureByCountry as byCountry }
