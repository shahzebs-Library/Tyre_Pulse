/**
 * Display Tokens service — the client boundary for roadmap item 21's Executive
 * TV Display mode (MIGRATIONS_V103_EXECUTIVE_DISPLAY.sql).
 *
 * Three surfaces, all defined in V103:
 *   • create_display_token(...)  — elevated RPC; returns the PLAINTEXT token ONCE
 *     ('disp_'+hex). It lives in the shareable URL by design; never re-derivable.
 *   • revoke_display_token(id)   — elevated RPC; soft-deactivates a token.
 *   • display_tokens (table)     — RLS scopes SELECT to the caller's org + elevated
 *     role. password_hash is server-side only and never selected here.
 *   • get_display_snapshot(token, password) — anon + authenticated. Returns ONLY
 *     org-scoped aggregate KPIs + branding (no raw rows, no PII), or a
 *     { ok:false, error } signal (invalid_token | password_required |
 *     invalid_password).
 *
 * GRACEFUL DEGRADATION: V103 may not be applied to the live DB yet. Every call
 * catches the "backend not provisioned" Postgres/PostgREST codes and returns a
 * clean { available:false } shape instead of throwing a raw error, so the UI can
 * render an "apply V103 first" state rather than crashing.
 */
import { supabase } from '../supabase'

// Postgres / PostgREST codes that mean "the V103 objects don't exist yet".
//   42883  undefined_function        — RPC not created
//   42P01  undefined_table           — display_tokens table missing
//   PGRST202 no function match        — PostgREST can't find the RPC in its schema cache
//   PGRST205 no table match           — PostgREST can't find the table
const NOT_PROVISIONED_CODES = new Set(['42883', '42P01', 'PGRST202', 'PGRST205'])

/**
 * True when a Supabase error means the V103 backend isn't there yet (as opposed
 * to a genuine failure the user should see). Falls back to message sniffing for
 * environments that don't surface a code.
 */
export function isBackendMissing(error) {
  if (!error) return false
  if (error.code && NOT_PROVISIONED_CODES.has(String(error.code))) return true
  const msg = String(error.message || '').toLowerCase()
  return (
    (msg.includes('does not exist') &&
      (msg.includes('function') || msg.includes('relation') || msg.includes('table'))) ||
    msg.includes('could not find the function') ||
    msg.includes('could not find the table')
  )
}

// Columns safe to expose to the client. Deliberately excludes password_hash
// (secret) and organisation_id / created_by (RLS-scoped internals).
const TOKEN_COLS =
  'id,name,token,template,refresh_seconds,rotate_seconds,active,expires_at,created_at,last_viewed_at,view_count'

/**
 * Build the full shareable board URL for a plaintext token. Pure — unit-tested.
 * @param {string} token  e.g. 'disp_ab12…'
 * @param {string} [origin] defaults to the current window origin.
 */
export function buildDisplayUrl(token, origin) {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')) || ''
  return `${base.replace(/\/+$/, '')}/display/${encodeURIComponent(token || '')}`
}

/**
 * List the organisation's display tokens (RLS scopes to org + elevated), newest
 * first. Never throws: on a real error returns { available, tokens:[], error };
 * when V103 is unapplied returns { available:false }.
 * @returns {Promise<{available:boolean, tokens:Array<object>, error:string|null}>}
 */
export async function listDisplayTokens({ client = supabase } = {}) {
  const { data, error } = await client
    .from('display_tokens')
    .select(TOKEN_COLS)
    .order('created_at', { ascending: false })

  if (error) {
    if (isBackendMissing(error)) return { available: false, tokens: [], error: null }
    return { available: true, tokens: [], error: error.message || 'Could not load display tokens.' }
  }
  return { available: true, tokens: data || [], error: null }
}

/**
 * Mint a new display token via the create_display_token RPC. The returned
 * plaintext `token` is shown ONCE — surface it to the user immediately.
 *
 * @param {object} opts
 * @param {string}   opts.name        required label
 * @param {object}   [opts.template]  { pages:[...] } widget rotation
 * @param {number}   [opts.refreshSeconds=60]  10..3600 (clamped server-side)
 * @param {number}   [opts.rotateSeconds=15]   5..600  (clamped server-side)
 * @param {string|null} [opts.password]   optional viewer password (bcrypt server-side)
 * @param {string|null} [opts.expiresAt]  ISO timestamp or null
 * @returns {Promise<{available:boolean, id?:string, token?:string, error:string|null}>}
 */
export async function createDisplayToken(
  {
    name,
    template = { pages: ['overview'] },
    refreshSeconds = 60,
    rotateSeconds = 15,
    password = null,
    expiresAt = null,
  } = {},
  { client = supabase } = {}
) {
  const { data, error } = await client.rpc('create_display_token', {
    p_name: name,
    p_template: template,
    p_refresh_seconds: refreshSeconds,
    p_rotate_seconds: rotateSeconds,
    p_password: password || null,
    p_expires_at: expiresAt || null,
  })

  if (error) {
    if (isBackendMissing(error)) return { available: false, error: null }
    return { available: true, error: error.message || 'Could not create display token.' }
  }
  // RPC returns jsonb { id, token }.
  return { available: true, id: data?.id ?? null, token: data?.token ?? null, error: null }
}

/**
 * Revoke (deactivate) a display token by id via the revoke_display_token RPC.
 * @param {string} id
 * @returns {Promise<{available:boolean, error:string|null}>}
 */
export async function revokeDisplayToken(id, { client = supabase } = {}) {
  const { error } = await client.rpc('revoke_display_token', { p_id: id })
  if (error) {
    if (isBackendMissing(error)) return { available: false, error: null }
    return { available: true, error: error.message || 'Could not revoke display token.' }
  }
  return { available: true, error: null }
}

/**
 * Fetch an anon board snapshot for a token. This is the SOLE anon-reachable
 * surface; the RPC decides exactly what it returns (aggregate KPIs + branding).
 *
 * Distinguishes three outcomes so the board can render the right state:
 *   • { available:false }                         — V103 not applied yet
 *   • { available:true, ok:false, reason, snapshot:null } — token gate failed
 *       (invalid_token | expired | password_required | invalid_password)
 *   • { available:true, ok:true, snapshot }       — good board payload
 *
 * @param {string} token
 * @param {string|null} [password]
 */
export async function getDisplaySnapshot(token, password = null, { client = supabase } = {}) {
  const { data, error } = await client.rpc('get_display_snapshot', {
    p_token: token,
    p_password: password || null,
  })

  if (error) {
    if (isBackendMissing(error)) return { available: false, ok: false, reason: null, snapshot: null }
    return {
      available: true,
      ok: false,
      reason: 'request_failed',
      error: error.message || 'Could not load the display board.',
      snapshot: null,
    }
  }

  // The RPC returns jsonb: either { ok:false, error } or { ok:true, ...board }.
  if (!data || data.ok !== true) {
    return { available: true, ok: false, reason: data?.error || 'invalid_token', snapshot: null }
  }
  return { available: true, ok: true, reason: null, snapshot: data }
}

/**
 * Normalise a raw get_display_snapshot payload into the shape the board renders.
 * Pure — unit-tested. Tolerates missing keys so a partial/older payload never
 * throws in the render tree.
 */
export function shapeSnapshot(raw) {
  const kpis = (raw && raw.kpis) || {}
  const branding = (raw && raw.branding) || {}
  const template = (raw && raw.template) || {}
  const pages = Array.isArray(template.pages) && template.pages.length ? template.pages : ['overview']

  return {
    name: raw?.name || 'Executive Display',
    generatedAt: raw?.generated_at || null,
    refreshSeconds: clampInt(raw?.refresh_seconds, 10, 3600, 60),
    rotateSeconds: clampInt(raw?.rotate_seconds, 5, 600, 15),
    pages,
    branding: {
      name: branding.name || null,
      logoUrl: branding.logo_url || null,
      primaryColor: branding.primary_color || null,
    },
    kpis: {
      tyresTotal: numOr(kpis.tyres_total, 0),
      spend30d: numOr(kpis.spend_30d, 0),
      highRisk: numOr(kpis.high_risk, 0),
      inspections30d: numOr(kpis.inspections_30d, 0),
      openWorkorders: numOr(kpis.open_workorders, 0),
      openAccidents: numOr(kpis.open_accidents, 0),
      fleetSize: numOr(kpis.fleet_size, 0),
    },
    spendTrend: Array.isArray(raw?.spend_trend)
      ? raw.spend_trend.map((r) => ({ month: r?.month ?? '', spend: numOr(r?.spend, 0) }))
      : [],
    riskBreakdown: Array.isArray(raw?.risk_breakdown)
      ? raw.risk_breakdown.map((r) => ({ level: r?.level ?? 'Unclassified', count: numOr(r?.count, 0) }))
      : [],
    recentActivity: Array.isArray(raw?.recent_activity)
      ? raw.recent_activity.map((r) => ({ type: r?.type ?? 'event', count: numOr(r?.count, 0) }))
      : [],
  }
}

// ── tiny pure helpers ─────────────────────────────────────────────────────────
function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function clampInt(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.round(n), min), max)
}
