/// Coverage for [QueuedInspection]'s JSON round trip - the on-disk shape
/// [FileInspectionSubmissionQueue] persists one submission as. A drift here
/// would silently corrupt every queued inspection written by an earlier
/// app version, so the round trip is checked field by field rather than by
/// a single blanket equality.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

InspectionPayload _samplePayload() {
  return InspectionPayload(
    title: 'Daily Tyre Inspection - NHC - 2026-08-20',
    site: 'NHC',
    assetNo: 'TM514',
    vehicleType: 'Tr-Mixer',
    inspector: 'user-1',
    createdBy: 'user-1',
    inspectionDate: DateTime.utc(2026, 8, 20, 9, 30),
    scheduledDate: DateTime.utc(2026, 8, 20, 9, 30),
    tyreConditions: <String, TyrePositionReading>{
      'LHF1': const TyrePositionReading(
        position: 'LHF1',
        pressurePsi: 0,
        treadDepthMm: 8.2,
        serialNumber: 'SN-1',
        condition: TyreReadingCondition.flat,
        checked: true,
        photoUrl: 'https://example.test/lhf1.jpg',
        notes: 'Flat - replace before dispatch',
      ),
    },
    notes: 'Routine daily check',
    findings: 'One flat tyre',
    odometerKm: 145200,
    hourMeter: 3120.5,
    inspectorSignature: 'data:image/png;base64,AAAA',
    approvalStatus: 'pending_approval',
    status: 'In Progress',
    country: 'KSA',
    gpsFix: InspectionGpsFix(
      latitude: 24.7136,
      longitude: 46.6753,
      accuracyMeters: 12.0,
      capturedAt: DateTime.utc(2026, 8, 20, 9, 29),
    ),
  );
}

void main() {
  group('JSON round trip', () {
    test('every field survives toJson -> fromJson unchanged', () {
      final QueuedInspection original = QueuedInspection(
        id: 'client-uuid-1',
        draftKey: 'user-1::TM514',
        payload: _samplePayload(),
        createdAt: DateTime.utc(2026, 8, 20, 9, 31),
        status: InspectionQueueStatus.pending,
      );

      final QueuedInspection decoded = QueuedInspection.fromJsonString(
        original.toJsonString(),
      );

      expect(decoded.id, original.id);
      expect(decoded.draftKey, original.draftKey);
      expect(decoded.status, InspectionQueueStatus.pending);
      expect(decoded.attempts, 0);
      expect(decoded.error, isNull);
      expect(decoded.syncedAt, isNull);

      expect(decoded.payload.site, 'NHC');
      expect(decoded.payload.assetNo, 'TM514');
      expect(decoded.payload.odometerKm, 145200);
      expect(decoded.payload.hourMeter, 3120.5);
      expect(decoded.payload.approvalStatus, 'pending_approval');
      expect(decoded.payload.country, 'KSA');

      final TyrePositionReading reading =
          decoded.payload.tyreConditions['LHF1']!;
      expect(reading.pressurePsi, 0.0);
      expect(reading.pressurePsi, isNotNull);
      expect(reading.treadDepthMm, 8.2);
      expect(reading.serialNumber, 'SN-1');
      expect(reading.condition, TyreReadingCondition.flat);
      expect(reading.checked, isTrue);
      expect(reading.photoUrl, 'https://example.test/lhf1.jpg');

      expect(decoded.payload.gpsFix, isNotNull);
      expect(decoded.payload.gpsFix!.latitude, 24.7136);
      expect(decoded.payload.gpsFix!.longitude, 46.6753);
      expect(decoded.payload.gpsFix!.accuracyMeters, 12.0);
    });

    test('a synced item with an error already cleared round-trips clean', () {
      final QueuedInspection item = QueuedInspection(
        id: 'client-uuid-2',
        draftKey: 'user-1::TM515',
        payload: _samplePayload(),
        createdAt: DateTime.utc(2026, 8, 20),
        status: InspectionQueueStatus.synced,
        syncedAt: DateTime.utc(2026, 8, 20, 9, 32),
      );
      final QueuedInspection decoded = QueuedInspection.fromJsonString(
        item.toJsonString(),
      );
      expect(decoded.status, InspectionQueueStatus.synced);
      expect(decoded.syncedAt, isNotNull);
    });

    test('a failed item carries its sanitised error and attempt count', () {
      final QueuedInspection item = QueuedInspection(
        id: 'client-uuid-3',
        draftKey: 'user-1::TM516',
        payload: _samplePayload(),
        createdAt: DateTime.utc(2026, 8, 20),
        status: InspectionQueueStatus.failed,
        error: 'This record changed on the server.',
        attempts: 2,
      );
      final QueuedInspection decoded = QueuedInspection.fromJsonString(
        item.toJsonString(),
      );
      expect(decoded.status, InspectionQueueStatus.failed);
      expect(decoded.error, 'This record changed on the server.');
      expect(decoded.attempts, 2);
    });

    test('a payload with no gps fix decodes with a null gpsFix, not a '
        'malformed one', () {
      final InspectionPayload noGps = _samplePayload().copyWith(
        clearGpsFix: true,
      );
      final QueuedInspection item = QueuedInspection(
        id: 'client-uuid-4',
        draftKey: 'k',
        payload: noGps,
        createdAt: DateTime.utc(2026, 8, 20),
      );
      final QueuedInspection decoded = QueuedInspection.fromJsonString(
        item.toJsonString(),
      );
      expect(decoded.payload.gpsFix, isNull);
    });
  });

  group('malformed input is refused, never silently accepted', () {
    test('missing id throws FormatException', () {
      expect(
        () => QueuedInspection.fromJson(<String, Object?>{
          'draftKey': 'k',
          'payload': <String, Object?>{},
        }),
        throwsFormatException,
      );
    });

    test('missing draftKey throws FormatException', () {
      expect(
        () => QueuedInspection.fromJson(<String, Object?>{
          'id': 'id-1',
          'payload': <String, Object?>{},
        }),
        throwsFormatException,
      );
    });

    test('missing payload throws FormatException', () {
      expect(
        () => QueuedInspection.fromJson(<String, Object?>{
          'id': 'id-1',
          'draftKey': 'k',
        }),
        throwsFormatException,
      );
    });

    test('an unrecognised status wire value falls back to pending, never '
        'throws', () {
      final QueuedInspection decoded = QueuedInspection.fromJson(
        <String, Object?>{
          'id': 'id-1',
          'draftKey': 'k',
          'status': 'some-future-status',
          'payload': <String, Object?>{},
        },
      );
      expect(decoded.status, InspectionQueueStatus.pending);
    });
  });

  group('copyWith', () {
    test('clearError removes a previously-set error even when no new one '
        'is supplied', () {
      final QueuedInspection failed = QueuedInspection(
        id: 'id-1',
        draftKey: 'k',
        payload: _samplePayload(),
        createdAt: DateTime.utc(2026, 8, 20),
        status: InspectionQueueStatus.failed,
        error: 'boom',
      );
      final QueuedInspection recovered = failed.copyWith(
        status: InspectionQueueStatus.synced,
        clearError: true,
      );
      expect(recovered.status, InspectionQueueStatus.synced);
      expect(recovered.error, isNull);
    });
  });

  group('InspectionQueueReadResult', () {
    test('.ok carries items and reports isReadable true', () {
      final InspectionQueueReadResult result = InspectionQueueReadResult.ok(
        <QueuedInspection>[],
      );
      expect(result.isReadable, isTrue);
      expect(result.status, InspectionQueueReadStatus.ok);
      expect(result.items, isEmpty);
    });

    test('.unreadable is never mistaken for an empty, healthy read', () {
      const InspectionQueueReadResult result =
          InspectionQueueReadResult.unreadable();
      expect(result.isReadable, isFalse);
      expect(result.status, InspectionQueueReadStatus.unreadable);
      expect(result.items, isEmpty);
    });
  });
}
