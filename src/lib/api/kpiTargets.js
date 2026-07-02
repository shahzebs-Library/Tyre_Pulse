/**
 * KPI Targets service - kpi_targets records, plus the two supporting reads the
 * KPI Scorecard page needs (tyre_records + open corrective_actions). Explicit
 * column lists (no SELECT *); additive, mirrors correctiveActions.js.
 *
 * The KPI Scorecard's initial load historically ignored query errors (bulk
 * analytics loads), so the load/upsert helpers here return the raw Supabase
 * `{ data, error }`-shaped result the page consumes (`.data`) rather than
 * throwing. The get/update helpers throw ServiceError via `unwrap` for call
 * sites that surface errors.
 */
import { supabase, unwrap, fetchAllPages } from './_client'

// Least-privilege column set for kpi_targets. Live columns:
// id,metric,target_value,year,month,site,region,created_by,updated_at,country,
// target,unit. The page reads metric + target_value; the rest are carried for
// list/edit round-trips and the upsert conflict target (metric,year,month,site).
const KPI_TARGET_COLS =
  'id,metric,target_value,year,month,site,region,created_by,updated_at,country,target,unit'

// Column set for the tyre_records analytics read - EXACTLY the page's select.
const TYRE_RECORD_COLS =
  'id,issue_date,risk_level,cost_per_tyre,qty,created_at,country,site'

// Column set for the open corrective_actions read - EXACTLY the page's select.
const OPEN_ACTION_COLS = 'id,due_date,status,country'

/**
 * List KPI targets for a given year. Non-throwing: returns the raw Supabase
 * result (`{ data, error }`) so the page's error-tolerant load keeps working.
 * @param {{year:number}} opts
 */
export async function listKpiTargets({ year }) {
  return supabase.from('kpi_targets').select(KPI_TARGET_COLS).eq('year', year)
}

/**
 * Upsert KPI target rows. Preserves the exact conflict target the page relied
 * on: (metric, year, month, site). Non-throwing to match the page's prior
 * fire-and-forget save.
 * @param {object[]} rows
 */
export async function upsertKpiTargets(rows) {
  return supabase.from('kpi_targets').upsert(rows, { onConflict: 'metric,year,month,site' })
}

/** Get one KPI target by id (or null). Throws ServiceError on failure. */
export async function getKpiTarget(id) {
  return unwrap(await supabase.from('kpi_targets').select(KPI_TARGET_COLS).eq('id', id).maybeSingle())
}

/** Update a KPI target by id. Throws ServiceError on failure. */
export async function updateKpiTarget(id, patch) {
  return unwrap(await supabase.from('kpi_targets').update(patch).eq('id', id))
}

/**
 * List tyre_records for KPI analytics, paged past the PostgREST cap. Applies
 * the SAME country predicate the page's local `flt()` applied: strict
 * `.eq('country', country)` when a real country is active, no filter for
 * 'All'/empty. Returns the fetchAllPages `{ data, error, truncated }` result
 * the page consumes via `.data`.
 * @param {{country?:string}} [opts]
 */
export async function listKpiTyreRecords({ country } = {}) {
  const active = country && country !== 'All' ? country : null
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select(TYRE_RECORD_COLS).order('issue_date')
    if (active) q = q.eq('country', active)
    return q.range(from, to)
  }, { max: 200000 })
}

/**
 * List tyre_records inside a specific issue_date window (YoY comparison), paged
 * past the PostgREST cap. Same strict country predicate as the page's `flt()`.
 * @param {{start:string,end:string,country?:string}} opts
 */
export async function listKpiTyreRecordsInRange({ start, end, country } = {}) {
  const active = country && country !== 'All' ? country : null
  return fetchAllPages((from, to) => {
    let q = supabase
      .from('tyre_records')
      .select(TYRE_RECORD_COLS)
      .gte('issue_date', start)
      .lte('issue_date', end)
    if (active) q = q.eq('country', active)
    return q.range(from, to)
  }, { max: 200000 })
}

/**
 * List open (non-Closed) corrective_actions. Applies the SAME country predicate
 * the page's `flt()` applied (strict `.eq('country', country)` when active).
 * Non-throwing: returns the raw Supabase result the page consumes via `.data`.
 * @param {{country?:string}} [opts]
 */
export async function listOpenCorrectiveActions({ country } = {}) {
  let q = supabase.from('corrective_actions').select(OPEN_ACTION_COLS).neq('status', 'Closed')
  if (country && country !== 'All') q = q.eq('country', country)
  return q
}
