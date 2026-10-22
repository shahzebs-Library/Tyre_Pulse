/// Parsing of the `workforce_assignment_transition` response and the
/// optimistic assignment view.
///
/// UNVERIFIED: written without a Flutter SDK; never compiled or run.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_view.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_remote.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';

WorkforceAssignment assignment(String id, String status) => WorkforceAssignment(
      id: id,
      title: 'Replace tyre $id',
      status: status,
      priority: 'normal',
    );

QueuedWorkforceTransition queued(
  String assignmentId,
  int seq,
  WorkforceAction action, {
  WorkforceQueueStatus status = WorkforceQueueStatus.pending,
}) {
  return QueuedWorkforceTransition(
    id: 'key-$seq-0000000000',
    userId: 'user-0000000000',
    assignmentId: assignmentId,
    action: action,
    seq: seq,
    createdAt: DateTime.utc(2026, 10, 23),
    clientAt: DateTime.utc(2026, 10, 23),
    status: status,
  );
}

void main() {
  group('WorkforceRemoteResult.fromJson', () {
    test('maps the four server results', () {
      expect(
        WorkforceRemoteResult.fromJson(<String, Object?>{
          'ok': true,
          'result': 'applied',
          'status': 'in_progress',
        }).outcome,
        WorkforceRemoteOutcome.applied,
      );
      expect(
        WorkforceRemoteResult.fromJson(<String, Object?>{
          'ok': true,
          'result': 'replayed',
          'status': 'in_progress',
        }).outcome,
        WorkforceRemoteOutcome.replayed,
      );
      expect(
        WorkforceRemoteResult.fromJson(<String, Object?>{
          'ok': true,
          'result': 'already_applied',
          'status': 'in_progress',
        }).outcome,
        WorkforceRemoteOutcome.alreadyApplied,
      );
      final WorkforceRemoteResult refused =
          WorkforceRemoteResult.fromJson(<String, Object?>{
        'ok': false,
        'result': 'rejected',
        'reason': 'invalid_transition',
        'current_status': 'cancelled',
      });
      expect(refused.outcome, WorkforceRemoteOutcome.rejected);
      expect(refused.reason, 'invalid_transition');
      expect(refused.status, 'cancelled');
      expect(refused.isDelivered, isFalse);
    });

    test('anything unexpected is an error, never assumed to be success', () {
      expect(() => WorkforceRemoteResult.fromJson(null), throwsFormatException);
      expect(() => WorkforceRemoteResult.fromJson('ok'), throwsFormatException);
      expect(
        () => WorkforceRemoteResult.fromJson(<String, Object?>{'result': 'applied'}),
        throwsFormatException,
      );
      expect(
        () => WorkforceRemoteResult.fromJson(
          <String, Object?>{'ok': true, 'result': 'maybe'},
        ),
        throwsFormatException,
      );
    });
  });

  group('buildWorkforceViews', () {
    test('shows pending updates optimistically and marks them', () {
      final List<WorkforceAssignmentView> views = buildWorkforceViews(
        <WorkforceAssignment>[
          assignment('a1', 'assigned'),
          assignment('a2', 'in_progress'),
        ],
        <QueuedWorkforceTransition>[
          queued('a1', 2, WorkforceAction.start),
          queued('a1', 1, WorkforceAction.accept),
        ],
      );
      expect(views[0].displayStatus, 'in_progress');
      expect(views[0].hasPending, isTrue);
      expect(views[0].pending.map((QueuedWorkforceTransition q) => q.seq),
          <int>[1, 2]);
      expect(views[1].displayStatus, 'in_progress');
      expect(views[1].hasPending, isFalse);
    });

    test('offers actions from the optimistic status', () {
      final WorkforceAssignmentView view = buildWorkforceViews(
        <WorkforceAssignment>[assignment('a1', 'assigned')],
        <QueuedWorkforceTransition>[queued('a1', 1, WorkforceAction.start)],
      ).single;
      expect(
        view.actions.map((WorkforceAction a) => a.wire).toSet(),
        <String>{'block', 'complete'},
      );
    });

    test('a refused update keeps the server status and hides actions', () {
      final WorkforceAssignmentView view = buildWorkforceViews(
        <WorkforceAssignment>[assignment('a1', 'assigned')],
        <QueuedWorkforceTransition>[
          queued('a1', 1, WorkforceAction.start,
              status: WorkforceQueueStatus.rejected),
        ],
      ).single;
      expect(view.displayStatus, 'assigned');
      expect(view.hasRejected, isTrue);
      expect(view.hasPending, isFalse);
      expect(view.actions, isEmpty);
    });

    test('other assignments are unaffected by someone else\'s queue entries',
        () {
      final WorkforceAssignmentView view = buildWorkforceViews(
        <WorkforceAssignment>[assignment('a1', 'assigned')],
        <QueuedWorkforceTransition>[queued('zzz', 1, WorkforceAction.start)],
      ).single;
      expect(view.displayStatus, 'assigned');
      expect(view.hasPending, isFalse);
    });
  });
}
