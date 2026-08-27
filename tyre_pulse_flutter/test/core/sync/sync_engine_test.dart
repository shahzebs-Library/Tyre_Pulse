import 'dart:collection';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';
import 'package:tyre_pulse/core/sync/sync_outcome.dart';

import '../database/database_test_support.dart';

/// One recorded call to [_FakeCommandPusher.push], for assertions on what
/// [SyncEngine] actually sent.
class _PushCallRecord {
  const _PushCallRecord({
    required this.spec,
    required this.payload,
    this.matchValue,
    this.expectedPriorStatus,
  });

  final CommandSpec spec;
  final Map<String, Object?> payload;
  final String? matchValue;
  final String? expectedPriorStatus;
}

/// A scriptable [CommandPusher].
///
/// A response is looked up by KEY - the update `matchValue` when there is
/// one, otherwise the insert's `client_uuid` - so a single test can give two
/// different commands two different outcomes within the same
/// `SyncEngine.runOnce` call. A key with nothing scripted for it returns an
/// empty row list rather than throwing, so a test that forgets to script a
/// call it did not mean to make fails on an assertion about the result, not
/// on an unrelated null-checked lookup.
class _FakeCommandPusher implements CommandPusher {
  final List<_PushCallRecord> calls = <_PushCallRecord>[];
  final Map<String, Queue<Object>> _scripts = <String, Queue<Object>>{};
  final Queue<Object> _unkeyed = Queue<Object>();

  void willReturnFor(String key, List<Map<String, Object?>> rows) {
    (_scripts[key] ??= Queue<Object>()).add(rows);
  }

  void willThrowFor(String key, SupabaseFailure failure) {
    (_scripts[key] ??= Queue<Object>()).add(failure);
  }

  void willReturn(List<Map<String, Object?>> rows) => _unkeyed.add(rows);

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    calls.add(
      _PushCallRecord(
        spec: spec,
        payload: Map<String, Object?>.unmodifiable(payload),
        matchValue: matchValue,
        expectedPriorStatus: expectedPriorStatus,
      ),
    );

    final String? key = matchValue ?? payload['client_uuid'] as String?;
    final Queue<Object> queue =
        (key != null ? _scripts[key] : null) ?? _unkeyed;
    final Object outcome =
        queue.isNotEmpty ? queue.removeFirst() : const <Map<String, Object?>>[];

    if (outcome is SupabaseFailure) {
      throw outcome;
    }
    return outcome as List<Map<String, Object?>>;
  }
}

/// A scriptable [MediaUploader], keyed by file name (already guaranteed
/// unique by `pending_media_uploads`'s own unique index).
class _FakeMediaUploader implements MediaUploader {
  final List<String> calledFor = <String>[];
  final Map<String, Object> _outcomes = <String, Object>{};

  void willSucceed(String fileName) {
    _outcomes[fileName] = MediaUploadResult(
      remotePath: fileName,
      remoteRef: 'tp-storage://test-bucket/$fileName',
    );
  }

  void willFail(String fileName, SupabaseFailure failure) {
    _outcomes[fileName] = failure;
  }

  @override
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  }) async {
    calledFor.add(fileName);
    final Object? outcome = _outcomes[fileName];
    if (outcome is SupabaseFailure) {
      throw outcome;
    }
    if (outcome is MediaUploadResult) {
      return outcome;
    }
    // A file name nobody scripted a result for still succeeds, so a test
    // that only cares about one photo among several does not have to script
    // every one of them individually.
    return MediaUploadResult(
      remotePath: fileName,
      remoteRef: 'tp-storage://test-bucket/$fileName',
    );
  }
}

/// A queued photo attachment with a real destination bucket set.
///
/// `queuedPhoto()` from `database_test_support.dart` deliberately leaves
/// `bucket` null (the DAO-level tests it was written for do not care about
/// upload routing); `SyncEngine` treats a media row with no bucket as a data
/// problem and fails it before ever calling the uploader, so any test that
/// wants the fake uploader actually invoked needs this instead.
QueuedMediaAttachment _photoWithBucket(String fileName) {
  return QueuedMediaAttachment(
    localPath: '/data/user/0/app/files/queue-media/$fileName',
    fileName: fileName,
    orderIndex: 0,
    bucket: 'tyre-photos',
  );
}

SupabaseFailure _uniqueViolationFailure() {
  return const SupabaseFailure(
    error: AppError(
      kind: AppErrorKind.conflict,
      message: 'This has already been saved.',
    ),
    cause: SupabaseFailureCause.uniqueViolation,
    code: '23505',
  );
}

SupabaseFailure _networkFailure() {
  return const SupabaseFailure(
    error: AppError.network(),
    cause: SupabaseFailureCause.offline,
  );
}

void main() {
  late AppDatabase db;

  setUp(() {
    db = newMemoryDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  SyncEngine buildEngine({
    required _FakeCommandPusher pusher,
    required _FakeMediaUploader uploader,
    String holderId = 'engine-under-test',
  }) {
    return SyncEngine(
      queueDao: db.queueDao,
      mediaDao: db.mediaDao,
      pusher: pusher,
      uploader: uploader,
      holderId: holderId,
    );
  }

  group('successful inserts', () {
    test(
        'a successful insert reaches synced, is pruned, and carries a '
        'defensively re-filtered payload with client_uuid attached', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        commandType: 'WORK_ORDER',
        entityType: 'work_orders',
        idempotencyKey: 'idem-cmd-1',
        payloadJson: jsonEncode(<String, Object?>{
          'work_order_no': 'WO-1001',
          'status': 'Open',
          // Not in WORK_ORDER's field allow-list. QueuedCommandRepository
          // already filters at enqueue time, but SyncEngine must not trust
          // that a payload already on disk was actually filtered - this is
          // the "last line of defence" the library comment describes.
          'not_a_real_column': 'must never reach the network',
        }),
      );

      final _FakeCommandPusher pusher = _FakeCommandPusher()
        ..willReturnFor('idem-cmd-1', <Map<String, Object?>>[
          <String, Object?>{'id': 'row-1'},
        ]);
      final SyncEngine engine = buildEngine(
        pusher: pusher,
        uploader: _FakeMediaUploader(),
      );

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(summary.claimed, 1);
      expect(summary.synced, 1);
      expect(summary.failed, 0);
      expect(summary.conflicted, 0);
      expect(summary.mediaPending, 0);

      expect(pusher.calls, hasLength(1));
      final _PushCallRecord call = pusher.calls.single;
      expect(call.spec.type, CommandType.workOrder);
      expect(call.matchValue, isNull, reason: 'an insert has no match value');
      expect(call.payload['work_order_no'], 'WO-1001');
      expect(
        call.payload.containsKey('not_a_real_column'),
        isFalse,
        reason: 'anything outside the field allow-list must never reach '
            'the pusher, even if it somehow reached the stored payload',
      );
      expect(
        call.payload['client_uuid'],
        'idem-cmd-1',
        reason: "every insert must carry the command's own idempotency key "
            'so a duplicate on replay is a duplicate of a KNOWN row',
      );

      expect(
        await db.queueDao.commandById('cmd-1'),
        isNull,
        reason: 'a synced command with no attached media has nothing left '
            'to wait on and is pruned within the same pass',
      );
    });
  });

  group('idempotent replay of an insert', () {
    test(
        'a duplicate key on the FIRST attempt is a genuine conflict, not '
        'a replay, and is never marked synced', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        commandType: 'WORK_ORDER',
        entityType: 'work_orders',
        idempotencyKey: 'idem-cmd-1',
        payloadJson: jsonEncode(<String, Object?>{'work_order_no': 'WO-1'}),
      );

      final _FakeCommandPusher pusher = _FakeCommandPusher()
        ..willThrowFor('idem-cmd-1', _uniqueViolationFailure());
      final SyncEngine engine = buildEngine(
        pusher: pusher,
        uploader: _FakeMediaUploader(),
      );

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(summary.synced, 0);
      expect(summary.conflicted, 1);
      expect(summary.failed, 0);

      final PendingCommand? stored = await db.queueDao.commandById('cmd-1');
      expect(
        stored,
        isNotNull,
        reason: 'a conflict is recorded and stays in the queue - nothing '
            'that has not reached the server is ever discarded',
      );
      expect(stored!.status, CommandStatus.retry);
      expect(stored.retryCount, 1);
      expect(stored.lastError, isNotNull);

      final List<SyncFailure> failures = await db.queueDao.recentFailures();
      expect(failures, hasLength(1));
      expect(failures.single.errorClass, SyncErrorClass.conflict);
      expect(failures.single.commandId, 'cmd-1');
    });

    test(
        'the SAME duplicate key on a RETRY (retryCount > 0) is read as a '
        'successful replay and marks the command synced', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        commandType: 'WORK_ORDER',
        entityType: 'work_orders',
        idempotencyKey: 'idem-cmd-1',
        payloadJson: jsonEncode(<String, Object?>{'work_order_no': 'WO-1'}),
      );
      // Force one prior failed attempt so the claimed row's retryCount is
      // already > 0 before this run - simulating "the first attempt's
      // response was lost, but the write actually landed".
      await db.queueDao.markAttemptFailed(
        'cmd-1',
        now: testNow,
        message: 'The server could not be reached.',
      );

      final DateTime later = testNow.add(const Duration(minutes: 1));
      final _FakeCommandPusher pusher = _FakeCommandPusher()
        ..willThrowFor('idem-cmd-1', _uniqueViolationFailure());
      final SyncEngine engine = buildEngine(
        pusher: pusher,
        uploader: _FakeMediaUploader(),
      );

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: later,
      );

      expect(summary.synced, 1);
      expect(summary.conflicted, 0);
      expect(summary.failed, 0);

      expect(
        await db.queueDao.commandById('cmd-1'),
        isNull,
        reason: 'treated as synced, and pruned since it has no attached '
            'media to wait on',
      );
    });
  });

  group('optimistic status match', () {
    test(
        'an update whose optimistic status match returns no rows is a '
        'conflict, never a silent success', () async {
      await db.queueDao.enqueue(
        id: 'cmd-1',
        commandType: 'WORK_ORDER_STATUS',
        entityType: 'work_orders',
        payloadJson: jsonEncode(<String, Object?>{
          'status': 'Completed',
          expectedPriorStatusPayloadKey: 'In Progress',
        }),
        createdBy: testUser,
        workspaceId: workspaceA,
        now: testNow,
        idempotencyKey: 'idem-cmd-1',
        entityId: 'wo-row-1',
      );

      final _FakeCommandPusher pusher = _FakeCommandPusher()
        ..willReturnFor('wo-row-1', const <Map<String, Object?>>[]);
      final SyncEngine engine = buildEngine(
        pusher: pusher,
        uploader: _FakeMediaUploader(),
      );

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(summary.synced, 0);
      expect(summary.conflicted, 1);

      final _PushCallRecord call = pusher.calls.single;
      expect(call.matchValue, 'wo-row-1');
      expect(call.expectedPriorStatus, 'In Progress');
      expect(
        call.payload.containsKey('id'),
        isFalse,
        reason: 'the match column must never appear in the SET clause an '
            'update sends, or the primary key would be rewritten',
      );
      expect(
        call.payload.containsKey(expectedPriorStatusPayloadKey),
        isFalse,
        reason: 'the expected-prior-status hint is read to build the '
            'filter, never sent as a column',
      );
      expect(call.payload['status'], 'Completed');

      final PendingCommand? stored = await db.queueDao.commandById('cmd-1');
      expect(
        stored!.status,
        CommandStatus.retry,
        reason: 'a stale-conflict update is recorded like any other '
            'failure - a person needs to see it, not have it silently '
            'dropped',
      );
    });

    test(
        'an update whose optimistic status match returns a row is '
        'synced normally', () async {
      await db.queueDao.enqueue(
        id: 'cmd-1',
        commandType: 'CORRECTIVE_ACTION_STATUS',
        entityType: 'corrective_actions',
        payloadJson: jsonEncode(<String, Object?>{
          'status': 'closed',
          expectedPriorStatusPayloadKey: 'open',
        }),
        createdBy: testUser,
        workspaceId: workspaceA,
        now: testNow,
        idempotencyKey: 'idem-cmd-1',
        entityId: 'ca-row-1',
      );

      final _FakeCommandPusher pusher = _FakeCommandPusher()
        ..willReturnFor('ca-row-1', <Map<String, Object?>>[
          <String, Object?>{'id': 'ca-row-1', 'status': 'closed'},
        ]);
      final SyncEngine engine = buildEngine(
        pusher: pusher,
        uploader: _FakeMediaUploader(),
      );

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(summary.synced, 1);
      expect(summary.conflicted, 0);
    });
  });

  group('media readiness gate', () {
    test(
        'a requiresMediaReady command whose photo has not uploaded is '
        'returned to pending and the pusher is never called for it', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        idempotencyKey: 'idem-cmd-1',
        attachments: <QueuedMediaAttachment>[_photoWithBucket('tyre1.jpg')],
      );

      final _FakeMediaUploader uploader = _FakeMediaUploader()
        ..willFail('tyre1.jpg', _networkFailure());
      final _FakeCommandPusher pusher = _FakeCommandPusher();
      final SyncEngine engine = buildEngine(pusher: pusher, uploader: uploader);

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(
        pusher.calls,
        isEmpty,
        reason: 'the business row must never be written before its '
            'evidence is confirmed',
      );
      expect(summary.claimed, 1);
      expect(summary.mediaPending, 1);
      expect(summary.synced, 0);
      expect(summary.failed, 0);
      // A photo that fails EVERY attempt is retried within this SAME pass,
      // not just once: `_drainMediaUploads` loops in rounds bounded by
      // `uploadConcurrency`, and `MediaDao.markUploadAttemptFailed` resets
      // the row back to `queued` (attempts+1) until `maxUploadAttempts` is
      // reached, so it is re-claimed by the next round rather than waiting
      // for a later sync pass. `_maxMediaClaimRounds`'s own doc comment on
      // `SyncEngine` derives its worst-case bound as exactly
      // `(queued rows) * maxUploadAttempts` for this reason. One row that
      // always fails therefore accounts for `maxUploadAttempts` (3) failed
      // attempts in a single `runOnce` call.
      expect(summary.photosFailed, maxUploadAttempts);

      final PendingCommand? stored = await db.queueDao.commandById('cmd-1');
      expect(stored!.status, CommandStatus.pending);
      expect(
        stored.retryCount,
        0,
        reason: 'waiting on evidence is not a failed attempt - '
            'QueueDao.returnToPending must never touch the retry counter',
      );
      expect(stored.lastError, isNull);
    });

    test(
        'a successful photo upload flows through to a synced, pruned '
        'command, while a failed one keeps its command from syncing ahead '
        'of its evidence', () async {
      await seedCommand(
        db,
        id: 'cmd-ready',
        idempotencyKey: 'idem-cmd-ready',
        attachments: <QueuedMediaAttachment>[_photoWithBucket('ready.jpg')],
      );
      await seedCommand(
        db,
        id: 'cmd-blocked',
        idempotencyKey: 'idem-cmd-blocked',
        attachments: <QueuedMediaAttachment>[_photoWithBucket('blocked.jpg')],
      );

      final _FakeMediaUploader uploader = _FakeMediaUploader()
        ..willSucceed('ready.jpg')
        ..willFail('blocked.jpg', _networkFailure());
      final _FakeCommandPusher pusher = _FakeCommandPusher()
        ..willReturnFor('idem-cmd-ready', <Map<String, Object?>>[
          <String, Object?>{'id': 'row-ready'},
        ]);
      final SyncEngine engine = buildEngine(pusher: pusher, uploader: uploader);

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(summary.photosUploaded, 1);
      // See the sibling test above for why one permanently-failing photo
      // accounts for `maxUploadAttempts` failed attempts within this same
      // pass, not just one.
      expect(summary.photosFailed, maxUploadAttempts);
      expect(
        summary.synced,
        1,
        reason: 'only the command whose photo actually reached the server '
            'this pass was pushed',
      );
      expect(summary.mediaPending, 1);

      expect(
        await db.queueDao.commandById('cmd-ready'),
        isNull,
        reason: 'synced with its one photo verified, so it was pruned in '
            'the same pass',
      );

      expect(
        pusher.calls,
        hasLength(1),
        reason: 'the blocked command must never have reached the pusher '
            'at all',
      );
      expect(pusher.calls.single.payload['client_uuid'], 'idem-cmd-ready');

      final PendingCommand? blocked = await db.queueDao.commandById(
        'cmd-blocked',
      );
      expect(blocked!.status, CommandStatus.pending);

      final PendingMediaUpload blockedMedia =
          (await db.mediaDao.mediaForCommand('cmd-blocked')).single;
      // A permanently-failing upload is retried within this SAME pass
      // (see the comment on the previous test), so by the time
      // `_drainMediaUploads` stops finding claimable rows it has already
      // spent all `maxUploadAttempts` on this one - it is exhausted, not
      // merely queued for a later pass.
      expect(blockedMedia.attempts, maxUploadAttempts);
      expect(
        blockedMedia.state,
        MediaUploadState.failed,
        reason: 'maxUploadAttempts was reached within this pass, so the '
            'row is reported rather than retried into another crash loop '
            '- see MediaDao.claimNextUploads\' own doc comment',
      );
    });

    test(
        'a requiresMediaReady command with NO attached photos at all is '
        'ready immediately, not stuck waiting on evidence that was never '
        'promised', () async {
      // MediaDao.commandMediaReady answers true vacuously when a command has
      // zero media rows - nothing is outstanding because nothing was ever
      // attached. A command genuinely photographed with nothing to show
      // (a tyre change with no photo field filled in) must not wait forever
      // for evidence that will never arrive.
      await seedCommand(
        db,
        id: 'cmd-1',
        idempotencyKey: 'idem-cmd-1',
        // No attachments - the default.
      );

      final _FakeCommandPusher pusher = _FakeCommandPusher()
        ..willReturnFor('idem-cmd-1', <Map<String, Object?>>[
          <String, Object?>{'id': 'row-1'},
        ]);
      final SyncEngine engine = buildEngine(
        pusher: pusher,
        uploader: _FakeMediaUploader(),
      );

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(summary.synced, 1);
      expect(summary.mediaPending, 0);
      expect(pusher.calls, hasLength(1));
    });
  });

  group('unrecognised or malformed commands', () {
    test(
        'a commandType this build does not recognise fails cleanly '
        'without crashing the pass', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        commandType: 'SOME_FUTURE_COMMAND_TYPE',
        entityType: 'unknown_table',
        idempotencyKey: 'idem-cmd-1',
      );

      final _FakeCommandPusher pusher = _FakeCommandPusher();
      final SyncEngine engine = buildEngine(
        pusher: pusher,
        uploader: _FakeMediaUploader(),
      );

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(summary.failed, 1);
      expect(pusher.calls, isEmpty);

      final PendingCommand? stored = await db.queueDao.commandById('cmd-1');
      expect(stored!.status, CommandStatus.retry);
      expect(stored.lastError, isNotNull);
    });
  });

  group('the sync lock', () {
    test(
      'prevents two overlapping runs from both claiming the same batch',
      () async {
        await seedCommand(db, id: 'cmd-1');
        await db.queueDao.acquireSyncLock(holder: 'someone-else', now: testNow);

        final _FakeCommandPusher pusher = _FakeCommandPusher();
        final SyncEngine engine = buildEngine(
          pusher: pusher,
          uploader: _FakeMediaUploader(),
          holderId: 'engine-under-test',
        );

        final SyncRunSummary summary = await engine.runOnce(
          workspaceId: workspaceA,
          now: testNow.add(const Duration(seconds: 1)),
        );

        expect(summary.lockAcquired, isFalse);
        expect(summary.claimed, 0);
        expect(pusher.calls, isEmpty);

        final PendingCommand? stored = await db.queueDao.commandById('cmd-1');
        expect(
          stored!.status,
          CommandStatus.pending,
          reason: 'a run that could not take the lock must not touch the '
              'queue at all',
        );
      },
    );
  });

  group('unblocking the active workspace', () {
    test(
        'a command blocked for the workspace that is now active is '
        'unblocked, claimed and pushed within the same run', () async {
      await seedCommand(
        db,
        id: 'cmd-1',
        commandType: 'WORK_ORDER',
        entityType: 'work_orders',
        idempotencyKey: 'idem-cmd-1',
        payloadJson: jsonEncode(<String, Object?>{'work_order_no': 'WO-1'}),
      );
      await db.queueDao.blockCommand(
        'cmd-1',
        reason: 'Captured in another workspace.',
      );

      final _FakeCommandPusher pusher = _FakeCommandPusher()
        ..willReturnFor('idem-cmd-1', <Map<String, Object?>>[
          <String, Object?>{'id': 'row-1'},
        ]);
      final SyncEngine engine = buildEngine(
        pusher: pusher,
        uploader: _FakeMediaUploader(),
      );

      final SyncRunSummary summary = await engine.runOnce(
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(
        summary.synced,
        1,
        reason: 'unblockForWorkspace runs before the claim step, so a row '
            'blocked for the workspace that is active RIGHT NOW becomes '
            'claimable again within the same pass',
      );
      expect(
        await db.queueDao.commandById('cmd-1'),
        isNull,
        reason: 'synced with no attached media, so pruned in the same pass',
      );
    });

    test('a command blocked for a DIFFERENT workspace stays blocked', () async {
      await seedCommand(db, id: 'cmd-a', workspaceId: workspaceA);
      await db.queueDao.blockCommand('cmd-a', reason: 'Another workspace.');

      final SyncEngine engine = buildEngine(
        pusher: _FakeCommandPusher(),
        uploader: _FakeMediaUploader(),
      );

      await engine.runOnce(workspaceId: workspaceB, now: testNow);

      final PendingCommand? stored = await db.queueDao.commandById('cmd-a');
      expect(
        stored!.status,
        CommandStatus.blocked,
        reason: 'this run only unblocks rows captured in the workspace it '
            'was told is active - never a different one, which would be a '
            'cross-tenant write',
      );
    });
  });
}
