/**
 * Gate Pass page reads/writes - the exact inline Supabase queries the gate
 * station screen consumes (site list, today's/historical pass log, clearance
 * lookup, denial insert).
 *
 * The safety-gated clearance issue path stays on the existing `gatePasses`
 * service module (createGatePass / listGatePassBlockers) and is untouched here;
 * this module only extracts the page's remaining inline queries. Read-only
 * pass-throughs return the raw query builder the page reads via `.data`.
 */
import { supabase, fetchAllPages } from './_client'

/** Distinct-site source list for the site filter (non-null sites only). */
export function listGatePassSites() {
  return supabase.from('vehicle_fleet').select('site').not('site', 'is', null)
}

/**
 * Gate passes for a given pass_date (newest first), optionally narrowed to a
 * site. Powers both the live "today" log and the historical date view.
 */
export function listGatePasses({ date, site } = {}) {
  return fetchAllPages((from, to) => {
    let q = supabase.from('gate_passes').select('*').eq('pass_date', date)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)
    if (site) q = q.eq('site', site)
    return q
  })
}

/**
 * Most recent completed/in-progress inspection for an asset on a given day,
 * used to gate manual clearance. Mirrors the page's exact filter chain.
 */
export function findAssetInspectionForClearance({ assetNo, date } = {}) {
  return supabase
    .from('inspections')
    .select('id, inspection_type, scheduled_date, inspector, created_at, status, site')
    .eq('asset_no', assetNo)
    .gte('scheduled_date', date)
    .lte('scheduled_date', date)
    .in('status', ['Done', 'In Progress'])
    .order('created_at', { ascending: false })
    .limit(1)
}

/** Insert a gate pass row directly (denials / non-cleared - never safety-blocked). */
export function insertGatePass(values) {
  return supabase.from('gate_passes').insert(values)
}
