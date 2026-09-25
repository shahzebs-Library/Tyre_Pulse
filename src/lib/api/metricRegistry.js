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
 * Read paths are HONEST: they degrade only when a relation or function is
 * genuinely not provisioned (by error code); a permission or network failure
 * THROWS a sanitised ServiceError so the page shows an error with Retry. The
 * Admin-only write paths (upsertMetric / saveMetricVersion) surface errors too.
 */
import { supabase, unwrap, isNotProvisioned } from './_client'

/**
 * All active metric registry rows, ordered by metric_id. The registry is a
 * small governed catalogue (tens of rows), well under the 1,000-row cap.
 * [] only when the table is genuinely not provisioned; any other failure
 * THROWS so the catalogue shows an error with Retry instead of "no metrics".
 *
 * @returns {Promise<Array<object>>}
 */
export async function listMetrics() {
  const res = await supabase
    .from('metric_registry')
    .select('*')
    .eq('active', true)
    .order('metric_id')
  if (res.error && isNotProvisioned(res.error)) return []
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

/**
 * A single registry row plus its versions (newest version first). `metric` is
 * null only when the metric genuinely does not exist; a failed read of either
 * table THROWS (a definition shown with no versions would claim it was never
 * versioned).
 *
 * @param {string} metricId
 * @returns {Promise<{ metric: object|null, versions: object[] }>}
 */
export async function getMetric(metricId) {
  const [regRes, verRes] = await Promise.all([
    supabase.from('metric_registry').select('*').eq('metric_id', metricId).maybeSingle(),
    supabase
      .from('metric_versions')
      .select('*')
      .eq('metric_id', metricId)
      .order('version', { ascending: false }),
  ])
  const metric = unwrap(regRes) ?? null
  const versions = verRes?.error && isNotProvisioned(verRes.error) ? [] : unwrap(verRes)
  return { metric, versions: Array.isArray(versions) ? versions : [] }
}

/**
 * Explain a metric for a country/date window via the `explain_metric` RPC.
 * Returns the json payload. A payload the server marks `ok:false` (unknown
 * metric) is returned as-is and the caller says "no governed definition"; an
 * RPC that is not deployed yet returns `{ ok:false, reason:'not_provisioned' }`.
 * A permission or network failure THROWS, so a broken read is never shown as
 * "this metric has no definition".
 * 'All' (or a falsy country) is sent as null so the DB applies no country filter.
 *
 * @param {string} metricId
 * @param {{ country?: string|null, from?: string|null, to?: string|null }} [opts]
 * @returns {Promise<object>}
 */
export async function explainMetric(metricId, { country = null, from = null, to = null } = {}) {
  const res = await supabase.rpc('explain_metric', {
    p_metric_id: metricId,
    p_country: country && country !== 'All' ? country : null,
    p_from: from,
    p_to: to,
  })
  if (res.error && isNotProvisioned(res.error)) return { ok: false, reason: 'not_provisioned' }
  return unwrap(res) || { ok: false }
}

/**
 * Full provenance for one source record via the `get_record_provenance` RPC.
 * Same contract as explainMetric: the server's own `ok:false` is returned,
 * a not-deployed RPC returns `{ ok:false, reason:'not_provisioned' }`, and a
 * real failure THROWS.
 *
 * @param {string} table  the source table name
 * @param {string} id     the row uuid
 * @returns {Promise<object>}
 */
export async function getRecordProvenance(table, id) {
  const res = await supabase.rpc('get_record_provenance', { p_table: table, p_id: id })
  if (res.error && isNotProvisioned(res.error)) return { ok: false, reason: 'not_provisioned' }
  return unwrap(res) || { ok: false }
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
