/**
 * Store -> Site expense (V358) - per-SITE parts/maintenance expense.
 *
 * The parts_consumption grid records the ERP `store_code`, which does not match
 * the app's governed `sites` vocabulary. `store_site_map` (seeded with the exact
 * matches, the rest mapped by an admin) resolves each store_code to a site so the
 * Expense Report can show a real "By site" breakdown instead of falling back to
 * legacy sources. Store codes with no mapping surface as 'Unmapped: <store_code>'.
 *
 * @module api/storeSiteExpense
 */
import { supabase } from './_client'

/**
 * Per-site expense (tyre / spare / oil / total / lines) for a country + date
 * window, mapped via store_site_map. Never throws - returns [] on any error so
 * the page degrades to an honest empty state.
 *
 * @param {{ country?:string, from?:string, to?:string }} [opts]
 * @returns {Promise<Array<{site:string, tyre:number, spare:number, oil:number, total:number, lines:number}>>}
 */
export async function getExpenseBySite({ country, from, to } = {}) {
  const { data, error } = await supabase.rpc('get_expense_by_site', {
    p_country: country && country !== 'All' ? country : null,
    p_from: from || null,
    p_to: to || null,
  })
  if (error) return []
  return Array.isArray(data) ? data : []
}

/**
 * Upsert one store_code -> site mapping (elevated roles only, enforced in the
 * RPC + RLS). Throws on error so the caller can surface it.
 *
 * @param {{ country?:string, store_code:string, site:string }} params
 */
export async function setStoreSiteMap({ country, store_code, site } = {}) {
  const { error } = await supabase.rpc('set_store_site_map', {
    p_country: country && country !== 'All' ? country : null,
    p_store_code: store_code,
    p_site: site,
  })
  if (error) throw error
  return true
}

/**
 * Governed site names for a country (org-scoped) - the option list the inline
 * mapping picker offers. Never throws; returns [] on error.
 *
 * @param {{ country?:string }} [opts]
 * @returns {Promise<Array<string>>}
 */
export async function listSites({ country } = {}) {
  let q = supabase.from('sites').select('id,name,country').order('name')
  if (country && country !== 'All') q = q.eq('country', country)
  const { data, error } = await q
  if (error) return []
  return (Array.isArray(data) ? data : []).map((r) => r?.name).filter(Boolean)
}
