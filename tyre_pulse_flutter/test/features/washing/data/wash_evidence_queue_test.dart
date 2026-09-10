import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/washing/data/wash_repository.dart';
import 'package:tyre_pulse/features/washing/domain/wash_evidence.dart';

import '../../../core/database/database_test_support.dart';

void main() {
  late AppDatabase db;
  late SupabaseClient client;
  late SupabaseWashRepository repo;
  const role = UserRole.known(RoleId.tyreMan);
  const workspace = WorkspaceContext(
    userId: testUser,
    role: role,
    effectivePermissions: AccessState(role: role),
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: workspaceA,
    tenantId: workspaceA,
    activeCountry: 'KSA',
  );
  setUp(() {
    db = newMemoryDatabase();
    client = SupabaseClient('https://example.supabase.co', 'test-key');
    repo = SupabaseWashRepository(client, QueuedCommandRepository(db.queueDao));
  });
  tearDown(() async {
    await db.close();
    await client.dispose();
  });

  test(
      'offline queue retains classification, explicit checklist and operator notes without dropped fields',
      () async {
    final dropped = await repo.submitWash(
      workspace: workspace,
      input: const SubmitWashInput(
        assetNo: 'TM1',
        washType: 'Exterior',
        status: 'Completed',
        notes: 'Scratch unchanged',
        evidence: WashEvidence(
          before: <String>['/tmp/before.jpg'],
          after: <String>['/tmp/after.jpg'],
          washCompleted: true,
          conditionChecked: true,
        ),
      ),
    );
    expect(dropped, isEmpty);
    final commands =
        await db.queueDao.outstandingCommands(workspaceId: workspaceA);
    expect(commands, hasLength(1));
    final payload =
        jsonDecode(commands.single.payloadJson) as Map<String, dynamic>;
    expect(payload['photos'], <String>['/tmp/before.jpg', '/tmp/after.jpg']);
    expect(payload['status'], 'Completed');
    final notes = payload['notes'] as String;
    expect(notes, startsWith('Scratch unchanged\n'));
    final details = jsonDecode(notes.split('\n').last) as Map<String, dynamic>;
    expect(details['before_photo_indices'], <int>[0]);
    expect(details['after_photo_indices'], <int>[1]);
    expect(details['selected_wash_completed'], isTrue);
    expect(details['final_condition_checked'], isTrue);
  });

  test('incomplete checklist cannot queue a completed wash', () async {
    await expectLater(
      repo.submitWash(
        workspace: workspace,
        input: const SubmitWashInput(
          assetNo: 'TM1',
          status: 'Completed',
          evidence: WashEvidence(washCompleted: true),
        ),
      ),
      throwsArgumentError,
    );
    expect(
      await db.queueDao.outstandingCommands(workspaceId: workspaceA),
      isEmpty,
    );
  });
}
