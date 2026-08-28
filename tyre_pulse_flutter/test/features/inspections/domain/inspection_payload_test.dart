/// Coverage for [validateInspectionForSubmit]: the check order ported from
/// `mobile/app/(app)/inspection/new.tsx`'s `handleSubmit`, and the
/// strict capture policy that requires deliberate evidence on every resolved
/// physical tyre before review/submission.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

InspectionPayload _basePayload({
  String site = 'NHC',
  String assetNo = 'TM514',
  String vehicleType = 'Tr-Mixer',
  String inspector = 'A. Inspector',
  Map<String, TyrePositionReading> tyreConditions =
      const <String, TyrePositionReading>{},
  String? signature,
}) {
  final DateTime now = DateTime.utc(2026, 8, 20, 9);
  return InspectionPayload(
    title: 'Inspection - $site - $assetNo',
    site: site,
    assetNo: assetNo,
    vehicleType: vehicleType,
    inspector: inspector,
    inspectionDate: now,
    scheduledDate: now,
    tyreConditions: tyreConditions,
    inspectorSignature: signature,
  );
}

void main() {
  group('validateInspectionForSubmit', () {
    test('a completely blank payload reports every structural issue', () {
      final InspectionPayload payload = _basePayload(
        site: '',
        assetNo: '',
        inspector: '',
      );
      final List<InspectionSubmitIssue> issues = validateInspectionForSubmit(
        payload,
      );

      expect(issues, contains(InspectionSubmitIssue.missingSite));
      expect(issues, contains(InspectionSubmitIssue.missingVehicle));
      expect(issues, contains(InspectionSubmitIssue.missingInspectorName));
      expect(issues, contains(InspectionSubmitIssue.noTyreTouched));
      expect(issues, contains(InspectionSubmitIssue.missingSignature));
      // Completeness is not evaluated (and so cannot appear) when nothing
      // was touched at all - the noTyreTouched issue is reported instead,
      // matching the RN screen's own else-if shape.
      expect(issues, isNot(contains(InspectionSubmitIssue.tyresIncomplete)));
    });

    test(
        'touching one of two positions but not the other reports '
        'tyresIncomplete, not noTyreTouched', () {
      final InspectionPayload payload = _basePayload(
        tyreConditions: <String, TyrePositionReading>{
          'LHF1': const TyrePositionReading(
            position: 'LHF1',
            pressurePsi: 110,
            checked: true,
          ),
          'RHF1': TyrePositionReading.seed('RHF1'),
        },
        signature: 'data:image/png;base64,abc',
      );
      final List<InspectionSubmitIssue> issues = validateInspectionForSubmit(
        payload,
      );
      expect(issues, contains(InspectionSubmitIssue.tyresIncomplete));
      expect(issues, isNot(contains(InspectionSubmitIssue.noTyreTouched)));
    });

    test('one checked tyre plus eleven seeded mixer tyres cannot submit', () {
      final List<String> positions = diagramPositions('Tr-Mixer', 'TM514');
      expect(positions, hasLength(12));
      final Map<String, TyrePositionReading> readings =
          <String, TyrePositionReading>{
        for (final String position in positions)
          position: TyrePositionReading.seed(position),
      };
      readings[positions.first] = TyrePositionReading(
        position: positions.first,
        checked: true,
      );

      final List<InspectionSubmitIssue> issues = validateInspectionForSubmit(
        _basePayload(
          tyreConditions: readings,
          signature: 'data:image/png;base64,abc',
        ),
      );

      expect(issues, contains(InspectionSubmitIssue.tyresIncomplete));
      expect(issues, isNot(contains(InspectionSubmitIssue.noTyreTouched)));
    });

    test('all twelve explicitly checked mixer tyres pass the tyre gate', () {
      final List<String> positions = diagramPositions('Tr-Mixer', 'TM514');
      final Map<String, TyrePositionReading> readings =
          <String, TyrePositionReading>{
        for (final String position in positions)
          position: TyrePositionReading(position: position, checked: true),
      };

      expect(
        validateInspectionForSubmit(
          _basePayload(
            tyreConditions: readings,
            signature: 'data:image/png;base64,abc',
          ),
        ),
        isEmpty,
      );
    });

    test(
        'a signature-only gap is the sole reported issue once everything '
        'else is satisfied', () {
      final InspectionPayload payload = _basePayload(
        tyreConditions: <String, TyrePositionReading>{
          'LHF1': const TyrePositionReading(
            position: 'LHF1',
            pressurePsi: 110,
            checked: true,
          ),
        },
        vehicleType: 'unrecognised-type-xyz',
        // resolveVehicleType also falls back to the ASSET NUMBER when the
        // type resolves to nothing (artifact rule R10) - the default
        // 'TM514' from _basePayload would itself resolve to a known
        // Tri-mixer layout via the TM asset-prefix rule, defeating the
        // "unknown layout" premise this test relies on. An assetNo with no
        // recognised prefix keeps the layout genuinely unknown.
        assetNo: 'ZZ999',
      );
      // vehicleType (and now assetNo) are deliberately unrecognisable so the
      // layout is "unknown", which tyreCompleteness treats as blocking
      // NOTHING (see that engine's own honesty rules) - so completeness must
      // not appear here either, isolating the assertion to signature alone.
      final List<InspectionSubmitIssue> issues = validateInspectionForSubmit(
        payload,
      );
      expect(issues, <InspectionSubmitIssue>[
        InspectionSubmitIssue.missingSignature,
      ]);
    });

    test('an empty list means the sheet may be submitted', () {
      final InspectionPayload payload = _basePayload(
        tyreConditions: <String, TyrePositionReading>{
          'LHF1': const TyrePositionReading(
            position: 'LHF1',
            pressurePsi: 110,
            checked: true,
          ),
        },
        vehicleType: 'unrecognised-type-xyz',
        // See the comment on the previous test - the default assetNo
        // 'TM514' would otherwise resolve a known Tri-mixer layout.
        assetNo: 'ZZ999',
        signature: 'data:image/png;base64,abc',
      );
      expect(validateInspectionForSubmit(payload), isEmpty);
    });

    test('a signature that is only whitespace is treated as missing', () {
      final InspectionPayload payload = _basePayload(
        tyreConditions: <String, TyrePositionReading>{
          'LHF1': const TyrePositionReading(position: 'LHF1', checked: true),
        },
        signature: '   ',
      );
      expect(
        validateInspectionForSubmit(payload),
        contains(InspectionSubmitIssue.missingSignature),
      );
    });
  });

  group('touchedPositionCount', () {
    test('counts only positions with real evidence, not the seeded ones', () {
      final Map<String, TyrePositionReading> conditions =
          <String, TyrePositionReading>{
        'LHF1': const TyrePositionReading(position: 'LHF1', checked: true),
        'RHF1': TyrePositionReading.seed('RHF1'),
        'LHR1': const TyrePositionReading(
          position: 'LHR1',
          pressurePsi: 100,
        ),
      };
      expect(touchedPositionCount(conditions), 2);
    });
  });

  group('gps is carried through toRow but never gates submission', () {
    test('toRow spreads four null gps columns when no fix was captured', () {
      final InspectionPayload payload = _basePayload();
      final Map<String, Object?> row = payload.toRow();
      expect(row['gps_lat'], isNull);
      expect(row['gps_lng'], isNull);
      expect(row['gps_accuracy'], isNull);
      expect(row['gps_captured_at'], isNull);
    });

    test('toRow spreads a real fix when one was captured', () {
      final InspectionPayload payload = InspectionPayload(
        title: 't',
        site: 'NHC',
        assetNo: 'TM514',
        vehicleType: 'Tr-Mixer',
        inspector: 'A',
        inspectionDate: DateTime.utc(2026, 8, 20),
        scheduledDate: DateTime.utc(2026, 8, 20),
        tyreConditions: const <String, TyrePositionReading>{},
        gpsFix: InspectionGpsFix(
          latitude: 24.7,
          longitude: 46.7,
          accuracyMeters: 8.5,
          capturedAt: DateTime.utc(2026, 8, 20, 9),
        ),
      );
      final Map<String, Object?> row = payload.toRow();
      expect(row['gps_lat'], 24.7);
      expect(row['gps_lng'], 46.7);
      expect(row['gps_accuracy'], 8.5);
      expect(row['gps_captured_at'], isNotNull);
    });
  });
}
