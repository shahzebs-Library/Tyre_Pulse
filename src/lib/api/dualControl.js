/**
 * Dual control (four-eyes approval) service. Super-admin only; every function
 * is enforced server-side (the RPCs refuse anyone who is not a super admin, and
 * refuse a person deciding their own request).
 */
import { supabase, unwrap } from './_client'
import { canonicalPayload, isApprovalRequiredError, APPROVAL_REQUIRED_MESSAGE, readableServerMessage } from '../dualControl'

/**
 * These RPCs raise short, hand-written sentences (22023 validation, the
 * four-eyes refusal, the approval-needed refusal). They carry a code, so the
 * generic sanitiser would hide them; pass through only the ones we wrote.
 */
async function call(fn, args) {
  const res = await supabase.rpc(fn, args)
  if (res?.error) {
    if (isApprovalRequiredError(res.error)) throw new Error(APPROVAL_REQUIRED_MESSAGE)
    const own = readableServerMessage(res.error)
    if (own) throw new Error(own)
  }
  return unwrap(res)
}

/**
 * @param {string|null} status  'open' | 'decided' | a single status | null for all
 * @returns {Promise<{enabled:boolean, activeSuperAdmins:number, me:string|null, rows:object[]}>}
 */
export async function listApprovals(status = null) {
  const raw = (await call('admin_list_approvals', { p_status: status })) || {}
  return {
    enabled: raw.enabled === true,
    activeSuperAdmins: Number(raw.active_super_admins) || 0,
    me: raw.me || null,
    rows: Array.isArray(raw.rows) ? raw.rows : [],
  }
}

export async function requestApproval(action, payload, reason) {
  const canon = canonicalPayload(action, payload)
  return (await call('admin_request_approval', {
    p_action: action, p_payload: canon, p_reason: reason,
  }))
}

export async function decideApproval(id, approve, note = null) {
  return (await call('admin_decide_approval', {
    p_id: id, p_approve: !!approve, p_note: note || null,
  }))
}

export async function cancelApproval(id) {
  return (await call('admin_cancel_approval', { p_id: id }))
}

/** Turn dual control on or off. Turning it off needs an approved request. */
export async function setDualControl(enabled, reason = null) {
  return (await call('admin_set_dual_control', {
    p_enabled: !!enabled, p_reason: reason || null,
  }))
}
