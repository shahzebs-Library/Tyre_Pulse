/// Payload-assembly coverage for [DefaultTyreReplacementRepository],
/// against the REAL [QueuedCommandRepository] over an in-memory database -
/// mirroring `test/features/checklists/data/
/// checklist_submission_repository_test.dart`'s own established pattern
/// (`test/core/sync/queued_command_repository_test.dart`'s `WorkspaceContext`
/// fixture, reused via `database_test_support.dart`) rather than a mock.
///
/// Asserts: every field this repository actually sends is inside
/// `CommandRegistry.specFor(CommandType.tyreChange).fieldAllowList` (so
/// nothing is silently dropped); the four literal constants the reference
/// screen hard-codes (`qty: 1`, `risk_level: 'Low'`, `category: 'Tyre
/// Change'`, `fitment_date == issue_date == today`); that `serial_no`/
/// `serial_number`/`tyre_serial` always move together; that `tyre_position`
/// is never populated (see the repository's own library comment on why);
/// that photos are a flat list, never a keyed map; and that the queue's own
/// bookkeeping `country` column falls back to the workspace's active
/// country independently of the stored BUSINESS `country` value, matching
/// `wash_repository.dart`'s/`meter_log_repository.dart`'s own established
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
import 'package:tyre_pulse/features/tyre_exchange/data/tyre_replacement_repository.dart';

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
  late DefaultTyreReplacementRepository repository;

  setUp(() {
    db = newMemoryDatabase();
    commands = QueuedCommandRepository(db.queueDao);
    repository = DefaultTyreReplacementRepository(commands);
  });

  tearDown(() async {
    await db.close();
  });

  /// Each test enqueues exactly one command against a fresh in-memory
  /// database, so the single outstanding row for [workspaceA] is
  /// unambiguous - mirroring `checklist_submission_repository_test.dart`'s
  /// own `outstandingCommands` lookup for its no-linked-assignment case.
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
    final Set<String> droppedFields = await repository.submitTyreReplacement(
      workspace: _workspace(),
      input: const SubmitTyreReplacementInput(
        assetNo: 'TM514',
        position: 'LHF1',
      ),
    );

    expect(droppedFields, isEmpty);

    final PendingCommand stored = await theOnlyQueuedCommand();
    final Map<String, Object?> payload = decode(stored);

    expect(
      payload.keys.toSet().difference(
            CommandRegistry.specFor(CommandType.tyreChange).fieldAllowList,
          ),
      isEmpty,
      reason: 'a field outside the allow-list would be dropped before the '
          'write, and PostgREST fails the whole insert on an unknown column',
    );
    expect(stored.entityType, SupabaseTables.tyreRecords);
    expect(stored.commandType, CommandType.tyreChange.wireName);
  });

  test(
      'asset_no is trimmed and position is trimmed, and every literal '
      'constant the reference hard-codes is present', () async {
    await repository.submitTyreReplacement(
      workspace: _workspace(),
      input: const SubmitTyreReplacementInput(
        assetNo: '  TM514  ',
        position: '  LHF1  ',
      ),
    );

    final Map<String, Object?> payload = decode(await theOnlyQueuedCommand());
    expect(payload['asset_no'], 'TM514');
    expect(payload['position'], 'LHF1');
    expect(payload['qty'], 1);
    expect(payload['risk_level'], 'Low');
    expect(payload['category'], 'Tyre Change');
    expect(payload['fitment_date'], isNotNull);
    expect(payload['fitment_date'], payload['issue_date']);
  });

  test(
    'a typed serial number is written into all three serial columns',
    () async {
      await repository.submitTyreReplacement(
        workspace: _workspace(),
        input: const SubmitTyreReplacementInput(
          assetNo: 'TM514',
          position: 'LHF1',
          serialNo: '  YMA55312  ',
        ),
      );

      final Map<String, Object?> payload = decode(await theOnlyQueuedCommand());
      expect(payload['serial_no'], 'YMA55312');
      expect(payload['serial_number'], 'YMA55312');
      expect(payload['tyre_serial'], 'YMA55312');
    },
  );

  test(
      'with no serial typed, all three serial columns are null - never an '
      'empty string', () async {
    await repository.submitTyreReplacement(
      workspace: _workspace(),
      input: const SubmitTyreReplacementInput(
        assetNo: 'TM514',
        position: 'LHF1',
      ),
    );

    final Map<String, Object?> payload = decode(await theOnlyQueuedCommand());
    expect(payload['serial_no'], isNull);
    expect(payload['serial_number'], isNull);
    expect(payload['tyre_serial'], isNull);
  });

  test(
    'tyre_position is never populated, even though it is a real '
    'allow-listed column - the reference screen never writes it either',
    () async {
      await repository.submitTyreReplacement(
        workspace: _workspace(),
        input: const SubmitTyreReplacementInput(
          assetNo: 'TM514',
          position: 'LHF1',
        ),
      );

      final Map<String, Object?> payload = decode(await theOnlyQueuedCommand());
      expect(payload.containsKey('tyre_position'), isFalse);
    },
  );

  test(
      'brand/size/cost/km/tread/removal reason pass through when supplied, '
      'and stay null when blank', () async {
    await repository.submitTyreReplacement(
      workspace: _workspace(),
      input: const SubmitTyreReplacementInput(
        assetNo: 'TM514',
        position: 'LHF1',
        brand: 'Michelin',
        size: '315/80R22.5',
        costPerTyre: 1250,
        kmAtFitment: 48000,
        treadDepthMm: 18.5,
        removalReason: 'Worn out',
      ),
    );

    final Map<String, Object?> payload = decode(await theOnlyQueuedCommand());
    expect(payload['brand'], 'Michelin');
    expect(payload['size'], '315/80R22.5');
    expect(payload['cost_per_tyre'], 1250);
    expect(payload['km_at_fitment'], 48000);
    expect(payload['tread_depth'], 18.5);
    expect(payload['removal_reason'], 'Worn out');
  });

  test(
      'photos: a flat, orderable list - never a keyed map - and empty '
      'becomes null rather than an empty array', () async {
    await repository.submitTyreReplacement(
      workspace: _workspace(),
      input: const SubmitTyreReplacementInput(
        assetNo: 'TM514',
        position: 'LHF1',
        photoLocalPaths: <String>['/tmp/lhf1-1.jpg', '/tmp/lhf1-2.jpg'],
      ),
    );

    final PendingCommand pending = await theOnlyQueuedCommand();
    final Map<String, Object?> payload = decode(pending);
    expect(payload['photos'], <String>['/tmp/lhf1-1.jpg', '/tmp/lhf1-2.jpg']);

    // The photo files were genuinely handed to the queue, not just recorded
    // in the payload JSON - mirrors the checklist repository test's own
    // verification that pending_media_uploads references the same files.
    final List<PendingMediaUpload> uploads = await db.mediaDao.mediaForCommand(
      pending.id,
    );
    expect(uploads, hasLength(2));
    expect(uploads.map((PendingMediaUpload u) => u.localPath).toSet(), <String>{
      '/tmp/lhf1-1.jpg',
      '/tmp/lhf1-2.jpg',
    });
  });

  test('no photos supplied writes null, not an empty array', () async {
    await repository.submitTyreReplacement(
      workspace: _workspace(),
      input: const SubmitTyreReplacementInput(
        assetNo: 'TM514',
        position: 'LHF1',
      ),
    );

    final Map<String, Object?> payload = decode(await theOnlyQueuedCommand());
    expect(payload['photos'], isNull);
  });

  test(
      'the stored country matches whatever the caller supplied, honestly - '
      'including null when nothing was supplied', () async {
    await repository.submitTyreReplacement(
      workspace: _workspace(activeCountry: 'KSA'),
      input: const SubmitTyreReplacementInput(
        assetNo: 'TM514',
        position: 'LHF1',
        country: null,
      ),
    );

    final PendingCommand stored = await theOnlyQueuedCommand();
    final Map<String, Object?> payload = decode(stored);

    // The BUSINESS column carries exactly what the caller sent - never
    // silently defaulted, matching wash_repository.dart's/
    // meter_log_repository.dart's own established convention.
    expect(payload['country'], isNull);
    // The QUEUE's own bookkeeping column, on the other hand, DOES fall back
    // to the active workspace country - the command was captured while
    // that country was selected, and recording it is more useful to a
    // later diagnostic than leaving it null.
    expect(stored.country, 'KSA');
  });

  test(
      'an explicit country is written to both the business column and the '
      'queue bookkeeping column', () async {
    await repository.submitTyreReplacement(
      workspace: _workspace(activeCountry: 'KSA'),
      input: const SubmitTyreReplacementInput(
        assetNo: 'TM514',
        position: 'LHF1',
        country: 'UAE',
      ),
    );

    final PendingCommand stored = await theOnlyQueuedCommand();
    final Map<String, Object?> payload = decode(stored);
    expect(payload['country'], 'UAE');
    expect(stored.country, 'UAE');
  });

  test(
    'two replacements on the same asset and position the same day get '
    'distinct idempotency keys, so neither is silently merged away',
    () async {
      await repository.submitTyreReplacement(
        workspace: _workspace(),
        input: const SubmitTyreReplacementInput(
          assetNo: 'TM514',
          position: 'LHF1',
          serialNo: 'FIRST-TYRE',
        ),
      );
      await repository.submitTyreReplacement(
        workspace: _workspace(),
        input: const SubmitTyreReplacementInput(
          assetNo: 'TM514',
          position: 'LHF1',
          serialNo: 'SECOND-TYRE',
        ),
      );

      final List<PendingCommand> all = await db.queueDao.outstandingCommands(
        workspaceId: workspaceA,
      );
      expect(all, hasLength(2));
      expect(all[0].idempotencyKey, isNot(all[1].idempotencyKey));
    },
  );
}
