/**
 * Super-admin API key administration (console /console/api-keys).
 *
 * Reads and writes the SAME public.api_keys table the public-api edge function
 * authenticates against (minted by create_api_key, V99). There is no second
 * key system. Every call goes through a SECURITY DEFINER RPC that refuses
 * anyone who is not a super admin (42501) and audits each write into
 * console_sessions and access_audit. The secret and its hash never leave the
 * database: the list returns the display prefix only.
 *
 * Usage: api_key_usage is pruned to the last hour on every authenticated call,
 * so the only usage history that exists is the last 60 minutes plus
 * last_used_at. This service does not pretend otherwise.
 */
import { supabase, unwrap } from './_client'

export async function listAllApiKeys() {
  const raw = unwrap(await supabase.rpc('admin_list_api_keys')) || {}
  const maxAge = Number(raw.max_age_days)
  return {
    keys: Array.isArray(raw.keys) ? raw.keys : [],
    usageLastHour: Array.isArray(raw.usage_last_hour) ? raw.usage_last_hour : [],
    maxAgeDays: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : null,
    generatedAt: raw.generated_at || null,
  }
}

export async function revokeApiKeyAsAdmin(id, reason) {
  if (!id) throw new Error('Missing key id')
  return unwrap(await supabase.rpc('admin_revoke_api_key', { p_id: id, p_reason: String(reason || '').trim() }))
}

/** `expiresAt` = ISO string, or null to remove the expiry. */
export async function setApiKeyExpiry(id, expiresAt) {
  if (!id) throw new Error('Missing key id')
  return unwrap(await supabase.rpc('admin_set_api_key_expiry', { p_id: id, p_expires_at: expiresAt || null }))
}
