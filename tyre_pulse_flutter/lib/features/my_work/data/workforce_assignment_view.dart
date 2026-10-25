/// What the assignment list shows: the last server state with this device's
/// unsent updates applied on top, clearly marked.
library;

import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';

final class WorkforceAssignmentView {
  const WorkforceAssignmentView({
    required this.assignment,
    required this.displayStatus,
    required this.pending,
    required this.rejected,
  });

  final WorkforceAssignment assignment;

  /// The server status plus pending updates (optimistic). Refused updates do
  /// NOT change it: the screen shows the last status the server confirmed.
  final String displayStatus;

  /// Updates waiting to reach the server ("pending sync").
  final List<QueuedWorkforceTransition> pending;

  /// Updates the server refused, waiting for the user to review them.
  final List<QueuedWorkforceTransition> rejected;

  bool get hasPending => pending.isNotEmpty;
  bool get hasRejected => rejected.isNotEmpty;

  /// Actions to offer. None while a refused update is unresolved (the user
  /// must review it first) and none once the assignment is no longer the
  /// employee's to act on.
  List<WorkforceAction> get actions => hasRejected
      ? const <WorkforceAction>[]
      : availableWorkforceActions(displayStatus);
}

List<WorkforceAssignmentView> buildWorkforceViews(
  List<WorkforceAssignment> assignments,
  List<QueuedWorkforceTransition> queued,
) {
  return <WorkforceAssignmentView>[
    for (final WorkforceAssignment a in assignments)
      _viewFor(
        a,
        queued
            .where((QueuedWorkforceTransition q) => q.assignmentId == a.id)
            .toList(growable: false),
      ),
  ];
}

WorkforceAssignmentView _viewFor(
  WorkforceAssignment assignment,
  List<QueuedWorkforceTransition> entries,
) {
  final List<QueuedWorkforceTransition> ordered =
      List<QueuedWorkforceTransition>.of(entries)
        ..sort(
          (QueuedWorkforceTransition a, QueuedWorkforceTransition b) =>
              a.seq.compareTo(b.seq),
        );
  return WorkforceAssignmentView(
    assignment: assignment,
    displayStatus: effectiveWorkforceStatus(assignment.status, ordered),
    pending: ordered
        .where(
          (QueuedWorkforceTransition q) =>
              q.status == WorkforceQueueStatus.pending,
        )
        .toList(growable: false),
    rejected: ordered
        .where(
          (QueuedWorkforceTransition q) =>
              q.status == WorkforceQueueStatus.rejected,
        )
        .toList(growable: false),
  );
}
