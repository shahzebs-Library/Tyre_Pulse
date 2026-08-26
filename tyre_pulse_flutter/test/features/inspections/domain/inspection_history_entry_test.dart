/// Coverage for [InspectionHistoryEntry.fromQueued] and
/// [sortInspectionHistory] - the merge that lets "My Inspections" show
/// queued and synced work in one newest-first list.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_history_entry.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

QueuedInspection _queued({
  required String id,
  required InspectionQueueStatus status,
  required DateTime createdAt,
  DateTime? syncedAt,
  String? error,
}) {
  return QueuedInspection(
    id: id,
    draftKey: 'user-1::$id',
    createdAt: createdAt,
    syncedAt: syncedAt,
    status: status,
    error: error,
    payload: InspectionPayload(
      title: 't',
      site: 'NHC',
      assetNo: 'TM514',
      vehicleType: 'Tr-Mixer',
      inspector: 'user-1',
      inspectionDate: createdAt,
      scheduledDate: createdAt,
      tyreConditions: const <String, TyrePositionReading>{},
      approvalStatus: 'pending_approval',
    ),
  );
}

void main() {
  group('InspectionHistoryEntry.fromQueued', () {
    test('carries the queue id as its own id and no recordId', () {
      final QueuedInspection q = _queued(
        id: 'q-1',
        status: InspectionQueueStatus.pending,
        createdAt: DateTime.utc(2026, 8, 20),
      );
      final InspectionHistoryEntry entry = InspectionHistoryEntry.fromQueued(q);
      expect(entry.source, InspectionHistorySource.queued);
      expect(entry.id, 'q-1');
      expect(entry.recordId, isNull);
      expect(entry.isLocalOnly, isTrue);
    });

    test('updatedAt prefers syncedAt over createdAt when both are set', () {
      final QueuedInspection q = _queued(
        id: 'q-1',
        status: InspectionQueueStatus.synced,
        createdAt: DateTime.utc(2026, 8, 20),
        syncedAt: DateTime.utc(2026, 8, 21),
      );
      final InspectionHistoryEntry entry = InspectionHistoryEntry.fromQueued(q);
      expect(entry.updatedAt, DateTime.utc(2026, 8, 21));
    });

    test('updatedAt falls back to createdAt when there is no syncedAt', () {
      final QueuedInspection q = _queued(
        id: 'q-1',
        status: InspectionQueueStatus.pending,
        createdAt: DateTime.utc(2026, 8, 20),
      );
      final InspectionHistoryEntry entry = InspectionHistoryEntry.fromQueued(q);
      expect(entry.updatedAt, DateTime.utc(2026, 8, 20));
    });

    test('needsAttention is true only for a failed queued entry', () {
      final InspectionHistoryEntry failed = InspectionHistoryEntry.fromQueued(
        _queued(
          id: 'q-1',
          status: InspectionQueueStatus.failed,
          createdAt: DateTime.utc(2026, 8, 20),
          error: 'conflict',
        ),
      );
      final InspectionHistoryEntry pending = InspectionHistoryEntry.fromQueued(
        _queued(
          id: 'q-2',
          status: InspectionQueueStatus.pending,
          createdAt: DateTime.utc(2026, 8, 20),
        ),
      );
      expect(failed.needsAttention, isTrue);
      expect(pending.needsAttention, isFalse);
    });
  });

  group('sortInspectionHistory', () {
    test('orders newest activity first and does not mutate the input', () {
      final List<InspectionHistoryEntry> input = <InspectionHistoryEntry>[
        InspectionHistoryEntry.fromQueued(
          _queued(
            id: 'oldest',
            status: InspectionQueueStatus.pending,
            createdAt: DateTime.utc(2026, 8, 18),
          ),
        ),
        InspectionHistoryEntry.fromQueued(
          _queued(
            id: 'newest',
            status: InspectionQueueStatus.pending,
            createdAt: DateTime.utc(2026, 8, 22),
          ),
        ),
        InspectionHistoryEntry.fromQueued(
          _queued(
            id: 'middle',
            status: InspectionQueueStatus.pending,
            createdAt: DateTime.utc(2026, 8, 20),
          ),
        ),
      ];

      final List<InspectionHistoryEntry> sorted = sortInspectionHistory(input);

      expect(sorted.map((e) => e.id).toList(), <String>[
        'newest',
        'middle',
        'oldest',
      ]);
      // The input list's own order is untouched.
      expect(input.first.id, 'oldest');
    });
  });
}
