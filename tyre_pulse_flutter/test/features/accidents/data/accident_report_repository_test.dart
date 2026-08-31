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
      <AccidentDamageMark>[
        AccidentDamageMark(
          zoneId: 'left_front_door',
          severity: AccidentDamageSeverity.severe,
          damageType: AccidentDamageType.broken,
          note: 'Door hinge broken',
          view: AccidentDamageView.left,
          normalizedX: .22,
          normalizedY: .58,
          areaLabel: 'Boom',
          photoReferences: const <String>['evidence://damage-closeup-1'],
          suggestion: AccidentDamageSuggestion(
            source: 'Finder',
            confidence: .82,
            suggestedType: AccidentDamageType.dent,
            suggestedArea: 'Cab door',
            decision: AccidentDamageSuggestionDecision.corrected,
            reviewedBy: 'Fleet Reporter',
            reviewedAt: DateTime.utc(2026, 8, 28, 14, 40),
            correctionNote: 'Finder selected the door; damage is on the boom.',
          ),
        ),
      ],
    );

    final Set<String> dropped = await repository.submit(
      workspace: _workspace,
      input: SubmitAccidentReportInput(
        assetNo: 'CP3012',
        vehicleId: 'pump-5-axle',
        vehicleType: 'SANY Concrete Pump 5 axle',
        plateNumber: 'UAE 74218',
        driverName: 'Ahmed Khan',
        site: 'Diriyah',
        location: 'Gate 3',
        incidentAt: DateTime(2026, 8, 28, 14, 35),
        description: 'Vehicle contacted a barrier.',
        severity: 'severe',
        accidentType: 'collision',
        injuries: false,
        injuryCount: 0,
        thirdPartyInvolved: true,
        policeReportNo: 'DUB-2026-88142',
        faultStatus: 'other_party',
        gccLiabilityRatio: 0,
        najmStatus: 'received',
        taqdeerStatus: 'pending',
        liableParty: 'Other party',
        payer: 'Other party insurance',
        responsibleParty: 'Al Noor Transport LLC',
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
    expect(payload['incident_date'], '2026-08-28');
    expect(payload['incident_time'], '14:35');
    expect(payload['plate_number'], 'UAE 74218');
    expect(payload['driver_name'], 'Ahmed Khan');
    expect(payload['injuries'], isFalse);
    expect(payload['injury_count'], 0);
    expect(payload['third_party_involved'], isTrue);
    expect(payload['police_report_no'], 'DUB-2026-88142');
    expect(payload['fault_status'], 'other_party');
    expect(payload['gcc_liability_ratio'], 0);
    expect(payload['najm_status'], 'received');
    expect(payload['taqdeer_status'], 'pending');
    expect(payload['liable_party'], 'Other party');
    expect(payload['payer'], 'Other party insurance');
    expect(payload['responsible_party'], 'Al Noor Transport LLC');
    expect(payload['status'], 'reported');
    expect(payload['country'], 'KSA');
    final Map<String, dynamic> damage =
        jsonDecode(payload['damage_description'] as String)
            as Map<String, dynamic>;
    expect(damage['version'], 2);
    expect(
      (damage['marks'] as List<dynamic>).single,
      <String, dynamic>{
        'zone_id': 'left_front_door',
        'view': 'left',
        'x': .22,
        'y': .58,
        'area': 'Boom',
        'damage_type': 'broken',
        'severity': 'severe',
        'note': 'Door hinge broken',
        'photo_references': <String>['evidence://damage-closeup-1'],
        'suggestion': <String, dynamic>{
          'source': 'Finder',
          'confidence': .82,
          'suggested_type': 'dent',
          'suggested_area': 'Cab door',
          'decision': 'corrected',
          'reviewed_by': 'Fleet Reporter',
          'reviewed_at': '2026-08-28T14:40:00.000Z',
          'correction_note': 'Finder selected the door; damage is on the boom.',
        },
      },
    );
    final List<PendingMediaUpload> media =
        await db.mediaDao.mediaForCommand(commands.single.id);
    expect(media, hasLength(1));
    expect(media.single.fileName, 'accident-1.jpg');
    expect(media.single.bucket, 'accident-photos');
  });
}
