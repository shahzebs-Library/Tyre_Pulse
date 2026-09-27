/**
 * advancedSearchAnalytics - pure presentation engine for the Advanced Search
 * page (/advanced-search). Saved-search roll-ups (summariseSearches,
 * groupByEntity) live in `./advancedSearch.js` and are REUSED here. This module
 * only shapes data for the page: library filters, the KPI strip with honest
 * nulls, the live-result summary, the library table rows and the export rows.
 *
 * No I/O and no clock read: `nowMs` is injected wherever age matters.
 *
 * HONEST NULLS. A search that has never been run has an UNKNOWN result count,
 * never 0 - zero would read as "this query finds nothing". And when no saved
 * search carries a recorded count, the "last recorded matches" tile is N/A.
 */
import { summariseSearches, groupByEntity, toFiniteNumber } from './advancedSearch'

export { groupByEntity }

const DAY_MS = 86_400_000
/** A saved search not run for this many days is "stale". */
export const STALE_DAYS = 30

export const ENTITY_LABELS = Object.freeze({
  all: 'All entities', assets: 'Assets', tyres: 'Tyres', work_orders: 'Work orders', inspections: 'Inspections',
})
export const ENTITY_SHORT = Object.freeze({
  all: 'All', assets: 'Assets', tyres: 'Tyres', work_orders: 'Work orders', inspections: 'Inspections',
})
export const entityShort = (e) => ENTITY_SHORT[e] || (e ? String(e) : 'All')

export const EMPTY_LIBRARY_FILTERS = Object.freeze({ search: '', entity: '', pinnedOnly: false, runState: '' })

export function activeLibraryFilterCount(f = {}) {
  return (String(f.search || '').trim() ? 1 : 0) + (f.entity ? 1 : 0) + (f.pinnedOnly ? 1 : 0) + (f.runState ? 1 : 0)
}

/** Days since a saved search was last run, or null when it never has been. */
export function daysSinceRun(row, nowMs) {
  if (!row?.last_run_at) return null
  const t = new Date(row.last_run_at).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((Number(nowMs) - t) / DAY_MS))
}

/** 'never' | 'stale' | 'recent' */
export function runState(row, nowMs) {
  const d = daysSinceRun(row, nowMs)
  if (d == null) return 'never'
  return d > STALE_DAYS ? 'stale' : 'recent'
}

/**
 * Filter the saved-search library. Search matches name, query, notes and
 * entity. Pinned searches float to the top, then most recently run.
 */
export function filterSavedSearches(rows = [], f = {}, nowMs) {
  const q = String(f.search || '').trim().toLowerCase()
  const out = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false
    if (f.entity && r.entity !== f.entity) return false
    if (f.pinnedOnly && !r.pinned) return false
    if (f.runState && runState(r, nowMs) !== f.runState) return false
    if (q) {
      const hay = [r.name, r.query_text, r.notes, r.entity].map((x) => (x == null ? '' : String(x))).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  return out.sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned))
    || ((new Date(b.last_run_at || 0).getTime() || 0) - (new Date(a.last_run_at || 0).getTime() || 0))
    || String(a.name || '').localeCompare(String(b.name || '')))
}

/** KPI strip over the saved library. */
export function savedSearchKpis(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows : []
  const s = summariseSearches(list)
  const recorded = list.filter((r) => toFiniteNumber(r?.result_count) != null).length
  const neverRun = list.filter((r) => runState(r, nowMs) === 'never').length
  const stale = list.filter((r) => runState(r, nowMs) === 'stale').length
  return {
    ...s,
    recordedCount: recorded,
    lastRecordedMatches: recorded ? s.totalResultsIndexed : null,
    neverRun,
    stale,
  }
}

/**
 * Summarise one live global-search response for the result header.
 *   total       rows returned across groups
 *   matches     server total, or null when the total could not be counted
 *   failed      group keys that could not be checked (the search is incomplete)
 *   perGroup    [{ key, shown, truncated, count }]
 */
export function resultSummary(results, groupKeys = []) {
  if (!results) return null
  const perGroup = groupKeys.map((key) => {
    const list = Array.isArray(results[key]) ? results[key] : []
    const cov = results.coverage?.[key] || {}
    return { key, shown: list.length, truncated: !!cov.truncated, count: cov.count ?? null }
  })
  const failed = Object.keys(results.errors || {}).filter((k) => results.errors[k])
  return {
    total: Number(results.total) || perGroup.reduce((s, g) => s + g.shown, 0),
    matches: results.totalMatches ?? null,
    complete: !!results.complete && failed.length === 0,
    failed,
    perGroup,
  }
}

export function savedTableRows(rows = [], nowMs) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    _entity: entityShort(r.entity),
    _results: toFiniteNumber(r.result_count),
    _daysSinceRun: daysSinceRun(r, nowMs),
    _runState: runState(r, nowMs),
  }))
}

export const SAVED_EXPORT_COLUMNS = Object.freeze([
  ['name', 'Name'], ['entity', 'Entity'], ['query_text', 'Query'], ['result_count', 'Last results'],
  ['pinned', 'Pinned'], ['last_run_at', 'Last run'], ['run_state', 'Run state'], ['notes', 'Notes'],
])

const RUN_STATE_LABEL = { never: 'Never run', stale: `Not run in ${STALE_DAYS}+ days`, recent: 'Recent' }
export const runStateLabel = (s) => RUN_STATE_LABEL[s] || ''

export function savedExportRows(rows = [], nowMs) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    name: r.name || '',
    entity: entityShort(r.entity),
    query_text: r.query_text || '',
    result_count: toFiniteNumber(r.result_count) ?? '',
    pinned: r.pinned ? 'Yes' : 'No',
    last_run_at: r.last_run_at ? String(r.last_run_at).replace('T', ' ').slice(0, 16) : '',
    run_state: runStateLabel(runState(r, nowMs)),
    notes: r.notes || '',
  }))
}
