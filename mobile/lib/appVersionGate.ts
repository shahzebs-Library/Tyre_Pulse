/**
 * Minimum-version gate (the I/O half; the rules live in ./appVersion).
 *
 * WHY THIS EXISTS: testers are spread across builds. Play Console shows crashes
 * still arriving from build 28 while 34 is current, and a fix shipped in a later
 * build does nothing for someone who never updated. This lets an admin name a
 * minimum version; anything older is asked to update before it can be used.
 *
 * FAIL-OPEN BY DESIGN. Every failure path - no config row, unreadable value,
 * unparseable version, no signal - reports "allowed". A version check must never
 * be the reason a field inspector cannot open the app in a yard. The only way a
 * user is blocked is an admin explicitly setting a minimum this build is below.
 */
import Constants from 'expo-constants'
import { supabase } from './supabase'
import { MIN_VERSION_KEY, isUpdateRequired } from './appVersion'

export { MIN_VERSION_KEY, isUpdateRequired, compareVersions } from './appVersion'

/** This build's version, from app.json. */
export function currentVersion(): string {
  return String(Constants.expoConfig?.version ?? '0.0.0')
}

/**
 * Ask the server for the minimum version. Resolves to null on ANY problem
 * (offline, missing row, RLS) so the caller allows entry.
 */
export async function fetchMinVersion(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', MIN_VERSION_KEY)
      .maybeSingle()
    if (error || !data) return null
    const raw = (data as { value?: unknown }).value
    if (raw == null) return null
    // system_config values may be stored JSON-quoted ("1.3.1") or bare.
    const s = String(raw).trim().replace(/^"+|"+$/g, '')
    return s || null
  } catch {
    return null
  }
}

/** Does THIS build need to update? Never throws; never blocks on error. */
export async function checkUpdateRequired(): Promise<boolean> {
  const min = await fetchMinVersion()
  return isUpdateRequired(currentVersion(), min)
}
