/// The employee-side vocabulary for a company work assignment.
///
/// Mirrors the CASE block of `public.workforce_assignment_transition()` in
/// `supabase/migrations/20261023090000_workforce_transitions_and_estimation.sql`
/// and `src/lib/workforceTransitions.js`. `src/test/workforceTransitions.test.js`
/// reads this file and fails when the three copies drift. The database is the
/// authority: this table only decides which buttons to offer and whether a
/// queued update still makes sense after the earlier queued ones are applied.
///
/// Only the assignee's actions live here. Review actions (verify, return,
/// cancel) are manager actions on the web and are never queued on a phone.
library;

/// One thing the assigned employee can do to an assignment.
enum WorkforceAction {
  accept(
    wire: 'accept',
    label: 'Accept',
    from: <String>['assigned'],
    to: 'acknowledged',
    noteRequired: false,
  ),
  start(
    wire: 'start',
    label: 'Start',
    from: <String>['assigned', 'acknowledged'],
    to: 'in_progress',
    noteRequired: false,
  ),
  block(
    wire: 'block',
    label: 'Block',
    from: <String>['acknowledged', 'in_progress'],
    to: 'blocked',
    noteRequired: true,
  ),
  resume(
    wire: 'resume',
    label: 'Resume',
    from: <String>['blocked'],
    to: 'in_progress',
    noteRequired: false,
  ),
  complete(
    wire: 'complete',
    label: 'Complete',
    from: <String>['in_progress'],
    to: 'submitted',
    noteRequired: false,
  );

  const WorkforceAction({
    required this.wire,
    required this.label,
    required this.from,
    required this.to,
    required this.noteRequired,
  });

  /// The action name sent to the database function.
  final String wire;

  /// Button text.
  final String label;

  /// Assignment statuses this action may be applied from.
  final List<String> from;

  /// The status the assignment has afterwards.
  final String to;

  /// Blocking requires a reason; the database refuses it without one.
  final bool noteRequired;

  bool canApplyFrom(String status) => from.contains(status);

  /// Parses a stored wire name; `null` for anything unknown (a corrupt file).
  static WorkforceAction? fromWire(String? value) {
    for (final WorkforceAction action in WorkforceAction.values) {
      if (action.wire == value) return action;
    }
    return null;
  }
}

/// Statuses in which an employee can still act. Everything else is read-only
/// for them (submitted work waits for review; verified/cancelled are closed).
const Set<String> workforceEmployeeOpenStatuses = <String>{
  'assigned',
  'acknowledged',
  'in_progress',
  'blocked',
};

/// Actions worth offering for [status], in a stable display order.
List<WorkforceAction> availableWorkforceActions(String status) {
  return <WorkforceAction>[
    for (final WorkforceAction action in WorkforceAction.values)
      if (action.canApplyFrom(status)) action,
  ];
}

/// The status after [action], or `null` when it does not apply from [status].
String? applyWorkforceAction(String status, WorkforceAction action) {
  return action.canApplyFrom(status) ? action.to : null;
}
