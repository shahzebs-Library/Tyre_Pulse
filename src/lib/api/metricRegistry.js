/**
 * Metric Registry / "Explain This Number" service (V473) - the single Supabase
 * boundary for the metric-definition + lineage + provenance system. Mirrors the
 * sibling service modules (tyreLearning.js / dataReconciliation.js): thin,
 * faithful pass-throughs over the registry tables and the security-definer RPCs.
 *
 * AUTH-SENSITIVE: metric_registry / metric_versions are authenticated-read (RLS);
 * explain_metric / get_record_provenance self-gate and are org-scoped in the DB.
 * This layer never re-implements the gate.
 *
 * Read paths never throw: they return [] / { metric:null } / { ok:false } on any
 * error so the console degrades to an honest empty state. The Admin-only write
 * paths (upsertMetric / saveMetricVersion) surface the error via `unwrap`.
 */
import { supabase, unwrap } from './_client'

/**
 * All active metric registry rows, ordered by metric_id. Never throws (returns
 * [] on error).
 *
 * @returns {Promise<Array<object>>}
 */
export async function listMetrics() {
  try {
    const { data, error } = await supabase
      .from('metric_registry')
      .select('*')
      .eq('active', true)
      .order('metric_id')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * A single registry row plus its versions (newest version first). Never throws:
 * returns { metric:null, versions:[] } on any error.
 *
 * @param {string} metricId
 * @returns {Promise<{ metric: object|null, versions: object[] }>}
 */
export async function getMetric(metricId) {
  try {
    const [regRes, verRes] = await Promise.all([
      supabase.from('metric_registry').select('*').eq('metric_id', metricId).maybeSingle(),
      supabase
        .from('metric_versions')
        .select('*')
        .eq('metric_id', metricId)
        .order('version', { ascending: false }),
    ])
    const metric = regRes && !regRes.error ? regRes.data ?? null : null
    const versions = verRes && !verRes.error && Array.isArray(verRes.data) ? verRes.data : []
    return { metric, versions }
  } catch {
    return { metric: null, versions: [] }
  }
}

/**
 * Explain a metric for a country/date window via the `explain_metric` RPC.
 * Returns the json payload, or { ok:false } on any error. Never throws.
 * 'All' (or a falsy country) is sent as null so the DB applies no country filter.
 *
 * @param {string} metricId
 * @param {{ country?: string|null, from?: string|null, to?: string|null }} [opts]
 * @returns {Promise<object>}
 */
export async function explainMetric(metricId, { country = null, from = null, to = null } = {}) {
  try {
    const { data, error } = await supabase.rpc('explain_metric', {
      p_metric_id: metricId,
      p_country: country && country !== 'All' ? country : null,
      p_from: from,
      p_to: to,
    })
    if (error || !data) return { ok: false }
    return data
  } catch {
    return { ok: false }
  }
}

/**
 * Full provenance for one source record via the `get_record_provenance` RPC.
 * Returns the json payload, or { ok:false } on any error. Never throws.
 *
 * @param {string} table  the source table name
 * @param {string} id     the row uuid
 * @returns {Promise<object>}
 */
export async function getRecordProvenance(table, id) {
  try {
    const { data, error } = await supabase.rpc('get_record_provenance', {
      p_table: table,
      p_id: id,
    })
    if (error || !data) return { ok: false }
    return data
  } catch {
    return { ok: false }
  }
}

/**
 * Upsert a metric registry row (Admin-only server-side). Surfaces the error via
 * `unwrap` (throws a ServiceError on failure).
 *
 * @param {object} row  a metric_registry row (must carry metric_id)
 * @returns {Promise<object>} the upserted row
 */
export async function upsertMetric(row) {
  return unwrap(
    await supabase.from('metric_registry').upsert(row, { onConflict: 'metric_id' }).select('*').single(),
  )
}

/**
 * Insert a new metric version (Admin-only server-side). Surfaces the error via
 * `unwrap` (throws a ServiceError on failure).
 *
 * @param {object} row  a metric_versions row (must carry metric_id + version)
 * @returns {Promise<object>} the inserted row
 */
export async function saveMetricVersion(row) {
  return unwrap(await supabase.from('metric_versions').insert(row).select('*').single())
}
