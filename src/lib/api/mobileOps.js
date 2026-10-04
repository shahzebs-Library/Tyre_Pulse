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
import { ServiceError } from './_client'

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
  if (error) throw new ServiceError(toUserMessage(error, 'Could not save the setting.'), error?.code, error)
}

/** Save the forced-update minimum. The PAGE runs gateRisk first; this is the writer only. */
export async function setMobileMinVersion(v) { await upsertConfig(KEY_MIN, v) }

/** Record the newest build released to Play (set after each release ships). */
export async function setMobileLatestVersion(v) { await upsertConfig(KEY_LATEST, v) }

/** The login picture each country shows on the phone (raw stored value, or null). */
export async function getMobileLoginArt() {
  const { data, error } = await supabase
    .from('system_config').select('value, updated_at').eq('key', 'mobile_login_hero').maybeSingle()
  if (error) throw new ServiceError(toUserMessage(error, 'Could not read the login pictures.'), error?.code, error)
  return { value: data?.value ?? null, updatedAt: data?.updated_at ?? null }
}

/** Save the login picture map. Caller passes the already-serialised JSON. */
export async function setMobileLoginArt(json) { await upsertConfig('mobile_login_hero', json) }

/* ------------------------------------------------------------------ */
/* Flutter app (the only field app the console controls)              */
/* ------------------------------------------------------------------ */

const F_MIN = 'flutter_min_version'
const F_LATEST = 'flutter_latest_version'

/**
 * Flutter gate + the retired Expo gate (read-only) in one read. configOk is
 * false when system_config could not be read, so the page never shows
 * "Gate off" for a value it simply could not see.
 */
export async function getFlutterOps() {
  const { data, error } = await supabase
    .from('system_config').select('key, value, updated_at').in('key', [F_MIN, F_LATEST, KEY_MIN, KEY_LATEST])
  const rows = error ? [] : (data || [])
  const at = (k) => (rows.find((r) => r.key === k) || {}).updated_at || null
  return {
    minVersion: val(rows, F_MIN),
    latestVersion: val(rows, F_LATEST),
    updatedAt: at(F_MIN),
    latestUpdatedAt: at(F_LATEST),
    configOk: !error,
    retired: {
      minVersion: val(rows, KEY_MIN),
      latestVersion: val(rows, KEY_LATEST),
      updatedAt: at(KEY_MIN) || at(KEY_LATEST),
    },
  }
}

/**
 * Save the Flutter minimum ('min', blank = gate off) or record the newest
 * released version ('latest'). The server RPC admin_set_flutter_version
 * (migration 20261004105000) enforces the same interlock as the page and
 * writes through admin_set_config, so the reason lands in system_config_history.
 */
export async function setFlutterVersion(which, value, reason) {
  const { data, error } = await supabase.rpc('admin_set_flutter_version', {
    p_which: which, p_value: String(value ?? '').trim(), p_reason: String(reason ?? '').trim(),
  })
  if (error) throw new ServiceError(toUserMessage(error, 'Could not save the version.'), error?.code, error)
  return data
}

/**
 * Recent changes to the two Flutter version keys, newest first, with the
 * changer's display name (never an email). Super-admin read via RLS.
 */
export async function listFlutterVersionHistory(limit = 20) {
  const { data, error } = await supabase
    .from('system_config_history')
    .select('id, key, action, old_value, new_value, changed_by, reason, changed_at')
    .in('key', [F_MIN, F_LATEST])
    .order('changed_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
  if (error) throw new ServiceError(toUserMessage(error, 'Could not read the change history.'), error?.code, error)
  const rows = data || []
  const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))]
  let names = {}
  if (ids.length) {
    const { data: people } = await supabase.from('profiles').select('id, full_name, username').in('id', ids).limit(100)
    names = Object.fromEntries((people || []).map((p) => [p.id, p.full_name || p.username || 'Admin']))
  }
  return rows.map((r) => ({ ...r, changed_by_name: r.changed_by ? (names[r.changed_by] || 'Admin') : 'Not recorded' }))
}
