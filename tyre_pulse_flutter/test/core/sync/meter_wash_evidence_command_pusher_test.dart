import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/meter_wash_evidence_command_pusher.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';

import '../database/database_test_support.dart';

class _Pusher implements CommandPusher {
  final List<Map<String, Object?>> calls = <Map<String, Object?>>[];
  bool fail = false;
  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    calls.add(payload);
    if (fail) {
      throw const SupabaseFailure(
        error: AppError.network(),
        cause: SupabaseFailureCause.offline,
      );
    }
    return <Map<String, Object?>>[
      <String, Object?>{'id': 'saved'},
    ];
  }
}

class _Uploader implements MediaUploader {
  @override
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  }) async {
    expect(bucket, 'tyre-photos');
    return MediaUploadResult(
      remotePath: fileName,
      remoteRef: 'tp-storage://$bucket/$fileName',
    );
  }
}

Future<void> _seed(
  AppDatabase db,
  CommandType type, {
  String workspace = workspaceA,
  String filePrefix = '',
}) =>
    db.queueDao.enqueue(
      id: type.wireName,
      commandType: type.wireName,
      entityType: CommandRegistry.specFor(type).table,
      payloadJson: jsonEncode(<String, Object?>{
        'asset_no': 'TM1',
        'photos': <String>['/local/before.jpg', '/local/after.jpg'],
        'notes': 'before=0;after=1',
      }),
      createdBy: testUser,
      workspaceId: workspace,
      now: testNow,
      idempotencyKey: 'key-${type.wireName}',
      attachments: <QueuedMediaAttachment>[
        QueuedMediaAttachment(
          localPath: '/local/before.jpg',
          fileName: '${filePrefix}before.jpg',
          orderIndex: 0,
        ),
        QueuedMediaAttachment(
          localPath: '/local/after.jpg',
          fileName: '${filePrefix}after.jpg',
          orderIndex: 1,
        ),
      ],
    ).then((_) {});

void main() {
  late AppDatabase db;
  setUp(() => db = newMemoryDatabase());
  tearDown(() => db.close());

  for (final type in <CommandType>[
    CommandType.odometerLog,
    CommandType.engineHoursLog,
    CommandType.washRecord,
  ]) {
    test(
        '${type.wireName} uploads legacy queued photos and preserves before/after order as private refs',
        () async {
      await _seed(db, type);
      expect(await prepareMeterWashMedia(db, workspaceA), 2);
      final delegate = _Pusher();
      final engine = SyncEngine(
        queueDao: db.queueDao,
        mediaDao: db.mediaDao,
        pusher: MeterWashEvidenceCommandPusher(
          delegate: delegate,
          queueDao: db.queueDao,
          mediaDao: db.mediaDao,
        ),
        uploader: _Uploader(),
        holderId: 'meter-wash-test',
      );
      final summary =
          await engine.runOnce(workspaceId: workspaceA, now: testNow);
      expect(summary.photosUploaded, 2);
      expect(summary.synced, 1);
      expect(delegate.calls.single['photos'], <String>[
        'tp-storage://tyre-photos/before.jpg',
        'tp-storage://tyre-photos/after.jpg',
      ]);
      expect(delegate.calls.single['notes'], 'before=0;after=1');
      expect(jsonEncode(delegate.calls.single), isNot(contains('/local/')));
      expect(await db.mediaDao.mediaForCommand(type.wireName), isEmpty);
    });
  }

  test('failed business write retains uploaded evidence and local files',
      () async {
    await _seed(db, CommandType.washRecord);
    await prepareMeterWashMedia(db, workspaceA);
    final delegate = _Pusher()..fail = true;
    final engine = SyncEngine(
      queueDao: db.queueDao,
      mediaDao: db.mediaDao,
      pusher: MeterWashEvidenceCommandPusher(
        delegate: delegate,
        queueDao: db.queueDao,
        mediaDao: db.mediaDao,
      ),
      uploader: _Uploader(),
      holderId: 'meter-wash-failed',
    );
    final summary = await engine.runOnce(workspaceId: workspaceA, now: testNow);
    expect(summary.synced, 0);
    final media =
        await db.mediaDao.mediaForCommand(CommandType.washRecord.wireName);
    expect(media, hasLength(2));
    expect(media.every((m) => m.state == MediaUploadState.uploaded), isTrue);
    expect(media.first.localPath, '/local/before.jpg');
  });

  test(
      'legacy preparation touches neither other workspaces nor unrelated commands',
      () async {
    await _seed(db, CommandType.washRecord, workspace: workspaceB);
    await _seed(db, CommandType.reportAccident, filePrefix: 'accident-');
    expect(await prepareMeterWashMedia(db, workspaceA), 0);
    expect(
      (await db.mediaDao.mediaForCommand(CommandType.washRecord.wireName))
          .first
          .bucket,
      isNull,
    );
    expect(
      (await db.mediaDao.mediaForCommand(CommandType.reportAccident.wireName))
          .first
          .bucket,
      isNull,
    );
  });
}
