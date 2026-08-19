/**
 * The signed-in person's own saved signature (V601 `user_signatures`).
 *
 * OWNERSHIP IS THE WHOLE POINT. The row is keyed on `auth.uid()` and the table's
 * only policies are "this row is mine", so a colleague cannot read, change or
 * even discover that someone else has saved a signature. That is why this is not
 * a column on `profiles`: `profiles_select` lets every authenticated user in the
 * organisation read every profile row, which would have handed every active user
 * a copy of everyone's handwriting.
 *
 * The user id is never taken from a caller. Every function resolves it from the
 * session, so a wrong id cannot be passed in and RLS would refuse it anyway.
 *
 * EVERY READ DEGRADES TO NULL RATHER THAN THROWING, and on a phone that matters
 * more than on the web: a signature that cannot be loaded on a weak signal must
 * leave a supervisor with a blank pad they can still sign on, never a screen
 * they cannot get past. Saving is the exception - it throws, because it is an
 * explicit action and a silent failure would leave someone believing their
 * signature is stored when it is not.
 */
import { supabase } from './supabase'
import { normaliseSignature } from './savedSignature'

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser()
    return data?.user?.id || null
  } catch {
    return null
  }
}

/** The caller's saved signature, or null when they have never saved one. */
export async function getMySignature(): Promise<string | null> {
  try {
    const uid = await currentUserId()
    if (!uid) return null
    const { data, error } = await supabase
      .from('user_signatures')
      .select('signature')
      .eq('user_id', uid)
      .limit(1)
    if (error) return null
    return normaliseSignature(data?.[0]?.signature)
  } catch {
    return null
  }
}

/**
 * Remember this mark as the caller's signature, replacing any earlier one.
 * Throws on refusal.
 */
export async function saveMySignature(signature: string): Promise<string> {
  const value = normaliseSignature(signature)
  if (!value) throw new Error('Draw a signature before saving it.')
  const uid = await currentUserId()
  if (!uid) throw new Error('You need to be signed in to save a signature.')
  const { error } = await supabase
    .from('user_signatures')
    .upsert({ user_id: uid, signature: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' })
  if (error) throw error
  return value
}

/** Forget the caller's saved signature. Approvals then start with a blank pad. */
export async function clearMySignature(): Promise<void> {
  const uid = await currentUserId()
  if (!uid) return
  await supabase.from('user_signatures').delete().eq('user_id', uid)
}
