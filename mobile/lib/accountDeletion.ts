/**
 * accountDeletion - records an in-app account/data deletion REQUEST.
 *
 * Google Play requires an in-app path for a user to request deletion of their
 * account and associated data. This helper inserts a row into the live
 * `account_deletion_requests` table (V317): the user may INSERT their own row;
 * user_id / organisation_id / email are DB-defaulted / stamped server-side and
 * status defaults to 'pending'. This records INTENT only - it NEVER deletes any
 * auth/user data client-side; an admin actions the request (~30-day timeline).
 *
 * Errors are mapped to a clean, generic message via toUserMessage. If the table
 * is missing (missing relation) we degrade to a friendly message rather than
 * leaking backend internals.
 */
import { supabase } from './supabase'
import { toUserMessage } from './safeError'

export interface RequestDeletionResult {
  ok: boolean
  /** Present when ok === false - a safe, user-facing message. */
  message?: string
}

/** True when the error indicates the target table/relation does not exist. */
function isMissingRelation(err: any): boolean {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '').toLowerCase()
  // Postgres undefined_table = 42P01; PostgREST surfaces PGRST205 for unknown table.
  return code === '42P01' || code === 'PGRST205' ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    msg.includes('schema cache')
}

/**
 * Insert a deletion request for the signed-in user.
 * @param reason optional free-text reason (trimmed; empty -> null).
 */
export async function requestAccountDeletion(reason?: string): Promise<RequestDeletionResult> {
  try {
    const { data: sessionData } = await supabase.auth.getUser()
    const authUser = sessionData?.user
    if (!authUser) {
      return { ok: false, message: 'Please sign in again to submit this request.' }
    }

    const cleanReason = (reason ?? '').trim()
    // user_id / organisation_id / email are DB-defaulted / stamped server-side.
    // We pass user_id + email defensively so the row attributes correctly even
    // if a column default is not wired for the anon-key insert path.
    const payload: Record<string, unknown> = {
      user_id: authUser.id,
      email: authUser.email ?? null,
      reason: cleanReason.length > 0 ? cleanReason : null,
    }

    const { error } = await supabase.from('account_deletion_requests').insert(payload)
    if (error) {
      if (__DEV__) console.error('[accountDeletion]', error)
      if (isMissingRelation(error)) {
        return {
          ok: false,
          message: 'Account deletion is not available right now. Please email us to request deletion.',
        }
      }
      return { ok: false, message: toUserMessage(error) }
    }
    return { ok: true }
  } catch (err) {
    if (__DEV__) console.error('[accountDeletion]', err)
    return { ok: false, message: toUserMessage(err as any) }
  }
}
