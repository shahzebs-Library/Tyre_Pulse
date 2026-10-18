import { supabase, unwrap, ServiceError } from './_client'
import { isAvatarImage } from '../profileAvatar'

/** The caller cannot supply another user's id or change any other profile field. */
export async function saveMyAvatar(value, expectedUserId) {
  if (value !== null && !isAvatarImage(value)) throw new ServiceError('Choose a valid profile picture.', 'invalid_avatar')
  const identity = unwrap(await supabase.auth.getUser())
  if (!identity?.user?.id || identity.user.id !== expectedUserId) throw new ServiceError('Sign in to update your picture.', 'unauthenticated')
  const row = unwrap(await supabase.from('profiles').update({ avatar_url: value })
    .eq('id', identity.user.id).select('id,avatar_url').single())
  if (!row || row.id !== identity.user.id || row.avatar_url !== value) throw new ServiceError('Your picture could not be saved.', 'avatar_not_saved')
  window.dispatchEvent(new CustomEvent('tp-profile-avatar', { detail: { id: row.id, value: row.avatar_url } }))
  return row.avatar_url
}
