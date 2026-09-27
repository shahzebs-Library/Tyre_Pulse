import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';

AccidentRecord _record({
  String? status,
  String? caseStatus,
  String? closureStatus,
  String? closureLevel,
}) =>
    AccidentRecord(
      id: 'a',
      assetNo: 'TM514',
      site: 'NHC',
      incidentDate: '2026-09-01',
      status: status,
      caseStatus: caseStatus,
      closureStatus: closureStatus,
      closureLevel: closureLevel,
    );

void main() {
  group('accidentRecordIsClosed', () {
    test('status or closure status reading closed is closed', () {
      expect(accidentRecordIsClosed(_record(status: 'Closed')), isTrue);
      expect(
        accidentRecordIsClosed(_record(closureStatus: ' closed ')),
        isTrue,
      );
    });

    test('legacy_closed and fully_closed on any column are closed', () {
      expect(
        accidentRecordIsClosed(
          _record(status: 'reported', closureLevel: 'legacy_closed'),
        ),
        isTrue,
      );
      expect(
        accidentRecordIsClosed(_record(caseStatus: 'legacy_closed')),
        isTrue,
      );
      expect(
        accidentRecordIsClosed(_record(closureLevel: 'fully_closed')),
        isTrue,
      );
    });

    test('open work is not closed', () {
      expect(
        accidentRecordIsClosed(
          _record(status: 'under_review', closureLevel: 'financially_open'),
        ),
        isFalse,
      );
      expect(accidentRecordIsClosed(_record()), isFalse);
    });
  });

  group('accidentTone on the Minor / Moderate / Major ladder', () {
    test('severe, major, fatal and total loss share the critical tone', () {
      for (final String token in <String>[
        'severe',
        'Major',
        'fatal',
        'Total Loss',
        'total_loss',
      ]) {
        expect(accidentTone(token), TpStatus.critical, reason: token);
      }
    });

    test('moderate warns and minor is ok', () {
      expect(accidentTone('moderate'), TpStatus.warning);
      expect(accidentTone('minor'), TpStatus.ok);
    });
  });
}
