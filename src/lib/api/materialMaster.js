/**
 * materialMaster.js — client boundary for the controlled material and service master
 * (V367).
 *
 * The master decides the cost category of a transaction. The free-text description
 * patterns are only a proposal for codes nobody has reviewed yet, so this surface is
 * where a human turns a guess into a decision that is recorded, attributable and
 * overrideable.
 *
 * KEYED PER COUNTRY, and every call must pass one. Item codes are NOT globally unique
 * in this data: 450115-O is "COMPRESSOR OIL 68" in KSA and "GREASE MISC ITEMS" in UAE.
 * A single-key master merged those into one row, which is the same cross-boundary merge
 * the expense identity was hardened against. The server refuses a set() without a
 * country for that reason.
 *
 * Pure logic lives in src/lib/materialMaster.js; this file only talks to the database.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

const COLS = 'id, country, item_code, item_name, category, subcategory, brand, uom, '
  + 'is_tyre, is_spare, is_lubricant, is_fuel, is_service, is_capital, '
  + 'reviewed, reviewed_by, reviewed_at, conflicting, proposed_from, '
  + 'txn_rows, txn_value, notes, updated_at'

/**
 * List master entries. Defaults to the highest-value codes first, because that is the
 * order a reviewer should work in: reviewing the top 200 codes by value covers far more
 * money than reviewing 200 alphabetically.
 *
 * @param {object} [opts]
 * @param {string} [opts.country]     filter to one country
 * @param {string} [opts.category]    filter to one category
 * @param {string} [opts.search]      match item code or name
 * @param {boolean} [opts.reviewedOnly]
 * @param {boolean} [opts.unreviewedOnly]
 * @param {boolean} [opts.conflictingOnly]
 * @param {number} [opts.limit=200]
 * @returns {Promise<Array<object>>} [] when the table is absent (pre-migration)
 */
export async function listMaterials(opts = {}) {
  const {
    country, category, search, reviewedOnly, unreviewedOnly, conflictingOnly, limit = 200,
  } = opts
  try {
    let q = supabase.from('material_master').select(COLS)
    if (country) q = q.eq('country', country)
    if (category) q = q.eq('category', category)
    if (reviewedOnly) q = q.eq('reviewed', true)
    if (unreviewedOnly) q = q.eq('reviewed', false)
    if (conflictingOnly) q = q.eq('conflicting', true)
    if (search && String(search).trim()) {
      const s = sanitizeSearch(search)
      if (s) q = q.or(`item_code.ilike.%${s}%,item_name.ilike.%${s}%`)
    }
    const { data, error } = await q
      .order('txn_value', { ascending: false })
      .limit(Math.max(1, Math.min(Number(limit) || 200, 2000)))
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Strip characters that would change the meaning of a PostgREST `or` filter.
 * Commas and parentheses are the separators of that syntax; a backslash escapes.
 */
function sanitizeSearch(term) {
  return String(term || '').replace(/[,()\\%]/g, '').trim().slice(0, 80)
}

/**
 * Rebuild the proposals from the transactions. Safe to run repeatedly: a REVIEWED row
 * keeps every human decision and only its row/value counts refresh.
 * @returns {Promise<{ok:boolean, inserted:number, updated:number, conflicting:number}>}
 */
export async function deriveMaterials() {
  const { data, error } = await supabase.rpc('material_master_derive')
  if (error) throw new Error(toUserMessage(error, 'Could not refresh the material master.'))
  return data || { ok: false, inserted: 0, updated: 0, conflicting: 0 }
}

/**
 * Record a decision for one item. Marks it reviewed and stamps who decided, so the
 * classification of any transaction using this code becomes attributable.
 *
 * @param {object} entry
 * @param {string} entry.country   REQUIRED, see the module note on code collisions
 * @param {string} entry.item_code
 * @param {string} entry.category
 * @param {string} [entry.subcategory]
 * @param {string} [entry.brand]
 * @param {string} [entry.uom]
 * @param {string} [entry.notes]
 * @param {boolean} [entry.reviewed=true]
 */
export async function setMaterial(entry = {}) {
  const { data, error } = await supabase.rpc('material_master_set', {
    p_country: entry.country || null,
    p_item_code: entry.item_code || null,
    p_category: entry.category || null,
    p_subcategory: entry.subcategory ?? null,
    p_brand: entry.brand ?? null,
    p_uom: entry.uom ?? null,
    p_notes: entry.notes ?? null,
    p_reviewed: entry.reviewed !== false,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not save that item.'))
  return data || null
}

/**
 * How much of the MONEY is classified by a human decision rather than a text pattern.
 * That is the honest progress figure: reviewing 100 high-value codes moves it far more
 * than reviewing 1,000 trivial ones.
 * @returns {Promise<object>} {} when unavailable
 */
export async function materialCoverage() {
  const { data, error } = await supabase.rpc('material_master_coverage')
  if (error) return {}
  return data || {}
}

/**
 * Every transaction row behind one master entry, so a reviewer can see what they are
 * deciding about instead of trusting a single sample description.
 * @param {string} country
 * @param {string} itemCode
 * @param {number} [limit=50]
 */
export async function listMaterialTransactions(country, itemCode, limit = 50) {
  try {
    const { data, error } = await supabase
      .from('parts_consumption')
      .select('item_description, cost_category, qty, line_cost, currency, site, event_date, work_order_no')
      .eq('country', country)
      .eq('item_code', itemCode)
      .order('line_cost', { ascending: false })
      .limit(Math.max(1, Math.min(Number(limit) || 50, 500)))
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
