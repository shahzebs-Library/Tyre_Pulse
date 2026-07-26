/**
 * Analytics reads - shared, read-only data access for the analytics/benchmark
 * pages (FleetAnalytics, CountryComparison, PerformanceBenchmark,
 * SafetyCompliance, ...). These pages historically consumed results via `.data`
 * (error-tolerant bulk loads), so each function returns the RAW Supabase /
 * fetchAllPages result the page reads via `.data` rather than throwing - the
 * behaviour is preserved exactly, only the table names/selects move behind here.
 */
import { supabase, fetchAllPages } from './_client'

const active = (c) => (c && c !== 'All' ? c : null)

/**
 * Every tyre_records column EXCEPT `extra_fields`.
 *
 * `extra_fields` is the jsonb copy of the whole original import row. It is 33%
 * of the table's on-disk bytes (1.37 MB of 4.15 MB) and NO analytics surface
 * renders it - the only consumers are the Custom Data Manager and
 * CustomFieldsPanel, which select it explicitly. Pulling it on a bulk analytics
 * load meant every one of these pages downloaded and parsed a third more data
 * than it could ever display, which is felt most on a phone.
 *
 * This is deliberately the FULL column list minus that one column, generated
 * from information_schema, so behaviour is otherwise identical to `select('*')`.
 * If a migration adds a tyre_records column that analytics needs, add it here.
 */
const TYRE_COLS_NO_EXTRA = [
  'id', 'sr', 'issue_date', 'description', 'brand', 'serial_no', 'qty', 'job_card',
  'mis_number', 'asset_no', 'site', 'remarks', 'remarks_cleaned', 'category',
  'risk_level', 'source_sheet', 'source_file', 'region', 'uploaded_by',
  'cost_per_tyre', 'cleaned', 'created_at', 'country', 'km_at_fitment',
  'km_at_removal', 'data_source', 'upload_batch_id', 'position', 'serial_number',
  'pressure_reading', 'tread_depth', 'size', 'driver_name', 'reason_for_removal',
  'removal_date', 'tyre_serial', 'supplier', 'asset_number', 'findings',
  'removal_reason', 'driver_id', 'tyre_position', 'vehicle_type', 'hrs_at_fitment',
  'hrs_at_removal', 'total_km', 'total_hrs', 'fitment_date', 'photos', 'status',
  'organisation_id', 'client_uuid',
].join(',')

/** report_asset_metrics RPC - per-asset aggregates. */
export function reportAssetMetrics({ country } = {}) {
  return supabase.rpc('report_asset_metrics', { p_country: country ?? 'All', p_from: null, p_to: null })
}

/** Raw tyre rows for one asset, newest first, country-scoped. */
export function listAssetTyreRecords({ assetNo, country } = {}) {
  let q = supabase.from('tyre_records').select(TYRE_COLS_NO_EXTRA).eq('asset_no', assetNo).order('issue_date', { ascending: false })
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
    let q = supabase.from('tyre_records').select(TYRE_COLS_NO_EXTRA).gte('created_at', since)
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
