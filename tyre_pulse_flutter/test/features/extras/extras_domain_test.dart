import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/auth/presentation/register_screen.dart';
import 'package:tyre_pulse/features/extras/data/self_registration_repository.dart';
import 'package:tyre_pulse/features/extras/domain/fleet_ai.dart';
import 'package:tyre_pulse/features/extras/domain/repair_request.dart';

void main() {
  group('repair request', () {
    test('meter parsing: blank is not zero, junk and negatives are invalid',
        () {
      expect(parseMeterReading(''), isA<MeterBlank>());
      expect(parseMeterReading(null), isA<MeterBlank>());
      expect((parseMeterReading('12,345') as MeterValue).value, 12345);
      expect((parseMeterReading('12,5') as MeterValue).value, 12.5);
      expect((parseMeterReading('0') as MeterValue).value, 0);
      expect(parseMeterReading('-3'), isA<MeterInvalid>());
      expect(parseMeterReading('abc'), isA<MeterInvalid>());
    });

    test('validation names every missing piece', () {
      expect(
        validateRepairRequest(
          const RepairRequestDraft(
            assetNo: ' ',
            description: '',
            odometer: 'x',
          ),
        ),
        <RepairRequestProblem>[
          RepairRequestProblem.assetMissing,
          RepairRequestProblem.descriptionMissing,
          RepairRequestProblem.odometerInvalid,
        ],
      );
      expect(
        validateRepairRequest(
          const RepairRequestDraft(assetNo: 'TM514', description: 'Leak'),
        ),
        isEmpty,
      );
    });

    test('row carries only verified columns and never a role or rfr number',
        () {
      final Map<String, Object?> row = buildRepairRequestRow(
        draft: const RepairRequestDraft(
          assetNo: ' TM514 ',
          description: ' Hydraulic leak ',
          priority: 'Nonsense',
          odometer: '',
          engineHours: '1,200',
          faultCategory: 'Hydraulics',
        ),
        reporter: const RepairRequestReporter(
          userId: 'u1',
          fullName: 'Ali',
          country: 'KSA',
          legacySite: 'NHC',
        ),
        clientUuid: 'c-1',
      );
      expect(row.keys.toSet(), <String>{
        'asset_no',
        'plate_no',
        'asset_description',
        'site',
        'country',
        'odometer',
        'engine_hours',
        'fault_category',
        'description',
        'priority',
        'status',
        'reported_by',
        'reported_by_name',
        'client_uuid',
      });
      expect(row['asset_no'], 'TM514');
      expect(row['description'], 'Hydraulic leak');
      expect(row['priority'], kRepairDefaultPriority);
      expect(row['odometer'], isNull);
      expect(row['engine_hours'], 1200);
      expect(row['site'], 'NHC');
      expect(row['status'], 'submitted');
    });

    test('asset description composes only what the register carries', () {
      expect(composeAssetDescription(), isNull);
      expect(
        composeAssetDescription(vehicleType: 'TR-MIXER', model: ' X '),
        'TR-MIXER / X',
      );
    });
  });

  group('fleet ai', () {
    test('an unreadable count is named unavailable, never zero', () {
      const FleetAiSnapshot snapshot = FleetAiSnapshot(vehicles: 10);
      final String prompt = buildFleetAiSystemPrompt(snapshot);
      expect(prompt, contains('Vehicles in the fleet register: 10'));
      expect(prompt, contains('Tyres rated Critical risk: unavailable'));
      expect(prompt, contains('Never invent numbers'));
      expect(snapshot.readCount, 1);
      expect(const FleetAiSnapshot().isEmpty, isTrue);
    });

    test('history window keeps the last turns in order', () {
      final List<FleetAiMessage> history = <FleetAiMessage>[
        for (int i = 0; i < 12; i++)
          FleetAiMessage(
            role: i.isEven ? FleetAiRole.user : FleetAiRole.assistant,
            content: 'm$i',
          ),
      ];
      final List<Map<String, String>> wire = fleetAiWireHistory(history);
      expect(wire, hasLength(kFleetAiHistoryWindow));
      expect(wire.first['content'], 'm4');
      expect(
        wire.last,
        <String, String>{'role': 'assistant', 'content': 'm11'},
      );
    });

    test('edge function statuses map to honest failure kinds', () {
      expect(fleetAiFailureForStatus(403), FleetAiFailureKind.disabled);
      expect(fleetAiFailureForStatus(402), FleetAiFailureKind.budget);
      expect(fleetAiFailureForStatus(429), FleetAiFailureKind.rateLimited);
      expect(fleetAiFailureForStatus(0), FleetAiFailureKind.offline);
      expect(fleetAiFailureForStatus(502), FleetAiFailureKind.unavailable);
    });
  });

  group('self registration', () {
    test('synthetic email mirrors the web', () {
      expect(syntheticEmailFor('Ali.Khan_1'), 'ali.khan.1@users.tyrepulse.app');
      expect(syntheticEmailFor('...'), 'user@users.tyrepulse.app');
    });

    test('policy: only an explicit false closes; length has a floor', () {
      expect(policyFromConfig(null).open, isTrue);
      expect(
        policyFromConfig(<String, Object?>{'registration_open': 'false'}).open,
        isFalse,
      );
      expect(
        policyFromConfig(<String, Object?>{'allow_signups': 'false'}).open,
        isFalse,
      );
      expect(
        policyFromConfig(<String, Object?>{'password_min_length': '4'})
            .minPassword,
        kPasswordFloor,
      );
      expect(
        policyFromConfig(<String, Object?>{'password_min_length': '10'})
            .minPassword,
        10,
      );
    });

    test('duplicate sign-up errors read as taken', () {
      expect(
        classifySignUpError('User already registered'),
        SelfRegistrationResult.taken,
      );
      expect(classifySignUpError('boom'), SelfRegistrationResult.failed);
    });

    test('form validation matches the web rules', () {
      expect(
        validateRegistration(
          username: 'ab',
          employeeId: '',
          password: 'short',
          confirm: 'other',
          minPassword: 8,
        ),
        <RegisterProblem>[
          RegisterProblem.usernameShort,
          RegisterProblem.employeeIdMissing,
          RegisterProblem.passwordShort,
          RegisterProblem.passwordMismatch,
        ],
      );
      expect(
        validateRegistration(
          username: 'ali khan',
          employeeId: 'E1',
          password: 'longenough',
          confirm: 'longenough',
          minPassword: 8,
        ),
        <RegisterProblem>[RegisterProblem.usernameChars],
      );
    });
  });
}
