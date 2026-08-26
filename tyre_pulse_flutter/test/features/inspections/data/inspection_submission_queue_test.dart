/// Coverage for [FileInspectionSubmissionQueue] against a real temporary
/// directory - the durability contract risk R2 depends on: atomic writes,
/// one file per submission, and a corrupt individual file degrading rather
/// than taking the whole read down.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

InspectionPayload _payload({String assetNo = 'TM514'}) {
  final DateTime now = DateTime.utc(2026, 8, 20, 9);
  return InspectionPayload(
    title: 't',
    site: 'NHC',
    assetNo: assetNo,
    vehicleType: 'Tr-Mixer',
    inspector: 'user-1',
    inspectionDate: now,
    scheduledDate: now,
    tyreConditions: const <String, TyrePositionReading>{},
  );
}

void main() {
  late Directory tempDir;
  late FileInspectionSubmissionQueue queue;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('inspection_queue_test_');
    queue = FileInspectionSubmissionQueue(overrideDirectory: tempDir);
  });

  tearDown(() async {
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  group('enqueue / list / byId', () {
    test(
      'a freshly enqueued item is readable back by id and by list()',
      () async {
        final QueuedInspection item = QueuedInspection(
          id: 'q-1',
          draftKey: 'user-1::TM514',
          payload: _payload(),
          createdAt: DateTime.utc(2026, 8, 20, 9, 1),
        );
        await queue.enqueue(item);

        final QueuedInspection? found = await queue.byId('q-1');
        expect(found, isNotNull);
        expect(found!.status, InspectionQueueStatus.pending);

        final InspectionQueueReadResult listed = await queue.list();
        expect(listed.isReadable, isTrue);
        expect(listed.items.map((q) => q.id), <String>['q-1']);
      },
    );

    test('byId returns null for an id that was never enqueued', () async {
      expect(await queue.byId('does-not-exist'), isNull);
    });

    test(
        'two independent submissions never collide - a write to one '
        'cannot corrupt another', () async {
      await queue.enqueue(
        QueuedInspection(
          id: 'q-1',
          draftKey: 'k1',
          payload: _payload(assetNo: 'TM514'),
          createdAt: DateTime.utc(2026, 8, 20),
        ),
      );
      await queue.enqueue(
        QueuedInspection(
          id: 'q-2',
          draftKey: 'k2',
          payload: _payload(assetNo: 'TM515'),
          createdAt: DateTime.utc(2026, 8, 20),
        ),
      );

      final InspectionQueueReadResult listed = await queue.list();
      expect(listed.items.length, 2);
      final Set<String> assetNumbers =
          listed.items.map((q) => q.payload.assetNo).toSet();
      expect(assetNumbers, <String>{'TM514', 'TM515'});
    });
  });

  group('markSynced / markFailed / remove', () {
    test(
        'markSynced updates status and syncedAt, and clears any prior '
        'error', () async {
      await queue.enqueue(
        QueuedInspection(
          id: 'q-1',
          draftKey: 'k',
          payload: _payload(),
          createdAt: DateTime.utc(2026, 8, 20),
          status: InspectionQueueStatus.failed,
          error: 'earlier failure',
        ),
      );

      final DateTime syncedAt = DateTime.utc(2026, 8, 20, 10);
      await queue.markSynced('q-1', syncedAt);

      final QueuedInspection? after = await queue.byId('q-1');
      expect(after!.status, InspectionQueueStatus.synced);
      expect(after.syncedAt, syncedAt);
      expect(after.error, isNull);
    });

    test('markFailed records the error and increments attempts', () async {
      await queue.enqueue(
        QueuedInspection(
          id: 'q-1',
          draftKey: 'k',
          payload: _payload(),
          createdAt: DateTime.utc(2026, 8, 20),
        ),
      );
      await queue.markFailed('q-1', error: 'network unreachable');
      await queue.markFailed('q-1', error: 'network unreachable');

      final QueuedInspection? after = await queue.byId('q-1');
      expect(after!.status, InspectionQueueStatus.failed);
      expect(after.error, 'network unreachable');
      expect(after.attempts, 2);
    });

    test('markSynced/markFailed on an unknown id is a safe no-op', () async {
      await queue.markSynced('ghost', DateTime.utc(2026, 8, 20));
      await queue.markFailed('ghost', error: 'x');
      expect((await queue.list()).items, isEmpty);
    });

    test(
      'remove deletes the entry so it no longer appears in list()',
      () async {
        await queue.enqueue(
          QueuedInspection(
            id: 'q-1',
            draftKey: 'k',
            payload: _payload(),
            createdAt: DateTime.utc(2026, 8, 20),
          ),
        );
        await queue.remove('q-1');
        expect((await queue.list()).items, isEmpty);
        expect(await queue.byId('q-1'), isNull);
      },
    );
  });

  group('pendingCount', () {
    test('counts everything not yet synced, ignores synced items', () async {
      await queue.enqueue(
        QueuedInspection(
          id: 'q-1',
          draftKey: 'k1',
          payload: _payload(),
          createdAt: DateTime.utc(2026, 8, 20),
        ),
      );
      await queue.enqueue(
        QueuedInspection(
          id: 'q-2',
          draftKey: 'k2',
          payload: _payload(),
          createdAt: DateTime.utc(2026, 8, 20),
          status: InspectionQueueStatus.failed,
          error: 'x',
        ),
      );
      await queue.enqueue(
        QueuedInspection(
          id: 'q-3',
          draftKey: 'k3',
          payload: _payload(),
          createdAt: DateTime.utc(2026, 8, 20),
          status: InspectionQueueStatus.synced,
          syncedAt: DateTime.utc(2026, 8, 20),
        ),
      );

      expect(await queue.pendingCount(), 2);
    });

    test('an empty queue reports 0, not an error', () async {
      expect(await queue.pendingCount(), 0);
    });
  });

  group(
    'a corrupt individual file is skipped, not fatal to the whole read',
    () {
      test(
        'list() omits an unparsable file but returns every other item',
        () async {
          await queue.enqueue(
            QueuedInspection(
              id: 'good-1',
              draftKey: 'k',
              payload: _payload(),
              createdAt: DateTime.utc(2026, 8, 20),
            ),
          );

          // Write a corrupt sibling file directly, bypassing the queue's own
          // atomic-write path - simulating a file that was truncated by a
          // process kill mid-write.
          final File corrupt = File(
            '${tempDir.path}${Platform.pathSeparator}inspection_submissions'
            '${Platform.pathSeparator}corrupt.json',
          );
          await corrupt.writeAsString('{not valid json');

          final InspectionQueueReadResult result = await queue.list();
          expect(result.isReadable, isTrue);
          expect(result.items.map((q) => q.id), <String>['good-1']);
        },
      );
    },
  );

  group('atomic write leaves no stray .tmp file behind on success', () {
    test('after enqueue, only the real .json file exists', () async {
      await queue.enqueue(
        QueuedInspection(
          id: 'q-1',
          draftKey: 'k',
          payload: _payload(),
          createdAt: DateTime.utc(2026, 8, 20),
        ),
      );
      final Directory folder = Directory(
        '${tempDir.path}${Platform.pathSeparator}inspection_submissions',
      );
      final List<String> names = await folder
          .list()
          .map((e) => e.path.split(Platform.pathSeparator).last)
          .toList();
      expect(names, <String>['q-1.json']);
    });
  });
}
