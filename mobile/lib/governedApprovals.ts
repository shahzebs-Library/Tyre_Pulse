import { supabase } from './supabase'
import { safeUuid } from './ids'

export type ApprovalType = 'checklist' | 'inspection' | 'work_order' | 'tyre_change'
export type ApprovalDecision = 'approved' | 'rejected' | 'returned'
type Row = Record<string, any>
export interface ApprovalReview extends Row {
  entity_type: ApprovalType
  entity_id: string
  mode: 'legacy' | 'enforced'
  revision: number
  stage_token: string
  document: Row
  stages: Row[]
  current_stage: number
  can_decide: boolean
  can_return: boolean
  history: Row[]
  delegations: Row[]
}
export interface ApprovalIntent {
  p_entity_type: ApprovalType
  p_entity_id: string
  p_decision: ApprovalDecision
  p_expected_revision: number
  p_expected_stage: string
  p_operation_id: string
  p_note: string | null
  p_signature: string | null
  p_client_captured_at: string
}
const TYPES = new Set(['checklist', 'inspection', 'work_order', 'tyre_change'])
async function rpc(name: string, args: Row) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}
export function validateApprovalReview(data: any, type: ApprovalType, id: string): ApprovalReview {
  if (!TYPES.has(type) || !data || data.entity_type !== type || data.entity_id !== id
    || data.document?.id !== id || !['legacy', 'enforced'].includes(data.mode)
    || !Number.isSafeInteger(data.revision) || data.revision < 0
    || typeof data.stage_token !== 'string' || !data.stage_token
    || !Array.isArray(data.stages) || !Number.isInteger(data.current_stage) || data.current_stage < 0
    || typeof data.can_decide !== 'boolean' || !Array.isArray(data.history)
    || (data.mode === 'enforced' && data.can_decide && !data.stages[data.current_stage])
    || (['work_order', 'tyre_change'].includes(type) && (!data.document.source_snapshot || !data.document.payload))) {
    throw new Error('The approval could not be verified. Refresh online before signing.')
  }
  return data
}
export async function getApprovalReview(type: ApprovalType, id: string) {
  return validateApprovalReview(await rpc('approval_review_context', { p_entity_type: type, p_entity_id: id }), type, id)
}
export function createApprovalIntent(review: ApprovalReview, decision: ApprovalDecision, note: string, signature: string | null): ApprovalIntent {
  validateApprovalReview(review, review.entity_type, review.entity_id)
  if (!['approved', 'rejected', 'returned'].includes(decision)
    || (decision === 'returned' ? !review.can_return : !review.can_decide)) throw new Error('This decision is not available at the current stage.')
  if (decision !== 'approved' && !note.trim()) throw new Error('A reason is required.')
  if (decision === 'approved' && (review.mode === 'legacy' || review.stages[review.current_stage]?.require_signature !== false)
    && !signature?.trim()) throw new Error('A signature is required.')
  return Object.freeze({ p_entity_type: review.entity_type, p_entity_id: review.entity_id,
    p_decision: decision, p_expected_revision: review.revision, p_expected_stage: review.stage_token,
    p_operation_id: safeUuid(), p_note: note.trim() || null, p_signature: decision === 'approved' ? signature : null,
    p_client_captured_at: new Date().toISOString() })
}
// Retry the exact intent after a timeout. Never generate another operation ID.
export async function submitApprovalIntent(intent: ApprovalIntent) {
  const data = await rpc('decide_approval', intent)
  if (!data?.ok || data.operation_id !== intent.p_operation_id || data.decision !== intent.p_decision
    || typeof data.status !== 'string' || !data.accepted_at) throw new Error('Decision not confirmed. Retry the same decision online.')
  return data
}
export function isDefinitiveApprovalRejection(error: any): boolean {
  return ['22023', '42501', '40001', '23514'].includes(error?.code)
}
export async function executeStoredApprovalIntent(storage: { setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }, key: string, intent: ApprovalIntent, isCurrent = () => true) {
  await storage.setItem(key, JSON.stringify(intent))
  if (!isCurrent()) throw new Error('The account or reviewed stage changed. Reopen the approval before retrying.')
  const receipt = await submitApprovalIntent(intent)
  await storage.removeItem(key)
  return receipt
}
export async function listApprovalPeople(review: ApprovalReview): Promise<Row[]> {
  const data = await rpc('approval_review_people', { p_entity_type: review.entity_type, p_entity_id: review.entity_id })
  if (!Array.isArray(data)) throw new Error('Eligible reviewers could not be verified.')
  return data
}
export async function changeApprovalRoute(review: ApprovalReview, action: 'recover' | 'reassign', reason: string, person?: string) {
  if (!reason.trim() || (action === 'reassign' && !person)) throw new Error('Choose a reviewer and enter a reason.')
  const data = await rpc(action === 'recover' ? 'approval_recover_route' : 'approval_reassign_stage', {
    p_entity_type: review.entity_type, p_entity_id: review.entity_id, p_expected_stage: review.stage_token,
    p_reason: reason.trim(), ...(action === 'reassign' ? { p_approver_id: person } : {}),
  })
  return validateApprovalReview(data, review.entity_type, review.entity_id)
}
export async function delegateApproval(review: ApprovalReview, person: string, starts: string, ends: string, reason: string) {
  const a = Date.parse(starts), b = Date.parse(ends)
  if (!person || !reason.trim() || !Number.isFinite(a) || !Number.isFinite(b) || b <= a || b <= Date.now() || b - a > 90 * 86400000) {
    throw new Error('Choose a reviewer, a reason and a period of no more than 90 days.')
  }
  const data = await rpc('approval_delegate_stage', { p_entity_type: review.entity_type, p_entity_id: review.entity_id,
    p_expected_stage: review.stage_token, p_delegate_id: person, p_starts_at: new Date(a).toISOString(),
    p_ends_at: new Date(b).toISOString(), p_reason: reason.trim() })
  if (!data?.id || data.delegate_id !== person || data.active !== true) throw new Error('Delegation not confirmed. Refresh before retrying.')
  return data
}
export async function revokeApprovalDelegation(id: string, reason: string) {
  if (!reason.trim()) throw new Error('A revocation reason is required.')
  const data = await rpc('approval_revoke_delegation', { p_delegation_id: id, p_reason: reason.trim() })
  if (data?.id !== id || data.active !== false) throw new Error('Revocation not confirmed. Refresh before retrying.')
}
export async function listMyPolicyApprovals(): Promise<Row[]> {
  const data = await rpc('my_pending_approvals', {})
  if (!Array.isArray(data)) throw new Error('The approval list could not be verified.')
  return data.filter(row => row.approval_policy_id)
}
export async function listOperationalApprovals(): Promise<Row[]> {
  return (await listMyPolicyApprovals()).filter(row => ['work_order', 'tyre_change'].includes(row.entity_type))
}
