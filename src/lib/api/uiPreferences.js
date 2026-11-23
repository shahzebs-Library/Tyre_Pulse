/**
 * Per-user UI preferences stored on the user's own profiles row
 * (profiles.ui_preferences jsonb, migration 20261123150000). Only the row owner
 * writes it (profiles_update_own RLS); it is not a guarded privileged column.
 *
 * Shape: { appearance: { mode, accent, updatedAt } , ...future keys }
 *
 * Every function degrades quietly: before the migration is applied the column
 * does not exist (42703 / PGRST204) and the app simply keeps the device copy in
 * localStorage, exactly as it did before account sync existed.
 */
import { supabase } from '../supabase'
import { isMissingColumn } from './_client'

const MODES = new Set(['light', 'dark', 'system'])

/** Validate whatever came back from the server into a safe appearance object. */
export function parseAppearance(raw) {
  const a = raw && typeof raw === 'object' ? raw.appearance : null
  if (!a || typeof a !== 'object') return null
  const mode = MODES.has(a.mode) ? a.mode : null
  const accent = typeof a.accent === 'string' ? a.accent.slice(0, 32) : null
  const updatedAt = Number.isFinite(Number(a.updatedAt)) ? Number(a.updatedAt) : 0
  if (!mode && accent == null) return null
  return { mode, accent, updatedAt }
}

export async function readUiPreferences(userId) {
  if (!userId) return { ok: false, reason: 'no_user' }
  const { data, error } = await supabase
    .from('profiles').select('ui_preferences').eq('id', userId).maybeSingle()
  if (error) return { ok: false, reason: isMissingColumn(error) ? 'not_provisioned' : 'error' }
  return { ok: true, prefs: data?.ui_preferences && typeof data.ui_preferences === 'object' ? data.ui_preferences : {} }
}

/** Merge `appearance` into the stored preferences (other keys are kept). */
export async function saveAppearancePreference(userId, appearance) {
  const current = await readUiPreferences(userId)
  if (!current.ok) return current
  const next = { ...current.prefs, appearance }
  const { error } = await supabase.from('profiles').update({ ui_preferences: next }).eq('id', userId)
  if (error) return { ok: false, reason: isMissingColumn(error) ? 'not_provisioned' : 'error' }
  return { ok: true }
}

export async function currentUserId() {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id || null
  } catch {
    return null
  }
}

export function onSignedIn(cb) {
  // supabase-js runs this callback inside its auth lock; never await an auth
  // method synchronously here (it deadlocks), so hand off to a macrotask.
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id
    if (uid && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) setTimeout(() => cb(uid), 0)
  })
  return () => data?.subscription?.unsubscribe?.()
}
