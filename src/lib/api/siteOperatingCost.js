import { supabase } from './_client'
import { callScopedMulti } from './partsConsumption'

/**
 * What each site actually costs to run.
 *
 * The owner's own ruling made this possible: the -ST names are SPARE PARTS
 * STORES, so an expense line's `site` is where the parts were ISSUED FROM, not
 * where the machine was working. Per-site cost read off that column is wrong,
 * and wrong by a lot on the sites that matter - Diriyah showed SAR 729,121
 * against the store while only SAR 2,335 of work happened at a site called
 * DIRIYAH, because the machines are at DIRIYAH-G1 and G2.
 *
 * So cost is attributed through the ASSET: expense line -> job card -> asset ->
 * the site that asset is registered at. Measured coverage is 99.4% of lines.
 *
 * Both readings are returned. The store side is not noise - it is the right
 * number for asking which store is issuing stock. They answer different
 * questions, and the screen says which is which.
 */

/**
 * @param {object} [opts]
 * @param {string} [opts.country] a single country; omit for all (money is never blended)
 * @param {string} [opts.from] YYYY-MM-DD
 * @param {string} [opts.to]   YYYY-MM-DD
 * @returns {Promise<{ok:boolean, coverage?:object, bySite?:Array, byStore?:Array, reason?:string}>}
 */
export async function getSiteOperatingCost({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_site_operating_cost', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    // A backend without V512 must leave the section out, not fail the page.
    if (error) return { ok: false, reason: 'unavailable' }
    if (!data?.ok) return { ok: false, reason: data?.reason || 'unavailable' }
    return {
      ok: true,
      coverage: data.coverage || null,
      bySite: Array.isArray(data.by_site) ? data.by_site : [],
      byStore: Array.isArray(data.by_store) ? data.by_store : [],
    }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * Site operating cost for every country in a reporting scope (V544).
 *
 * One block per country. `coverage` (the share of expense lines that resolve
 * through a job card to an asset's registered site) stays PER COUNTRY rather
 * than being averaged into one scope-wide figure: it is a data-quality reading,
 * and three countries load their job cards differently, so one blended
 * percentage would describe none of them.
 *
 * This also supplies the country guard the single-country function lacks - asked
 * with no country it returns every country in the organisation regardless of
 * what the caller may see.
 *
 * @param {{countries:string[], from?:string, to?:string}} opts
 * @returns {Promise<{ok:boolean, blocks:Array, refused:string[]}>} never throws
 */
export async function getSiteOperatingCostMulti({ countries, from, to } = {}) {
  try {
    const res = await callScopedMulti('get_site_operating_cost_multi', countries, {
      p_from: from || null, p_to: to || null,
    })
    return {
      ...res,
      blocks: res.blocks.map((b) => ({
        country: b?.country,
        currency: b?.currency || null,
        coverage: b?.result?.coverage || null,
        bySite: Array.isArray(b?.result?.by_site) ? b.result.by_site : [],
        byStore: Array.isArray(b?.result?.by_store) ? b.result.by_store : [],
      })),
    }
  } catch {
    return { ok: false, blocks: [], refused: [] }
  }
}

/**
 * How far the store reading is from the operating reading, per name. A large gap
 * is not an error - it is a store serving other sites - but it is exactly what
 * makes reading cost off the store misleading, so it is worth showing.
 */
export function storeVsOperating(bySite = [], byStore = []) {
  const operating = new Map()
  for (const r of bySite) {
    if (!r?.resolved) continue
    operating.set(String(r.site), Number(r.total) || 0)
  }
  return byStore
    .filter((r) => r?.store && r.store !== 'Not recorded')
    .map((r) => {
      const name = String(r.store)
      const issued = Number(r.total) || 0
      const worked = operating.has(name) ? operating.get(name) : null
      return {
        name,
        issued,
        worked,
        currency: r.currency || null,
        // null worked = no asset is registered at a site of this name at all,
        // which is a different statement from "no cost", so it is kept as null.
        gap: worked == null ? null : issued - worked,
      }
    })
    .sort((a, b) => Math.abs(b.gap ?? b.issued) - Math.abs(a.gap ?? a.issued))
}
