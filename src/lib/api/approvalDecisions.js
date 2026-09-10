import { supabase, unwrap } from './_client'

const TYPES = new Set(['inspection', 'checklist', 'work_order', 'tyre_change'])

function requireType(entityType) {
  if (!TYPES.has(entityType)) throw new Error('This approval type is not supported.')
}

/** Only an absent RPC permits the caller to offer its existing legacy flow. */
export function isApprovalReviewUnavailable(error) {
  return ['42883', 'PGRST202'].includes(error?.code || error?.cause?.code)
}

/** The document and revision come from the same server snapshot. */
function validateReview(data, entityType, entityId) {
  if (!data || data.entity_id !== entityId || data.entity_type !== entityType
    || !Number.isSafeInteger(data.revision) || data.revision < 0 || typeof data.stage_token !== 'string' || !data.stage_token
    || !data.document || data.document.id !== entityId || !['legacy', 'enforced'].includes(data.mode)
    || typeof data.can_decide !== 'boolean' || !Array.isArray(data.stages)
    || (['work_order', 'tyre_change'].includes(entityType) && (!data.document.source_snapshot || !data.document.payload))
    || !Number.isInteger(data.current_stage) || data.current_stage < 0
    || (data.mode === 'enforced' && data.can_decide && !data.stages[data.current_stage])) {
    throw new Error('The server did not provide a valid approval review. Refresh before deciding.')
  }
  const template = data.document.checklist_templates
  if (entityType === 'checklist' && template) {
    data.document = { ...data.document,
      template_fields: template.fields || [],
      template_settings: { require_area_manager: !!template.require_area_manager,
        doc_prefix: template.doc_prefix ?? null, min_interval_days: template.min_interval_days ?? null },
      template_i18n: { option_sets: template.option_sets || {}, name_i18n: template.name_i18n || {},
        description_i18n: template.description_i18n || {} },
    }
  }
  return data
}

export async function getApprovalReview(entityType, entityId) {
  requireType(entityType)
  const data = unwrap(await supabase.rpc('approval_review_context', {
    p_entity_type: entityType, p_entity_id: entityId,
  }))
  return validateReview(data, entityType, entityId)
}

export async function listApprovalReviewPeople(entityType, entityId) {
  requireType(entityType)
  const people = unwrap(await supabase.rpc('approval_review_people', {
    p_entity_type: entityType, p_entity_id: entityId,
  }))
  if (!Array.isArray(people)) throw new Error('Eligible reviewers could not be verified.')
  return people
}

async function changeRoute(name, review, reason, extra = {}) {
  requireType(review.entity_type)
  if (!String(reason || '').trim() || !review.stage_token) throw new Error('A change reason and current approval stage are required.')
  const data = unwrap(await supabase.rpc(name, {
    p_entity_type: review.entity_type, p_entity_id: review.entity_id,
    p_expected_stage: review.stage_token, p_reason: reason.trim(), ...extra,
  }))
  return validateReview(data, review.entity_type, review.entity_id)
}

export const recoverApprovalRoute = (review, reason) => changeRoute('approval_recover_route', review, reason)
export const reassignApprovalStage = (review, approverId, reason) => changeRoute('approval_reassign_stage', review, reason, { p_approver_id: approverId })

export async function delegateApprovalStage(review, delegateId, startsAt, endsAt, reason) {
  requireType(review.entity_type)
  const starts = new Date(startsAt).getTime(), ends = new Date(endsAt).getTime()
  if (!delegateId || !String(reason || '').trim() || !Number.isFinite(starts) || !Number.isFinite(ends)
    || ends <= starts || ends <= Date.now() || ends - starts > 90 * 24 * 60 * 60 * 1000) {
    throw new Error('Choose a delegate, a reason and a valid period of no more than 90 days.')
  }
  const data = unwrap(await supabase.rpc('approval_delegate_stage', {
    p_entity_type: review.entity_type, p_entity_id: review.entity_id, p_expected_stage: review.stage_token,
    p_delegate_id: delegateId, p_starts_at: new Date(starts).toISOString(), p_ends_at: new Date(ends).toISOString(), p_reason: reason.trim(),
  }))
  if (!data?.id || data.delegate_id !== delegateId || data.active !== true) throw new Error('The server did not confirm the delegation. Refresh before retrying.')
  return data
}

export async function revokeApprovalDelegation(delegationId, reason) {
  if (!String(reason || '').trim()) throw new Error('A revocation reason is required.')
  const data = unwrap(await supabase.rpc('approval_revoke_delegation', { p_delegation_id: delegationId, p_reason: reason.trim() }))
  if (data?.id !== delegationId || data.active !== false) throw new Error('The server did not confirm revocation. Refresh before retrying.')
  return data
}

/** Keep the returned intent for retries; never mint a second ID after a timeout. */
export function createApprovalIntent(review, { approved, decision, note, signature } = {}) {
  requireType(review?.entity_type)
  const action = decision || (approved ? 'approved' : 'rejected')
  if (!['approved', 'rejected', 'returned'].includes(action)) throw new Error('This approval action is not supported.')
  if (action === 'returned' ? review.can_return !== true : review.can_decide !== true) throw new Error('You cannot decide this approval at its current stage.')
  if (!Number.isSafeInteger(review.revision) || !review.stage_token) {
    throw new Error('Refresh this approval before deciding.')
  }
  const cleanNote = String(note || '').trim()
  if (action !== 'approved' && !cleanNote) throw new Error('A reason is required to reject or return this request.')
  const stage = review.stages?.[review.current_stage]
  if (action === 'approved' && (review.mode === 'legacy' || stage?.require_signature !== false)
    && !String(signature || '').trim()) {
    throw new Error('A signature is required to approve this request.')
  }
  return Object.freeze({
    p_entity_type: review.entity_type,
    p_entity_id: review.entity_id,
    p_decision: action,
    p_expected_revision: review.revision,
    p_expected_stage: review.stage_token,
    p_operation_id: crypto.randomUUID(),
    p_note: cleanNote || null,
    p_signature: action === 'approved' ? signature || null : null,
    p_client_captured_at: new Date().toISOString(),
  })
}

export async function submitApprovalIntent(intent) {
  const data = unwrap(await supabase.rpc('decide_approval', intent))
  if (!data || data.ok !== true || data.operation_id !== intent.p_operation_id
    || data.decision !== intent.p_decision || typeof data.status !== 'string'
    || !data.accepted_at) {
    throw new Error('The server did not confirm this decision. Retry the same decision to check its result.')
  }
  return data
}
