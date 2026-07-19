/**
 * systemConfig.js — the ONE central configuration service.
 *
 * The console System Configuration page (ConsoleSystemConfig.jsx) writes global
 * controls into the `system_config` table. Historically many of those controls
 * were saved but never read, so toggling them changed nothing. This service is
 * the single sanctioned reader: every enforcement point (export guard, upload
 * guard, maintenance gate, session-timeout, AI edge functions, backup cron, ...)
 * resolves the effective value through here instead of re-querying the table.
 *
 * Two read paths:
 *   - loadSystemConfig()  authenticated full read (RLS: any authenticated member
 *     may read system_config). Primes the in-memory cache used by the sync
 *     configBool/configNum/configStr helpers.
 *   - getPublicConfig()   anon-safe DEFINER RPC (get_public_config, V286) exposing
 *     ONLY the pre-auth subset (maintenance / registration / version / password
 *     policy). Used by the login, register and boot maintenance gate before a
 *     session exists (V281 revoked anon table grants, so a direct read is blocked).
 *
 * Values in system_config are stored as strings; a few legacy rows are JSON-quoted
 * (e.g. "SAR"). parseConfigValue() normalises both shapes. The typed getters read
 * the primed cache synchronously so hot paths (an export click) never await I/O.
 */
import { supabase } from './_client'

/** Keys the anon-safe get_public_config() RPC is allowed to return (mirror V286). */
export const PUBLIC_CONFIG_KEYS = Object.freeze([
  'maintenance_mode', 'maintenance_message', 'registration_open', 'allow_signups',
  'require_approval', 'app_version', 'session_timeout_hours', 'two_factor_required',
  'password_min_length', 'default_currency',
])

/** App defaults — the effective value when a key is unset/unreadable. Enforcement
 *  must fail SAFE: a switch defaults to its permissive/pre-existing behavior so a
 *  transient read failure never locks users out or silently disables a feature. */
export const CONFIG_DEFAULTS = Object.freeze({
  maintenance_mode: false,
  registration_open: true,
  require_approval: true,
  ai_enabled: true,
  ai_monthly_budget_usd: 0,      // 0 = no budget cap
  ai_rate_limit_per_min: 0,      // 0 = no rate cap
  ai_cache_ttl_hours: 24,
  session_timeout_hours: 0,      // 0 = no idle auto-logout
  max_login_attempts: 0,
  password_min_length: 8,
  two_factor_required: false,
  email_notifications: true,
  push_notifications: true,
  backup_enabled: true,
  export_enabled: true,
  max_export_rows: 50000,
  max_upload_rows: 10000,
  data_retention_months: 0,      // 0 = keep forever
  audit_retention_days: 0,       // 0 = keep forever
})

// ── raw value cache (key -> raw string from the table) ────────────────────────
let _cache = {}
let _loadedAt = 0

/**
 * Normalise a stored config value into a JS primitive.
 * Handles 'true'/'false', numeric strings, JSON-quoted strings ("SAR"), and plain
 * text. Returns the string unchanged when it is not a recognised scalar.
 */
export function parseConfigValue(raw) {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'boolean' || typeof raw === 'number') return raw
  const s = String(raw).trim()
  if (s === '') return ''
  if (s === 'true') return true
  if (s === 'false') return false
  // JSON-quoted string, e.g. "SAR" / "weekly"
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try { return JSON.parse(s) } catch { return s.slice(1, -1) }
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

function coerceBool(v, dflt) {
  const p = parseConfigValue(v)
  if (p === null || p === '') return dflt
  if (typeof p === 'boolean') return p
  const s = String(p).toLowerCase()
  if (['true', '1', 'on', 'yes'].includes(s)) return true
  if (['false', '0', 'off', 'no'].includes(s)) return false
  return dflt
}

function coerceNum(v, dflt) {
  const p = parseConfigValue(v)
  if (p === null || p === '') return dflt
  const n = Number(p)
  return Number.isFinite(n) ? n : dflt
}

function coerceStr(v, dflt) {
  const p = parseConfigValue(v)
  if (p === null) return dflt
  return String(p)
}

/** Seed the cache from an already-fetched {key: rawValue} map (e.g. SettingsContext). */
export function primeConfigCache(map) {
  if (map && typeof map === 'object') {
    _cache = { ...map }
    _loadedAt = Date.now()
  }
  return _cache
}

/** The raw cached map (key -> raw string). */
export function getConfigCache() { return _cache }
/** Epoch ms the cache was last primed, or 0. */
export function configLoadedAt() { return _loadedAt }

// ── synchronous typed getters (read the primed cache) ─────────────────────────
export function configBool(key, dflt) {
  return coerceBool(_cache[key], dflt !== undefined ? dflt : CONFIG_DEFAULTS[key] ?? false)
}
export function configNum(key, dflt) {
  return coerceNum(_cache[key], dflt !== undefined ? dflt : CONFIG_DEFAULTS[key] ?? 0)
}
export function configStr(key, dflt) {
  return coerceStr(_cache[key], dflt !== undefined ? dflt : CONFIG_DEFAULTS[key] ?? '')
}

// ── async loaders ─────────────────────────────────────────────────────────────
/**
 * Authenticated full read of system_config. Primes the cache and returns the raw
 * {key: value} map. Never throws — returns the last-known cache on failure so a
 * transient error can't disable enforcement (fail-safe to defaults).
 */
export async function loadSystemConfig() {
  try {
    const { data, error } = await supabase.from('system_config').select('key, value')
    if (error) throw error
    const map = {}
    for (const row of data || []) map[row.key] = row.value
    return primeConfigCache(map)
  } catch {
    return _cache
  }
}

/**
 * Anon-safe pre-auth read of the public config subset via the get_public_config
 * DEFINER RPC. Primes the cache (public keys only) and returns the raw map.
 * Never throws.
 */
export async function getPublicConfig() {
  try {
    const { data, error } = await supabase.rpc('get_public_config')
    if (error) throw error
    const map = (data && typeof data === 'object') ? data : {}
    // Merge onto any existing cache without clobbering non-public keys.
    _cache = { ..._cache, ...map }
    _loadedAt = Date.now()
    return map
  } catch {
    return {}
  }
}

/**
 * Guard helper for export/upload code paths. Throws a user-safe Error when the
 * feature is switched off. `feature` is 'export' | 'upload'.
 */
export function assertFeatureEnabled(feature) {
  if (feature === 'export' && !configBool('export_enabled', true)) {
    throw new Error('Exports are disabled by your administrator.')
  }
}

/** Clamp a row count to the configured maximum (0/unset = no cap). */
export function clampToMax(key, count) {
  const max = configNum(key, 0)
  if (!max || max <= 0) return count
  return Math.min(count, max)
}

/**
 * Enforcement status registry — the SINGLE source of truth the console badges
 * read, so the System Configuration page can honestly show, per control, whether
 * a saved value is actually enforced and where. Keep this in lockstep with the
 * real enforcement sites. status: 'active' (read + enforced) | 'saved' (stored,
 * not yet wired). `where` names the enforcement site(s) in plain language.
 */
export const ENFORCEMENT_STATUS = Object.freeze({
  // Enforced this pass (read + acted on at the named site):
  maintenance_mode:      { status: 'active', where: 'Web app gate (MaintenanceGate)' },
  registration_open:     { status: 'active', where: 'Web + mobile signup pre-check (get_public_config)' },
  require_approval:      { status: 'active', where: 'handle_new_user (off = auto-approve) + ProtectedRoute' },
  max_upload_rows:       { status: 'active', where: 'Data Intake import guard' },
  export_enabled:        { status: 'active', where: 'exportUtils (Excel / PDF / PPTX)' },
  max_export_rows:       { status: 'active', where: 'exportUtils row cap' },
  session_timeout_hours: { status: 'active', where: 'Idle auto sign-out (web app + console)' },
  two_factor_required:   { status: 'active', where: 'Admin 2FA gate (enrolment prompt)' },
  backup_enabled:        { status: 'active', where: 'Nightly backup cron (cron_run_backup)' },
  ai_enabled:            { status: 'active', where: 'AI edge (chat-ai + ai-orchestrator)' },
  ai_monthly_budget_usd: { status: 'active', where: 'AI edge monthly budget guard' },
  ai_rate_limit_per_min: { status: 'active', where: 'AI edge per-user rate limit' },
  ai_cache_ttl_hours:    { status: 'active', where: 'AI edge response cache TTL (chat-ai)' },
  // Honestly still SAVED ONLY (stored; not yet enforced) - never claimed active:
  ai_model:              { status: 'saved', where: 'Model is locked server-side for safety; this value is not used' },
  password_min_length:   { status: 'saved', where: 'Not yet enforced in signup / reset validation' },
  app_version:           { status: 'saved', where: 'Not yet shown in the app footer / update prompt' },
  max_login_attempts:    { status: 'saved', where: 'Needs a failed-login tracking table + lockout RPC' },
  email_notifications:   { status: 'saved', where: 'Global email on/off not yet wired into the email edge functions' },
  push_notifications:    { status: 'saved', where: 'Global push on/off not yet wired into workflow-notify' },
  alert_email:           { status: 'saved', where: 'Sentry alerts use their own console-configured email, not this key' },
  digest_frequency:      { status: 'saved', where: 'Scheduled reports use each schedule own cadence' },
  audit_retention_days:  { status: 'saved', where: 'Retention purge job deferred (destructive - needs sign-off)' },
  data_retention_months: { status: 'saved', where: 'Retention / archive job deferred (destructive - needs sign-off)' },
})
