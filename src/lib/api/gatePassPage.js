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

/**
 * Distinct-site source list for the site filter (non-null sites only). PAGED:
 * an unbounded read returns at most 1000 of the 1,617 fleet rows, so sites
 * belonging only to assets outside that page never reached the filter. `id` is
 * the paging tiebreak - site repeats heavily.
 */
export function listGatePassSites() {
  return fetchAllPages(
    (from, to) => supabase.from('vehicle_fleet').select('site')
      .not('site', 'is', null).order('site').order('id').range(from, to),
    { max: 20000 },
  )
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

/**
 * Gate passes across an inclusive pass_date range (newest first), optionally
 * narrowed to a site. Drives the redesigned page's date-range navigator.
 */
export function listGatePassesRange({ from, to, site } = {}) {
  return fetchAllPages((f, t) => {
    let q = supabase.from('gate_passes').select('*').gte('pass_date', from).lte('pass_date', to)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(f, t)
    if (site) q = q.eq('site', site)
    return q
  }, { max: 20000 })
}

/**
 * Fleet register rows (asset, class, make, model, site) for the asset picker
 * and the vehicle pictures. PAGED past the 1000-row response cap; `id` is the
 * tiebreak because asset_no is unique per country, not globally.
 */
export function listGateFleet() {
  return fetchAllPages(
    (from, to) => supabase.from('vehicle_fleet').select('id, asset_no, vehicle_type, make, model, site, country')
      .order('asset_no').order('id').range(from, to),
    { max: 20000 },
  )
}

/** Display names for the people recorded on passes (one read, ids chunked). */
export async function listActorNames(ids = []) {
  const list = [...new Set(ids.filter(Boolean))]
  const out = {}
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', list.slice(i, i + 200))
    if (error) throw error
    for (const r of data || []) if (r.full_name) out[r.id] = r.full_name
  }
  return out
}

/** Update one gate pass (status moves and custom_data stamps). */
export function updateGatePass(id, patch) {
  return supabase.from('gate_passes').update(patch).eq('id', id)
}
