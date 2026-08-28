/// Payload-assembly coverage for [DefaultTyreDefectReportRepository],
/// against the REAL [QueuedCommandRepository] over an in-memory database -
/// mirroring `test/features/tyre_exchange/data/
/// tyre_replacement_repository_test.dart`'s own established pattern.
///
/// Asserts: every field this repository actually sends is inside
/// `CommandRegistry.specFor(CommandType.reportIssue).fieldAllowList` (so
/// nothing is silently dropped, and PostgREST never fails the whole write on
/// an unknown column); blank/whitespace-only optional fields are stored as
/// `null`, never an empty string; and the queue's own bookkeeping `country`
/// column falls back to the workspace's active country when the caller
/// supplies none - matching every sibling repository's established
/// convention.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/tyre_diagram/data/tyre_defect_report_repository.dart';

import '../../../core/database/database_test_support.dart';

const UserRole _testRole = UserRole.known(RoleId.tyreMan);
const AccessState _testAccess = AccessState(role: _testRole);

WorkspaceContext _workspace({String? activeCountry = 'KSA'}) {
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
  late QueuedCommandRepository commands;
  late DefaultTyreDefectReportRepository repository;

  setUp(() {
    db = newMemoryDatabase();
    commands = QueuedCommandRepository(db.queueDao);
    repository = DefaultTyreDefectReportRepository(commands);
  });

  tearDown(() async {
    await db.close();
  });

  Future<PendingCommand> theOnlyQueuedCommand() async {
    final List<PendingCommand> all = await db.queueDao.outstandingCommands(
      workspaceId: workspaceA,
    );
    expect(all, hasLength(1), reason: 'expected exactly one queued command');
    return all.single;
  }

  Map<String, Object?> decode(PendingCommand row) =>
      jsonDecode(row.payloadJson) as Map<String, Object?>;

  test(
      'every field this repository sends is inside the command registry\'s '
      'allow-list, and nothing is dropped', () async {
    final Set<String> droppedFields = await repository.submitDefectReport(
      workspace: _workspace(),
      input: const SubmitTyreDefectReportInput(
        title: 'Puncture on LHF1',
        description: 'Sharp object found in tread.',
        assetNo: 'TM514',
        tyreSerial: 'YMA55312',
        site: 'NHC',
        priority: CorrectiveActionPriority.high,
        rootCause: 'Puncture',
        country: 'KSA',
      ),
    );

    expect(droppedFields, isEmpty);

    final PendingCommand stored = await theOnlyQueuedCommand();
    final Map<String, Object?> payload = decode(stored);

    expect(
      payload.keys.toSet().difference(
            CommandRegistry.specFor(CommandType.reportIssue).fieldAllowList,
          ),
      isEmpty,
      reason: 'a field outside the allow-list would be dropped before the '
          'write, and PostgREST fails the whole insert on an unknown column',
    );
    expect(stored.entityType, SupabaseTables.correctiveActions);
    expect(stored.commandType, CommandType.reportIssue.wireName);
    expect(payload['title'], 'Puncture on LHF1');
    expect(payload['description'], 'Sharp object found in tread.');
    expect(payload['asset_no'], 'TM514');
    expect(payload['tyre_serial'], 'YMA55312');
    expect(payload['site'], 'NHC');
    expect(payload['priority'], CorrectiveActionPriority.high);
    expect(payload['root_cause'], 'Puncture');
    expect(payload['status'], 'Open');
  });

  test('a blank optional field is stored as null, never an empty string',
      () async {
    await repository.submitDefectReport(
      workspace: _workspace(),
      input: const SubmitTyreDefectReportInput(
        title: 'Damaged sidewall',
        description: '   ',
        assetNo: '  ',
        tyreSerial: null,
        site: '',
        priority: null,
        rootCause: null,
      ),
    );

    final PendingCommand stored = await theOnlyQueuedCommand();
    final Map<String, Object?> payload = decode(stored);

    expect(payload['description'], isNull);
    expect(payload['asset_no'], isNull);
    expect(payload['tyre_serial'], isNull);
    expect(payload['site'], isNull);
    expect(payload['priority'], isNull);
    expect(payload['root_cause'], isNull);
  });

  test('due date, assignment and photos survive into the offline queue',
      () async {
    final DateTime due = DateTime.utc(2026, 9, 4, 12);
    await repository.submitDefectReport(
      workspace: _workspace(),
      input: SubmitTyreDefectReportInput(
        title: 'Hydraulic leak',
        description: 'Leak below pump housing.',
        assignedTo: 'Eng Vinay',
        dueDate: due,
        photoLocalPaths: const <String>[
          r'C:\drafts\leak-1.jpg',
          r'C:\drafts\leak-2.jpg',
        ],
      ),
    );

    final PendingCommand stored = await theOnlyQueuedCommand();
    final Map<String, Object?> payload = decode(stored);
    expect(payload['assigned_to'], 'Eng Vinay');
    expect(payload['due_date'], due.toIso8601String());
    expect(payload['photos'], <String>[
      r'C:\drafts\leak-1.jpg',
      r'C:\drafts\leak-2.jpg',
    ]);
    final List<PendingMediaUpload> uploads =
        await db.mediaDao.mediaForCommand(stored.id);
    expect(uploads, hasLength(2));
    expect(uploads.map((PendingMediaUpload row) => row.fileName), <String>[
      'leak-1.jpg',
      'leak-2.jpg',
    ]);
  });

  test(
      'the queue bookkeeping country falls back to the active country when '
      'the caller supplies none', () async {
    await repository.submitDefectReport(
      workspace: _workspace(activeCountry: 'UAE'),
      input: const SubmitTyreDefectReportInput(
        title: 'Flat tyre',
        description: 'Deflated overnight.',
      ),
    );

    final PendingCommand stored = await theOnlyQueuedCommand();
    expect(stored.country, 'UAE');
  });

  test('two reports on the same asset get distinct idempotency keys', () async {
    const SubmitTyreDefectReportInput input = SubmitTyreDefectReportInput(
      title: 'Puncture',
      description: 'Again.',
      assetNo: 'TM514',
    );
    await repository.submitDefectReport(
      workspace: _workspace(),
      input: input,
    );
    await repository.submitDefectReport(
      workspace: _workspace(),
      input: input,
    );

    final List<PendingCommand> all = await db.queueDao.outstandingCommands(
      workspaceId: workspaceA,
    );
    expect(all, hasLength(2));
    expect(all[0].idempotencyKey, isNot(all[1].idempotencyKey));
  });
}
