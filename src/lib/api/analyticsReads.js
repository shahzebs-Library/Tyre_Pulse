/**
 * Analytics reads — shared, read-only data access for the analytics/benchmark
 * pages (FleetAnalytics, CountryComparison, PerformanceBenchmark,
 * SafetyCompliance, …). These pages historically consumed results via `.data`
 * (error-tolerant bulk loads), so each function returns the RAW Supabase /
 * fetchAllPages result the page reads via `.data` rather than throwing — the
 * behaviour is preserved exactly, only the table names/selects move behind here.
 */
import { supabase, fetchAllPages } from './_client'

const active = (c) => (c && c !== 'All' ? c : null)

/** report_asset_metrics RPC — per-asset aggregates. */
export function reportAssetMetrics({ country } = {}) {
  return supabase.rpc('report_asset_metrics', { p_country: country ?? 'All', p_from: null, p_to: null })
}

/** Raw tyre rows for one asset, newest first, country-scoped. */
export function listAssetTyreRecords({ assetNo, country } = {}) {
  let q = supabase.from('tyre_records').select('*').eq('asset_no', assetNo).order('issue_date', { ascending: false })
  if (active(country)) q = q.eq('country', country)
  return q
}

/** report_country_metrics RPC. */
export function reportCountryMetrics({ from, to } = {}) {
  return supabase.rpc('report_country_metrics', { p_from: from || null, p_to: to || null })
}

/** report_country_trends RPC. */
export function reportCountryTrends({ from, to } = {}) {
  return supabase.rpc('report_country_trends', { p_from: from || null, p_to: to || null })
}

/** Brief corrective-action fields used for country rollups. */
export function listCorrectiveActionsBrief() {
  return supabase.from('corrective_actions').select('id,country,status,due_date,priority')
}

/** All tyre_records since an ISO timestamp (paged), country-scoped. */
export function listTyreRecordsSince({ country, since, max = 200000 } = {}) {
  const c = active(country)
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select('*').gte('created_at', since)
    if (c) q = q.eq('country', c)
    return q.range(from, to)
  }, { max })
}

/** All inspections since an ISO date (paged). */
export function listInspectionsSince({ since, max = 200000 } = {}) {
  return fetchAllPages((from, to) => supabase.from('inspections').select('*').gte('inspection_date', since).range(from, to), { max })
}

/** All accidents since an ISO date. */
export function listAccidentsSince({ since } = {}) {
  return supabase.from('accidents').select('*').gte('incident_date', since)
}
