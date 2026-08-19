/**
 * The signed-in person's own saved signature (V601 `user_signatures`).
 *
 * OWNERSHIP IS THE WHOLE POINT. The row is keyed on `auth.uid()` and the table's
 * only policies are "this row is mine", so a colleague cannot read, change or
 * even discover that someone else has saved a signature. That is why this did
 * NOT become a column on `profiles`: `profiles_select` lets every authenticated
 * user in the organisation read every profile row, which would have handed all
 * 38 active users a copy of everyone's handwriting.
 *
 * The user id is never taken from a caller. Every function resolves it from the
 * session, so a wrong id cannot be passed in and RLS would refuse it anyway.
 *
 * Every read degrades to null rather than throwing: a signature that cannot be
 * loaded must leave an approver with a blank pad they can still sign on, never
 * with a broken screen.
 */
import { supabase, unwrap, isMissingRelation } from './_client'
import { normaliseSignature } from '../savedSignature'

async function currentUserId() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id || null
}

/**
 * The caller's saved signature, or null when they have never saved one.
 * @returns {Promise<string|null>}
 */
export async function getMySignature() {
  try {
    const uid = await currentUserId()
    if (!uid) return null
    const rows = unwrap(
      await supabase.from('user_signatures').select('signature').eq('user_id', uid).limit(1),
    )
    return normaliseSignature(rows?.[0]?.signature)
  } catch (err) {
    if (isMissingRelation(err)) return null
    // A signature that will not load is a convenience that failed, not an
    // outage. The approver still has a pad.
    return null
  }
}

/**
 * Remember this mark as the caller's signature, replacing any earlier one.
 * Throws on refusal - saving is an explicit action, so a silent failure would
 * leave someone believing their signature is stored when it is not.
 * @param {string} signature
 * @returns {Promise<string>} the value stored
 */
export async function saveMySignature(signature) {
  const value = normaliseSignature(signature)
  if (!value) throw new Error('Draw a signature before saving it.')
  const uid = await currentUserId()
  if (!uid) throw new Error('You need to be signed in to save a signature.')
  unwrap(
    await supabase
      .from('user_signatures')
      .upsert({ user_id: uid, signature: value, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }),
  )
  return value
}

/** Forget the caller's saved signature. Approvals then start with a blank pad. */
export async function clearMySignature() {
  const uid = await currentUserId()
  if (!uid) return
  unwrap(await supabase.from('user_signatures').delete().eq('user_id', uid))
}
