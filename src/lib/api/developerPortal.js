/**
 * Developer Portal service: the single seam between the Developer Portal page
 * (/developer-portal) and Supabase for two related entity sets:
 *
 *   - API keys           -> the CANONICAL `api_keys` table (V99), the one the
 *                           public-api edge function authenticates against.
 *                           Minted by create_api_key (plaintext returned ONCE,
 *                           only its sha256 is stored) and revoked by
 *                           revoke_api_key. Super admins manage every org's
 *                           keys at /console/api-keys over the same table.
 *   - webhook_endpoints  (table `webhook_endpoints`, V194)
 *
 * RETIRED (20260924123000): the separate `developer_api_keys` table (V194)
 * held metadata that never issued a credential, so the portal showed "keys"
 * that could not authenticate anything. It is no longer read or written; there
 * is ONE key system.
 *
 * SECURITY: key_hash is never selected. The plaintext key exists only in the
 * create_api_key response and is shown to the user once.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber, shapeCanonicalKey } from '../developerPortal'

/** Canonical api_keys columns. Deliberately excludes key_hash. */
export const API_KEY_COLS =
  'id,name,key_prefix,scopes,active,rate_per_minute,created_at,last_used_at,expires_at,revoked_at,revoke_reason'

export const WEBHOOK_COLS =
  'id,organisation_id,country,endpoint_name,url,event_types,status,' +
  'last_delivery_at,failure_count,secret_set,notes,created_by,' +
  'created_at,updated_at'

const WEBHOOK_STATUSES = ['active', 'paused', 'failing', 'disabled']
/** Scopes create_api_key accepts today. */
export const API_KEY_SCOPES = ['read']

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

// ── API Keys (canonical api_keys) ───────────────────────────────────────────

/**
 * List the organisation's API keys, newest first, in the portal row shape.
 * api_keys is organisation-level (no country column), so `country` is ignored.
 * RLS limits the read to elevated users in the caller's organisation.
 */
export async function listApiKeys({ limit = 500 } = {}) {
  try {
    const rows = unwrap(await supabase.from('api_keys').select(API_KEY_COLS)
      .order('created_at', { ascending: false }).limit(limit)) || []
    return rows.map(shapeCanonicalKey)
  } catch (err) {
    if (isMissingRelation(err, 'api_keys')) return []
    throw err
  }
}

export async function getApiKey(id) {
  const row = unwrap(await supabase.from('api_keys').select(API_KEY_COLS).eq('id', id).maybeSingle())
  return row ? shapeCanonicalKey(row) : null
}

/**
 * Mint a real API key through create_api_key. Returns { id, key, prefix };
 * `key` is the plaintext and can never be retrieved again, so the caller must
 * show it immediately. Only the 'read' scope exists today.
 */
export async function createApiKey(values = {}) {
  const name = asText(values.key_name ?? values.name, 200)
  if (!name) throw new Error('A key name is required.')
  const expiresAt = asTimestamp(values.expires_at)
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new Error('The expiry date must be in the future.')
  return unwrap(await supabase.rpc('create_api_key', {
    p_name: name, p_scopes: API_KEY_SCOPES, p_expires_at: expiresAt,
  }))
}

/**
 * A canonical key cannot be edited: its name, scope and expiry are fixed when
 * it is minted (super admins can change the expiry at /console/api-keys). The
 * only change allowed here is revocation.
 */
export async function updateApiKey(id, patch = {}) {
  if (patch && patch.status === 'revoked') return revokeApiKey(id)
  throw new Error('An API key cannot be edited. Revoke it and issue a new one.')
}

/** Revoke (deactivate) a key. It stays listed as revoked; nothing is deleted. */
export async function revokeApiKey(id) {
  if (!id) throw new Error('Missing key id')
  return unwrap(await supabase.rpc('revoke_api_key', { p_id: id }))
}

/** Kept for existing callers: "deleting" a key revokes it. */
export async function deleteApiKey(id) {
  return revokeApiKey(id)
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
