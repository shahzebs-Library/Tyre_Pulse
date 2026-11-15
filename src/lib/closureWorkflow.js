/**
 * closureWorkflow - pure rules for the two closure workflows (owner decision 2026-11-15).
 *
 *   A. Corrective action: the assigned worker submits completion evidence, an
 *      authorised reviewer approves the closure or returns it with a comment.
 *   B. Checklist with a fault: the signer ACKNOWLEDGES the sheet (the fault stays
 *      as recorded), and the sheet is compliant only when every fault is resolved
 *      on review or covered by a documented exception.
 *
 * The database is the boundary (drafts 20261116100000 and 20261116101000). This
 * module exists so a screen can say why a button is not offered before somebody
 * presses it. No I/O. MIRRORS the SQL writers: change both.
 *
 * The corrective-action STATUS vocabulary is deliberately unchanged
 * (Open / In Progress / Closed). Review progress lives in `review_status`.
 */

export const REVIEW_SUBMITTED = 'submitted'
export const REVIEW_RETURNED = 'returned'
export const REVIEW_APPROVED = 'approved'
export const REVIEW_EXCEPTION = 'exception'
export const REVIEW_STATES = [REVIEW_SUBMITTED, REVIEW_RETURNED, REVIEW_APPROVED, REVIEW_EXCEPTION]

export const MAX_PHOTOS = 6
export const MIN_NOTE_LENGTH = 5
export const MIN_EXCEPTION_REASON = 10
export const MIN_RETURN_COMMENT = 5

/** Same normalisation as SQL closure_role_in: case, spaces, dashes and underscores do not matter. */
export function normaliseRole(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')
}

export function roleIn(role, roles) {
  const r = normaliseRole(role)
  if (!r) return false
  return (Array.isArray(roles) ? roles : []).some((x) => normaliseRole(x) === r)
}

const isClosed = (a) => String(a?.status ?? '').trim().toLowerCase() === 'closed'

/** One line on where an action has got to in review. `null` when it has never been in review. */
export function reviewLabel(action) {
  const rs = String(action?.review_status ?? '')
  if (rs === REVIEW_SUBMITTED) return { tone: 'warn', text: 'Waiting for review' }
  if (rs === REVIEW_RETURNED) return { tone: 'bad', text: 'Returned for correction' }
  if (rs === REVIEW_EXCEPTION) return { tone: 'muted', text: 'Closed by exception' }
  if (rs === REVIEW_APPROVED) return { tone: 'good', text: 'Closure approved' }
  if (isClosed(action)) return { tone: 'muted', text: 'Closed before reviews were recorded' }
  return null
}

/** Is this action sitting in a reviewer's queue? */
export function isAwaitingReview(action) {
  return !isClosed(action) && String(action?.review_status ?? '') === REVIEW_SUBMITTED
}

/** Why a completion cannot be submitted, or null when it can. */
export function completionProblem({ note, photos } = {}, { minPhotos = 0 } = {}) {
  if (String(note ?? '').trim().length < MIN_NOTE_LENGTH) return 'Describe what was done to complete this action.'
  const list = Array.isArray(photos) ? photos : []
  if (list.length > MAX_PHOTOS) return `Attach at most ${MAX_PHOTOS} photographs.`
  if (list.length < Number(minPhotos || 0)) {
    return Number(minPhotos) === 1
      ? 'Attach at least one photograph as completion evidence.'
      : `Attach at least ${minPhotos} photographs as completion evidence.`
  }
  return null
}

/** Why a review decision cannot be sent, or null when it can. */
export function reviewProblem(decision, comment) {
  if (decision !== 'approve' && decision !== 'return') return 'Choose approve or return.'
  if (decision === 'return' && String(comment ?? '').trim().length < MIN_RETURN_COMMENT) {
    return 'Say what has to be corrected before returning the action.'
  }
  return null
}

export function exceptionProblem(reason) {
  return String(reason ?? '').trim().length < MIN_EXCEPTION_REASON
    ? 'An exception needs a written reason of at least 10 characters.'
    : null
}

/**
 * What one person may do on one action. Mirrors corrective_action_my_permissions.
 * Fails CLOSED: an unknown answer offers nothing.
 */
export function actionAccess(action, { userId, role, isSuperAdmin = false, isAssignee = false, config } = {}) {
  const cfg = withDefaults(config)
  const closed = isClosed(action)
  const reviewer = !!isSuperAdmin || roleIn(role, cfg.ca_reviewer_roles)
  const self = !!userId && action?.submitted_by === userId
  const waiting = String(action?.review_status ?? '') === REVIEW_SUBMITTED
  return {
    isAssignee: !!isAssignee,
    isReviewer: reviewer,
    canUpdate: !closed && !waiting && (!!isAssignee || reviewer),
    canSubmit: !closed && !waiting && (!!isAssignee || reviewer),
    canReview: !closed && waiting && reviewer && (!self || cfg.ca_allow_self_review),
    selfReviewBlocked: waiting && reviewer && self && !cfg.ca_allow_self_review,
    canException: !closed && (!!isSuperAdmin || roleIn(role, cfg.exception_roles)),
    minPhotos: cfg.ca_min_photos,
  }
}

/** Shape the server's answer (snake case) into the same object, failing closed. */
export function accessFromServer(payload) {
  const p = payload && payload.ok === true ? payload : {}
  return {
    known: payload?.ok === true,
    isAssignee: p.is_assignee === true,
    isReviewer: p.is_reviewer === true,
    canUpdate: p.can_update === true,
    canSubmit: p.can_submit === true,
    canReview: p.can_review === true,
    selfReviewBlocked: p.self_review_blocked === true,
    canException: p.can_exception === true,
    minPhotos: Number.isFinite(Number(p.min_photos)) ? Number(p.min_photos) : 0,
  }
}

export const DEFAULT_CONFIG = Object.freeze({
  ca_reviewer_roles: ['Admin', 'Manager', 'Workshop Supervisor', 'Maintenance Supervisor', 'Tyre Engineer',
    'Tire Planning Engineer', 'PMV Manager', 'Workshop Area Manager', 'Workshop Maintenance Area Manager'],
  ca_allow_self_review: false,
  ca_min_photos: 0,
  ca_allow_direct_close: true,
  exception_roles: ['Admin', 'Director', 'Manager', 'PMV Manager', 'Workshop Area Manager', 'Workshop Maintenance Area Manager'],
  checklist_final_signer_roles: [],
  checklist_allow_self_ack: false,
})

export function withDefaults(config) {
  const c = config && typeof config === 'object' ? config : {}
  const arr = (v, d) => (Array.isArray(v) ? v : d)
  return {
    ca_reviewer_roles: arr(c.ca_reviewer_roles, DEFAULT_CONFIG.ca_reviewer_roles),
    ca_allow_self_review: c.ca_allow_self_review === true,
    ca_min_photos: Number.isFinite(Number(c.ca_min_photos)) ? Number(c.ca_min_photos) : 0,
    ca_allow_direct_close: c.ca_allow_direct_close !== false,
    exception_roles: arr(c.exception_roles, DEFAULT_CONFIG.exception_roles),
    checklist_final_signer_roles: arr(c.checklist_final_signer_roles, []),
    checklist_allow_self_ack: c.checklist_allow_self_ack === true,
  }
}

// ─── B. Checklist with a fault ────────────────────────────────────────────────

export const CHECKLIST_ACKNOWLEDGED = 'acknowledged'
export const isAcknowledged = (submission) => String(submission?.approval_status ?? '') === CHECKLIST_ACKNOWLEDGED

const FIRST_SIGNER_ROLES = ['Admin', 'Maintenance Supervisor', 'Workshop Supervisor', 'PMV Manager',
  'Workshop Area Manager', 'Workshop Maintenance Area Manager', 'Tyre Data Collector']
const FINAL_SIGNER_ROLES = ['Admin', 'Director', 'PMV Manager', 'Workshop Area Manager', 'Workshop Maintenance Area Manager']

/** Final signer for this company: the fixed roles plus the ones the company added. */
export function isFinalSigner(role, { isSuperAdmin = false, config } = {}) {
  return !!isSuperAdmin || roleIn(role, FINAL_SIGNER_ROLES) || roleIn(role, withDefaults(config).checklist_final_signer_roles)
}

/**
 * May this person acknowledge this sheet now? Mirrors acknowledge_checklist_faults.
 * @returns {{ok:boolean, reason:string|null, bothSteps:boolean}}
 */
export function acknowledgeCheck({ submission, twoStage, faultCount, role, isSuperAdmin = false, userId, config } = {}) {
  const no = (reason) => ({ ok: false, reason, bothSteps: false })
  const st = String(submission?.approval_status ?? '')
  if (st !== 'pending' && st !== 'pending_area_manager') return no('This checklist is not waiting for a signature.')
  if (submission?.approval_policy_required || submission?.approval_workflow_id) {
    return no('This checklist is routed through an approval policy. Decide it in the approval queue.')
  }
  if (!(Number(faultCount) > 0)) return no('This checklist has no recorded fault. Approve it in the normal way.')
  const cfg = withDefaults(config)
  if (userId && submission?.submitted_by === userId && !cfg.checklist_allow_self_ack) {
    return no('You submitted this checklist, so another signer has to acknowledge it.')
  }
  if (twoStage) {
    if (!isFinalSigner(role, { isSuperAdmin, config })) {
      return no(st === 'pending' && roleIn(role, FIRST_SIGNER_ROLES)
        ? 'Give the supervisor signature first. The final signer then acknowledges the fault.'
        : 'Only a final signer can acknowledge this checklist.')
    }
    return { ok: true, reason: null, bothSteps: st === 'pending' }
  }
  if (!(isSuperAdmin || roleIn(role, FIRST_SIGNER_ROLES))) return no('You do not have permission to sign this checklist.')
  return { ok: true, reason: null, bothSteps: false }
}

/**
 * State of each fault on a sheet, from the sheet's blocking answers and the
 * corrective actions raised from it. A fault with no action is `unlinked`.
 * @param {{id:string,label:string,value:string}[]} blocking  from checklistMarks.blockingAnswers
 * @param {object[]} actions  corrective actions with source_id = the sheet
 */
export function faultRows(blocking = [], actions = []) {
  return blocking.map((b) => {
    const mine = actions.filter((a) => a?.source_detail === b.label)
    const action = mine.find((a) => isClosed(a)) || mine[0] || null
    let state = 'unlinked'
    if (action) {
      if (!isClosed(action)) state = String(action.review_status ?? '') === REVIEW_SUBMITTED ? 'in_review' : 'open'
      else state = action.review_status === REVIEW_EXCEPTION ? 'exception' : 'resolved'
    }
    return { key: b.id, label: b.label, mark: b.value, action, state }
  })
}

/** Sheet-level fault state. Mirrors v_checklist_fault_compliance. */
export function faultSummary(rows = []) {
  const total = rows.length
  const resolved = rows.filter((r) => r.state === 'resolved').length
  const exception = rows.filter((r) => r.state === 'exception').length
  const open = total - resolved - exception
  const state = total === 0 ? 'no_fault' : open > 0 ? 'fault_open' : exception > 0 ? 'exception' : 'fault_resolved'
  return { total, resolved, exception, open, state }
}

/** Is the sheet compliant? Approved history is never re-judged. */
export function isCompliant(submission, summary) {
  const st = String(submission?.approval_status ?? '')
  if (st === 'approved') return true
  if (st === CHECKLIST_ACKNOWLEDGED || st === 'not_required') return (summary?.open ?? 0) === 0
  return false
}

export function complianceLabel(submission, summary) {
  const st = String(submission?.approval_status ?? '')
  if (st === CHECKLIST_ACKNOWLEDGED) {
    if ((summary?.open ?? 0) > 0) {
      return { tone: 'warn', text: summary.open === 1 ? 'Acknowledged, 1 fault open' : `Acknowledged, ${summary.open} faults open` }
    }
    return summary?.state === 'exception'
      ? { tone: 'muted', text: 'Acknowledged, compliant by exception' }
      : { tone: 'good', text: 'Acknowledged, faults resolved' }
  }
  return null
}

export const FAULT_STATE_TEXT = {
  unlinked: 'No corrective action yet',
  open: 'Open',
  in_review: 'Waiting for review',
  resolved: 'Resolved',
  exception: 'Exception recorded',
}
