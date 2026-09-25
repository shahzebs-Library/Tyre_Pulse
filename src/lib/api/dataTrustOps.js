/**
 * dataTrustOps service (V474) - the Supabase boundary for Data Trust Phase 2:
 * data-quality checks, reconciliation, the job/integration monitors and the
 * correction-case workflow. Faithful pass-throughs over the security-definer
 * RPCs + the org-scoped tables; every RPC self-gates on app_is_elevated().
 * Read paths are HONEST: [] only when a relation is genuinely not provisioned
 * (by error CODE); a permission or network failure throws so the page can show
 * an error with Retry. Action/write paths surface errors too.
 */
import { supabase, unwrap, isNotProvisioned } from './_client'

const c = (country) => (country && country !== 'All' ? country : null)

/**
 * Honest read: a table or RPC that is genuinely not provisioned yet degrades to
 * `fallback`; ANY other failure (permission, network, bad filter) throws a
 * sanitised ServiceError via `unwrap`, so the page shows an error with Retry
 * instead of an empty list that reads as "nothing wrong".
 */
function readRows(res, pick = (d) => d) {
  if (res?.error && isNotProvisioned(res.error)) return []
  const data = unwrap(res)
  const rows = pick(data)
  return Array.isArray(rows) ? rows : []
}

/**
 * Newest-N windows. These are deliberately bounded "latest activity" views,
 * each well under the PostgREST 1,000-row cap, so a single request returns the
 * whole window. The page states the window rather than implying a full history.
 */
export const QUALITY_RESULTS_WINDOW = 400
export const RECON_RUNS_WINDOW = 200
export const CORRECTION_CASES_WINDOW = 300

// ── Data quality ──────────────────────────────────────────────────────────────
export async function runQualityChecks(country = null) {
  return unwrap(await supabase.rpc('run_quality_checks', { p_country: c(country) }))
}
/** Active quality rules (a small global registry). Throws on a real failure. */
export async function listQualityRules() {
  return readRows(await supabase.from('quality_rules').select('*').eq('active', true).order('severity'))
}
/** Most recent quality results (newest first). Throws on a real failure. */
export async function listQualityResults({ country = null } = {}) {
  let q = supabase.from('quality_results').select('*').order('checked_at', { ascending: false }).limit(QUALITY_RESULTS_WINDOW)
  if (c(country)) q = q.eq('country', country)
  return readRows(await q)
}

// ── Reconciliation ──────────────────────────────────────────────────────────────
export async function runReconciliation(country = null) {
  return unwrap(await supabase.rpc('run_reconciliation', { p_country: c(country) }))
}
/** Most recent reconciliation runs (newest first). Throws on a real failure. */
export async function listReconciliationRuns({ country = null } = {}) {
  let q = supabase.from('reconciliation_runs').select('*').order('run_at', { ascending: false }).limit(RECON_RUNS_WINDOW)
  if (c(country)) q = q.eq('country', country)
  return readRows(await q)
}

// ── Job / integration monitors (read existing run/log tables) ─────────────────
/** Recent job runs via get_pipeline_runs. Throws on a real failure. */
export async function getPipelineRuns({ country = null, limit = 100 } = {}) {
  return readRows(
    await supabase.rpc('get_pipeline_runs', { p_country: c(country), p_limit: limit }),
    (d) => d?.runs,
  )
}
/** Recent integration events via get_integration_events. Throws on a real failure. */
export async function getIntegrationEvents({ country = null, limit = 100 } = {}) {
  return readRows(
    await supabase.rpc('get_integration_events', { p_country: c(country), p_limit: limit }),
    (d) => d?.events,
  )
}

// ── Correction cases ──────────────────────────────────────────────────────────
/** Most recent correction cases (newest first). Throws on a real failure. */
export async function listCorrectionCases({ country = null, status = null } = {}) {
  let q = supabase.from('correction_cases').select('*').order('created_at', { ascending: false }).limit(CORRECTION_CASES_WINDOW)
  if (c(country)) q = q.eq('country', country)
  if (status && status !== 'all') q = q.eq('status', status)
  return readRows(await q)
}
/**
 * One case plus its event trail. `case` is null only when the row genuinely
 * does not exist (or is not visible); a failed read THROWS rather than showing
 * the case as missing or its history as empty.
 */
export async function getCorrectionCase(id) {
  const [caseRes, eventsRes] = await Promise.all([
    supabase.from('correction_cases').select('*').eq('id', id).maybeSingle(),
    supabase.from('correction_case_events').select('*').eq('case_id', id).order('created_at', { ascending: true }),
  ])
  const kase = unwrap(caseRes)
  const events = readRows(eventsRes)
  return { case: kase || null, events }
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
