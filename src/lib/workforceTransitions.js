/**
 * Workforce assignment transition vocabulary (web).
 *
 * Mirrors the CASE block of public.workforce_assignment_transition() in
 * supabase/migrations/20261023091000_workforce_transitions_and_estimation.sql and the Dart
 * enum in tyre_pulse_flutter/lib/features/my_work/domain/workforce_transition.dart.
 * src/test/workforceTransitions.test.js fails when either copy drifts from the SQL.
 * The database is the authority; this table only decides which buttons to offer.
 */
export const TRANSITIONS = Object.freeze({
  accept:   { from: ['assigned'], to: 'acknowledged', actor: 'assignee', noteRequired: false, label: 'Accept' },
  start:    { from: ['assigned', 'acknowledged'], to: 'in_progress', actor: 'assignee', noteRequired: false, label: 'Start' },
  block:    { from: ['acknowledged', 'in_progress'], to: 'blocked', actor: 'assignee', noteRequired: true, label: 'Block' },
  resume:   { from: ['blocked'], to: 'in_progress', actor: 'assignee', noteRequired: false, label: 'Resume' },
  complete: { from: ['in_progress'], to: 'submitted', actor: 'assignee', noteRequired: false, label: 'Submit work' },
  verify:   { from: ['submitted'], to: 'verified', actor: 'manager', noteRequired: false, label: 'Verify' },
  return:   { from: ['submitted'], to: 'in_progress', actor: 'manager', noteRequired: true, label: 'Return for rework' },
  cancel:   { from: ['assigned', 'acknowledged', 'in_progress', 'blocked', 'submitted'], to: 'cancelled', actor: 'manager', noteRequired: true, label: 'Cancel' },
})

/** Blocker causes (mirror of the workforce_assignment_events.reason_code CHECK). */
export const BLOCK_REASONS = Object.freeze(['waiting_stock', 'waiting_equipment', 'vehicle_unavailable', 'safety_hold', 'waiting_approval', 'waiting_manpower', 'other'])
export const BLOCK_REASON_LABELS = Object.freeze({
  waiting_stock: 'Waiting for stock / tyres', waiting_equipment: 'Waiting for equipment or tools', vehicle_unavailable: 'Vehicle not available',
  safety_hold: 'Safety hold', waiting_approval: 'Waiting for approval', waiting_manpower: 'Waiting for manpower', other: 'Other (explain in note)',
  not_recorded: 'Cause not recorded',
})

export const ACTION_ORDER = Object.freeze(['accept', 'start', 'resume', 'block', 'complete', 'verify', 'return', 'cancel'])

/** Actions worth offering for this viewer. A manager who is also the assignee cannot review own work. */
export function availableActions(status, { isAssignee = false, isManager = false } = {}) {
  return ACTION_ORDER.filter(key => {
    const t = TRANSITIONS[key]
    if (!t.from.includes(status)) return false
    if (t.actor === 'assignee') return isAssignee
    if (!isManager) return false
    return !(isAssignee && (key === 'verify' || key === 'return'))
  })
}

const MESSAGES = {
  not_found: 'This assignment is no longer available to you.',
  forbidden: 'Only the assigned employee can do this.',
  self_review: 'You cannot review work that is assigned to you.',
  note_required: 'A note is required for this action.',
  key_reuse: 'This update was already used for a different action. Refresh and try again.',
  invalid_transition: 'The assignment has moved on since this screen loaded.',
  reason_required: 'Choose why the work is blocked.',
  evidence_required: 'Attach the required evidence before submitting this work.',
  record_required: 'Link the operational record (for example the tyre fitment) before verifying.',
  review_note_required: 'This task needs a technical review note before it can be verified.',
  safety_blocked: 'The selected employee is not qualified for this safety-critical work.',
  override_required: 'A manager override reason is required for this employee.',
  record_not_found: 'That record was not found in your organisation.',
  asset_mismatch: 'That record belongs to a different vehicle than this task.',
  record_already_linked: 'That record is already linked to another task.',
  record_type_mismatch: 'This task needs a different kind of operational record.',
}
const STATUS_KEYS = new Set(['assigned', 'acknowledged', 'in_progress', 'blocked', 'submitted', 'verified', 'cancelled'])

/**
 * Plain-sentence refusal. Without `t` it returns the English text (service-layer callers and tests);
 * with the LanguageContext `t` it returns the same sentence from the workforce namespace.
 */
export function reasonMessage(reason, currentStatus, t) {
  if (typeof t === 'function') {
    const base = t(MESSAGES[reason] ? `workforce.refusal.${reason}` : 'workforce.refusal.default')
    if (reason !== 'invalid_transition' || !currentStatus) return base
    const s = String(currentStatus)
    return t('workforce.refusal.withStatus', { message: base, status: STATUS_KEYS.has(s) ? t(`workforce.status.${s}`) : s.replace('_', ' ') })
  }
  const base = MESSAGES[reason] || 'The update was not accepted.'
  return reason === 'invalid_transition' && currentStatus ? `${base} Current status: ${String(currentStatus).replace('_', ' ')}.` : base
}

/** Button label for a transition; English without `t`, translated with it. */
export function transitionLabel(key, t) {
  const en = TRANSITIONS[key]?.label
  return en && typeof t === 'function' ? t(`workforce.actions.${key}`) : (en || key)
}

/** Blocker cause label; English without `t`, translated with it. Unknown codes are shown as given. */
export function blockReasonLabel(code, t) {
  const en = BLOCK_REASON_LABELS[code]
  if (!en) return code
  return typeof t === 'function' ? t(`workforce.blockReason.${code}`) : en
}
