/**
 * Budgets service - budgets records, plus the supporting tyre_records spend read
 * the Budgets page needs. Explicit column lists (no SELECT *); additive, mirrors
 * kpiTargets.js / correctiveActions.js.
 *
 * The Budgets page's initial load historically ignored query errors (bulk
 * analytics loads via `.data`), so `listBudgets` and `listBudgetTyreRecords`
 * return the raw Supabase / fetchAllPages result the page consumes via `.data`
 * rather than throwing. The upsert/update helpers used at explicit user-driven
 * save points; `updateBudgetStatus` throws ServiceError via `unwrap`, while the
 * upserts stay non-throwing to match the page's prior fire-and-forget saves
 * (`save` reads `.error` directly; `savePlannerEdits` ignored the result).
 */
import { supabase, unwrap, fetchAllPages } from './_client'

// Least-privilege column set for budgets. Live columns:
// id,site,region,monthly_budget,year,month,created_by,created_at,country,status,
// organisation_id. The page reads/writes site, region, monthly_budget, year,
// month, status, id; organisation_id is RLS-managed and never touched here, so
// the page's prior `select('*')` is narrowed to the columns actually consumed.
const BUDGET_COLS =
  'id,site,region,monthly_budget,year,month,created_by,created_at,country,status'

// Column set for the tyre_records spend read - EXACTLY the page's select.
const TYRE_RECORD_COLS = 'site, cost_per_tyre, qty, issue_date'

/**
 * List budgets for a year (and optional month), ordered by site. Applies the
 * SAME country predicate the page's local `flt()` applied: strict
 * `.eq('country', country)` when a real country is active, no filter for
 * 'All'/empty. Non-throwing: returns the raw Supabase result the page consumes
 * via `.data` so the error-tolerant load keeps working.
 * @param {{country?:string, year:number, month?:number}} opts
 */
export async function listBudgets({ country, year, month } = {}) {
  let q = supabase.from('budgets').select(BUDGET_COLS).eq('year', year)
  if (month != null) q = q.eq('month', month)
  q = q.order('site')
  if (country && country !== 'All') q = q.eq('country', country)
  return q
}

/**
 * Upsert a single budget row on the conflict target the page relied on:
 * (site, region, year, month). Non-throwing: returns the raw Supabase result so
 * the page's `save` can read `.error` directly and surface it inline.
 * @param {object} row
 */
export async function upsertBudget(row) {
  return supabase.from('budgets').upsert(row, { onConflict: 'site,region,year,month' })
}

/**
 * Bulk-upsert budget rows on the conflict target the page relied on:
 * (site, region, year, month). Non-throwing to match the page's prior
 * fire-and-forget planner save.
 * @param {object[]} rows
 */
export async function upsertBudgets(rows) {
  return supabase.from('budgets').upsert(rows, { onConflict: 'site,region,year,month' })
}

/** Update a budget's status by id. Throws ServiceError on failure. */
export async function updateBudgetStatus(id, status) {
  return unwrap(await supabase.from('budgets').update({ status }).eq('id', id))
}

/**
 * List tyre_records spend inside an [start, end) issue_date window, paged past
 * the PostgREST cap. Applies the SAME strict country predicate as the page's
 * local `flt()`. Returns the fetchAllPages result the page consumes via `.data`.
 * @param {{country?:string, start:string, end:string}} opts
 */
export async function listBudgetTyreRecords({ country, start, end } = {}) {
  const active = country && country !== 'All' ? country : null
  return fetchAllPages((from, to) => {
    let q = supabase
      .from('tyre_records')
      .select(TYRE_RECORD_COLS)
      .gte('issue_date', start)
      .lt('issue_date', end)
    if (active) q = q.eq('country', active)
    return q.range(from, to)
  })
}
