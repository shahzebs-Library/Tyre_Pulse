/**
 * Account-deletion request service — the single seam between the in-app
 * "Delete my account" flow (Settings page) and Supabase table
 * `account_deletion_requests` (V317).
 *
 * IMPORTANT: this NEVER deletes auth/user/business data. It only RECORDS a
 * request for an administrator to action, satisfying the Google Play / privacy
 * requirement for an in-app account & data deletion REQUEST path. Actual
 * deletion is a verified, human-driven back-office process.
 *
 * Mirrors orgUnits.js / iftaRecords.js: a missing relation (the org has not run
 * V317 yet) degrades to a clean, friendly message / empty list so the UI can
 * still render instead of throwing a raw error.
 */
import { supabase, unwrap } from './_client'

export const COLS =
  'id,user_id,organisation_id,email,reason,status,requested_at,processed_by,processed_at'

/** True when the failure is "table does not exist yet" (pre-V317). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('account_deletion_requests'))
  )
}

/** Friendly message shown when the recording table is not provisioned yet. */
export const NOT_AVAILABLE_MESSAGE =
  'Account deletion requests are not available yet. Please email support to request deletion.'

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

/**
 * Record a self-service account-deletion request for the signed-in user.
 * Records only — it does not delete anything. RLS restricts the insert to the
 * caller's own row (user_id / organisation_id are DB-defaulted).
 *
 * @param {string} [reason] optional free-text reason (trimmed, capped)
 * @returns {Promise<{ ok: true, request: object } | { ok: false, reason: 'unavailable'|'error', message: string }>}
 */
export async function requestAccountDeletion(reason) {
  try {
    const { data: userRes } = await supabase.auth.getUser()
    const email = userRes?.user?.email ?? null

    const row = unwrap(
      await supabase
        .from('account_deletion_requests')
        .insert({ email, reason: asText(reason, 2000) })
        .select(COLS)
        .single(),
    )
    return { ok: true, request: row }
  } catch (err) {
    if (isMissingRelation(err)) {
      return { ok: false, reason: 'unavailable', message: NOT_AVAILABLE_MESSAGE }
    }
    throw err
  }
}

/**
 * List the signed-in user's own deletion requests (most recent first).
 * Returns [] when the table has not been provisioned yet (pre-V317).
 *
 * @returns {Promise<object[]>}
 */
export async function listMyDeletionRequests() {
  try {
    return (
      unwrap(
        await supabase
          .from('account_deletion_requests')
          .select(COLS)
          .order('requested_at', { ascending: false }),
      ) ?? []
    )
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}
