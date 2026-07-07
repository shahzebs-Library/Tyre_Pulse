/**
 * Integrations service - the V97 API-platform boundary: `api_keys` (minted /
 * revoked exclusively via SECURITY DEFINER RPCs; the plaintext key is returned
 * ONCE by create_api_key and only its SHA-256 is stored - key_hash is NEVER
 * selected here), plus outbound `webhook_subscriptions` and their
 * `webhook_deliveries` audit. Explicit column lists (no SELECT *), unwrap
 * error surfacing, mirrors alertThresholds.js.
 */
import { supabase, unwrap } from './_client'

// api_keys columns for the keys table. Deliberately excludes key_hash
// (secret material) and organisation_id / created_by (RLS-scoped).
const API_KEY_COLS =
  'id,name,key_prefix,scopes,active,rate_per_minute,created_at,last_used_at,expires_at'

// webhook_subscriptions columns for the endpoints list + edit form. `secret`
// is included so admins can copy it for HMAC verification (RLS: elevated
// users in-org only).
const WEBHOOK_COLS =
  'id,name,url,secret,event_types,active,consecutive_failures,disabled_reason,last_success_at,last_failure_at,created_at'

// webhook_deliveries columns for the delivery log. Omits request_id
// (internal pg_net linkage) and organisation_id (RLS-scoped).
const DELIVERY_COLS =
  'id,subscription_id,event_id,event_type,payload,status,attempts,next_attempt_at,response_status,last_error,created_at,delivered_at'

/**
 * List the organisation's API keys (prefix + metadata only - the plaintext
 * key is unrecoverable), newest first.
 */
export async function listApiKeys() {
  return unwrap(
    await supabase.from('api_keys').select(API_KEY_COLS).order('created_at', { ascending: false })
  )
}

/**
 * Mint a new API key via the create_api_key RPC. The returned plaintext `key`
 * is shown ONCE and can never be retrieved again - surface it to the user
 * immediately.
 * @param {{name:string, scopes?:string[], expiresAt?:string|null}} opts
 * @returns {Promise<{id:string, key:string, prefix:string}>}
 */
export async function createApiKey({ name, scopes = ['read'], expiresAt = null } = {}) {
  return unwrap(
    await supabase.rpc('create_api_key', {
      p_name: name,
      p_scopes: scopes,
      p_expires_at: expiresAt,
    })
  )
}

/**
 * Revoke (deactivate) an API key by id via the revoke_api_key RPC.
 * @param {string} id
 */
export async function revokeApiKey(id) {
  return unwrap(await supabase.rpc('revoke_api_key', { p_id: id }))
}

/**
 * List the organisation's webhook subscriptions, newest first.
 */
export async function listWebhooks() {
  return unwrap(
    await supabase
      .from('webhook_subscriptions')
      .select(WEBHOOK_COLS)
      .order('created_at', { ascending: false })
  )
}

/**
 * Create a webhook subscription; returns the inserted row (including the
 * generated signing secret). `url` must be https; `event_types` NULL = all.
 * @param {{name:string, url:string, event_types?:string[]|null, active?:boolean}} values
 */
export async function createWebhook(values) {
  return unwrap(
    await supabase.from('webhook_subscriptions').insert(values).select(WEBHOOK_COLS).single()
  )
}

/**
 * Update a webhook subscription by id (e.g. re-enable after auto-disable:
 * {active:true, consecutive_failures:0, disabled_reason:null}).
 * @param {string} id
 * @param {object} patch
 */
export async function updateWebhook(id, patch) {
  return unwrap(await supabase.from('webhook_subscriptions').update(patch).eq('id', id))
}

/**
 * Delete a webhook subscription by id (its deliveries cascade).
 * @param {string} id
 */
export async function deleteWebhook(id) {
  return unwrap(await supabase.from('webhook_subscriptions').delete().eq('id', id))
}

/**
 * One page of webhook deliveries (exact count), newest first, optionally
 * scoped to a single subscription.
 * @param {object} [opts]
 * @param {string|null} [opts.subscriptionId]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Promise<{rows: Array<object>, count: number}>}
 */
export async function listWebhookDeliveries({ subscriptionId = null, limit = 50, offset = 0 } = {}) {
  let q = supabase
    .from('webhook_deliveries')
    .select(DELIVERY_COLS, { count: 'exact' })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)

  if (subscriptionId) q = q.eq('subscription_id', subscriptionId)

  const result = await q
  const rows = unwrap(result) ?? []
  return { rows, count: result.count ?? 0 }
}
