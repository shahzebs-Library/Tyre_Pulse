/// The assignee transition table. `src/test/workforceTransitions.test.js`
/// additionally pins this file to the SQL function.
///
/// UNVERIFIED: written without a Flutter SDK; never compiled or run.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';

void main() {
  test('offers the right actions for each status', () {
    Set<String> names(String status) => availableWorkforceActions(status)
        .map((WorkforceAction a) => a.wire)
        .toSet();

    expect(names('assigned'), <String>{'accept', 'start'});
    expect(names('acknowledged'), <String>{'start', 'block'});
    expect(names('in_progress'), <String>{'block', 'complete'});
    expect(names('blocked'), <String>{'resume'});
    expect(names('submitted'), isEmpty);
    expect(names('verified'), isEmpty);
    expect(names('cancelled'), isEmpty);
  });

  test('only blocking requires a note', () {
    expect(
      WorkforceAction.values
          .where((WorkforceAction a) => a.noteRequired)
          .map((WorkforceAction a) => a.wire),
      <String>['block'],
    );
  });

  test('applying an action yields the target status or null', () {
    expect(applyWorkforceAction('assigned', WorkforceAction.accept),
        'acknowledged');
    expect(applyWorkforceAction('blocked', WorkforceAction.resume),
        'in_progress');
    expect(applyWorkforceAction('in_progress', WorkforceAction.complete),
        'submitted');
    expect(applyWorkforceAction('submitted', WorkforceAction.start), isNull);
    expect(applyWorkforceAction('assigned', WorkforceAction.complete), isNull);
  });

  test('wire names round-trip and unknown values are rejected', () {
    for (final WorkforceAction a in WorkforceAction.values) {
      expect(WorkforceAction.fromWire(a.wire), a);
    }
    expect(WorkforceAction.fromWire('verify'), isNull);
    expect(WorkforceAction.fromWire(null), isNull);
  });

  test('every action leads somewhere the employee can keep going from or wait at',
      () {
    for (final WorkforceAction a in WorkforceAction.values) {
      final bool open = workforceEmployeeOpenStatuses.contains(a.to);
      final bool waiting = a.to == 'submitted';
      expect(open || waiting, isTrue, reason: a.wire);
    }
  });
}
