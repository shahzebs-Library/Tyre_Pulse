library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/rca/data/rca_record_dto.dart';
import 'package:tyre_pulse/features/rca/data/rca_repository.dart';

import '../../../core/database/database_test_support.dart';

class _MockSupabaseClient extends Mock implements SupabaseClient {}

const AccessState _access = AccessState(role: UserRole.known(RoleId.admin));
const WorkspaceContext _workspace = WorkspaceContext(
  userId: testUser,
  role: UserRole.known(RoleId.admin),
  effectivePermissions: _access,
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  companyId: workspaceA,
  tenantId: workspaceA,
  activeCountry: 'KSA',
);

void main() {
  test('DTO keeps the verified RCA projection and factor list', () {
    final record = const RcaRecordDto(<String, dynamic>{
      'id': 'rca-1',
      'asset_no': 'TM-100',
      'tyre_serial': 'TY-8',
      'root_cause': 'Under-inflation over time',
      'contributing_factors': <String>['Under-inflation', 'Overload'],
      'km_at_failure': 54000,
      'created_at': '2026-08-28T10:00:00Z',
    }).toDomain();

    expect(record.id, 'rca-1');
    expect(record.assetNo, 'TM-100');
    expect(record.contributingFactors, <String>['Under-inflation', 'Overload']);
    expect(record.kmAtFailure, 54000);
  });

  test('submit queues one idempotent RCA command with durable media', () async {
    final AppDatabase db = newMemoryDatabase();
    addTearDown(db.close);
    final repository = DefaultRcaRepository(
      _MockSupabaseClient(),
      QueuedCommandRepository(db.queueDao),
    );

    await repository.submit(
      workspace: _workspace,
      input: const SubmitRcaInput(
        rootCause: 'Sidewall repeatedly overloaded.',
        assetNo: 'TM-100',
        tyreSerial: 'TY-8',
        site: 'NHC',
        kmAtFailure: 54000,
        contributingFactors: <String>['Overload'],
        photoLocalPaths: <String>[r'C:\drafts\rca-1.jpg'],
      ),
    );

    final List<PendingCommand> commands = await db.queueDao.outstandingCommands(
      workspaceId: workspaceA,
    );
    expect(commands, hasLength(1));
    final Map<String, dynamic> payload =
        jsonDecode(commands.single.payloadJson) as Map<String, dynamic>;
    expect(payload['asset_no'], 'TM-100');
    expect(payload['root_cause'], 'Sidewall repeatedly overloaded.');
    expect(payload['contributing_factors'], <String>['Overload']);
    expect(payload['country'], 'KSA');
    final List<PendingMediaUpload> uploads =
        await db.mediaDao.mediaForCommand(commands.single.id);
    expect(uploads.single.fileName, 'rca-1.jpg');
  });
}
