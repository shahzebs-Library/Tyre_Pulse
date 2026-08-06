/**
 * Tell the server which language this person reads.
 *
 * WHY. The app has always known the chosen language, but only on the device -
 * nothing ever recorded it server side. So when a manager writes a message in
 * both English and Arabic, the server had no way to address anyone in their own
 * language, and the only honest fallback was to send both to everybody.
 *
 * Best effort by design: this is a preference, not data anyone is waiting on.
 * A failure here must never block sign in or the language change itself, so
 * every path swallows its error. The worst case is that a person keeps
 * receiving both languages, which is exactly the behaviour before this existed.
 */
import { supabase } from './supabase'

/** Normalise whatever the app holds to the short code the server stores. */
export function normaliseLanguage(lang: string | null | undefined): string | null {
  const v = String(lang ?? '').trim().toLowerCase()
  if (!v) return null
  if (v.startsWith('ar')) return 'ar'
  if (v.startsWith('en')) return 'en'
  if (v.startsWith('ur')) return 'ur'
  return null
}

/**
 * Record the language against the signed-in profile, if it changed.
 *
 * Reads first so a sign in does not write on every launch: this runs on every
 * session restore, and an unconditional write would be a pointless round trip
 * for every user, every time.
 */
export async function syncProfileLanguage(
  userId: string | null | undefined,
  lang: string | null | undefined,
): Promise<void> {
  const code = normaliseLanguage(lang)
  if (!userId || !code) return
  try {
    const { data, error } = await supabase
      .from('profiles').select('language').eq('id', userId).maybeSingle()
    if (error) return
    if (data && String(data.language ?? '') === code) return
    await supabase.from('profiles').update({ language: code }).eq('id', userId)
  } catch {
    // A preference is never worth surfacing an error for.
  }
}
