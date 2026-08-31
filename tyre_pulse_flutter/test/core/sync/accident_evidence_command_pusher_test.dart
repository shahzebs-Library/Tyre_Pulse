import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/sync/accident_evidence_command_pusher.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';
import 'package:tyre_pulse/core/sync/sync_outcome.dart';

import '../database/database_test_support.dart';

final class _PushCall {
  const _PushCall({required this.spec, required this.payload});

  final CommandSpec spec;
  final Map<String, Object?> payload;
}

final class _RecordingPusher implements CommandPusher {
  _RecordingPusher({this.failure});

  final SupabaseFailure? failure;
  final List<_PushCall> calls = <_PushCall>[];

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    calls.add(
      _PushCall(
        spec: spec,
        payload: Map<String, Object?>.unmodifiable(payload),
      ),
    );
    final SupabaseFailure? scripted = failure;
    if (scripted != null) throw scripted;
    return <Map<String, Object?>>[
      <String, Object?>{'id': 'remote-accident-1'},
    ];
  }
}

final class _RecordingUploader implements MediaUploader {
  _RecordingUploader({this.failure});

  final SupabaseFailure? failure;
  final List<String> files = <String>[];

  @override
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  }) async {
    files.add(fileName);
    final SupabaseFailure? scripted = failure;
    if (scripted != null) throw scripted;
    return MediaUploadResult(
      remotePath: fileName,
      remoteRef: 'tp-storage://$bucket/$fileName',
    );
  }
}

const SupabaseFailure _networkFailure = SupabaseFailure(
  error: AppError.network(),
  cause: SupabaseFailureCause.offline,
);

const SupabaseFailure _duplicateFailure = SupabaseFailure(
  error: AppError(
    kind: AppErrorKind.conflict,
    message: 'This has already been saved.',
  ),
  cause: SupabaseFailureCause.uniqueViolation,
  code: '23505',
);

String _localPath(String fileName) =>
    '/data/user/0/app/files/accident_draft_photos/$fileName';

QueuedMediaAttachment _photo(String fileName, int orderIndex) {
  return QueuedMediaAttachment(
    localPath: _localPath(fileName),
    fileName: fileName,
    orderIndex: orderIndex,
    bucket: 'accident-photos',
  );
}

Future<void> _seedAccident(
  AppDatabase db, {
  String id = 'accident-command',
  String idempotencyKey = 'accident-idempotency',
  required Object? photos,
  List<QueuedMediaAttachment> attachments = const <QueuedMediaAttachment>[],
}) async {
  await db.queueDao.enqueue(
    id: id,
    commandType: CommandType.reportAccident.wireName,
    entityType: CommandRegistry.specFor(CommandType.reportAccident).table,
    payloadJson: jsonEncode(<String, Object?>{
      'asset_no': 'CP-3012',
      'site': 'Diriyah',
      'photos': photos,
    }),
    createdBy: testUser,
    workspaceId: workspaceA,
    now: testNow,
    idempotencyKey: idempotencyKey,
    attachments: attachments,
  );
}

AccidentEvidenceCommandPusher _decorator(
  AppDatabase db,
  CommandPusher delegate,
) {
  return AccidentEvidenceCommandPusher(
    delegate: delegate,
    queueDao: db.queueDao,
    mediaDao: db.mediaDao,
  );
}

SyncEngine _engine(
  AppDatabase db, {
  required CommandPusher delegate,
  required MediaUploader uploader,
}) {
  return SyncEngine(
    queueDao: db.queueDao,
    mediaDao: db.mediaDao,
    pusher: _decorator(db, delegate),
    uploader: uploader,
    holderId: 'accident-evidence-test',
  );
}

Future<void> _markOnlyPhotoUploaded(AppDatabase db, String commandId) async {
  final PendingMediaUpload media =
      (await db.mediaDao.mediaForCommand(commandId)).single;
  await db.mediaDao.markUploaded(
    media.id,
    bucket: 'accident-photos',
    remotePath: media.fileName,
    remoteRef: 'tp-storage://accident-photos/${media.fileName}',
    at: testNow,
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

  test(
      'REPORT_ACCIDENT uploads first, sends exact private refs, verifies '
      'media and prunes the completed local transaction', () async {
    await _seedAccident(
      db,
      photos: <String>[_localPath('scene-1.jpg'), _localPath('scene-2.jpg')],
      attachments: <QueuedMediaAttachment>[
        _photo('scene-1.jpg', 0),
        _photo('scene-2.jpg', 1),
      ],
    );
    final _RecordingPusher delegate = _RecordingPusher();
    final _RecordingUploader uploader = _RecordingUploader();

    final SyncRunSummary summary = await _engine(
      db,
      delegate: delegate,
      uploader: uploader,
    ).runOnce(workspaceId: workspaceA, now: testNow);

    expect(summary.photosUploaded, 2);
    expect(summary.synced, 1);
    expect(delegate.calls, hasLength(1));
    expect(
      delegate.calls.single.payload['photos'],
      <String>[
        'tp-storage://accident-photos/scene-1.jpg',
        'tp-storage://accident-photos/scene-2.jpg',
      ],
    );
    expect(
      jsonEncode(delegate.calls.single.payload),
      isNot(contains('/data/user/0/')),
    );
    expect(await db.queueDao.commandById('accident-command'), isNull);
    expect(
      await db.mediaDao.mediaForCommand('accident-command'),
      isEmpty,
      reason: 'the decorator verified the uploaded evidence, allowing the '
          'normal synced-command pruner to remove its rows and local files',
    );
  });

  test('REPORT_ACCIDENT never reaches the delegate while upload is unresolved',
      () async {
    await _seedAccident(
      db,
      photos: <String>[_localPath('offline.jpg')],
      attachments: <QueuedMediaAttachment>[_photo('offline.jpg', 0)],
    );
    final _RecordingPusher delegate = _RecordingPusher();

    final SyncRunSummary summary = await _engine(
      db,
      delegate: delegate,
      uploader: _RecordingUploader(failure: _networkFailure),
    ).runOnce(workspaceId: workspaceA, now: testNow);

    expect(delegate.calls, isEmpty);
    expect(summary.synced, 0);
    expect(summary.failed, 1);
    final PendingCommand? command =
        await db.queueDao.commandById('accident-command');
    expect(command, isNotNull);
    expect(command!.status, CommandStatus.retry);
    final PendingMediaUpload media =
        (await db.mediaDao.mediaForCommand('accident-command')).single;
    expect(media.state, MediaUploadState.failed);
    expect(media.localPath, _localPath('offline.jpg'));
  });

  test('an already-resolved private accident reference is preserved exactly',
      () async {
    const String existing = 'tp-storage://accident-photos/already-uploaded.jpg';
    await _seedAccident(db, photos: <String>[existing]);
    final _RecordingPusher delegate = _RecordingPusher();

    final SyncRunSummary summary = await _engine(
      db,
      delegate: delegate,
      uploader: _RecordingUploader(),
    ).runOnce(workspaceId: workspaceA, now: testNow);

    expect(summary.synced, 1);
    expect(delegate.calls.single.payload['photos'], <String>[existing]);
  });

  test('an unmapped local accident path fails closed', () async {
    await _seedAccident(db, photos: <String>[_localPath('missing.jpg')]);
    final _RecordingPusher delegate = _RecordingPusher();

    final SyncRunSummary summary = await _engine(
      db,
      delegate: delegate,
      uploader: _RecordingUploader(),
    ).runOnce(workspaceId: workspaceA, now: testNow);

    expect(summary.failed, 1);
    expect(delegate.calls, isEmpty);
    expect(await db.queueDao.commandById('accident-command'), isNotNull);
  });

  test('a malformed private accident reference fails closed', () async {
    await _seedAccident(
      db,
      photos: const <String>['tp-storage://accident-photos/'],
    );
    final _RecordingPusher delegate = _RecordingPusher();

    final SyncRunSummary summary = await _engine(
      db,
      delegate: delegate,
      uploader: _RecordingUploader(),
    ).runOnce(workspaceId: workspaceA, now: testNow);

    expect(summary.failed, 1);
    expect(delegate.calls, isEmpty);
  });

  test('all non-accident command types pass through unchanged', () async {
    final _RecordingPusher delegate = _RecordingPusher();
    final AccidentEvidenceCommandPusher pusher = _decorator(db, delegate);
    final Map<String, Object?> payload = <String, Object?>{
      'client_uuid': 'rca-idempotency',
      'photos': <String>[_localPath('rca.jpg')],
    };

    await pusher.push(
      spec: CommandRegistry.specFor(CommandType.rca),
      payload: payload,
    );

    expect(delegate.calls, hasLength(1));
    expect(delegate.calls.single.spec.type, CommandType.rca);
    expect(delegate.calls.single.payload, payload);
  });

  test('a first-attempt 23505 remains a conflict and media stays uploaded',
      () async {
    await _seedAccident(
      db,
      photos: <String>[_localPath('first-conflict.jpg')],
      attachments: <QueuedMediaAttachment>[_photo('first-conflict.jpg', 0)],
    );
    await _markOnlyPhotoUploaded(db, 'accident-command');

    final SyncRunSummary summary = await _engine(
      db,
      delegate: _RecordingPusher(failure: _duplicateFailure),
      uploader: _RecordingUploader(),
    ).runOnce(workspaceId: workspaceA, now: testNow);

    expect(summary.conflicted, 1);
    expect(summary.synced, 0);
    final PendingCommand? command =
        await db.queueDao.commandById('accident-command');
    expect(command!.retryCount, 1);
    expect(
      (await db.mediaDao.mediaForCommand('accident-command')).single.state,
      MediaUploadState.uploaded,
      reason: 'the decorator must not reinterpret a first-attempt duplicate '
          'more generously than SyncEngine does',
    );
  });

  test('a retry 23505 verifies media and follows SyncEngine replay success',
      () async {
    await _seedAccident(
      db,
      photos: <String>[_localPath('replay.jpg')],
      attachments: <QueuedMediaAttachment>[_photo('replay.jpg', 0)],
    );
    await _markOnlyPhotoUploaded(db, 'accident-command');
    await db.queueDao.markAttemptFailed(
      'accident-command',
      now: testNow,
      message: 'The earlier response was not received.',
    );

    final SyncRunSummary summary = await _engine(
      db,
      delegate: _RecordingPusher(failure: _duplicateFailure),
      uploader: _RecordingUploader(),
    ).runOnce(
      workspaceId: workspaceA,
      now: testNow.add(const Duration(minutes: 1)),
    );

    expect(summary.synced, 1);
    expect(summary.conflicted, 0);
    expect(await db.queueDao.commandById('accident-command'), isNull);
    expect(await db.mediaDao.mediaForCommand('accident-command'), isEmpty);
  });
}
