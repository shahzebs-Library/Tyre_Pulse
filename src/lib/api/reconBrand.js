/**
 * Brand data-quality service - the single Supabase boundary for the "Tyres
 * missing a brand" data-reconciliation section. Mirrors the sibling service
 * modules (dataReconciliation.js / adminAccess.js): thin, faithful queries over
 * `tyre_records` with `ServiceError` error surfacing on the write path (no raw
 * Supabase errors to callers) and honest empty results on the read paths.
 *
 * AUTH-SENSITIVE: reads are org-scoped by RLS on `tyre_records`; the brand
 * UPDATE relies on the existing elevated write policy on `tyre_records`
 * (Admin / Manager / Director). This layer never re-implements those gates - the
 * enforcement lives in Postgres.
 *
 * A "blank brand" is a tyre_records row whose `brand` is NULL or an empty string
 * (brand is unpopulated on UAE and Egypt fleets and a small slice of KSA). The
 * read paths (listBrandGapSummary / listBrandGapTyres) never throw: they return
 * [] on any error so the console degrades to an honest empty state. setTyreBrand
 * surfaces a ServiceError so the UI can report a failed mutation.
 */
import { supabase, ServiceError } from './_client'

/** Countries the fleet is partitioned across (per the `country` column). */
export const BRAND_GAP_COUNTRIES = ['KSA', 'UAE', 'Egypt']

// PostgREST `.or()` filter that matches a blank brand: NULL or empty string.
const BLANK_BRAND_FILTER = 'brand.is.null,brand.eq.'

/**
 * Per-country brand-gap summary: for each country, the count of tyre_records
 * with a blank brand and the total tyre count. Uses head-only exact-count
 * queries (no rows transferred). Never throws - returns [] on any error, and
 * silently skips a country whose count query fails.
 *
 * @returns {Promise<Array<{ country: string, missing: number, total: number }>>}
 */
export async function listBrandGapSummary() {
  try {
    const out = []
    for (const country of BRAND_GAP_COUNTRIES) {
      const totalRes = await supabase
        .from('tyre_records')
        .select('id', { count: 'exact', head: true })
        .eq('country', country)
      if (totalRes.error) continue

      const missingRes = await supabase
        .from('tyre_records')
        .select('id', { count: 'exact', head: true })
        .eq('country', country)
        .or(BLANK_BRAND_FILTER)
      if (missingRes.error) continue

      out.push({
        country,
        missing: Number(missingRes.count) || 0,
        total: Number(totalRes.count) || 0,
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * List tyre_records with a blank brand, optionally scoped to one country,
 * ordered by country then issue date and capped at `limit` rows. Never throws -
 * returns [] on any error.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.country]  a specific country, or omit / 'All' for all
 * @param {number}  [opts.limit=500]
 * @returns {Promise<Array<{
 *   id: string,
 *   serial_no: string,
 *   asset_no: string,
 *   size: string,
 *   site: string,
 *   country: string,
 *   issue_date: string
 * }>>}
 */
export async function listBrandGapTyres({ country, limit = 500 } = {}) {
  try {
    let query = supabase
      .from('tyre_records')
      .select('id,serial_no,asset_no,size,site,country,issue_date')
      .or(BLANK_BRAND_FILTER)

    if (country && country !== 'All') {
      query = query.eq('country', country)
    }

    query = query
      .order('country', { ascending: true })
      .order('issue_date', { ascending: true })
      .limit(limit)

    const { data, error } = await query
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * List ALL tyre_records with a blank brand for the given scope, for a bulk
 * "fill list" export the customer completes and re-imports into stg_tyre_brand.
 * Pages the full result set (there are ~1600 rows) via range so nothing is
 * truncated by PostgREST's default row cap. Ordered by country, asset, serial.
 * Never throws - returns [] on any error.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.country]  a specific country, or omit / 'All' for all
 * @returns {Promise<Array<{
 *   country: string,
 *   serial_no: string,
 *   asset_no: string,
 *   size: string,
 *   site: string,
 *   issue_date: string
 * }>>}
 */
export async function listBrandGapTyresAll({ country } = {}) {
  try {
    const PAGE = 1000
    const out = []
    for (let from = 0; ; from += PAGE) {
      let query = supabase
        .from('tyre_records')
        .select('country,serial_no,asset_no,size,site,issue_date')
        .or(BLANK_BRAND_FILTER)
        .not('serial_no', 'is', null)
        .neq('serial_no', '')

      if (country && country !== 'All') {
        query = query.eq('country', country)
      }

      query = query
        .order('country', { ascending: true })
        .order('asset_no', { ascending: true })
        .order('serial_no', { ascending: true })
        .range(from, from + PAGE - 1)

      const { data, error } = await query
      if (error) return out
      const batch = Array.isArray(data) ? data : []
      out.push(...batch)
      if (batch.length < PAGE) break
    }
    return out
  } catch {
    return []
  }
}

/**
 * Set the brand on a single tyre_records row. Trims the value; an empty brand is
 * a client-side validation error. Surfaces a ServiceError on an RLS/DB failure
 * so the UI can report the failed write.
 *
 * @param {string} id     the tyre_records uuid
 * @param {string} brand  the brand to set (trimmed, must be non-empty)
 * @returns {Promise<{ ok: true }>}
 */
export async function setTyreBrand(id, brand) {
  const value = typeof brand === 'string' ? brand.trim() : ''
  if (!value) throw new Error('Brand is required.')

  const { error } = await supabase
    .from('tyre_records')
    .update({ brand: value })
    .eq('id', id)

  if (error) throw new ServiceError(error.message, error.code, error)
  return { ok: true }
}
