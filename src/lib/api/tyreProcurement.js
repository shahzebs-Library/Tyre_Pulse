/**
 * Tyre procurement options service — the supplier quotes ("the deals") the Value
 * Advisor ranks by lifecycle cost-per-km. CRUD over public.tyre_procurement_options
 * (V249), org + country isolated by RLS; writes gated to elevated roles server-side.
 *
 * Pass-through style: each returns the raw Supabase query builder / promise the
 * caller reads via `.data` / `.error`. Country scoping mirrors tyreSpecs.js:
 * NULL-inclusive `.or(...)` so org-wide (country-null) quotes always show.
 * Explicit column lists throughout.
 */
import { supabase } from './_client'

const OPTION_COLS =
  'id, vehicle_type, position, brand, size, ply_rating, supplier, unit_price, currency, ' +
  'expected_life_km, retreadable, retread_count, retread_cost_pct, warranty_km, casing_value, ' +
  'notes, country, created_by, created_at, updated_at'

/**
 * List procurement quotes, NULL-inclusive country scoping when a real country is
 * active, ordered by vehicle_type, position, then unit_price ascending.
 * @param {{country?:string|null}} [opts]
 */
export function listOptions({ country } = {}) {
  let q = supabase.from('tyre_procurement_options').select(OPTION_COLS)
  if (country) q = q.or(`country.eq.${country},country.is.null`)
  return q
    .order('vehicle_type', { ascending: true })
    .order('position', { ascending: true })
    .order('unit_price', { ascending: true, nullsFirst: false })
}

/** Insert one procurement quote (whitelisted row built by the page). */
export function insertOption(row) {
  return supabase.from('tyre_procurement_options').insert(row)
}

/** Update a procurement quote by id. */
export function updateOption(id, row) {
  return supabase.from('tyre_procurement_options').update(row).eq('id', id)
}

/** Delete a procurement quote by id. */
export function deleteOption(id) {
  return supabase.from('tyre_procurement_options').delete().eq('id', id)
}
