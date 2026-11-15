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
/** An exception has been ASKED for. The action is still open until a different person decides. */
export const REVIEW_EXCEPTION_REQUESTED = 'exception_requested'
export const REVIEW_STATES = [REVIEW_SUBMITTED, REVIEW_RETURNED, REVIEW_APPROVED, REVIEW_EXCEPTION_REQUESTED, REVIEW_EXCEPTION]

export const MAX_PHOTOS = 6
export const MIN_NOTE_LENGTH = 5
export const MIN_EXCEPTION_REASON = 10
export const MIN_RETURN_COMMENT = 5

/**
 * The one wording for an acknowledged checklist whose fault is still open (owner decision
 * 2026-11-15). Every list, viewer, report and export reads it from here.
 */
export const ACK_ACTION_REQUIRED = 'Acknowledged, Action Required'

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
  if (rs === REVIEW_EXCEPTION_REQUESTED && !isClosed(action)) return { tone: 'warn', text: 'Exception requested, waiting for a decision' }
  if (rs === REVIEW_RETURNED) return { tone: 'bad', text: 'Returned for correction' }
  if (rs === REVIEW_EXCEPTION) return { tone: 'muted', text: 'Closed by exception' }
  if (rs === REVIEW_APPROVED) return { tone: 'good', text: 'Closure approved' }
  if (isClosed(action)) return { tone: 'muted', text: 'Closed before reviews were recorded' }
  return null
}

/** Is this action sitting in a reviewer's queue (a completion to review, or an exception to decide)? */
export function isAwaitingReview(action) {
  const rs = String(action?.review_status ?? '')
  return !isClosed(action) && (rs === REVIEW_SUBMITTED || rs === REVIEW_EXCEPTION_REQUESTED)
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

/** Why exception evidence cannot be sent, or null when it can (optional, at most 6 photographs). */
export function evidenceProblem(evidence) {
  if (evidence == null) return null
  if (!Array.isArray(evidence)) return 'Photographs must be a list.'
  if (evidence.length > 6) return 'Attach at most 6 photographs.'
  return null
}

/** Why an exception decision cannot be sent, or null when it can. */
export function exceptionDecisionProblem(decision, comment) {
  if (decision !== 'approve' && decision !== 'refuse') return 'Choose approve or refuse.'
  if (decision === 'refuse' && String(comment ?? '').trim().length < MIN_RETURN_COMMENT) {
    return 'Say why the exception is refused.'
  }
  return null
}

/**
 * What one person may do on one action. Mirrors corrective_action_my_permissions.
 * Fails CLOSED: an unknown answer offers nothing.
 */
export function actionAccess(action, { userId, role, isSuperAdmin = false, isAssignee = false, config } = {}) {
  const cfg = withDefaults(config)
  const closed = isClosed(action)
  const reviewer = !!isSuperAdmin || roleIn(role, cfg.ca_reviewer_roles)
  const exceptionRole = !!isSuperAdmin || roleIn(role, cfg.exception_roles)
  const self = !!userId && action?.submitted_by === userId
  const rs = String(action?.review_status ?? '')
  const inReview = rs === REVIEW_SUBMITTED
  const excPending = rs === REVIEW_EXCEPTION_REQUESTED
  const waiting = inReview || excPending
  // The person who asked for the exception, or who submitted the completion, never decides it.
  // No company setting relaxes this, and it applies to a super admin too.
  const excSelf = !!userId && (action?.exception_requested_by === userId || action?.submitted_by === userId)
  // Independent approval: whoever asked for an exception on this action never closes it.
  // (The database also reads its history; this mirror only sees the latest request.)
  const excAsker = !!userId && action?.exception_requested_by === userId
  return {
    isAssignee: !!isAssignee,
    isReviewer: reviewer,
    canUpdate: !closed && !waiting && (!!isAssignee || reviewer),
    canSubmit: !closed && !waiting && (!!isAssignee || reviewer),
    canReview: !closed && inReview && reviewer && (!self || cfg.ca_allow_self_review) && !excAsker,
    selfReviewBlocked: inReview && reviewer && self && !cfg.ca_allow_self_review,
    closeBlockedExceptionRequester: !closed && inReview && reviewer && excAsker,
    exceptionRequestedByMe: !closed && excPending && excAsker,
    canRequestException: !closed && !excPending && (!!isAssignee || reviewer || exceptionRole),
    canDecideException: !closed && excPending && exceptionRole && !excSelf,
    exceptionSelfBlocked: !closed && excPending && exceptionRole && excSelf,
    waitingOn: closed ? null : inReview ? 'reviewer' : excPending ? 'exception_decider' : 'worker',
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
    closeBlockedExceptionRequester: p.close_blocked_exception_requester === true,
    exceptionRequestedByMe: p.exception_requested_by_me === true,
    canRequestException: p.can_request_exception === true,
    canDecideException: p.can_decide_exception === true,
    exceptionSelfBlocked: p.exception_self_blocked === true,
    waitingOn: ['reviewer', 'exception_decider', 'worker'].includes(p.waiting_on) ? p.waiting_on : null,
    minPhotos: Number.isFinite(Number(p.min_photos)) ? Number(p.min_photos) : 0,
  }
}

/** True when the panel has nothing this person can do on the action. */
export function hasNoAction(access) {
  const a = access || {}
  return !(a.canSubmit || a.canReview || a.selfReviewBlocked || a.canRequestException || a.canDecideException
    || a.exceptionSelfBlocked || a.closeBlockedExceptionRequester)
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
      if (!isClosed(action)) {
        const rs = String(action.review_status ?? '')
        state = rs === REVIEW_SUBMITTED ? 'in_review' : rs === REVIEW_EXCEPTION_REQUESTED ? 'exception_requested' : 'open'
      }
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
      return {
        tone: 'warn', text: ACK_ACTION_REQUIRED, state: 'fault_open', open: summary.open,
        detail: summary.open === 1 ? '1 fault open' : `${summary.open} faults open`,
      }
    }
    return summary?.state === 'exception'
      ? { tone: 'muted', text: 'Acknowledged, compliant by exception', state: 'exception', open: 0, detail: null }
      : { tone: 'good', text: 'Acknowledged, faults resolved', state: 'fault_resolved', open: 0, detail: null }
  }
  return null
}

/**
 * The label for an acknowledged sheet in a LIST, where only the sheet row is at hand.
 * `ack_fault_state` is attached by the service from v_checklist_fault_compliance. When it is
 * not known the answer is "Action Required": a sheet is never shown as settled without evidence.
 * Returns null for a sheet that is not acknowledged.
 */
export function acknowledgedLabel(submission) {
  if (!isAcknowledged(submission)) return null
  const state = String(submission?.ack_fault_state ?? '')
  if (state === 'exception') return { key: 'ack_exception', tone: 'muted', text: 'Acknowledged, compliant by exception', actionRequired: false }
  if (state === 'fault_resolved' || state === 'no_fault') return { key: 'ack_resolved', tone: 'good', text: 'Acknowledged, faults resolved', actionRequired: false }
  return { key: 'ack_action', tone: 'warn', text: ACK_ACTION_REQUIRED, actionRequired: true }
}

/** Readable sign-off status of any checklist row, for lists, reports and exports. Null = not acknowledged. */
export const acknowledgedText = (submission) => acknowledgedLabel(submission)?.text ?? null

export const FAULT_STATE_TEXT = {
  unlinked: 'No corrective action yet',
  open: 'Open',
  in_review: 'Waiting for review',
  exception_requested: 'Exception requested',
  resolved: 'Resolved',
  exception: 'Exception recorded',
}
