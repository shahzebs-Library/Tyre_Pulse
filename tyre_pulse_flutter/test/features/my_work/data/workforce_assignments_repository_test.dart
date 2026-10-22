import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';

WorkforceAssignment _item(String status) => WorkforceAssignment(
      id: 'a1',
      title: 'Task',
      status: status,
      priority: 'normal',
    );

void main() {
  group('next action follows the database transition guard', () {
    test('employee steps', () {
      expect(_item('assigned').nextAction, 'acknowledged');
      expect(_item('acknowledged').nextAction, 'in_progress');
      expect(_item('in_progress').nextAction, 'submitted');
      expect(_item('blocked').nextAction, 'in_progress');
    });

    test('closed or manager-owned states offer nothing', () {
      for (final String s in <String>['submitted', 'verified', 'cancelled']) {
        expect(_item(s).nextAction, isNull, reason: s);
      }
    });
  });

  group('transition failures are classified without leaking database text', () {
    test('guard exceptions and check violations are rejections', () {
      expect(
        classifyWorkforceTransitionError(
          const PostgrestException(
            message: 'Invalid employee assignment transition',
            code: 'P0001',
          ),
        ),
        WorkforceTransitionFailure.rejected,
      );
      expect(
        classifyWorkforceTransitionError(
          const PostgrestException(message: 'check', code: '23514'),
        ),
        WorkforceTransitionFailure.rejected,
      );
    });

    test('row-level security is a denial', () {
      expect(
        classifyWorkforceTransitionError(
          const PostgrestException(message: 'rls', code: '42501'),
        ),
        WorkforceTransitionFailure.denied,
      );
    });

    test('anything that is not a server answer is a network failure', () {
      expect(
        classifyWorkforceTransitionError(StateError('socket closed')),
        WorkforceTransitionFailure.network,
      );
      expect(
        classifyWorkforceTransitionError(
          const PostgrestException(message: 'x'),
        ),
        WorkforceTransitionFailure.network,
      );
    });

    test('an already-typed failure passes through', () {
      expect(
        classifyWorkforceTransitionError(
          const WorkforceTransitionException(
            WorkforceTransitionFailure.conflict,
          ),
        ),
        WorkforceTransitionFailure.conflict,
      );
    });

    test('only a network failure is retryable as is', () {
      for (final WorkforceTransitionFailure f
          in WorkforceTransitionFailure.values) {
        expect(
          WorkforceTransitionException(f).retryableAsIs,
          f == WorkforceTransitionFailure.network,
          reason: f.name,
        );
      }
    });
  });

  test('fromJson tolerates a missing priority, site and due date', () {
    final WorkforceAssignment a = WorkforceAssignment.fromJson(
      <String, dynamic>{'id': 'x', 'title': 'T', 'status': 'assigned'},
    );
    expect(a.priority, 'normal');
    expect(a.site, isNull);
    expect(a.dueAt, isNull);
  });
}
