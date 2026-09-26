// The WORKSHOP_EVENT payload: photo refs folded into `note` (no photos
// column in V291) and the best-effort GPS fix on gps_lat / gps_lng.
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
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_evidence.dart';

import '../../../core/database/database_test_support.dart';

class _MockSupabaseClient extends Mock implements SupabaseClient {}

const WorkspaceContext _workspace = WorkspaceContext(
  userId: testUser,
  role: UserRole.known(RoleId.tyreMan),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.tyreMan)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  companyId: workspaceA,
  tenantId: workspaceA,
  activeCountry: 'KSA',
);

Future<Map<String, dynamic>> _queuedPayload(
  AppDatabase db,
  RecordWorkshopEventInput input,
) async {
  final SupabaseWorkshopRepository repo = SupabaseWorkshopRepository(
    _MockSupabaseClient(),
    QueuedCommandRepository(db.queueDao),
  );
  await repo.recordEvent(workspace: _workspace, input: input);
  final List<PendingCommand> commands =
      await db.queueDao.outstandingCommands(workspaceId: workspaceA);
  expect(commands, hasLength(1));
  expect(commands.single.commandType, 'WORKSHOP_EVENT');
  return jsonDecode(commands.single.payloadJson) as Map<String, dynamic>;
}

void main() {
  test('photo refs are folded into note; GPS rides on gps_lat/gps_lng',
      () async {
    final AppDatabase db = newMemoryDatabase();
    addTearDown(db.close);
    final Map<String, dynamic> payload = await _queuedPayload(
      db,
      const RecordWorkshopEventInput(
        eventType: 'report_problem',
        jobId: 'wo-1',
        assetNo: 'TM514',
        reasonCode: 'problem',
        note: 'Hub seal torn',
        photoRefs: <String>[
          'tp-storage://tyre-photos/modules/workshop/t/1.jpg',
        ],
        gps: WorkshopGpsReading(lat: 24.71, lng: 46.67),
      ),
    );
    expect(
      payload['note'],
      'Hub seal torn\nPhotos: tp-storage://tyre-photos/modules/workshop/t/1.jpg',
    );
    expect(payload['gps_lat'], 24.71);
    expect(payload['gps_lng'], 46.67);
    expect(payload.containsKey('photos'), isFalse);
  });

  test('no fix and no photo: null coordinates, never 0, and the plain note',
      () async {
    final AppDatabase db = newMemoryDatabase();
    addTearDown(db.close);
    final Map<String, dynamic> payload = await _queuedPayload(
      db,
      const RecordWorkshopEventInput(
        eventType: 'request_parts',
        jobId: 'wo-1',
        reasonCode: 'parts',
        note: '  Need brake pads ',
      ),
    );
    expect(payload['note'], 'Need brake pads');
    expect(payload['gps_lat'], isNull);
    expect(payload['gps_lng'], isNull);
  });
}
