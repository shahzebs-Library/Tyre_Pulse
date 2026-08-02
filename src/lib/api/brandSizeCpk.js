/**
 * brandSizeCpk.js - client boundary for the brand + price + CPK comparison BY
 * TYRE SIZE (RPC get_brand_size_cpk, V446).
 *
 * The RPC returns a jsonb ARRAY of rows, one per (country, size, brand):
 *   { size, brand, tyres, avg_price, median_price, avg_life_km,
 *     cpk (avg_price/avg_life_km, NULL when no life), currency, country }
 * Currency is per country (never blended); cpk is NULL when life km is 0.
 *
 * The value maths (rank by CPK, best-value / cheapest flags, the plain-English
 * recommendation) lives in the pure engine src/lib/brandSizeCpk.js. This file
 * only talks to the database and DEGRADES to [] on any failure - a missing
 * function (org not migrated), an empty result or any error becomes an empty
 * array so the page renders an honest empty state instead of throwing.
 */
import { supabase } from './_client'

/**
 * Fetch per-size, per-brand price + CPK rows for the value comparison.
 *
 * @param {{ country?:string, from?:string, to?:string }} [opts]
 *   country: a single country ('KSA'/'UAE'/'Egypt') or 'All'/null for every one.
 *   from/to: ISO YYYY-MM-DD bounds on the tyre's issue/fitment/removal date.
 * @returns {Promise<Array<object>>} raw RPC rows. Always resolves, never rejects.
 */
export async function getBrandSizeCpk({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_brand_size_cpk', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    if (error || !Array.isArray(data)) return []
    return data
  } catch {
    return []
  }
}
