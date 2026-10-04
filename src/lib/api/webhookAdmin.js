/**
 * Super-admin webhook delivery log (console API Monitor).
 * RPCs from supabase/migrations/20260930181000_webhook_delivery_admin.sql; each
 * refuses anyone who is not a super admin (42501). The signing secret and the
 * full target URL never leave the database: only the host is returned.
 */
import { supabase, unwrap } from './_client'

export async function listWebhooksAdmin() {
  const rows = unwrap(await supabase.rpc('admin_list_webhooks'))
  return Array.isArray(rows) ? rows : []
}

export async function listWebhookDeliveriesAdmin({ limit = 50, status = null } = {}) {
  const raw = unwrap(await supabase.rpc('admin_list_webhook_deliveries', { p_limit: limit, p_status: status || null })) || {}
  return {
    total: Number.isFinite(Number(raw.total)) ? Number(raw.total) : null,
    rows: Array.isArray(raw.rows) ? raw.rows : [],
  }
}

/**
 * Put one delivery back in the queue for one more try. A reason is required
 * (written to the console audit trail). Resolves to
 * { ok, will_send, previous_status } or { ok:false, reason }.
 */
export async function resendWebhookDelivery(id, reason) {
  const clean = String(reason || '').trim()
  if (clean.length < 3) throw new Error('A reason is required to resend a delivery.')
  return unwrap(await supabase.rpc('admin_resend_webhook_delivery', { p_id: id, p_reason: clean }))
}

/** Plain-English result line for a resend response. */
export function resendMessage(res) {
  if (!res) return 'The delivery could not be resent.'
  if (res.ok === false) {
    if (res.reason === 'already_delivered') return 'This delivery already succeeded, so it was not sent again.'
    if (res.reason === 'in_flight') return 'This delivery is being sent right now. Try again in a minute.'
    return 'This delivery no longer exists.'
  }
  return res.will_send
    ? 'Queued for one more try. The sender picks it up within a minute.'
    : 'Queued, but this webhook is off, so nothing is sent until it is turned back on.'
}

export const DELIVERY_STATUS_META = {
  delivered: { label: 'Delivered', tone: 'good' },
  pending: { label: 'Waiting', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
}
