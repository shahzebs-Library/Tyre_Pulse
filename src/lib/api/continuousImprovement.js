/**
 * Continuous Improvement service - the reads/writes the Continuous Improvement
 * screen consumes: the four datasets its opportunity analysis runs over
 * (tyre_records, corrective_actions, inspections, kpi_targets) and the
 * create/close corrective-action actions its recommendations trigger.
 *
 * Pass-through style: each returns the raw Supabase query builder (thenable) or
 * fetchAllPages promise the page reads via `.data` / `.error`, preserving the
 * page's `Promise.all`, destructuring and try/catch exactly. Country scoping is
 * STRICT `.eq('country', ...)` when a real country is active - replicated
 * verbatim from the page's local helper (`country !== 'All'`), NOT NULL-inclusive,
 * to avoid behaviour change. Explicit column lists throughout.
 */
import { supabase, fetchAllPages } from './_client'

/**
 * All tyre_records for the improvement analysis, fully paged, newest first,
 * strictly country-scoped (`.eq`) when a real country is active.
 * @param {{country?:string}} [opts]
 */
export function listImprovementTyreRecords({ country } = {}) {
  return fetchAllPages((from, to) => {
    let q = supabase
      .from('tyre_records')
      .select('id,asset_no,site,brand,position,risk_level,category,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,country')
      .order('issue_date', { ascending: false })
    if (country !== 'All') q = q.eq('country', country)
    return q.range(from, to)
  })
}

/**
 * Corrective actions (up to 2000, newest first) for the analysis, strictly
 * country-scoped (`.eq`) when a real country is active.
 * @param {{country?:string}} [opts]
 */
export function listImprovementActions({ country } = {}) {
  let q = supabase
    .from('corrective_actions')
    .select('id,title,site,status,priority,created_at,resolved_at,description,country')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (country !== 'All') q = q.eq('country', country)
  return q
}

/**
 * All inspections for the analysis, fully paged, newest scheduled first,
 * strictly country-scoped (`.eq`) when a real country is active.
 * @param {{country?:string}} [opts]
 */
export function listImprovementInspections({ country } = {}) {
  return fetchAllPages((from, to) => {
    let q = supabase
      .from('inspections')
      .select('id,asset_no,site,status,scheduled_date,completed_date,country')
      .order('scheduled_date', { ascending: false })
    if (country !== 'All') q = q.eq('country', country)
    return q.range(from, to)
  })
}

/** KPI targets (up to 500) for the target-vs-actual comparison. */
export function listImprovementKpiTargets() {
  return supabase.from('kpi_targets').select('metric,target_value,year,month,site').limit(500)
}

/** Insert a corrective action from an improvement recommendation. */
export function insertCorrectiveAction(row) {
  return supabase.from('corrective_actions').insert(row)
}

/**
 * Re-read corrective actions after a create (up to 2000, newest first). Mirrors
 * the page's refresh read exactly - no country column, no country filter.
 */
export function listCorrectiveActionsRefresh() {
  return supabase
    .from('corrective_actions')
    .select('id,title,site,status,priority,created_at,resolved_at,description')
    .order('created_at', { ascending: false })
    .limit(2000)
}

/** Close (update) a corrective action by id with the given patch. */
export function closeCorrectiveAction(id, patch) {
  return supabase.from('corrective_actions').update(patch).eq('id', id)
}
