// Background delivery of blind count lines, end to end on the device side:
// count_line_queue -> pending_commands -> SyncEngine ->
// InventoryCountCommandPusher (photos first) -> the inv_count_submit answer.
// The server is a scripted fake; the queue, engine and decorator are real.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/inventory_count_command_pusher.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';
import 'package:tyre_pulse/core/sync/sync_outcome.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/inventory/data/count_line_queue.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';

import '../database/database_test_support.dart';

const WorkspaceContext _ws = WorkspaceContext(
  userId: testUser,
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  tenantId: workspaceA,
  companyId: workspaceA,
  activeCountry: 'KSA',
);

const String _audit = 'audit-1';
const String _u1 = '11111111-1111-1111-1111-111111111111';
const String _u2 = '22222222-2222-2222-2222-222222222222';

CountLine _line(String uuid, {List<String> photos = const <String>[]}) =>
    CountLine(
      clientUuid: uuid,
      locationId: 'loc-1',
      itemId: 'item-1',
      scannedCode: 'TP-1',
      countedQty: 2,
      countedAt: DateTime.utc(2026, 11, 20, 8),
      photoPaths: photos,
      photoRefs: const <String>['tp-storage://tyre-photos/already/one.jpg'],
    );

const SupabaseFailure _offline = SupabaseFailure(
  error: AppError.network(),
  cause: SupabaseFailureCause.offline,
);

/// The RPC side: records every call and answers from [answer], or throws.
final class _Server implements CommandPusher {
  _Server(this.events);

  final List<Map<String, Object?>> calls = <Map<String, Object?>>[];
  final List<String> events;
  SupabaseFailure? failWith;
  Map<String, Object?> Function(String key) answer =
      (String key) => <String, Object?>{
            'accepted': <String>[key],
          };

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    final SupabaseFailure? f = failWith;
    if (f != null) throw f;
    calls.add(payload);
    final Map<String, Object?> line =
        (payload['lines']! as List<Object?>).single! as Map<String, Object?>;
    events.add('rpc:${line['client_uuid']}');
    return <Map<String, Object?>>[answer('${line['client_uuid']}')];
  }
}

final class _NoUploads implements MediaUploader {
  @override
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  }) =>
      throw StateError('count photos never go through pending_media_uploads');
}

void main() {
  late AppDatabase db;
  late List<String> events;
  late _Server server;
  late Set<String> onDisk;
  SupabaseFailure? uploadFails;

  setUp(() {
    db = newMemoryDatabase();
    events = <String>[];
    server = _Server(events);
    onDisk = <String>{};
    uploadFails = null;
  });
  tearDown(() async => db.close());

  SyncEngine engine() => SyncEngine(
        queueDao: db.queueDao,
        mediaDao: db.mediaDao,
        pusher: InventoryCountCommandPusher(
          delegate: server,
          fileExists: (String p) async => onDisk.contains(p),
          putPhoto: ({
            required String bucket,
            required String objectPath,
            required String localPath,
          }) async {
            final SupabaseFailure? f = uploadFails;
            if (f != null) throw f;
            events.add('upload:$bucket/$objectPath');
          },
          priorRefusal: (String k) => priorRefusalIn(db, k),
        ),
        uploader: _NoUploads(),
        holderId: 'engine-under-test',
      );

  Future<int> queue(List<CountLine> lines) => queueCountLines(
        commands: QueuedCommandRepository(db.queueDao),
        auditId: _audit,
        deviceId: 'device-1',
        lines: lines,
        workspace: _ws,
        now: testNow,
        isQueued: (String k) async =>
            await db.queueDao.commandByIdempotencyKey(k) != null,
      );

  Future<PendingCommand> row(String key) async =>
      (await db.queueDao.commandByIdempotencyKey(key))!;

  group('offline, then online', () {
    test('a line queued without signal is sent when the connection returns',
        () async {
      expect(await queue(<CountLine>[_line(_u1)]), 1);
      expect((await row(_u1)).commandType, 'INVENTORY_COUNT_LINE');

      server.failWith = _offline;
      SyncRunSummary s =
          await engine().runOnce(workspaceId: workspaceA, now: testNow);
      expect(s.synced, 0);
      expect((await row(_u1)).status, CommandStatus.retry);
      expect(server.calls, isEmpty);

      server.failWith = null;
      s = await engine().runOnce(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(minutes: 5)),
      );
      expect(s.synced, 1);
      // Synced rows are pruned from the queue at the end of the pass.
      expect(await db.queueDao.commandByIdempotencyKey(_u1), isNull);
      final Map<String, Object?> sent = server.calls.single;
      expect(sent.keys.toSet(), <String>{'audit_id', 'device_id', 'lines'});
      expect(sent['audit_id'], _audit);
    });

    test('pressing Send twice without signal queues each line once', () async {
      expect(await queue(<CountLine>[_line(_u1), _line(_u2)]), 2);
      expect(await queue(<CountLine>[_line(_u1), _line(_u2)]), 2);
      expect(await db.queueDao.pendingCount(), 2);
    });
  });

  group('replays and duplicates', () {
    test('a line the server already holds is answered as a duplicate: synced',
        () async {
      await queue(<CountLine>[_line(_u1)]);
      server.answer = (String key) => <String, Object?>{
            'accepted': const <String>[],
            'duplicates': <String>[key],
          };
      final SyncRunSummary s =
          await engine().runOnce(workspaceId: workspaceA, now: testNow);
      expect(s.synced, 1);
      expect(s.failed, 0);
    });

    test('a lost answer: the retry is a duplicate and still succeeds',
        () async {
      await queue(<CountLine>[_line(_u1)]);
      // The first attempt reached nothing we can see (timeout); the retry is
      // answered as a duplicate because the first attempt did land.
      server.failWith = const SupabaseFailure(
        error: AppError.network(),
        cause: SupabaseFailureCause.timeout,
      );
      await engine().runOnce(workspaceId: workspaceA, now: testNow);
      server
        ..failWith = null
        ..answer = (String key) => <String, Object?>{
              'duplicates': <String>[key],
            };
      final SyncRunSummary s = await engine().runOnce(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(minutes: 5)),
      );
      expect(s.synced, 1);
    });
  });

  group('refusals', () {
    test('a refusal is a conflict with the server reason and is never re-sent',
        () async {
      await queue(<CountLine>[_line(_u1)]);
      server.answer = (String key) => <String, Object?>{
            'rejected': <Object?>[
              <String, Object?>{'client_uuid': key, 'reason': 'Audit closed'},
            ],
          };
      SyncRunSummary s =
          await engine().runOnce(workspaceId: workspaceA, now: testNow);
      expect(s.conflicted, 1);
      expect((await row(_u1)).lastError, 'Audit closed');
      expect(server.calls, hasLength(1));

      // Every later claim of the row replays the refusal locally: the server
      // is not called again and nothing is uploaded.
      DateTime t = testNow;
      for (var i = 0; i < QueueRetryPolicy.maxRetries + 2; i++) {
        t = t.add(QueueRetryPolicy.maxBackoff + const Duration(minutes: 1));
        s = await engine().runOnce(workspaceId: workspaceA, now: t);
      }
      expect(server.calls, hasLength(1), reason: 'refusals are not retried');
      final PendingCommand finalRow = await row(_u1);
      expect(finalRow.status, CommandStatus.failed);
      expect(finalRow.lastError, 'Audit closed');
    });
  });

  group('photos before the line', () {
    test('local photos are uploaded first, then the line carries their refs',
        () async {
      const String p1 = '/data/inv/photo_a.jpg';
      const String p2 = '/data/inv/photo_b.jpg';
      onDisk.addAll(<String>{p1, p2});
      await queue(<CountLine>[
        _line(_u1, photos: <String>[p1, p2]),
      ]);
      // The queued payload holds the device paths, never yet sent.
      final Map<String, Object?> queued =
          jsonDecode((await row(_u1)).payloadJson) as Map<String, Object?>;
      final Map<String, Object?> qLine =
          (queued['lines']! as List<Object?>).single! as Map<String, Object?>;
      expect(qLine[localPhotosKey], <Object?>[p1, p2]);

      final SyncRunSummary s =
          await engine().runOnce(workspaceId: workspaceA, now: testNow);
      expect(s.synced, 1);
      expect(events, <String>[
        'upload:tyre-photos/inventory_count/$_audit/$_u1/photo_a.jpg',
        'upload:tyre-photos/inventory_count/$_audit/$_u1/photo_b.jpg',
        'rpc:$_u1',
      ]);
      final Map<String, Object?> sentLine =
          (server.calls.single['lines']! as List<Object?>).single!
              as Map<String, Object?>;
      expect(
        sentLine.containsKey(localPhotosKey),
        isFalse,
        reason: 'device paths never reach the server',
      );
      expect(sentLine['photos'], <Object?>[
        'tp-storage://tyre-photos/already/one.jpg',
        'tp-storage://tyre-photos/inventory_count/$_audit/$_u1/photo_a.jpg',
        'tp-storage://tyre-photos/inventory_count/$_audit/$_u1/photo_b.jpg',
      ]);
    });

    test('a failed upload sends nothing; the retry uploads then sends',
        () async {
      const String p1 = '/data/inv/photo_a.jpg';
      onDisk.add(p1);
      await queue(<CountLine>[
        _line(_u1, photos: <String>[p1]),
      ]);
      uploadFails = _offline;
      SyncRunSummary s =
          await engine().runOnce(workspaceId: workspaceA, now: testNow);
      expect(s.synced, 0);
      expect(server.calls, isEmpty, reason: 'no line without its evidence');
      expect((await row(_u1)).status, CommandStatus.retry);

      uploadFails = null;
      s = await engine().runOnce(
        workspaceId: workspaceA,
        now: testNow.add(const Duration(minutes: 5)),
      );
      expect(s.synced, 1);
      expect(events.first, startsWith('upload:'));
      expect(events.last, 'rpc:$_u1');
    });

    test('a photo already deleted after a manual Send is not re-uploaded',
        () async {
      // The app deletes a count photo only after the server accepted that
      // line, so the replay is answered as a duplicate.
      await queue(<CountLine>[
        _line(_u1, photos: <String>['/gone/photo_a.jpg']),
      ]);
      server.answer = (String key) => <String, Object?>{
            'duplicates': <String>[key],
          };
      final SyncRunSummary s =
          await engine().runOnce(workspaceId: workspaceA, now: testNow);
      expect(s.synced, 1);
      expect(events, <String>['rpc:$_u1']);
      final Map<String, Object?> sentLine =
          (server.calls.single['lines']! as List<Object?>).single!
              as Map<String, Object?>;
      expect(
        sentLine['photos'],
        contains(
          'tp-storage://tyre-photos/inventory_count/$_audit/$_u1/photo_a.jpg',
        ),
      );
    });
  });

  test('other commands pass through the decorator untouched', () async {
    final InventoryCountCommandPusher p = InventoryCountCommandPusher(
      delegate: server,
      putPhoto: ({
        required String bucket,
        required String objectPath,
        required String localPath,
      }) async =>
          fail('no upload for other commands'),
    );
    final Map<String, Object?> payload = <String, Object?>{
      'lines': <Object?>[
        <String, Object?>{
          'client_uuid': 'x',
          localPhotosKey: <String>['/p'],
        },
      ],
    };
    await p.push(
      spec: CommandRegistry.specFor(CommandType.washRecord),
      payload: payload,
    );
    expect(server.calls.single, same(payload));
  });

  group('STOCK_ADJUST is retired', () {
    test('an old queued STOCK_ADJUST never reaches the server and ends failed',
        () async {
      await db.queueDao.enqueue(
        id: 'cmd-old',
        commandType: 'STOCK_ADJUST',
        entityType: 'stock_records',
        payloadJson: jsonEncode(<String, Object?>{'id': 's1', 'stock_qty': 4}),
        createdBy: testUser,
        workspaceId: workspaceA,
        now: testNow,
        idempotencyKey: 'idem-old',
        entityId: 's1',
      );
      DateTime t = testNow;
      for (var i = 0; i < QueueRetryPolicy.maxRetries + 1; i++) {
        await engine().runOnce(workspaceId: workspaceA, now: t);
        t = t.add(QueueRetryPolicy.maxBackoff + const Duration(minutes: 1));
      }
      expect(server.calls, isEmpty);
      final PendingCommand old = (await db.queueDao.commandById('cmd-old'))!;
      expect(old.status, CommandStatus.failed);
      expect(old.lastError, contains('Count the item again'));
    });

    test('the spec keeps decoding old rows but carries a retired message', () {
      final CommandSpec spec = CommandRegistry.specFor(CommandType.stockAdjust);
      expect(commandTypeFromWire('STOCK_ADJUST'), CommandType.stockAdjust);
      expect(spec.retiredMessage, isNotNull);
    });
  });
}
