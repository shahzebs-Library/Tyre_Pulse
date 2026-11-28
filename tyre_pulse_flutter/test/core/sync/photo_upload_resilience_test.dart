import 'dart:convert';

import 'package:drift/drift.dart' show Value;
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show StorageException;
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/module_photo_command_pusher.dart';
import 'package:tyre_pulse/core/sync/supabase_command_pusher.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';

import '../database/database_test_support.dart';

SupabaseFailure _f(SupabaseFailureCause cause, {String? code}) =>
    SupabaseFailure(error: const AppError.network(), cause: cause, code: code);

final SupabaseFailure _offline = _f(SupabaseFailureCause.offline);
final SupabaseFailure _server = _f(
  SupabaseFailureCause.serverError,
  code: '503',
);
final SupabaseFailure _auth = _f(
  SupabaseFailureCause.unauthenticated,
  code: '401',
);
final SupabaseFailure _forbidden = _f(
  SupabaseFailureCause.forbidden,
  code: '403',
);

/// Fails every call for a file with the scripted failure (in order, last one
/// repeats) until [succeedAfter] calls, then succeeds.
final class _Uploader implements MediaUploader {
  final Map<String, List<SupabaseFailure>> fail =
      <String, List<SupabaseFailure>>{};
  final List<String> calls = <String>[];

  @override
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  }) async {
    calls.add(fileName);
    final List<SupabaseFailure>? script = fail[fileName];
    if (script != null && script.isNotEmpty) {
      throw script.length == 1 ? script.first : script.removeAt(0);
    }
    return MediaUploadResult(
      remotePath: 'p/$fileName',
      remoteRef: 'tp-storage://$bucket/p/$fileName',
    );
  }
}

final class _OkPusher implements CommandPusher {
  int calls = 0;
  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    calls++;
    return <Map<String, Object?>>[payload];
  }
}

QueuedMediaAttachment _photo(String name, {String? path, int order = 0}) =>
    QueuedMediaAttachment(
      localPath: path ?? '/data/user/0/app/files/queue-media/$name',
      fileName: name,
      orderIndex: order,
      bucket: 'tyre-photos',
    );

SyncEngine _engine(
  AppDatabase db,
  CommandPusher pusher,
  MediaUploader uploader, {
  SessionRefresher? refresh,
}) =>
    SyncEngine(
      queueDao: db.queueDao,
      mediaDao: db.mediaDao,
      pusher: pusher,
      uploader: uploader,
      holderId: 'resilience',
      refreshSession: refresh,
    );

DateTime _day(int i) => testNow.add(Duration(days: i));

void main() {
  late AppDatabase db;
  setUp(() => db = newMemoryDatabase());
  tearDown(() async => db.close());

  group('a requiresMediaReady photo never fails for a transient reason', () {
    for (final (String label, SupabaseFailure failure) in <(
      String,
      SupabaseFailure,
    )>[
      ('offline', _offline),
      ('5xx', _server),
      ('401', _auth),
    ]) {
      test(label, () async {
        expect(
          CommandRegistry.specFor(CommandType.tyreChange).requiresMediaReady,
          isTrue,
        );
        await seedCommand(
          db,
          id: 'tc',
          attachments: <QueuedMediaAttachment>[_photo('tc.jpg')],
        );
        final _Uploader uploader = _Uploader()
          ..fail['tc.jpg'] = <SupabaseFailure>[failure];
        final _OkPusher pusher = _OkPusher();

        for (int i = 1; i <= 6; i++) {
          await _engine(db, pusher, uploader)
              .runOnce(workspaceId: workspaceA, now: _day(i));
        }
        final PendingMediaUpload media =
            (await db.mediaDao.mediaForCommand('tc')).single;
        expect(media.state, MediaUploadState.queued);
        expect(media.attempts, 0);
        expect(pusher.calls, 0);
        expect(
          (await db.queueDao.commandById('tc'))!.status,
          CommandStatus.pending,
        );

        uploader.fail.clear();
        await _engine(db, pusher, uploader)
            .runOnce(workspaceId: workspaceA, now: _day(7));
        expect(pusher.calls, 1);
        expect(await db.queueDao.commandById('tc'), isNull);
      });
    }

    test('a definitive refusal still spends the budget', () async {
      await seedCommand(
        db,
        id: 'tc',
        attachments: <QueuedMediaAttachment>[_photo('tc.jpg')],
      );
      final _Uploader uploader = _Uploader()
        ..fail['tc.jpg'] = <SupabaseFailure>[_forbidden];
      for (int i = 1; i <= maxUploadAttempts; i++) {
        await _engine(db, _OkPusher(), uploader)
            .runOnce(workspaceId: workspaceA, now: _day(i));
      }
      final PendingMediaUpload media =
          (await db.mediaDao.mediaForCommand('tc')).single;
      expect(media.state, MediaUploadState.failed);
      expect(media.attempts, maxUploadAttempts);
    });

    test('a transient failure backs off within the same clock', () async {
      await seedCommand(
        db,
        id: 'tc',
        attachments: <QueuedMediaAttachment>[_photo('tc.jpg')],
      );
      final _Uploader uploader = _Uploader()
        ..fail['tc.jpg'] = <SupabaseFailure>[_server];
      await _engine(db, _OkPusher(), uploader)
          .runOnce(workspaceId: workspaceA, now: testNow);
      await _engine(db, _OkPusher(), uploader).runOnce(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(seconds: 5)),
      );
      expect(uploader.calls, <String>['tc.jpg']);
      await _engine(db, _OkPusher(), uploader).runOnce(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(minutes: 1)),
      );
      expect(uploader.calls, <String>['tc.jpg', 'tc.jpg']);
    });
  });

  test('legacy failed rows are requeued once and then upload', () async {
    await seedCommand(
      db,
      id: 'tc',
      attachments: <QueuedMediaAttachment>[_photo('tc.jpg')],
    );
    await (db.update(db.pendingMediaUploads)
          ..where((t) => t.commandId.equals('tc')))
        .write(
      const PendingMediaUploadsCompanion(
        state: Value<String>(MediaUploadState.failed),
        attempts: Value<int>(maxUploadAttempts),
      ),
    );
    final _OkPusher pusher = _OkPusher();
    await _engine(db, pusher, _Uploader())
        .runOnce(workspaceId: workspaceA, now: _day(1));
    expect(pusher.calls, 1);
    expect(await db.queueDao.commandById('tc'), isNull);

    // Only once: a later definitive failure stays failed.
    await seedCommand(
      db,
      id: 'tc2',
      attachments: <QueuedMediaAttachment>[_photo('tc2.jpg')],
    );
    await (db.update(db.pendingMediaUploads)
          ..where((t) => t.commandId.equals('tc2')))
        .write(
      const PendingMediaUploadsCompanion(
        state: Value<String>(MediaUploadState.failed),
        attempts: Value<int>(maxUploadAttempts),
      ),
    );
    expect(
      await db.mediaDao.requeueLegacyTransientFailuresOnce(now: _day(2)),
      0,
    );
    // The explicit reset (sign-in / connection back) still works.
    expect(await db.mediaDao.requeueFailedMedia(), 1);
  });

  group('a lapsed session', () {
    test('one refresh, then the upload is retried in the same pass', () async {
      await seedCommand(
        db,
        id: 'tc',
        attachments: <QueuedMediaAttachment>[_photo('tc.jpg')],
      );
      final _Uploader uploader = _Uploader()
        ..fail['tc.jpg'] = <SupabaseFailure>[_auth];
      // The refresh fixes the session, so the retry succeeds.
      int refreshes = 0;
      final _OkPusher pusher = _OkPusher();
      await _engine(
        db,
        pusher,
        uploader,
        refresh: () async {
          refreshes++;
          uploader.fail.clear();
          return true;
        },
      ).runOnce(workspaceId: workspaceA, now: _day(1));
      expect(refreshes, 1);
      expect(uploader.calls, hasLength(2));
      expect(pusher.calls, 1);
    });

    test('a wash photo never reaches the wait cap on 401s', () async {
      const String path = '/data/user/0/app/files/wash_photos/w.jpg';
      final PendingCommand command = await db.queueDao.enqueue(
        commandType: CommandType.washRecord.wireName,
        entityType: CommandRegistry.specFor(CommandType.washRecord).table,
        payloadJson: jsonEncode(<String, Object?>{
          'asset_no': 'TM514',
          'photos': <String>[path],
        }),
        createdBy: testUser,
        workspaceId: workspaceA,
        now: testNow,
        idempotencyKey: 'wash_auth',
        attachments: <QueuedMediaAttachment>[
          const QueuedMediaAttachment(
            localPath: path,
            fileName: '${washMediaPrefix}abc_w.jpg',
            orderIndex: 0,
            bucket: moduleMediaBucket,
          ),
        ],
      );
      final _Uploader uploader = _Uploader()
        ..fail['${washMediaPrefix}abc_w.jpg'] = <SupabaseFailure>[_auth];
      final _OkPusher delegate = _OkPusher();
      for (int i = 1; i <= 10; i++) {
        await SyncEngine(
          queueDao: db.queueDao,
          mediaDao: db.mediaDao,
          pusher: ModulePhotoCommandPusher(
            delegate: delegate,
            queueDao: db.queueDao,
            mediaDao: db.mediaDao,
            uploader: uploader,
            fileExists: (_) => true,
            clock: () => testNow,
          ),
          uploader: uploader,
          holderId: 'wash',
        ).runOnce(workspaceId: workspaceA, now: _day(i));
      }
      final PendingCommand? row = await db.queueDao.commandById(command.id);
      expect(row, isNotNull);
      expect(row!.retryCount, 0);
      final PendingMediaUpload media =
          (await db.mediaDao.mediaForCommand(command.id)).single;
      expect(media.state, isNot(MediaUploadState.abandoned));
      expect(delegate.calls, 0);
    });
  });

  group('Storage 400 InvalidJWT', () {
    test('is an auth lapse, not a refusal', () {
      final SupabaseFailure f = classifySupabaseError(
        const StorageException(
          'jwt expired',
          statusCode: '400',
          error: 'InvalidJWT',
        ),
      );
      expect(isAuthFailure(f), isTrue);
      expect(isDefinitivePhotoRefusal(f), isFalse);
    });

    test('a plain 400 InvalidRequest is still definitive', () {
      final SupabaseFailure f = classifySupabaseError(
        const StorageException(
          'The object name contains invalid characters',
          statusCode: '400',
          error: 'InvalidKey',
        ),
      );
      expect(isAuthFailure(f), isFalse);
      expect(isDefinitivePhotoRefusal(f), isTrue);
    });
  });

  test('a file shared with another queued record is not deleted', () async {
    const String shared = '/data/user/0/app/files/queue-media/shared.jpg';
    await seedCommand(
      db,
      id: 'a',
      attachments: <QueuedMediaAttachment>[_photo('a.jpg', path: shared)],
    );
    await seedCommand(
      db,
      id: 'b',
      attachments: <QueuedMediaAttachment>[_photo('b.jpg', path: shared)],
    );
    Future<void> deliver(String id) async {
      final PendingMediaUpload m =
          (await db.mediaDao.mediaForCommand(id)).single;
      await db.mediaDao.markUploaded(
        m.id,
        bucket: 'tyre-photos',
        remotePath: 'x',
        remoteRef: 'tp-storage://tyre-photos/x',
        at: testNow,
      );
      await db.queueDao.markSynced(id, testNow);
      await db.mediaDao.markCommandMediaVerified(id);
    }

    await deliver('a');
    expect(await db.queueDao.pruneSyncedCommands(), isEmpty);
    expect(await db.queueDao.commandById('a'), isNull);
    await deliver('b');
    expect(await db.queueDao.pruneSyncedCommands(), <String>[shared]);
  });

  test('a failing photo at the head does not hide the ones behind', () async {
    await seedCommand(
      db,
      id: 'tc',
      attachments: <QueuedMediaAttachment>[
        for (int i = 0; i < uploadConcurrency + 1; i++)
          _photo('p$i.jpg', order: i),
      ],
    );
    final _Uploader uploader = _Uploader();
    for (int i = 0; i < uploadConcurrency; i++) {
      uploader.fail['p$i.jpg'] = <SupabaseFailure>[_server];
      // These are the oldest, so they are always claimed first.
      await (db.update(db.pendingMediaUploads)
            ..where((t) => t.fileName.equals('p$i.jpg')))
          .write(
        PendingMediaUploadsCompanion(
          capturedAt: Value<DateTime>(
            testNow.subtract(Duration(hours: uploadConcurrency - i)),
          ),
        ),
      );
    }
    await _engine(db, _OkPusher(), uploader)
        .runOnce(workspaceId: workspaceA, now: _day(1));
    const String last = 'p$uploadConcurrency.jpg';
    expect(uploader.calls, contains(last));
    final PendingMediaUpload lastRow =
        (await db.mediaDao.mediaForCommand('tc')).firstWhere(
      (PendingMediaUpload m) => m.fileName == last,
    );
    expect(lastRow.state, MediaUploadState.uploaded);

    // Inside the backoff the failing ones are not claimed again.
    expect(
      await db.mediaDao.claimNextUploads(
        excludeIds: await db.mediaDao.mediaIdsInBackoff(_day(1)),
      ),
      isEmpty,
    );
  });

  group('failed photos are never stuck', () {
    Future<void> failIt(String cmd) async {
      await (db.update(db.pendingMediaUploads)
            ..where((t) => t.commandId.equals(cmd)))
          .write(
        const PendingMediaUploadsCompanion(
          state: Value<String>(MediaUploadState.failed),
          attempts: Value<int>(maxUploadAttempts),
        ),
      );
    }

    test('Sync now / connection back gives one bounded try', () async {
      await db.mediaDao.requeueLegacyTransientFailuresOnce(now: testNow);
      await seedCommand(
        db,
        id: 'tc',
        attachments: <QueuedMediaAttachment>[_photo('tc.jpg')],
      );
      await failIt('tc');
      final _Uploader uploader = _Uploader()
        ..fail['tc.jpg'] = <SupabaseFailure>[_forbidden];

      // A normal periodic pass leaves it alone.
      await _engine(db, _OkPusher(), uploader)
          .runOnce(workspaceId: workspaceA, now: _day(1));
      expect(uploader.calls, isEmpty);

      // A one-off pass tries it once, it is refused, and it is failed again
      // with a backoff: no loop.
      await _engine(db, _OkPusher(), uploader).runOnce(
        workspaceId: workspaceA,
        now: _day(2),
        requeueFailedPhotos: true,
      );
      expect(uploader.calls, <String>['tc.jpg']);
      expect(
        (await db.mediaDao.mediaForCommand('tc')).single.state,
        MediaUploadState.failed,
      );

      // Inside the backoff a second trigger does not requeue it.
      expect(await db.mediaDao.requeueFailedMedia(now: _day(2)), 0);

      // Later, and now the server accepts it: the record syncs.
      uploader.fail.clear();
      final _OkPusher pusher = _OkPusher();
      await _engine(db, pusher, uploader).runOnce(
        workspaceId: workspaceA,
        now: _day(3),
        requeueFailedPhotos: true,
      );
      expect(pusher.calls, 1);
      expect(await db.queueDao.commandById('tc'), isNull);
    });

    test('a person can send the record without the photo', () async {
      await db.mediaDao.requeueLegacyTransientFailuresOnce(now: testNow);
      const String path = '/data/user/0/app/files/queue-media/tc.jpg';
      await seedCommand(
        db,
        id: 'tc',
        payloadJson: jsonEncode(<String, Object?>{
          'asset_no': 'TM514',
          'photos': <String>[path, 'tp-storage://tyre-photos/kept.jpg'],
        }),
        attachments: <QueuedMediaAttachment>[_photo('tc.jpg', path: path)],
      );
      await failIt('tc');
      final String mediaId =
          (await db.mediaDao.mediaForCommand('tc')).single.id;
      expect(await db.mediaDao.commandMediaReady('tc'), isFalse);

      expect(await db.mediaDao.removeFailedPhoto(mediaId), isTrue);
      expect(await db.mediaDao.commandMediaReady('tc'), isTrue);
      final PendingCommand cmd = (await db.queueDao.commandById('tc'))!;
      expect(
        (jsonDecode(cmd.payloadJson) as Map<String, Object?>)['photos'],
        <String>['tp-storage://tyre-photos/kept.jpg'],
      );
      // A queued (not failed) photo can never be removed this way.
      expect(await db.mediaDao.removeFailedPhoto('nope'), isFalse);
    });
  });

  test('a far-future backoff from a bad clock is clamped', () async {
    await seedCommand(
      db,
      id: 'tc',
      attachments: <QueuedMediaAttachment>[_photo('tc.jpg')],
    );
    final String id = (await db.mediaDao.mediaForCommand('tc')).single.id;
    // Clock ran a year ahead when the failure was recorded.
    await db.mediaDao.recordTransientUploadFailure(
      id,
      messageSafe: 'x',
      now: testNow.add(const Duration(days: 365)),
    );
    expect(await db.mediaDao.mediaIdsInBackoff(testNow), contains(id));
    final MediaUploadBackoff b =
        (await db.mediaDao.uploadBackoff(id, now: testNow))!;
    expect(
      b.until.isAfter(testNow.add(MediaDao.transientBackoffMax)),
      isFalse,
    );
    expect(
      await db.mediaDao.mediaIdsInBackoff(
        testNow.add(MediaDao.transientBackoffMax + const Duration(minutes: 1)),
      ),
      isNot(contains(id)),
    );
  });

  test('the module pusher refreshes the session once per pass', () async {
    const String a = '/data/user/0/app/files/wash_photos/a.jpg';
    const String b = '/data/user/0/app/files/wash_photos/b.jpg';
    await db.queueDao.enqueue(
      commandType: CommandType.washRecord.wireName,
      entityType: CommandRegistry.specFor(CommandType.washRecord).table,
      payloadJson: jsonEncode(<String, Object?>{
        'asset_no': 'TM514',
        'photos': <String>[a, b],
      }),
      createdBy: testUser,
      workspaceId: workspaceA,
      now: testNow,
      idempotencyKey: 'wash_two',
      attachments: const <QueuedMediaAttachment>[
        // An older build queued these with no destination, so the pusher
        // uploads them itself.
        QueuedMediaAttachment(localPath: a, fileName: 'a.jpg', orderIndex: 0),
        QueuedMediaAttachment(localPath: b, fileName: 'b.jpg', orderIndex: 1),
      ],
    );
    int refreshes = 0;
    final _AuthUploader uploader = _AuthUploader();
    await SyncEngine(
      queueDao: db.queueDao,
      mediaDao: db.mediaDao,
      pusher: ModulePhotoCommandPusher(
        delegate: _OkPusher(),
        queueDao: db.queueDao,
        mediaDao: db.mediaDao,
        uploader: uploader,
        fileExists: (_) => true,
        clock: () => testNow,
        refreshSession: () async {
          refreshes++;
          return true;
        },
      ),
      uploader: uploader,
      holderId: 'wash',
    ).runOnce(workspaceId: workspaceA, now: _day(1));
    expect(refreshes, 1);
  });
}

/// Every upload is refused for a lapsed session.
final class _AuthUploader implements MediaUploader {
  @override
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  }) async =>
      throw _auth;
}
