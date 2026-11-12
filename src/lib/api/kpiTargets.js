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
import { supabase, unwrap, fetchAllPages, ServiceError } from './_client'
import { expectRows } from './writeGuard'

// Least-privilege column set for kpi_targets. Live columns:
// id,metric,target_value,year,month,site,region,created_by,updated_at,country,
// target,unit. The page reads metric + target_value; the rest are carried for
// list/edit round-trips. Saving matches the stored row in code (saveKpiTargets).
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

const lc = (v) => String(v ?? '').trim().toLowerCase()
const numOrNull = (v) => (v == null || v === '' ? null : Number(v))

/**
 * Does a stored target row sit in the same scope as the row being saved?
 * The scope is the one the database's own uniqueness rule uses: metric, year,
 * month (blank counts as "whole year"), site (blank counts as "all sites") and
 * country. A row to save that names no country matches on the other four.
 */
export function sameTargetScope(stored, row) {
  if (stored.metric !== row.metric) return false
  if (Number(stored.year) !== Number(row.year)) return false
  if (numOrNull(stored.month) !== numOrNull(row.month)) return false
  if (lc(stored.site) !== lc(row.site)) return false
  if (row.country != null && row.country !== '' && lc(stored.country) !== lc(row.country)) return false
  return true
}

/**
 * Save KPI target rows: update the stored target in the same scope, insert when
 * there is none.
 *
 * WHY THIS IS NOT AN UPSERT. It used to be
 * `upsert(rows, { onConflict: 'metric,year,month,site' })`. Targets are saved
 * with month and site blank (NULL), and in a unique constraint NULL never
 * equals NULL, so the conflict target could not match the row saved last time.
 * Every save after the first became a fresh INSERT, which the second unique
 * index (the one that treats blank as a value) then refused as a duplicate.
 * The first save of a year worked and every later one failed. Matching the
 * stored row here and updating it by id does not depend on either index.
 *
 * Non-throwing, like its predecessor: resolves to `{ data, error }` where
 * `data` is `{ updated, inserted }`. A refused update (zero rows changed) is
 * returned as an error, never counted as saved.
 * @param {object[]} rows
 */
export async function saveKpiTargets(rows) {
  const list = (rows || []).filter((r) => r && r.metric)
  const done = { updated: 0, inserted: 0 }
  if (!list.length) return { data: done, error: null }
  try {
    const years = [...new Set(list.map((r) => Number(r.year)).filter(Number.isFinite))]
    const stored = []
    for (const year of years) {
      stored.push(...(unwrap(await supabase.from('kpi_targets')
        .select('id,metric,year,month,site,country').eq('year', year)) || []))
    }
    for (const row of list) {
      const matches = stored.filter((s) => sameTargetScope(s, row))
      if (matches.length > 1) {
        throw new ServiceError(
          `More than one target is stored for ${row.metric} in ${row.year}. Choose a country and save again.`)
      }
      if (matches.length === 1) {
        // Never rewrite who first created the target, and never move its scope.
        const { created_by: _creator, metric: _m, year: _y, ...patch } = row
        expectRows(
          await supabase.from('kpi_targets').update(patch).eq('id', matches[0].id).select('id'),
          'The targets were not saved. Only a Manager or an Admin can change KPI targets.',
        )
        done.updated += 1
      } else {
        const inserted = expectRows(
          await supabase.from('kpi_targets').insert(row).select('id,metric,year,month,site,country'),
          'The targets were not saved. Only a Manager or an Admin can set KPI targets.',
        )
        // A second row for the same scope later in this save updates this one.
        stored.push(...inserted)
        done.inserted += 1
      }
    }
    return { data: done, error: null }
  } catch (error) {
    return { data: done, error }
  }
}

/**
 * Kept under its old name for existing callers. It no longer upserts: see
 * saveKpiTargets for why an upsert could never save a target twice.
 * @param {object[]} rows
 */
export async function upsertKpiTargets(rows) {
  return saveKpiTargets(rows)
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
 *
 * `from`/`to` bound `issue_date` SERVER-side and are OPTIONAL: omitted, the read
 * is the all-time one it has always been, so no caller changes behaviour by
 * upgrading. They exist because this read carries a 200k ceiling and no date
 * predicate at all - every tyre record ever, over ~9-11 paged requests, on every
 * visit - and the scorecard only ever charts a window of it.
 * @param {{country?:string, from?:string, to?:string}} [opts]
 */
export async function listKpiTyreRecords({ country, from: fromDate, to: toDate } = {}) {
  const active = country && country !== 'All' ? country : null
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select(TYRE_RECORD_COLS).order('issue_date')
    if (active) q = q.eq('country', active)
    if (fromDate) q = q.gte('issue_date', fromDate)
    if (toDate) q = q.lte('issue_date', toDate)
    return q.order('id', { ascending: true }).range(from, to)
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
    return q.order('id', { ascending: true }).range(from, to)
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
