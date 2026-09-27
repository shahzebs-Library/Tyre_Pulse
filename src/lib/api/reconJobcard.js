/**
 * Job card date mismatch service - the Supabase boundary for the read-only
 * "Job card date mismatches" reconciliation section (V346 recon_jobcard_*
 * RPCs). Mirrors the sibling dataReconciliation.js service: thin, faithful
 * pass-throughs over the security-definer RPCs.
 *
 * AUTH-SENSITIVE: both `recon_jobcard_*` RPCs self-gate server-side on
 * super-admin / Admin / Manager / Director and are org-scoped in the database.
 * This layer never re-implements the gate; it only relocates the call and
 * normalises the empty result. Do NOT rename an RPC or reshape its `p_*`
 * argument object here - the enforcement lives in Postgres.
 *
 * Both read paths NEVER throw: they return [] on a null payload or any RPC
 * error so the section can degrade to an honest empty state. This surface is
 * READ ONLY - the rows are flags for manual correction and are never mutated.
 */
import { supabase, ServiceError, isNotProvisioned } from './_client'
import { toUserMessage } from '../safeError'

/**
 * List work orders whose encoded MM/YY (from the Ramco work order number)
 * disagrees with the actual opened date, via the `recon_jobcard_mismatches`
 * RPC. Returns [] when not provisioned; throws a sanitised ServiceError otherwise.
 *
 * @param {{ limit?: number }} [opts]  max rows to return (server-clamped)
 * @returns {Promise<Array<{
 *   id: string,
 *   work_order_no: string,
 *   opened_at: string,
 *   country: string,
 *   site: string,
 *   jobcard_month: number,
 *   jobcard_year: number,
 *   opened_month: number,
 *   opened_year: number
 * }>>} mismatch rows (empty array when none or not provisioned; throws otherwise)
 */
export async function listJobcardMismatches({ limit = 1000 } = {}) {
  const { data, error } = await supabase.rpc('recon_jobcard_mismatches', { p_limit: limit })
  if (error) {
    if (isNotProvisioned(error)) return []
    throw new ServiceError(toUserMessage(error, 'Could not load job card date mismatches.'), error.code, error)
  }
  return Array.isArray(data) ? data : []
}

/**
 * Per-country count of job card date mismatches via the
 * `recon_jobcard_mismatch_summary` RPC. Returns [] on a null payload or when the
 * RPC is not provisioned; THROWS a sanitised ServiceError on any other failure.
 *
 * @returns {Promise<Array<{ country: string, mismatches: number }>>}
 *   per-country summary rows (empty array when none or not provisioned; throws otherwise)
 */
export async function getJobcardMismatchSummary() {
  const { data, error } = await supabase.rpc('recon_jobcard_mismatch_summary')
  if (error) {
    if (isNotProvisioned(error)) return []
    throw new ServiceError(toUserMessage(error, 'Could not load the job card mismatch summary.'), error.code, error)
  }
  return Array.isArray(data) ? data : []
}
