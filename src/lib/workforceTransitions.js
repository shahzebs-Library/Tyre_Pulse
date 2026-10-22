/**
 * Workforce assignment transition vocabulary (web).
 *
 * Mirrors the CASE block of public.workforce_assignment_transition() in
 * supabase/migrations/20261023090000_workforce_transitions_and_estimation.sql and the Dart
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
}
export function reasonMessage(reason, currentStatus) {
  const base = MESSAGES[reason] || 'The update was not accepted.'
  return reason === 'invalid_transition' && currentStatus ? `${base} Current status: ${String(currentStatus).replace('_', ' ')}.` : base
}
