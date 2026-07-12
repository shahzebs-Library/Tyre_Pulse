/**
 * Tyre Pool service — reads the candidate tyre records for the Tyre Pool screen
 * (unfitted / available spare stock). Ported (backend-logic side) from tyre_saas
 * and wired to Tyre Pulse's `tyre_records`. Country-scoped (null-safe) and fully
 * paginated so large fleets are never silently truncated.
 *
 * The pool DEFINITION (which of these rows are actually "in the pool") lives in
 * the pure, unit-tested `src/lib/tyrePool.js` and runs client-side — the status
 * vocabulary varies across imported datasets, so filtering there keeps the rule
 * in one auditable place rather than encoding a brittle status list in SQL.
 */
import { supabase, applyCountry, fetchAllPages } from './_client'

// Explicit least-privilege column list (no SELECT *). Includes the fields the
// pure pool filter and the page's KPIs / table / export need.
const COLS =
  'id,serial_no,serial_number,tyre_serial,brand,size,asset_no,site,region,country,' +
  'status,position,tyre_position,cost_per_tyre,tread_depth,category,risk_level,' +
  'km_at_removal,fitment_date,removal_date,issue_date'

/**
 * Every candidate tyre record in scope for the pool view, paginated. The client
 * narrows these to actual pool tyres via `summarizePool` / `isPoolTyre`.
 * @param {{ country?:string }} [opts]
 */
export async function listPoolCandidates({ country } = {}) {
  return fetchAllPages((from, to) => {
    const q = supabase.from('tyre_records').select(COLS)
      .order('brand', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}
