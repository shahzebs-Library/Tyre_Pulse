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

/** The statuses an admin may set on a deletion request (V317 CHECK). */
export const DELETION_STATUSES = ['pending', 'processing', 'completed', 'rejected']

/**
 * ADMIN: list deletion requests for the caller's organisation, newest first.
 * RLS (V317) restricts the rows to Admin/super within their own org, so this is
 * an org-scoped read by construction. An optional `status` narrows the list.
 * Returns [] when the table has not been provisioned yet (pre-V317).
 *
 * @param {{ status?: string }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listDeletionRequests({ status } = {}) {
  try {
    let q = supabase
      .from('account_deletion_requests')
      .select(COLS)
      .order('requested_at', { ascending: false })
    if (status && DELETION_STATUSES.includes(status)) q = q.eq('status', status)
    return unwrap(await q) ?? []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * ADMIN: advance a deletion request to a new status, stamping who/when.
 * RLS (V317) enforces that only an Admin/super within the row's org can update.
 *
 * @param {string} id      request id
 * @param {string} status  one of DELETION_STATUSES
 * @param {string} [note]  optional processing note. The V317 table has no admin
 *                         note column, so this is accepted for API-compatibility
 *                         and deliberately NOT persisted over the requester's
 *                         own `reason`; wire it to a real column when one exists.
 * @returns {Promise<object>} the updated row
 */
export async function setDeletionRequestStatus(id, status, note) { // eslint-disable-line no-unused-vars
  if (!id) throw new Error('A request id is required.')
  if (!DELETION_STATUSES.includes(status)) {
    throw new Error('Invalid status. Use pending, processing, completed or rejected.')
  }

  const { data: userRes } = await supabase.auth.getUser()
  const processedBy = userRes?.user?.id ?? null

  const patch = {
    status,
    processed_at: new Date().toISOString(),
    processed_by: processedBy,
  }

  return unwrap(
    await supabase
      .from('account_deletion_requests')
      .update(patch)
      .eq('id', id)
      .select(COLS)
      .single(),
  )
}
