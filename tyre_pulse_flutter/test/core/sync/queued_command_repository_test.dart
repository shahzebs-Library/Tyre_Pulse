import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';

import '../database/database_test_support.dart';

const UserRole _testRole = UserRole.known(RoleId.reporter);
const AccessState _testAccess = AccessState(role: _testRole);

WorkspaceContext _workspace({String? activeCountry}) {
  return WorkspaceContext(
    userId: testUser,
    role: _testRole,
    effectivePermissions: _testAccess,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: workspaceA,
    tenantId: workspaceA,
    activeCountry: activeCountry,
  );
}

void main() {
  late AppDatabase db;
  late QueuedCommandRepository repository;

  setUp(() {
    db = newMemoryDatabase();
    repository = QueuedCommandRepository(db.queueDao);
  });

  tearDown(() async {
    await db.close();
  });

  group('field allow-list', () {
    test('drops any field not in the command spec and reports it', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.odometerLog,
        payload: <String, Object?>{
          'asset_no': 'TM514',
          'odometer_km': 18422,
          'this_column_does_not_exist': 'x',
        },
        workspace: _workspace(),
        now: testNow,
      );

      expect(result.droppedFields, <String>{'this_column_does_not_exist'});

      final Map<String, Object?> stored =
          jsonDecode(result.command.payloadJson) as Map<String, Object?>;
      expect(stored, <String, Object?>{
        'asset_no': 'TM514',
        'odometer_km': 18422,
      });
    });

    test('reports no dropped fields when every key is allow-listed', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.rca,
        payload: <String, Object?>{'asset_no': 'TM514', 'brand': 'Michelin'},
        workspace: _workspace(),
        now: testNow,
      );

      expect(result.droppedFields, isEmpty);
    });

    test(
        'an update command keeps its match column in the stored payload, '
        'and drops the rest', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.stockAdjust,
        entityId: 'stock-9',
        payload: <String, Object?>{
          'id': 'stock-9',
          'stock_qty': 4,
          'not_a_real_column': true,
        },
        workspace: _workspace(),
        now: testNow,
      );

      expect(result.droppedFields, <String>{'not_a_real_column'});
      final Map<String, Object?> stored =
          jsonDecode(result.command.payloadJson) as Map<String, Object?>;
      expect(stored['id'], 'stock-9');
      expect(stored['stock_qty'], 4);
      expect(stored.containsKey('not_a_real_column'), isFalse);
    });
  });

  group('round trip', () {
    test('a real row lands in pending_commands and can be read back', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.washRecord,
        payload: <String, Object?>{'asset_no': 'TM514', 'wash_type': 'full'},
        workspace: _workspace(),
        now: testNow,
      );

      final PendingCommand? stored = await db.queueDao.commandById(
        result.command.id,
      );

      expect(stored, isNotNull);
      expect(stored!.commandType, 'WASH_RECORD');
      expect(stored.entityType, 'wash_records');
      expect(stored.workspaceId, workspaceA);
      expect(stored.createdBy, testUser);
      expect(stored.status, CommandStatus.pending);
    });
  });

  group('update commands', () {
    test('carries entityId through to the stored row', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.stockAdjust,
        entityId: 'stock-42',
        payload: <String, Object?>{
          'id': 'stock-42',
          'stock_qty': 12,
          'stock_status': 'available',
        },
        workspace: _workspace(),
        now: testNow,
      );

      expect(result.command.entityId, 'stock-42');
    });

    test('throws when entityId is missing, and nothing is enqueued', () async {
      await expectLater(
        repository.enqueue(
          type: CommandType.workOrderStatus,
          payload: <String, Object?>{'id': 'wo-1', 'status': 'Completed'},
          workspace: _workspace(),
          now: testNow,
        ),
        throwsA(isA<ArgumentError>()),
      );

      expect(await db.queueDao.pendingCount(), 0);
    });

    test('throws when entityId is blank, matching the missing case', () async {
      await expectLater(
        repository.enqueue(
          type: CommandType.correctiveActionStatus,
          entityId: '   ',
          payload: <String, Object?>{'id': 'ca-1', 'status': 'closed'},
          workspace: _workspace(),
          now: testNow,
        ),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('an insert command needs no entityId at all', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.workOrder,
        payload: <String, Object?>{'work_order_no': 'WO-1'},
        workspace: _workspace(),
        now: testNow,
      );

      expect(result.command.entityId, isNull);
    });
  });

  group('country', () {
    test('uses the explicit country over the workspace selection', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.washRecord,
        payload: <String, Object?>{'asset_no': 'TM514'},
        workspace: _workspace(activeCountry: 'KSA'),
        now: testNow,
        country: 'UAE',
      );

      expect(result.command.country, 'UAE');
    });

    test('falls back to the workspace active country when omitted', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.washRecord,
        payload: <String, Object?>{'asset_no': 'TM514'},
        workspace: _workspace(activeCountry: 'Egypt'),
        now: testNow,
      );

      expect(result.command.country, 'Egypt');
    });

    test('is null when neither is set', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.washRecord,
        payload: <String, Object?>{'asset_no': 'TM514'},
        workspace: _workspace(),
        now: testNow,
      );

      expect(result.command.country, isNull);
    });
  });

  group('idempotency and id minting', () {
    test(
      'two commands enqueued with neither id nor key both get real rows',
      () async {
        final EnqueueResult first = await repository.enqueue(
          type: CommandType.odometerLog,
          payload: <String, Object?>{'asset_no': 'TM514', 'odometer_km': 1000},
          workspace: _workspace(),
          now: testNow,
        );
        final EnqueueResult second = await repository.enqueue(
          type: CommandType.odometerLog,
          payload: <String, Object?>{'asset_no': 'TM514', 'odometer_km': 1050},
          workspace: _workspace(),
          now: testNow,
        );

        expect(first.command.id, isNotEmpty);
        expect(second.command.id, isNotEmpty);
        expect(first.command.id, isNot(second.command.id));
        expect(first.command.idempotencyKey, isNotEmpty);
        expect(second.command.idempotencyKey, isNotEmpty);
        expect(
          first.command.idempotencyKey,
          isNot(second.command.idempotencyKey),
        );
        expect(await db.queueDao.pendingCount(), 2);
      },
    );

    test(
      'an explicit id and key are honoured instead of being minted',
      () async {
        final EnqueueResult result = await repository.enqueue(
          type: CommandType.engineHoursLog,
          payload: <String, Object?>{'asset_no': 'TM514', 'engine_hours': 12},
          workspace: _workspace(),
          now: testNow,
          id: 'cmd-fixed',
          idempotencyKey: 'idem-fixed',
        );

        expect(result.command.id, 'cmd-fixed');
        expect(result.command.idempotencyKey, 'idem-fixed');
      },
    );
  });

  group('workspace', () {
    test('the stored workspaceId is the resolved organisation id', () async {
      final EnqueueResult result = await repository.enqueue(
        type: CommandType.washRecord,
        payload: <String, Object?>{'asset_no': 'TM514'},
        workspace: _workspace(),
        now: testNow,
      );

      expect(result.command.workspaceId, workspaceA);
    });
  });
}
