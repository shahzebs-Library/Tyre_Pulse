/**
 * Developer Portal service — the single seam between the Developer Portal page
 * (/developer-portal) and Supabase for two related entity sets:
 *
 *   • api_keys           (table `api_keys`,          V194)
 *   • webhook_endpoints  (table `webhook_endpoints`, V194)
 *
 * Mirrors odometerLogs.js: explicit column lists (least-privilege selects),
 * null-safe country scoping, input validation, and a missing-relation guard so
 * a pre-migration org degrades listing to an empty array (the page then renders
 * its "apply the migration" empty state instead of erroring). RLS enforces org
 * isolation; this layer never trusts client input blindly.
 *
 * SECURITY: this service only ever persists non-secret metadata. `key_prefix` is
 * a display hint, never the raw secret, and `secret_set` is a boolean flag — the
 * webhook signing secret itself is never written here.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../developerPortal'

export const API_KEY_COLS =
  'id,organisation_id,country,key_name,key_prefix,scopes,environment,status,' +
  'rate_limit,last_used_at,expires_at,created_label,notes,created_by,' +
  'created_at,updated_at'

export const WEBHOOK_COLS =
  'id,organisation_id,country,endpoint_name,url,event_types,status,' +
  'last_delivery_at,failure_count,secret_set,notes,created_by,' +
  'created_at,updated_at'

const KEY_ENVIRONMENTS = ['sandbox', 'production']
const KEY_STATUSES = ['active', 'revoked', 'expired']
const WEBHOOK_STATUSES = ['active', 'paused', 'failing', 'disabled']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err, relation) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes(relation))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asWhitelist = (v, allowed) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return allowed.includes(s) ? s : null
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// ── API Keys ────────────────────────────────────────────────────────────────

/**
 * List API keys (newest first by created_at). Optional `country` filter.
 * Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listApiKeys({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('api_keys').select(API_KEY_COLS)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err, 'api_keys')) return []
    throw err
  }
}

export async function getApiKey(id) {
  return unwrap(await supabase.from('api_keys').select(API_KEY_COLS).eq('id', id).maybeSingle())
}

/**
 * Issue an API key record (metadata only — never a raw secret). Requires a
 * human key name. Environment/status are whitelisted; rate_limit, when present,
 * must be a non-negative integer.
 */
export async function createApiKey(values = {}) {
  const key_name = asText(values.key_name, 200)
  if (!key_name) throw new Error('A key name is required.')

  let rate_limit = null
  if (values.rate_limit !== undefined && values.rate_limit !== null && values.rate_limit !== '') {
    rate_limit = toFiniteNumber(values.rate_limit)
    if (rate_limit == null) throw new Error('Rate limit must be a number.')
    if (rate_limit < 0) throw new Error('Rate limit cannot be negative.')
    rate_limit = Math.round(rate_limit)
  }

  const payload = {
    key_name,
    key_prefix: asText(values.key_prefix, 60),
    scopes: asText(values.scopes, 2000),
    environment: asWhitelist(values.environment, KEY_ENVIRONMENTS) || 'sandbox',
    status: asWhitelist(values.status, KEY_STATUSES) || 'active',
    rate_limit,
    expires_at: asTimestamp(values.expires_at),
    created_label: asText(values.created_label, 200),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('api_keys').insert(payload).select(API_KEY_COLS).single())
}

/**
 * Patch an API key. Strips immutable/ownership fields (id, organisation_id,
 * key_prefix, created_by, timestamps); coerces each field present so the stored
 * value never drifts from the validated shape.
 */
export async function updateApiKey(id, patch = {}) {
  const clean = {}
  if (patch.key_name !== undefined) {
    const key_name = asText(patch.key_name, 200)
    if (!key_name) throw new Error('A key name is required.')
    clean.key_name = key_name
  }
  if (patch.scopes !== undefined) clean.scopes = asText(patch.scopes, 2000)
  if (patch.environment !== undefined) clean.environment = asWhitelist(patch.environment, KEY_ENVIRONMENTS)
  if (patch.status !== undefined) clean.status = asWhitelist(patch.status, KEY_STATUSES)
  if (patch.rate_limit !== undefined) {
    if (patch.rate_limit === null || patch.rate_limit === '') {
      clean.rate_limit = null
    } else {
      const rl = toFiniteNumber(patch.rate_limit)
      if (rl == null) throw new Error('Rate limit must be a number.')
      if (rl < 0) throw new Error('Rate limit cannot be negative.')
      clean.rate_limit = Math.round(rl)
    }
  }
  if (patch.expires_at !== undefined) clean.expires_at = asTimestamp(patch.expires_at)
  if (patch.last_used_at !== undefined) clean.last_used_at = asTimestamp(patch.last_used_at)
  if (patch.created_label !== undefined) clean.created_label = asText(patch.created_label, 200)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('api_keys').update(clean).eq('id', id).select(API_KEY_COLS).single())
}

/** Revoke (hard-delete) an API key record. */
export async function deleteApiKey(id) {
  return unwrap(await supabase.from('api_keys').delete().eq('id', id))
}

// ── Webhook Endpoints ─────────────────────────────────────────────────────────

/**
 * List webhook endpoints (newest first by created_at). Optional `country`
 * filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listWebhookEndpoints({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('webhook_endpoints').select(WEBHOOK_COLS)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err, 'webhook_endpoints')) return []
    throw err
  }
}

export async function getWebhookEndpoint(id) {
  return unwrap(await supabase.from('webhook_endpoints').select(WEBHOOK_COLS).eq('id', id).maybeSingle())
}

/**
 * Register a webhook endpoint. Requires an endpoint name. Status is whitelisted;
 * `secret_set` is coerced to a strict boolean (never the secret value itself).
 */
export async function createWebhookEndpoint(values = {}) {
  const endpoint_name = asText(values.endpoint_name, 200)
  if (!endpoint_name) throw new Error('An endpoint name is required.')

  let failure_count = null
  if (values.failure_count !== undefined && values.failure_count !== null && values.failure_count !== '') {
    failure_count = toFiniteNumber(values.failure_count)
    if (failure_count == null) throw new Error('Failure count must be a number.')
    if (failure_count < 0) throw new Error('Failure count cannot be negative.')
    failure_count = Math.round(failure_count)
  }

  const payload = {
    endpoint_name,
    url: asText(values.url, 2000),
    event_types: asText(values.event_types, 2000),
    status: asWhitelist(values.status, WEBHOOK_STATUSES) || 'active',
    failure_count,
    secret_set: values.secret_set === true || values.secret_set === 'true',
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('webhook_endpoints').insert(payload).select(WEBHOOK_COLS).single())
}

/**
 * Patch a webhook endpoint. Strips immutable/ownership fields; coerces each
 * field present so the stored value never drifts from the validated shape.
 */
export async function updateWebhookEndpoint(id, patch = {}) {
  const clean = {}
  if (patch.endpoint_name !== undefined) {
    const endpoint_name = asText(patch.endpoint_name, 200)
    if (!endpoint_name) throw new Error('An endpoint name is required.')
    clean.endpoint_name = endpoint_name
  }
  if (patch.url !== undefined) clean.url = asText(patch.url, 2000)
  if (patch.event_types !== undefined) clean.event_types = asText(patch.event_types, 2000)
  if (patch.status !== undefined) clean.status = asWhitelist(patch.status, WEBHOOK_STATUSES)
  if (patch.failure_count !== undefined) {
    if (patch.failure_count === null || patch.failure_count === '') {
      clean.failure_count = null
    } else {
      const fc = toFiniteNumber(patch.failure_count)
      if (fc == null) throw new Error('Failure count must be a number.')
      if (fc < 0) throw new Error('Failure count cannot be negative.')
      clean.failure_count = Math.round(fc)
    }
  }
  if (patch.last_delivery_at !== undefined) clean.last_delivery_at = asTimestamp(patch.last_delivery_at)
  if (patch.secret_set !== undefined) clean.secret_set = patch.secret_set === true || patch.secret_set === 'true'
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('webhook_endpoints').update(clean).eq('id', id).select(WEBHOOK_COLS).single())
}

export async function deleteWebhookEndpoint(id) {
  return unwrap(await supabase.from('webhook_endpoints').delete().eq('id', id))
}
