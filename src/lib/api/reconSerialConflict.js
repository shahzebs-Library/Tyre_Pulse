/**
 * Serial-on-multiple-assets service - the Supabase boundary for the READ-ONLY
 * "Serial on multiple assets" reconciliation section (V353
 * recon_serial_multi_asset RPC). Mirrors the sibling dataReconciliation.js /
 * reconJobcard.js / reconDupKeys.js services: a thin, faithful pass-through
 * over the security-definer RPC.
 *
 * A row flags the SAME tyre serial recorded against more than one asset -
 * usually a tyre that MOVED between vehicles over its life, occasionally a
 * data-entry error. This is INFORMATIONAL ONLY: the rows are surfaced for
 * manual review and are NEVER mutated or deleted here.
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
 * List tyre serials that appear against more than one asset, via the
 * `recon_serial_multi_asset` RPC. Never throws - returns [] on a null payload
 * or any RPC error.
 *
 * @returns {Promise<Array<{
 *   serial_no: string,
 *   country: string,
 *   asset_count: number,
 *   assets: string
 * }>>} serial-on-multiple-assets rows (empty array when none or on error)
 */
export async function listSerialMultiAsset() {
  try {
    const { data, error } = await supabase.rpc('recon_serial_multi_asset')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
