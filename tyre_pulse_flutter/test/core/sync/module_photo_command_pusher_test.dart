import 'dart:convert';

import 'package:drift/drift.dart' show Value;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/module_photo_command_pusher.dart';
import 'package:tyre_pulse/core/sync/supabase_command_pusher.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';
import 'package:tyre_pulse/core/sync/sync_outcome.dart';

import '../database/database_test_support.dart';

const String _owner = '12345678-aaaa-bbbb-cccc-1234567890ab';

final class _InsertPusher implements CommandPusher {
  final List<Map<String, Object?>> payloads = <Map<String, Object?>>[];

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    payloads.add(Map<String, Object?>.unmodifiable(payload));
    return <Map<String, Object?>>[payload];
  }
}

final class _Uploader implements MediaUploader {
  _Uploader({this.online = true, this.refuse = false});

  bool online;

  /// The server answers, but refuses the object.
  final bool refuse;
  final List<String> paths = <String>[];

  @override
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  }) async {
    if (!online) {
      throw const SupabaseFailure(
        error: AppError.network(),
        cause: SupabaseFailureCause.offline,
      );
    }
    if (refuse) {
      throw const SupabaseFailure(
        error: AppError.network(),
        cause: SupabaseFailureCause.unknown,
      );
    }
    final String path = storageObjectPath(
      bucket: bucket,
      fileName: fileName,
      userId: _owner,
    );
    paths.add(path);
    return MediaUploadResult(
      remotePath: path,
      remoteRef: 'tp-storage://$bucket/$path',
    );
  }
}

const String _washPhoto = '/data/user/0/app/files/wash_photos/wash_0_1.jpg';
const String _gaugePhoto = '/data/user/0/app/files/meter_photos/odo_1.jpg';

Future<String> _seed(
  AppDatabase db, {
  required CommandType type,
  required String photo,
  required String key,
  required bool routed,
  String prefix = washMediaPrefix,
}) async {
  final PendingCommand command = await db.queueDao.enqueue(
    commandType: type.wireName,
    entityType: CommandRegistry.specFor(type).table,
    payloadJson: jsonEncode(<String, Object?>{
      'asset_no': 'TM514',
      'photos': <String>[photo],
    }),
    createdBy: testUser,
    workspaceId: workspaceA,
    now: testNow,
    idempotencyKey: key,
    attachments: <QueuedMediaAttachment>[
      QueuedMediaAttachment(
        localPath: photo,
        // An older build queued the raw basename and no bucket.
        fileName: routed
            ? modulePhotoFileName(
                prefix: prefix,
                unique: 'abcdef12',
                localName: photo.split('/').last,
              )
            : photo.split('/').last,
        orderIndex: 0,
        bucket: routed ? moduleMediaBucket : null,
      ),
    ],
  );
  return command.id;
}

SyncEngine _engine(
  AppDatabase db,
  CommandPusher delegate,
  _Uploader uploader, {
  bool Function(String)? fileExists,
}) =>
    SyncEngine(
      queueDao: db.queueDao,
      mediaDao: db.mediaDao,
      pusher: ModulePhotoCommandPusher(
        delegate: delegate,
        queueDao: db.queueDao,
        mediaDao: db.mediaDao,
        uploader: uploader,
        fileExists: fileExists ?? (_) => true,
        clock: () => testNow,
      ),
      uploader: uploader,
      holderId: 'module-photo-test',
    );

void main() {
  late AppDatabase db;

  setUp(() => db = newMemoryDatabase());
  tearDown(() async => db.close());

  group('storage namespace', () {
    test('wash and meter photos go where the web and old app put them', () {
      expect(
        storageObjectPath(
          bucket: 'tyre-photos',
          fileName: 'washrec_abc_wash_0.jpg',
          userId: _owner,
        ),
        'modules/wash/12345678/washrec_abc_wash_0.jpg',
      );
      expect(
        storageObjectPath(
          bucket: 'tyre-photos',
          fileName: 'meterlog_abc_odo.jpg',
          userId: _owner,
        ),
        'modules/meter-log/12345678/meterlog_abc_odo.jpg',
      );
      expect(
        () => storageObjectPath(
          bucket: 'tyre-photos',
          fileName: 'meterlog_abc_odo.jpg',
          userId: null,
        ),
        throwsStateError,
      );
    });

    test('file names are one safe basename', () {
      final String name = modulePhotoFileName(
        prefix: washMediaPrefix,
        unique: '0f1e2d3c-1111-2222',
        localName: 'wash 0/1.jpg',
      );
      expect(name, 'washrec_0f1e2d3c_wash_0_1.jpg');
    });
  });

  test('wash: photo uploads, the row gets only a private ref', () async {
    await _seed(
      db,
      type: CommandType.washRecord,
      photo: _washPhoto,
      key: 'wash_TM514_a',
      routed: true,
    );
    final _InsertPusher insert = _InsertPusher();
    final SyncRunSummary summary = await _engine(db, insert, _Uploader())
        .runOnce(workspaceId: workspaceA, now: testNow);
    expect(summary.synced, 1);
    final List<Object?> photos =
        insert.payloads.single['photos']! as List<Object?>;
    expect(
      photos.single,
      startsWith('tp-storage://tyre-photos/modules/wash/12345678/washrec_'),
    );
    expect(jsonEncode(insert.payloads.single), isNot(contains('/data/user/')));
    // Delivered photo verified, so the command and its file were pruned.
    expect(await db.queueDao.commandByIdempotencyKey('wash_TM514_a'), isNull);
  });

  test('meter offline: the reading waits for its photo', () async {
    await _seed(
      db,
      type: CommandType.odometerLog,
      photo: _gaugePhoto,
      key: 'odo_TM514_a',
      routed: true,
      prefix: meterLogMediaPrefix,
    );
    final _InsertPusher insert = _InsertPusher();
    await _engine(db, insert, _Uploader(online: false))
        .runOnce(workspaceId: workspaceA, now: testNow);
    expect(insert.payloads, isEmpty);
    expect(
      await db.queueDao.commandByIdempotencyKey('odo_TM514_a'),
      isNotNull,
    );
  });

  test('meter: a photo the server keeps refusing never blocks the reading',
      () async {
    final String id = await _seed(
      db,
      type: CommandType.engineHoursLog,
      photo: _gaugePhoto,
      key: 'hrs_TM514_a',
      routed: true,
      prefix: meterLogMediaPrefix,
    );
    final _InsertPusher insert = _InsertPusher();
    final _Uploader uploader = _Uploader(refuse: true);
    // Later runs: the photo's budget is spent, then the row goes alone.
    for (int i = 0; i < 3 && insert.payloads.isEmpty; i++) {
      await _engine(db, insert, uploader).runOnce(
        workspaceId: workspaceA,
        now: testNow.add(Duration(hours: i + 1)),
      );
    }
    expect(insert.payloads, hasLength(1));
    expect(insert.payloads.single['photos'], isNull);
    final media = await db.mediaDao.mediaForCommand(id);
    expect(media.single.state, MediaUploadState.failed);
    expect(media.single.lastError, kModulePhotoRefusedMessage);
  });

  test('offline for many runs: the photo is kept, never dropped', () async {
    final String id = await _seed(
      db,
      type: CommandType.washRecord,
      photo: _washPhoto,
      key: 'wash_TM514_c',
      routed: true,
    );
    final _InsertPusher insert = _InsertPusher();
    final _Uploader uploader = _Uploader(online: false);
    for (int i = 0; i < 3; i++) {
      await _engine(db, insert, uploader).runOnce(
        workspaceId: workspaceA,
        now: testNow.add(Duration(hours: i + 1)),
      );
    }
    expect(insert.payloads, isEmpty);
    uploader.online = true;
    await _engine(db, insert, uploader).runOnce(
      workspaceId: workspaceA,
      now: testNow.add(const Duration(days: 1)),
    );
    final List<Object?> photos =
        insert.payloads.single['photos']! as List<Object?>;
    expect(photos.single, startsWith('tp-storage://tyre-photos/modules/wash/'));
    expect(await db.mediaDao.mediaForCommand(id), isEmpty);
  });

  test('file gone: sent without the photo, reason kept on the photo', () async {
    final String id = await _seed(
      db,
      type: CommandType.washRecord,
      photo: _washPhoto,
      key: 'wash_TM514_b',
      routed: true,
    );
    final _InsertPusher insert = _InsertPusher();
    final _Uploader uploader = _Uploader(online: false);
    await _engine(db, insert, uploader, fileExists: (_) => false)
        .runOnce(workspaceId: workspaceA, now: testNow);
    expect(insert.payloads.single['photos'], isNull);
    final media = await db.mediaDao.mediaForCommand(id);
    expect(media.single.state, MediaUploadState.failed);
    expect(media.single.lastError, kModulePhotoMissingMessage);
  });

  test('older queued photo with no destination still uploads', () async {
    final String id = await _seed(
      db,
      type: CommandType.odometerLog,
      photo: _gaugePhoto,
      key: 'odo_TM514_b',
      routed: false,
    );
    // Simulate an older build whose offline runs already spent the budget
    // on "no upload destination recorded".
    await (db.update(db.pendingMediaUploads)
          ..where((t) => t.commandId.equals(id)))
        .write(
      const PendingMediaUploadsCompanion(
        state: Value<String>(MediaUploadState.failed),
        attempts: Value<int>(maxUploadAttempts),
        lastError: Value<String?>('no destination'),
      ),
    );
    final _InsertPusher insert = _InsertPusher();
    final _Uploader uploader = _Uploader();
    await _engine(db, insert, uploader)
        .runOnce(workspaceId: workspaceA, now: testNow);
    final List<Object?> photos =
        insert.payloads.single['photos']! as List<Object?>;
    expect(
      photos.single,
      startsWith(
        'tp-storage://tyre-photos/modules/meter-log/12345678/meterlog_',
      ),
    );
    expect(uploader.paths.single, endsWith('_odo_1.jpg'));
  });
}
