/**
 * Duplicate-key tyre service - the Supabase boundary for the READ-ONLY
 * "Possible duplicate tyres" reconciliation section (V349
 * recon_duplicate_key_tyres RPC). Mirrors the sibling dataReconciliation.js /
 * reconJobcard.js services: a thin, faithful pass-through over the
 * security-definer RPC.
 *
 * A "possible duplicate" is a group of tyre_records sharing the same
 * (serial_no, asset_no, issue_date, country) natural fitment key but which may
 * differ in other columns. This is DISTINCT from the "Exact duplicates"
 * section (recon_duplicate_tyres), which finds byte-identical rows safe to
 * merge. These groups are flagged for MANUAL review only - they are NEVER
 * mutated or auto-deleted here.
 *
 * AUTH-SENSITIVE: the RPC self-gates server-side on super-admin / Admin /
 * Manager / Director (app_is_elevated) and is org-scoped in the database. This
 * layer never re-implements the gate; it only relocates the call and
 * normalises the empty result. Do NOT rename the RPC here - the enforcement
 * lives in Postgres.
 *
 * The read path NEVER throws: it returns [] on a null payload or any RPC error
 * so the section can degrade to an honest empty state.
 */
import { supabase } from './_client'

/**
 * List groups of tyre_records that share the same (serial_no, asset_no,
 * issue_date, country) key with more than one copy, via the
 * `recon_duplicate_key_tyres` RPC. Never throws - returns [] on a null payload
 * or any RPC error.
 *
 * @returns {Promise<Array<{
 *   serial_no: string,
 *   asset_no: string,
 *   issue_date: string,
 *   country: string,
 *   copies: number
 * }>>} duplicate-key group rows (empty array when none or on error)
 */
export async function listDuplicateKeyTyres() {
  try {
    const { data, error } = await supabase.rpc('recon_duplicate_key_tyres')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
