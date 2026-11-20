// INVENTORY_COUNT_LINE replay and STOCK_ADJUST retirement through the real
// SyncEngine and an in-memory database (docs/inventory_reserved_patch.md).
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';
import 'package:tyre_pulse/core/sync/sync_outcome.dart';

import '../database/database_test_support.dart';

/// Answers every RPC call with a scripted `{accepted, duplicates, rejected}`.
final class _RpcPusher implements CommandPusher {
  _RpcPusher(this.answer);

  final Map<String, Object?> answer;
  final List<Map<String, Object?>> calls = <Map<String, Object?>>[];
  final List<CommandSpec> specs = <CommandSpec>[];

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    calls.add(payload);
    specs.add(spec);
    return <Map<String, Object?>>[answer];
  }
}

final class _NoUploads implements MediaUploader {
  @override
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  }) =>
      throw StateError('no media in these tests');
}

const String _uuid = '11111111-1111-1111-1111-111111111111';

Map<String, Object?> _line({String? countedAt}) => <String, Object?>{
      'client_uuid': _uuid,
      'location_id': 'loc-1',
      'item_id': 'item-1',
      'counted_qty': 3,
      'counted_at': countedAt ?? '2026-11-20T08:00:00.000Z',
    };

void main() {
  late AppDatabase db;

  setUp(() => db = newMemoryDatabase());
  tearDown(() async => db.close());

  Future<void> enqueueLine({Map<String, Object?>? extra}) =>
      db.queueDao.enqueue(
        id: 'cmd-line',
        commandType: 'INVENTORY_COUNT_LINE',
        entityType: 'inventory_count_lines',
        payloadJson: jsonEncode(<String, Object?>{
          'audit_id': 'audit-1',
          'device_id': 'device-1',
          'lines': <Object?>[_line()],
          ...?extra,
        }),
        createdBy: testUser,
        workspaceId: workspaceA,
        now: testNow,
        idempotencyKey: _uuid,
      );

  SyncEngine engine(CommandPusher pusher) => SyncEngine(
        queueDao: db.queueDao,
        mediaDao: db.mediaDao,
        pusher: pusher,
        uploader: _NoUploads(),
        holderId: 'engine-under-test',
      );

  test('an accepted line is synced; the call carries only the allow-list',
      () async {
    await enqueueLine(extra: <String, Object?>{'expected_qty': 99});
    final _RpcPusher pusher = _RpcPusher(<String, Object?>{
      'accepted': <String>[_uuid],
    });
    final SyncRunSummary s =
        await engine(pusher).runOnce(workspaceId: workspaceA, now: testNow);
    expect(s.synced, 1);
    expect(pusher.specs.single.operation, CommandOperation.rpc);
    expect(pusher.specs.single.rpc, 'inv_count_submit');
    expect(
      pusher.calls.single.keys.toSet(),
      <String>{'audit_id', 'device_id', 'lines'},
      reason: 'expected_qty must never reach the server from the phone',
    );
  });

  test('a replay answered as a duplicate is synced, not failed', () async {
    await enqueueLine();
    final _RpcPusher pusher = _RpcPusher(<String, Object?>{
      'accepted': <String>[],
      'duplicates': <String>[_uuid],
    });
    final SyncRunSummary s =
        await engine(pusher).runOnce(workspaceId: workspaceA, now: testNow);
    expect(s.synced, 1);
    expect(s.failed, 0);
  });

  test('a refusal is a conflict carrying the server reason', () async {
    await enqueueLine();
    final _RpcPusher pusher = _RpcPusher(<String, Object?>{
      'rejected': <Object?>[
        <String, Object?>{'client_uuid': _uuid, 'reason': 'Audit is closed'},
      ],
    });
    final SyncRunSummary s =
        await engine(pusher).runOnce(workspaceId: workspaceA, now: testNow);
    expect(s.conflicted, 1);
    final PendingCommand? stored = await db.queueDao.commandById('cmd-line');
    expect(stored!.lastError, 'Audit is closed');
  });

  test('an answer that does not name the line is not counted as stored',
      () async {
    await enqueueLine();
    final SyncRunSummary s = await engine(_RpcPusher(<String, Object?>{}))
        .runOnce(workspaceId: workspaceA, now: testNow);
    expect(s.synced, 0);
    expect(s.failed, 1);
  });

  test('a late line keeps its counting time, not the replay time', () async {
    await enqueueLine();
    final _RpcPusher pusher = _RpcPusher(<String, Object?>{
      'accepted': <String>[_uuid],
    });
    await engine(pusher).runOnce(
      workspaceId: workspaceA,
      now: testNow.add(const Duration(days: 2)),
    );
    final List<Object?> lines = pusher.calls.single['lines']! as List<Object?>;
    expect(
      (lines.single! as Map<String, Object?>)['counted_at'],
      '2026-11-20T08:00:00.000Z',
    );
  });

  test('a queued STOCK_ADJUST is failed and never reaches the server',
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
    final _RpcPusher pusher = _RpcPusher(<String, Object?>{});
    final SyncRunSummary s =
        await engine(pusher).runOnce(workspaceId: workspaceA, now: testNow);
    expect(s.failed, 1);
    expect(pusher.calls, isEmpty);
    final PendingCommand? stored = await db.queueDao.commandById('cmd-old');
    expect(stored!.lastError, contains('Count the item again'));
    expect(stored.status, isNot(CommandStatus.synced));
  });
}
