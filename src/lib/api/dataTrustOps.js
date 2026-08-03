/**
 * dataTrustOps service (V474) - the Supabase boundary for Data Trust Phase 2:
 * data-quality checks, reconciliation, the job/integration monitors and the
 * correction-case workflow. Faithful pass-throughs over the security-definer
 * RPCs + the org-scoped tables; every RPC self-gates on app_is_elevated().
 * Read paths never throw ([] / honest empty); action/write paths surface errors.
 */
import { supabase, unwrap } from './_client'

const c = (country) => (country && country !== 'All' ? country : null)

// ── Data quality ──────────────────────────────────────────────────────────────
export async function runQualityChecks(country = null) {
  return unwrap(await supabase.rpc('run_quality_checks', { p_country: c(country) }))
}
export async function listQualityRules() {
  try {
    const { data, error } = await supabase.from('quality_rules').select('*').eq('active', true).order('severity')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}
export async function listQualityResults({ country = null } = {}) {
  try {
    let q = supabase.from('quality_results').select('*').order('checked_at', { ascending: false }).limit(400)
    if (c(country)) q = q.eq('country', country)
    const { data, error } = await q
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

// ── Reconciliation ──────────────────────────────────────────────────────────────
export async function runReconciliation(country = null) {
  return unwrap(await supabase.rpc('run_reconciliation', { p_country: c(country) }))
}
export async function listReconciliationRuns({ country = null } = {}) {
  try {
    let q = supabase.from('reconciliation_runs').select('*').order('run_at', { ascending: false }).limit(200)
    if (c(country)) q = q.eq('country', country)
    const { data, error } = await q
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

// ── Job / integration monitors (read existing run/log tables) ─────────────────
export async function getPipelineRuns({ country = null, limit = 100 } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_pipeline_runs', { p_country: c(country), p_limit: limit })
    if (error) return []
    return Array.isArray(data?.runs) ? data.runs : []
  } catch { return [] }
}
export async function getIntegrationEvents({ country = null, limit = 100 } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_integration_events', { p_country: c(country), p_limit: limit })
    if (error) return []
    return Array.isArray(data?.events) ? data.events : []
  } catch { return [] }
}

// ── Correction cases ──────────────────────────────────────────────────────────
export async function listCorrectionCases({ country = null, status = null } = {}) {
  try {
    let q = supabase.from('correction_cases').select('*').order('created_at', { ascending: false }).limit(300)
    if (c(country)) q = q.eq('country', country)
    if (status && status !== 'all') q = q.eq('status', status)
    const { data, error } = await q
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}
export async function getCorrectionCase(id) {
  try {
    const [{ data: kase }, { data: events }] = await Promise.all([
      supabase.from('correction_cases').select('*').eq('id', id).single(),
      supabase.from('correction_case_events').select('*').eq('case_id', id).order('created_at', { ascending: true }),
    ])
    return { case: kase || null, events: Array.isArray(events) ? events : [] }
  } catch { return { case: null, events: [] } }
}
export async function openCorrectionCase({ title, metricId = null, country = null, context = {}, originalValue = null, suspectedCause = null, severity = 'medium' }) {
  return unwrap(await supabase.rpc('correction_case_open', {
    p_title: title, p_metric_id: metricId, p_country: c(country),
    p_context: context, p_original_value: originalValue, p_suspected_cause: suspectedCause, p_severity: severity,
  }))
}
export async function transitionCorrectionCase(id, toStatus, note = null) {
  return unwrap(await supabase.rpc('correction_case_transition', { p_id: id, p_to_status: toStatus, p_note: note }))
}
export async function updateCorrectionCase(id, patch) {
  return unwrap(await supabase.rpc('correction_case_update', { p_id: id, p_patch: patch }))
}
