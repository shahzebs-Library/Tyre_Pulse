/**
 * Closure review service: the corrective-action review loop and the checklist
 * acknowledge step. Every write is a database function (drafts 20261116100000 and
 * 20261116101000); nothing here updates a table directly, so the browser cannot
 * skip a rule the database enforces.
 *
 * SHIP BEFORE MIGRATE: until the drafts are applied these functions and columns do
 * not exist. Reads report `provisioned: false` instead of failing the page, and
 * writes raise a plain "not switched on yet" message.
 */
import { supabase, unwrap, isMissingColumn, isMissingRelation, ServiceError, toServiceError } from './_client'
import {
  accessFromServer, withDefaults, completionProblem, reviewProblem, exceptionProblem, exceptionDecisionProblem, evidenceProblem,
  CHECKLIST_ACKNOWLEDGED,
} from '../closureWorkflow'

const REVIEW_COLS = 'id,review_status,submitted_by,submitted_at,completion_note,completion_photos,reviewed_by,reviewed_at,review_comment,exception_requested_by,exception_requested_at,exception_reason,exception_evidence'
const EVENT_COLS = 'id,action_id,event_type,actor_id,actor_role,actor_name,note,evidence,linked,created_at'
const NOT_ON = 'Closure review is not switched on for this system yet.'

/** A missing function, table or column all mean "the drafts are not applied". */
export function isNotProvisioned(err) {
  if (!err) return false
  const code = String(err.code || err.cause?.code || '')
  return isMissingColumn(err) || isMissingRelation(err) || code === 'PGRST202' || code === '42883'
}

async function call(fn, args, fallback) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    if (isNotProvisioned(error)) throw new ServiceError(NOT_ON, { cause: error })
    throw toServiceError(error, fallback)
  }
  return data
}

/** The company's review settings, with the built-in defaults filled in. */
export async function getClosureReviewConfig() {
  const { data, error } = await supabase.rpc('get_closure_review_config')
  if (error) {
    if (isNotProvisioned(error)) return { provisioned: false, config: withDefaults(null) }
    throw toServiceError(error, 'Could not read the review settings.')
  }
  return { provisioned: true, config: withDefaults(data) }
}

export async function saveClosureReviewConfig(patch) {
  return withDefaults(await call('save_closure_review_config', { p: patch || {} }, 'Could not save the review settings.'))
}

/** What the signed-in person may do on one action. Fails closed. */
export async function getActionReviewAccess(actionId) {
  if (!actionId) return { provisioned: true, ...accessFromServer(null) }
  const { data, error } = await supabase.rpc('corrective_action_my_permissions', { p_id: actionId })
  if (error) {
    if (isNotProvisioned(error)) return { provisioned: false, ...accessFromServer(null) }
    throw toServiceError(error, 'Could not check what you may do on this action.')
  }
  return { provisioned: true, ...accessFromServer(data) }
}

/** Review columns for one action, or null fields when the drafts are not applied. */
export async function getActionReview(actionId) {
  const { data, error } = await supabase.from('corrective_actions').select(REVIEW_COLS).eq('id', actionId).maybeSingle()
  if (error) {
    if (isNotProvisioned(error)) return { provisioned: false, review: null }
    throw toServiceError(error, 'Could not read the review details.')
  }
  return { provisioned: true, review: data }
}

/** Ids of the actions waiting for a reviewer, with who submitted and when. */
export async function listReviewQueue({ country } = {}) {
  let q = supabase.from('corrective_actions').select('id,review_status,submitted_by,submitted_at')
    .in('review_status', ['submitted', 'exception_requested']).order('submitted_at', { ascending: true }).limit(500)
  if (country && country !== 'All') q = q.eq('country', country)
  const { data, error } = await q
  if (error) {
    if (isNotProvisioned(error)) return { provisioned: false, rows: [] }
    throw toServiceError(error, 'Could not read the review queue.')
  }
  return { provisioned: true, rows: data || [] }
}

/** Append-only history of one action, oldest first. */
export async function listActionReviewEvents(actionId) {
  const { data, error } = await supabase.from('corrective_action_review_events').select(EVENT_COLS)
    .eq('action_id', actionId).order('id', { ascending: true }).limit(200)
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error, 'Could not read the review history.')
  }
  return data || []
}

export async function recordProgress(actionId, note, photos = []) {
  return call('corrective_action_worker_update', { p_id: actionId, p_note: String(note || '').trim(), p_photos: photos },
    'Could not save the update.')
}

export async function submitCompletion(actionId, { note, photos = [] } = {}, { minPhotos = 0 } = {}) {
  const problem = completionProblem({ note, photos }, { minPhotos })
  if (problem) throw new ServiceError(problem)
  return call('corrective_action_submit_completion', { p_id: actionId, p_note: String(note).trim(), p_photos: photos },
    'Could not submit the completion.')
}

export async function reviewAction(actionId, decision, comment = '') {
  const problem = reviewProblem(decision, comment)
  if (problem) throw new ServiceError(problem)
  return call('corrective_action_review', { p_id: actionId, p_decision: decision, p_comment: String(comment || '').trim() || null },
    'Could not record the review decision.')
}

/**
 * Ask for a documented exception. This does NOT close the action: a different
 * authorised person approves or refuses the request. Optional supporting evidence
 * (photographs, at most 6) is stored with the request. The database checks the
 * caller's company, country and sites, and the person who asks never decides or
 * closes the action.
 */
export async function requestException(actionId, reason, evidence = []) {
  const problem = exceptionProblem(reason) || evidenceProblem(evidence)
  if (problem) throw new ServiceError(problem)
  return call('corrective_action_request_exception',
    { p_id: actionId, p_reason: String(reason).trim(), p_evidence: Array.isArray(evidence) ? evidence : [] },
    'Could not record the exception request.')
}

/** Approve or refuse a requested exception. The database refuses the person who asked. */
export async function decideException(actionId, decision, comment = '') {
  const problem = exceptionDecisionProblem(decision, comment)
  if (problem) throw new ServiceError(problem)
  return call('corrective_action_decide_exception',
    { p_id: actionId, p_decision: decision, p_comment: String(comment || '').trim() || null },
    'Could not record the exception decision.')
}

// ─── Checklist ────────────────────────────────────────────────────────────────

/** Sign a checklist that carries a fault, without approving it. */
export async function acknowledgeChecklist(submissionId, { note = null, signature } = {}) {
  if (!String(signature ?? '').trim()) throw new ServiceError('A signature is required to acknowledge this checklist.')
  const res = await call('acknowledge_checklist_faults', {
    p_submission_id: submissionId,
    p_note: note && String(note).trim() ? String(note).trim().slice(0, 8000) : null,
    p_signature: String(signature),
  }, 'Could not acknowledge the checklist.')
  if (!res || res.ok !== true) throw new ServiceError('The server did not confirm the acknowledgement. Refresh before retrying.')
  return res
}

/** Corrective actions raised from one sheet, with review state when available. */
export async function listSheetActions(submissionId) {
  const base = 'id,title,status,asset_no,source_detail,created_at,closed_at,work_order_id'
  let res = await supabase.from('corrective_actions').select(`${base},review_status,reviewed_at,review_comment`)
    .eq('source_type', 'checklist').eq('source_id', submissionId).order('created_at', { ascending: false })
  let provisioned = true
  if (res.error && isNotProvisioned(res.error)) {
    provisioned = false
    res = await supabase.from('corrective_actions').select(base)
      .eq('source_type', 'checklist').eq('source_id', submissionId).order('created_at', { ascending: false })
  }
  return { provisioned, actions: unwrap(res) || [] }
}

/** Sign-off history of one sheet, oldest first. Empty before the drafts are applied. */
export async function listChecklistDecisionEvents(submissionId) {
  const { data, error } = await supabase.from('checklist_decision_events')
    .select('id,from_status,to_status,actor_id,actor_role,note,created_at')
    .eq('submission_id', submissionId).order('id', { ascending: true }).limit(100)
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error, 'Could not read the sign-off history.')
  }
  return data || []
}

/** Who acknowledged a sheet and when. Null before the drafts are applied or when not acknowledged. */
export async function getAcknowledgement(submissionId) {
  const { data, error } = await supabase.from('checklist_submissions')
    .select('id,acknowledged_name,acknowledged_at,acknowledgement_note,approval_policy_required,approval_workflow_id,submitted_by')
    .eq('id', submissionId).maybeSingle()
  if (error) {
    if (isNotProvisioned(error)) return null
    throw toServiceError(error, 'Could not read the acknowledgement.')
  }
  return data
}

/**
 * Attach `ack_fault_state` ('fault_open' | 'exception' | 'fault_resolved') to every
 * acknowledged sheet in a list, read from v_checklist_fault_compliance, so a list can say
 * "Acknowledged, Action Required" only while a fault is really open. Rows are returned as
 * given when nothing is acknowledged. A failed or unavailable read leaves the field unset,
 * which every reader treats as "Action Required": never settled without evidence.
 */
export async function attachAckFaultStates(rows) {
  const list = Array.isArray(rows) ? rows : []
  const ids = list.filter((r) => r && String(r.approval_status ?? '') === CHECKLIST_ACKNOWLEDGED && r.id).map((r) => r.id)
  if (!ids.length) return rows
  const states = new Map()
  const signers = new Map()
  try {
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150)
      const [view, who] = await Promise.all([
        supabase.from('v_checklist_fault_compliance').select('submission_id,fault_state,open_count').in('submission_id', chunk),
        supabase.from('checklist_submissions').select('id,acknowledged_name,acknowledged_at,acknowledgement_note').in('id', chunk),
      ])
      if (view.error) throw view.error
      for (const r of view.data || []) states.set(r.submission_id, r)
      // Who signed is extra detail: a failure here never hides the fault state.
      if (!who.error) for (const r of who.data || []) signers.set(r.id, r)
    }
  } catch { return rows }
  return list.map((r) => {
    const st = r && states.get(r.id)
    if (!st) return r
    const w = signers.get(r.id) || {}
    return {
      ...r, ack_fault_state: st.fault_state, ack_open_faults: st.open_count,
      acknowledged_name: w.acknowledged_name ?? r.acknowledged_name ?? null,
      acknowledged_at: w.acknowledged_at ?? r.acknowledged_at ?? null,
      acknowledgement_note: w.acknowledgement_note ?? r.acknowledgement_note ?? null,
    }
  })
}
