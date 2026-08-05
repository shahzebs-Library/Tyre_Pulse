/**
 * Mobile App Control service (console-only surface).
 *
 * Reads/writes the two system_config keys that govern the fleet's phones:
 *   mobile_min_version    - the forced-update gate the app enforces on open
 *   mobile_latest_version - the newest build actually released to Play, set
 *                           here after each release so the gate interlock has
 *                           a truth to check against (never guessed)
 * plus the device install-base counts. Every reader degrades to a safe shape
 * so a missing table never blanks the page.
 */
import { supabase } from '../supabase'
import { toUserMessage } from '../safeError'

const KEY_MIN = 'mobile_min_version'
const KEY_LATEST = 'mobile_latest_version'

const val = (rows, key) => {
  const r = (rows || []).find((x) => x.key === key)
  if (!r) return ''
  const raw = String(r.value ?? '').trim()
  // Values are stored either bare (1.3.1) or JSON-quoted ("1.3.1").
  try { const p = JSON.parse(raw); return typeof p === 'string' ? p : raw } catch { return raw }
}

export async function getMobileOps() {
  const [cfg, devices, tokens] = await Promise.allSettled([
    supabase.from('system_config').select('key, value, updated_at').in('key', [KEY_MIN, KEY_LATEST]),
    supabase.from('user_devices').select('id', { count: 'exact', head: true }).eq('revoked', false),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).not('push_token', 'is', null),
  ])
  const rows = cfg.status === 'fulfilled' ? (cfg.value.data || []) : []
  return {
    minVersion: val(rows, KEY_MIN),
    latestVersion: val(rows, KEY_LATEST),
    updatedAt: (rows.find((r) => r.key === KEY_MIN) || {}).updated_at || null,
    activeDevices: devices.status === 'fulfilled' ? (devices.value.count ?? null) : null,
    usersWithPush: tokens.status === 'fulfilled' ? (tokens.value.count ?? null) : null,
    configOk: cfg.status === 'fulfilled' && !cfg.value.error,
  }
}

async function upsertConfig(key, value) {
  const { error } = await supabase
    .from('system_config')
    .upsert({ key, value: String(value ?? '').trim(), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(toUserMessage(error, 'Could not save the setting.'))
}

/** Save the forced-update minimum. The PAGE runs gateRisk first; this is the writer only. */
export async function setMobileMinVersion(v) { await upsertConfig(KEY_MIN, v) }

/** Record the newest build released to Play (set after each release ships). */
export async function setMobileLatestVersion(v) { await upsertConfig(KEY_LATEST, v) }
