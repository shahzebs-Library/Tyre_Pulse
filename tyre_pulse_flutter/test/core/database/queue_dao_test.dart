import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';

import 'database_test_support.dart';

void main() {
  late AppDatabase db;

  setUp(() {
    db = newMemoryDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  group('enqueue, claim, sync', () {
    test('a queued command starts pending and immediately due', () async {
      final command = await seedCommand(db, id: 'cmd-1');

      expect(command.status, CommandStatus.pending);
      expect(command.retryCount, 0);
      expect(command.syncedAt, isNull);
      expect(command.workspaceId, workspaceA);
      expectSameInstant(command.nextRetryAt, testNow);
    });

    test('claiming marks the row processing so a crash is visible', () async {
      await seedCommand(db, id: 'cmd-1');

      final claimed = await db.queueDao.claimNextBatch(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(claimed, hasLength(1));
      expect(claimed.single.id, 'cmd-1');
      expect(claimed.single.status, CommandStatus.processing);

      final stored = await db.queueDao.commandById('cmd-1');
      expect(stored!.status, CommandStatus.processing);
    });

    test('marking synced records the time and clears the last error', () async {
      await seedCommand(db, id: 'cmd-1');
      await db.queueDao.markAttemptFailed(
        'cmd-1',
        now: testNow,
        message: 'The server could not be reached.',
      );

      final DateTime syncedAt = testNow.add(const Duration(minutes: 5));
      await db.queueDao.markSynced('cmd-1', syncedAt);

      final stored = await db.queueDao.commandById('cmd-1');
      expect(stored!.status, CommandStatus.synced);
      expect(stored.lastError, isNull);
      expectSameInstant(stored.syncedAt!, syncedAt);
    });

    test('a synced command is not claimed again', () async {
      await seedCommand(db, id: 'cmd-1');
      await db.queueDao.markSynced('cmd-1', testNow);

      final claimed = await db.queueDao.claimNextBatch(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(hours: 1)),
      );
      expect(claimed, isEmpty);
    });

    test('claims oldest first so dependent work stays in order', () async {
      await seedCommand(
        db,
        id: 'cmd-newer',
        now: testNow.add(const Duration(minutes: 10)),
      );
      await seedCommand(db, id: 'cmd-older', now: testNow);

      final claimed = await db.queueDao.claimNextBatch(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(hours: 1)),
      );
      expect(claimed.map((PendingCommand c) => c.id).toList(), <String>[
        'cmd-older',
        'cmd-newer',
      ]);
    });
  });

  group('retry', () {
    test(
      'a failure increments the count and schedules 30 seconds out',
      () async {
        await seedCommand(db, id: 'cmd-1');

        final after = await db.queueDao.markAttemptFailed(
          'cmd-1',
          now: testNow,
          message: 'The server could not be reached.',
        );

        expect(after.retryCount, 1);
        expect(after.status, CommandStatus.retry);
        expect(after.lastError, 'The server could not be reached.');
        expectSameInstant(
          after.nextRetryAt,
          testNow.add(QueueRetryPolicy.baseBackoff),
        );
      },
    );

    test('the backoff doubles on each attempt', () async {
      await seedCommand(db, id: 'cmd-1');

      final first = await db.queueDao.markAttemptFailed(
        'cmd-1',
        now: testNow,
        message: 'no answer',
      );
      expectSameInstant(
        first.nextRetryAt,
        testNow.add(const Duration(seconds: 30)),
      );

      final second = await db.queueDao.markAttemptFailed(
        'cmd-1',
        now: testNow,
        message: 'no answer',
      );
      expect(second.retryCount, 2);
      expectSameInstant(
        second.nextRetryAt,
        testNow.add(const Duration(seconds: 60)),
      );
    });

    test('the backoff is capped at thirty minutes', () {
      expect(QueueRetryPolicy.backoffFor(0), const Duration(seconds: 30));
      expect(QueueRetryPolicy.backoffFor(1), const Duration(seconds: 60));
      expect(QueueRetryPolicy.backoffFor(5), const Duration(seconds: 960));
      expect(QueueRetryPolicy.backoffFor(6), const Duration(minutes: 30));
      expect(QueueRetryPolicy.backoffFor(40), const Duration(minutes: 30));
    });

    test('a row that is not yet due is not claimed', () async {
      await seedCommand(db, id: 'cmd-1');
      await db.queueDao.markAttemptFailed(
        'cmd-1',
        now: testNow,
        message: 'no answer',
      );

      final tooSoon = await db.queueDao.claimNextBatch(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(seconds: 29)),
      );
      expect(tooSoon, isEmpty);

      final dueNow = await db.queueDao.claimNextBatch(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(seconds: 31)),
      );
      expect(dueNow, hasLength(1));
    });

    test('an exhausted command fails but is never discarded', () async {
      await seedCommand(db, id: 'cmd-1');

      late PendingCommand latest;
      for (int attempt = 0; attempt < QueueRetryPolicy.maxRetries; attempt++) {
        latest = await db.queueDao.markAttemptFailed(
          'cmd-1',
          now: testNow,
          message: 'no answer',
        );
      }

      expect(latest.retryCount, QueueRetryPolicy.maxRetries);
      expect(latest.status, CommandStatus.failed);
      expect(
        await db.queueDao.commandById('cmd-1'),
        isNotNull,
        reason: 'nothing that has not reached the server is ever removed '
            'automatically',
      );
    });

    test('retry failed puts the row back at the front of the queue', () async {
      await seedCommand(db, id: 'cmd-1');
      for (int attempt = 0; attempt < QueueRetryPolicy.maxRetries; attempt++) {
        await db.queueDao.markAttemptFailed(
          'cmd-1',
          now: testNow,
          message: 'no answer',
        );
      }

      final DateTime later = testNow.add(const Duration(hours: 2));
      await db.queueDao.retryFailed(now: later);

      final stored = await db.queueDao.commandById('cmd-1');
      expect(stored!.status, CommandStatus.pending);
      expect(stored.retryCount, 0);
      expect(stored.lastError, isNull);
      expectSameInstant(stored.nextRetryAt, later);
    });
  });

  group('blocked', () {
    test('a blocked command is never claimed', () async {
      await seedCommand(db, id: 'cmd-1');
      await db.queueDao.blockCommand(
        'cmd-1',
        reason: 'Captured in another workspace.',
      );

      final claimed = await db.queueDao.claimNextBatch(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(days: 1)),
      );

      expect(claimed, isEmpty);
      final stored = await db.queueDao.commandById('cmd-1');
      expect(stored!.status, CommandStatus.blocked);
      expect(stored.lastError, 'Captured in another workspace.');
    });

    test('a blocked command still counts as outstanding work', () async {
      await seedCommand(db, id: 'cmd-1');
      await db.queueDao.blockCommand('cmd-1', reason: 'Another workspace.');

      expect(await db.queueDao.pendingCount(), 1);
    });

    test(
      'unblocking returns it to the queue when the workspace is active',
      () async {
        await seedCommand(db, id: 'cmd-1');
        await db.queueDao.blockCommand('cmd-1', reason: 'Another workspace.');

        await db.queueDao.unblockForWorkspace(
          workspaceId: workspaceA,
          now: testNow,
        );

        final claimed = await db.queueDao.claimNextBatch(
          workspaceId: workspaceA,
          now: testNow,
        );
        expect(claimed, hasLength(1));
      },
    );

    test('a command captured in another workspace is not claimed', () async {
      await seedCommand(db, id: 'cmd-b', workspaceId: workspaceB);

      final claimed = await db.queueDao.claimNextBatch(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(
        claimed,
        isEmpty,
        reason: 'pushing it under the active context would be a cross-tenant '
            'write',
      );
      expect(
        await db.queueDao.commandById('cmd-b'),
        isNotNull,
        reason: 'and it is never discarded either',
      );
    });

    test(
      'a command waiting on an unsynced predecessor is blocked, not run',
      () async {
        await seedCommand(db, id: 'cmd-first');
        await db.queueDao.enqueue(
          id: 'cmd-second',
          commandType: 'WORKSHOP_EVENT',
          entityType: 'tech_activity_events',
          payloadJson: '{"event":"complete"}',
          createdBy: testUser,
          workspaceId: workspaceA,
          now: testNow.add(const Duration(minutes: 1)),
          idempotencyKey: 'idem-second',
          dependsOn: 'cmd-first',
        );

        final claimed = await db.queueDao.claimNextBatch(
          workspaceId: workspaceA,
          now: testNow.add(const Duration(hours: 1)),
        );

        expect(claimed.map((PendingCommand c) => c.id).toList(), <String>[
          'cmd-first',
        ]);
        final second = await db.queueDao.commandById('cmd-second');
        expect(second!.status, CommandStatus.blocked);
      },
    );
  });

  group('idempotency key', () {
    test('is stable across every retry of the same logical write', () async {
      final original = await seedCommand(db, id: 'cmd-1');
      final String key = original.idempotencyKey;

      for (int attempt = 0; attempt < 3; attempt++) {
        final after = await db.queueDao.markAttemptFailed(
          'cmd-1',
          now: testNow,
          message: 'no answer',
        );
        expect(
          after.idempotencyKey,
          key,
          reason: 'a fresh key on retry is the exact double-insert the '
              'mechanism exists to prevent',
        );
      }

      await db.queueDao.retryFailed(now: testNow);
      final reset = await db.queueDao.commandById('cmd-1');
      expect(reset!.idempotencyKey, key);
    });

    test(
      'is unique, so two screens cannot queue the same write twice',
      () async {
        await seedCommand(db, id: 'cmd-1', idempotencyKey: 'shared-key');

        await expectLater(
          seedCommand(db, id: 'cmd-2', idempotencyKey: 'shared-key'),
          throwsA(isA<Exception>()),
        );

        expect(
          await db.queueDao.commandByIdempotencyKey('shared-key'),
          isNotNull,
        );
        expect(
          await db.queueDao.commandById('cmd-2'),
          isNull,
          reason:
              'the whole enqueue is one transaction, so a refused key leaves '
              'nothing behind',
        );
      },
    );

    test('is generated when the caller does not supply one', () async {
      final first = await db.queueDao.enqueue(
        commandType: 'ODOMETER_LOG',
        entityType: 'odometer_logs',
        payloadJson: '{"km":1200}',
        createdBy: testUser,
        workspaceId: workspaceA,
        now: testNow,
      );
      final second = await db.queueDao.enqueue(
        commandType: 'ODOMETER_LOG',
        entityType: 'odometer_logs',
        payloadJson: '{"km":1300}',
        createdBy: testUser,
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(first.idempotencyKey, isNotEmpty);
      expect(first.idempotencyKey, isNot(second.idempotencyKey));
    });
  });

  group('pending count', () {
    test('counts everything that is not synced, failures included', () async {
      await seedCommand(db, id: 'cmd-pending');
      await seedCommand(db, id: 'cmd-failed');
      await seedCommand(db, id: 'cmd-synced');

      for (int attempt = 0; attempt < QueueRetryPolicy.maxRetries; attempt++) {
        await db.queueDao.markAttemptFailed(
          'cmd-failed',
          now: testNow,
          message: 'no answer',
        );
      }
      await db.queueDao.markSynced('cmd-synced', testNow);

      expect(
        await db.queueDao.pendingCount(),
        2,
        reason: 'counting only pending made every badge read 0 the moment an '
            'item failed, and the technician was shown all synced while an '
            'inspection sat unsent',
      );
    });

    test('can be narrowed to one workspace', () async {
      await seedCommand(db, id: 'cmd-a', workspaceId: workspaceA);
      await seedCommand(db, id: 'cmd-b', workspaceId: workspaceB);

      expect(await db.queueDao.pendingCount(workspaceId: workspaceA), 1);
      expect(await db.queueDao.pendingCount(), 2);
    });
  });

  group('pruning', () {
    test(
      'removes a synced command and hands back its files to delete',
      () async {
        await seedCommand(
          db,
          id: 'cmd-1',
          attachments: <QueuedMediaAttachment>[queuedPhoto('q_1.jpg')],
        );
        await db.queueDao.markSynced('cmd-1', testNow);
        await db.mediaDao.markUploaded(
          (await db.mediaDao.mediaForCommand('cmd-1')).single.id,
          bucket: 'tyre-photos',
          remotePath: 'org-a/q_1.jpg',
          remoteRef: 'tp-storage://tyre-photos/org-a/q_1.jpg',
          at: testNow,
        );
        await db.mediaDao.markCommandMediaVerified('cmd-1');

        final List<String> files = await db.queueDao.pruneSyncedCommands();

        expect(files, <String>['/data/user/0/app/files/queue-media/q_1.jpg']);
        expect(await db.queueDao.commandById('cmd-1'), isNull);
        expect(await db.mediaDao.mediaForCommand('cmd-1'), isEmpty);
      },
    );

    test('keeps a synced command whose photo is not yet confirmed', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        attachments: <QueuedMediaAttachment>[queuedPhoto('q_1.jpg')],
      );
      await db.queueDao.markSynced('cmd-1', testNow);

      final List<String> files = await db.queueDao.pruneSyncedCommands();

      expect(files, isEmpty);
      expect(
        await db.queueDao.commandById('cmd-1'),
        isNotNull,
        reason: 'the command row is the only thing keeping the photo file '
            'alive until the upload is confirmed',
      );
    });

    test('never prunes an unsynced command', () async {
      await seedCommand(db, id: 'cmd-1');
      await db.queueDao.pruneSyncedCommands();
      expect(await db.queueDao.commandById('cmd-1'), isNotNull);
    });
  });

  group('failures log', () {
    test('keeps the newest entries by count, not by age', () async {
      for (int i = 0; i < RetentionLimits.syncFailures + 5; i++) {
        await db.queueDao.recordFailure(
          id: 'fail-${i.toString().padLeft(4, '0')}',
          errorClass: SyncErrorClass.network,
          occurredAt: testNow.add(Duration(seconds: i)),
          attempt: 1,
          messageSafe: 'The server could not be reached.',
        );
      }

      final all = await db.queueDao.recentFailures(limit: 1000);
      expect(all, hasLength(RetentionLimits.syncFailures));
      expect(all.first.id, 'fail-0204');
    });

    test('survives a command being pruned', () async {
      await seedCommand(db, id: 'cmd-1');
      await db.queueDao.recordFailure(
        commandId: 'cmd-1',
        errorClass: SyncErrorClass.validation,
        occurredAt: testNow,
        attempt: 1,
        messageSafe: 'That record was refused.',
      );
      await db.queueDao.markSynced('cmd-1', testNow);
      await db.queueDao.pruneSyncedCommands();

      final failures = await db.queueDao.recentFailures();
      expect(failures, hasLength(1));
      expect(failures.single.commandId, 'cmd-1');
    });
  });

  group('stale claims', () {
    test(
      'a claim abandoned by a crashed run is returned to the queue',
      () async {
        await seedCommand(db, id: 'cmd-1');
        await db.queueDao.claimNextBatch(workspaceId: workspaceA, now: testNow);

        final DateTime later = testNow.add(const Duration(minutes: 30));
        final int reclaimed = await db.queueDao.reclaimStaleClaims(now: later);

        expect(reclaimed, 1);
        final stored = await db.queueDao.commandById('cmd-1');
        expect(stored!.status, CommandStatus.pending);
      },
    );
  });

  group('sync lock', () {
    test('a second engine cannot take a live lock', () async {
      expect(
        await db.queueDao.acquireSyncLock(holder: 'engine-1', now: testNow),
        isTrue,
      );
      expect(
        await db.queueDao.acquireSyncLock(
          holder: 'engine-2',
          now: testNow.add(const Duration(seconds: 10)),
        ),
        isFalse,
      );
    });

    test(
      'a stale lock can be broken so the queue is not stuck forever',
      () async {
        await db.queueDao.acquireSyncLock(holder: 'engine-1', now: testNow);

        expect(
          await db.queueDao.acquireSyncLock(
            holder: 'engine-2',
            now: testNow.add(const Duration(hours: 1)),
          ),
          isTrue,
        );
      },
    );

    test('releasing lets the next engine in', () async {
      await db.queueDao.acquireSyncLock(holder: 'engine-1', now: testNow);
      await db.queueDao.releaseSyncLock(now: testNow);

      expect(
        await db.queueDao.acquireSyncLock(
          holder: 'engine-2',
          now: testNow.add(const Duration(seconds: 1)),
        ),
        isTrue,
      );
    });
  });
}
