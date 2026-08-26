/// Tests for [TyreDiagramPending] - the Dart-idiomatic replacement for the
/// RN renderer's `PendingInput` union (artifact section 7.2: "correctly
/// accepts a result object, an array or a Set").
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_pending.dart';

void main() {
  test('TyreDiagramPending.none resolves to an empty key set', () {
    expect(TyreDiagramPending.none.resolveKeys(), isEmpty);
  });

  group('fromKeys', () {
    test('normalises via keyOf, so punctuation/case differences collapse', () {
      final TyreDiagramPending pending = TyreDiagramPending.fromKeys(<String>[
        'LHR1-O',
        'r2ri',
      ]);
      final Set<String> keys = pending.resolveKeys();
      expect(keys, contains(keyOf('LHR1O')));
      expect(keys, contains(keyOf('R2RI')));
      expect(keys.length, 2);
    });

    test('accepts a Set<String> - the same constructor covers both list '
        'and Set shapes the RN union offers', () {
      final TyreDiagramPending pending = TyreDiagramPending.fromKeys(<String>{
        'FL',
        'FR',
      });
      expect(pending.resolveKeys(), <String>{keyOf('FL'), keyOf('FR')});
    });

    test('an empty-string entry contributes nothing', () {
      final TyreDiagramPending pending = TyreDiagramPending.fromKeys(<String>[
        '',
        'FL',
      ]);
      expect(pending.resolveKeys(), <String>{keyOf('FL')});
    });
  });

  group('fromCompleteness', () {
    test('collects both the slot id and the canonical code for every '
        'non-complete slot, and nothing for complete slots', () {
      final TyreCompletenessResult result = tyreCompleteness(
        'TR-MIXER',
        'TM123',
        <String, Object?>{
          'F1L': <String, Object?>{'condition': 'Good', 'pressure_psi': '110'},
        },
      );
      final TyreDiagramPending pending = TyreDiagramPending.fromCompleteness(
        result,
      );
      final Set<String> keys = pending.resolveKeys();
      // F1L was fully recorded - complete - so neither its id nor its
      // code (LHF1) should appear.
      expect(keys, isNot(contains(keyOf('F1L'))));
      expect(keys, isNot(contains(keyOf('LHF1'))));
      // F1R was never recorded at all - missing - so both forms of it
      // must appear, since a caller may hold either vocabulary.
      expect(keys, contains(keyOf('F1R')));
      expect(keys, contains(keyOf('RHF1')));
    });
  });
}
