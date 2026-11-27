import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/job_completion_evidence_command_pusher.dart';
import 'package:tyre_pulse/core/sync/supabase_command_pusher.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';
import 'package:tyre_pulse/core/sync/sync_outcome.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_completion_service.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_completion.dart';

import '../database/database_test_support.dart';

final class _RpcPusher implements CommandPusher {
  _RpcPusher({this.reject});

  final String? reject;
  final List<Map<String, Object?>> payloads = <Map<String, Object?>>[];

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    payloads.add(Map<String, Object?>.unmodifiable(payload));
    final String key = payload['client_uuid']! as String;
    final String? why = reject;
    return <Map<String, Object?>>[
      if (why == null)
        <String, Object?>{
          'accepted': <String>[key],
        }
      else
        <String, Object?>{
          'rejected': <Map<String, Object?>>[
            <String, Object?>{'client_uuid': key, 'reason': why},
          ],
        },
    ];
  }
}

final class _Uploader implements MediaUploader {
  _Uploader({this.online = true});

  final bool online;
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
    final String path = storageObjectPath(
      bucket: bucket,
      fileName: fileName,
      userId: '12345678-aaaa-bbbb-cccc-1234567890ab',
    );
    paths.add(path);
    return MediaUploadResult(
      remotePath: path,
      remoteRef: 'tp-storage://$bucket/$path',
    );
  }
}

const String _key = 'jobdone_0f1e2d3c-1111-2222-3333-444455556666';
const String _after = '/data/user/0/app/files/workshop_photos/workshop_1.jpg';
const String _before = '/data/user/0/app/files/workshop_photos/workshop_0.jpg';

Future<void> _seed(AppDatabase db) async {
  const WorkshopCompletionDraft draft = WorkshopCompletionDraft(
    workDone: 'Replaced hub seal',
    beforePhotos: <String>[_before],
    afterPhotos: <String>[_after],
    signature: 'data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  );
  await db.queueDao.enqueue(
    commandType: CommandType.jobCompletion.wireName,
    entityType: CommandRegistry.specFor(CommandType.jobCompletion).table,
    payloadJson: jsonEncode(
      workshopCompletionPayload(
        key: _key,
        job: const WorkshopJob(id: 'wo-1', workOrderNo: 'JC-1'),
        draft: draft,
        workDone: 'Replaced hub seal',
        now: testNow,
      ),
    ),
    createdBy: testUser,
    workspaceId: workspaceA,
    now: testNow,
    idempotencyKey: _key,
    attachments: workshopCompletionAttachments(key: _key, draft: draft),
  );
}

SyncEngine _engine(
  AppDatabase db,
  CommandPusher delegate,
  MediaUploader uploader,
) =>
    SyncEngine(
      queueDao: db.queueDao,
      mediaDao: db.mediaDao,
      pusher: JobCompletionEvidenceCommandPusher(
        delegate: delegate,
        queueDao: db.queueDao,
        mediaDao: db.mediaDao,
      ),
      uploader: uploader,
      holderId: 'job-completion-test',
    );

void main() {
  late AppDatabase db;

  setUp(() => db = newMemoryDatabase());
  tearDown(() async => db.close());

  test('attachments: one per local photo, in the workshop namespace', () {
    final attachments = workshopCompletionAttachments(
      key: _key,
      draft: const WorkshopCompletionDraft(
        beforePhotos: <String>[_before],
        afterPhotos: <String>[_after, 'tp-storage://tyre-photos/x/y.jpg'],
      ),
    );
    expect(attachments, hasLength(2));
    expect(attachments.map((a) => a.fieldKey), <String>['before', 'after']);
    for (final a in attachments) {
      expect(a.bucket, 'tyre-photos');
      expect(a.fileName, startsWith('jobdone_'));
      expect(
        storageObjectPath(
          bucket: a.bucket!,
          fileName: a.fileName,
          userId: '12345678-xx',
        ),
        startsWith('modules/workshop/12345678/jobdone_'),
      );
    }
  });

  test('payload never carries country, site or asset', () {
    final Map<String, Object?> payload = workshopCompletionPayload(
      key: _key,
      job: const WorkshopJob(id: 'wo-1', assetNo: 'TM514', site: 'NHC'),
      draft: const WorkshopCompletionDraft(),
      workDone: 'x x x',
      now: testNow,
    );
    expect(payload.containsKey('country'), isFalse);
    expect(payload.containsKey('site'), isFalse);
    expect(payload.containsKey('asset_no'), isFalse);
  });

  test('offline: the RPC is not called while the photos wait', () async {
    await _seed(db);
    final _RpcPusher rpc = _RpcPusher();
    await _engine(db, rpc, _Uploader(online: false))
        .runOnce(workspaceId: workspaceA, now: testNow);
    expect(rpc.payloads, isEmpty);
    expect(await db.queueDao.commandByIdempotencyKey(_key), isNotNull);
  });

  test('online: photos upload first, the RPC sees only private refs', () async {
    await _seed(db);
    final _RpcPusher rpc = _RpcPusher();
    final SyncRunSummary summary = await _engine(db, rpc, _Uploader())
        .runOnce(workspaceId: workspaceA, now: testNow);
    expect(summary.photosUploaded, 2);
    expect(summary.synced, 1);
    final Map<String, Object?> sent = rpc.payloads.single;
    expect(jsonEncode(sent), isNot(contains('/data/user/0/')));
    expect(
      (sent['after_photos']! as List<Object?>).single,
      startsWith('tp-storage://tyre-photos/modules/workshop/12345678/'
          'jobdone_'),
    );
    expect(sent['before_photos']! as List<Object?>, hasLength(1));
  });

  test('a refusal stays on the phone with the server sentence', () async {
    await _seed(db);
    final _RpcPusher rpc = _RpcPusher(
      reject: 'This job was closed before your completion arrived.',
    );
    await _engine(db, rpc, _Uploader())
        .runOnce(workspaceId: workspaceA, now: testNow);
    final PendingCommand? left = await db.queueDao.commandByIdempotencyKey(
      _key,
    );
    expect(left?.lastError, contains('closed before your completion'));
    final Map<String, WorkshopPendingCompletion> pending =
        workshopPendingCompletions(<PendingCommand>[left!], userId: testUser);
    expect(pending['wo-1']?.isFailed, isTrue);
  });
}
