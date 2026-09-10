import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/washing/domain/wash_evidence.dart';

void main() {
  test(
      'before and after map to the persisted ordered photos without storing local paths in notes',
      () {
    const evidence = WashEvidence(
      before: <String>['before-1', '', 'before-2'],
      after: <String>['after-1'],
      washCompleted: true,
    );
    expect(evidence.photos, <String>['before-1', 'before-2', 'after-1']);
    final notes = evidence.notesWithEvidence('Operator observation');
    expect(notes, startsWith('Operator observation\n[Wash evidence]\n'));
    final metadata = jsonDecode(notes.split('\n').last) as Map<String, dynamic>;
    expect(metadata['before_photo_indices'], <int>[0, 1]);
    expect(metadata['after_photo_indices'], <int>[2]);
    expect(metadata['selected_wash_completed'], isTrue);
    expect(metadata['final_condition_checked'], isFalse);
    expect(notes, isNot(contains('before-1')));
  });
  test('completion requires both explicit checks; photos stay optional', () {
    expect(const WashEvidence().completionConfirmed, isFalse);
    expect(
      const WashEvidence(washCompleted: true).completionConfirmed,
      isFalse,
    );
    expect(
      const WashEvidence(conditionChecked: true).completionConfirmed,
      isFalse,
    );
    const complete = WashEvidence(washCompleted: true, conditionChecked: true);
    expect(complete.completionConfirmed, isTrue);
    expect(complete.photos, isEmpty);
  });
}
