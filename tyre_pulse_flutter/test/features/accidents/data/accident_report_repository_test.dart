import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/accidents/data/accident_report_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';

import '../../../core/database/database_test_support.dart';

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
  fullName: 'Fleet Reporter',
);

void main() {
  test('queues report, private-bucket evidence and serialized damage marks',
      () async {
    final AppDatabase db = newMemoryDatabase();
    addTearDown(db.close);
    final AccidentReportRepository repository = OfflineAccidentReportRepository(
      QueuedCommandRepository(db.queueDao),
    );
    final AccidentDamageMap damageMap = AccidentDamageMap.fromMarks(
      const <AccidentDamageMark>[
        AccidentDamageMark(
          zoneId: 'left_front_door',
          severity: AccidentDamageSeverity.severe,
          note: 'Door hinge broken',
          view: AccidentDamageView.left,
          normalizedX: .22,
          normalizedY: .58,
          areaLabel: 'Boom',
        ),
      ],
    );

    final Set<String> dropped = await repository.submit(
      workspace: _workspace,
      input: SubmitAccidentReportInput(
        assetNo: 'CP3012',
        vehicleId: 'pump-5-axle',
        vehicleType: 'SANY Concrete Pump 5 axle',
        site: 'Diriyah',
        location: 'Gate 3',
        description: 'Vehicle contacted a barrier.',
        severity: 'severe',
        accidentType: 'collision',
        notes: 'Supervisor notified.',
        photoLocalPaths: const <String>[r'C:\drafts\accident-1.jpg'],
        damageMap: damageMap,
      ),
    );

    expect(dropped, isEmpty);
    final List<PendingCommand> commands = await db.queueDao.outstandingCommands(
      workspaceId: workspaceA,
    );
    expect(commands, hasLength(1));
    final Map<String, dynamic> payload =
        jsonDecode(commands.single.payloadJson) as Map<String, dynamic>;
    expect(payload['asset_no'], 'CP3012');
    expect(payload['reported_by'], testUser);
    expect(payload['reporter_name'], 'Fleet Reporter');
    expect(payload['status'], 'reported');
    expect(payload['country'], 'KSA');
    final Map<String, dynamic> damage =
        jsonDecode(payload['damage_description'] as String)
            as Map<String, dynamic>;
    expect(damage['version'], 1);
    expect(
      (damage['marks'] as List<dynamic>).single,
      <String, dynamic>{
        'zone_id': 'left_front_door',
        'view': 'left',
        'x': .22,
        'y': .58,
        'area': 'Boom',
        'severity': 'severe',
        'note': 'Door hinge broken',
      },
    );
    final List<PendingMediaUpload> media =
        await db.mediaDao.mediaForCommand(commands.single.id);
    expect(media, hasLength(1));
    expect(media.single.fileName, 'accident-1.jpg');
    expect(media.single.bucket, 'accident-photos');
  });
}
