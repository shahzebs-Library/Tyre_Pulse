import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/auth/auth_screen_registrations.dart';
import 'package:tyre_pulse/features/auth/presentation/register_screen.dart';
import 'package:tyre_pulse/features/extras/data/fleet_ai_repository.dart';
import 'package:tyre_pulse/features/extras/data/repair_request_repository.dart';
import 'package:tyre_pulse/features/extras/data/self_registration_repository.dart';
import 'package:tyre_pulse/features/extras/domain/fleet_ai.dart';
import 'package:tyre_pulse/features/extras/extras_providers.dart';
import 'package:tyre_pulse/features/extras/extras_screen_registrations.dart';
import 'package:tyre_pulse/features/extras/presentation/fleet_ai_screen.dart';
import 'package:tyre_pulse/features/extras/presentation/repair_request_screen.dart';

const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  activeCountry: 'KSA',
  fullName: 'Field Driver',
  legacySite: 'NHC',
);

class _FakeAi implements FleetAiRepository {
  _FakeAi({required this.snapshot, this.answer, this.failure});

  final FleetAiSnapshot snapshot;
  final String? answer;
  final FleetAiFailureKind? failure;
  final List<List<Map<String, String>>> asked = <List<Map<String, String>>>[];

  @override
  Future<FleetAiSnapshot> loadSnapshot({
    String? country,
    DateTime? now,
  }) async =>
      snapshot;

  @override
  Future<String> ask({
    required String system,
    required List<Map<String, String>> messages,
  }) async {
    asked.add(messages);
    if (failure != null) throw FleetAiFailure(failure!);
    return answer!;
  }
}

class _FakeReg implements SelfRegistrationRepository {
  _FakeReg(this.policy);
  final RegistrationPolicy? policy;
  int calls = 0;

  @override
  Future<RegistrationPolicy?> loadPolicy() async => policy;

  @override
  Future<SelfRegistrationResult> register({
    required String username,
    required String employeeId,
    required String password,
    String? fullName,
  }) async {
    calls++;
    return SelfRegistrationResult.created;
  }
}

class _FakeRepair implements RepairRequestRepository {
  final List<Map<String, Object?>> rows = <Map<String, Object?>>[];

  @override
  Future<RepairRequestReceipt> submit(Map<String, Object?> row) async {
    rows.add(row);
    return const RepairRequestReceipt(id: 'r1', rfrNo: 'GC/RFR/0001/0926');
  }
}

class _FakeFleetSource implements VehicleFleetSource {
  @override
  Future<Map<String, dynamic>?> fetchByAssetNo({
    required String assetNo,
    required String? country,
  }) async =>
      <String, dynamic>{
        'id': 'v1',
        'asset_no': assetNo,
        'vehicle_type': 'TR-MIXER',
        'site': 'DIRIYAH-G1',
        'registration_no': '1234 ABC',
      };

  @override
  Future<List<Map<String, dynamic>>> fetchPage({
    required int from,
    required int to,
    required String? country,
  }) async =>
      const <Map<String, dynamic>>[];
}

Future<void> _pump(
  WidgetTester tester,
  Widget home,
  List<Override> overrides,
) async {
  tester.view.physicalSize = const Size(420, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        workspaceContextProvider.overrideWithValue(_workspace),
        ...overrides,
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  test('registrations cover the three routes', () {
    expect(
      extrasScreenRegistrations.keys.toSet(),
      <String>{TpRouteId.fleetAi, TpRouteId.repairRequest},
    );
    expect(authScreenRegistrations.keys, contains(TpRouteId.register));
  });

  testWidgets('builders return the screens and reject a wrong route', (
    WidgetTester tester,
  ) async {
    late List<Widget> built;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          built = <Widget>[
            extrasScreenRegistrations[TpRouteId.fleetAi]!(
              context,
              const FleetAiRoute(),
            ),
            extrasScreenRegistrations[TpRouteId.repairRequest]!(
              context,
              const RepairRequestRoute(),
            ),
            authScreenRegistrations[TpRouteId.register]!(
              context,
              const RegisterRoute(),
            ),
            extrasScreenRegistrations[TpRouteId.fleetAi]!(
              context,
              const HomeRoute(),
            ),
          ];
          return const SizedBox.shrink();
        },
      ),
    );
    expect(built[0], isA<FleetAiScreen>());
    expect(built[1], isA<RepairRequestScreen>());
    expect(built[2], isA<RegisterScreen>());
    expect(built[3], isA<TpScreenNotAvailable>());
  });

  group('Fleet AI', () {
    testWidgets('no readable data blocks sending instead of guessing', (
      WidgetTester tester,
    ) async {
      final _FakeAi ai = _FakeAi(snapshot: const FleetAiSnapshot());
      await _pump(
        tester,
        const FleetAiScreen(route: FleetAiRoute()),
        <Override>[fleetAiRepositoryProvider.overrideWithValue(ai)],
      );
      expect(find.byKey(FleetAiKeys.noData), findsOneWidget);
      await tester.tap(find.byKey(FleetAiKeys.suggestion(0)));
      await tester.pumpAndSettle();
      expect(ai.asked, isEmpty);
    });

    testWidgets('a question is sent with history and the answer shown', (
      WidgetTester tester,
    ) async {
      final _FakeAi ai = _FakeAi(
        snapshot: const FleetAiSnapshot(vehicles: 10, criticalTyres: 2),
        answer: 'Two tyres are critical.',
      );
      await _pump(
        tester,
        const FleetAiScreen(route: FleetAiRoute()),
        <Override>[fleetAiRepositoryProvider.overrideWithValue(ai)],
      );
      expect(find.text('Based on 2 of 5 live fleet counts'), findsOneWidget);
      await tester.enterText(find.byKey(FleetAiKeys.input), 'Critical tyres?');
      await tester.tap(find.byKey(FleetAiKeys.send));
      await tester.pumpAndSettle();
      expect(ai.asked.single.single['content'], 'Critical tyres?');
      expect(find.text('Two tyres are critical.'), findsOneWidget);
    });

    testWidgets('an administrator switch-off is explained, not faked', (
      WidgetTester tester,
    ) async {
      final _FakeAi ai = _FakeAi(
        snapshot: const FleetAiSnapshot(vehicles: 1),
        failure: FleetAiFailureKind.disabled,
      );
      await _pump(
        tester,
        const FleetAiScreen(route: FleetAiRoute()),
        <Override>[fleetAiRepositoryProvider.overrideWithValue(ai)],
      );
      await tester.tap(find.byKey(FleetAiKeys.suggestion(1)));
      await tester.pumpAndSettle();
      expect(find.byKey(FleetAiKeys.error), findsOneWidget);
      expect(
        find.text('AI features are switched off by your administrator.'),
        findsOneWidget,
      );
    });
  });

  group('Register', () {
    testWidgets('closed registration shows the invite-only notice', (
      WidgetTester tester,
    ) async {
      final _FakeReg reg = _FakeReg(
        const RegistrationPolicy(open: false, minPassword: 8),
      );
      await _pump(
        tester,
        const RegisterScreen(route: RegisterRoute()),
        <Override>[selfRegistrationRepositoryProvider.overrideWithValue(reg)],
      );
      expect(find.byKey(RegisterKeys.closed), findsOneWidget);
      expect(find.byKey(RegisterKeys.submit), findsNothing);
    });

    testWidgets('invalid form is not sent; a valid one creates the account', (
      WidgetTester tester,
    ) async {
      final _FakeReg reg = _FakeReg(
        const RegistrationPolicy(open: true, minPassword: 8),
      );
      await _pump(
        tester,
        const RegisterScreen(route: RegisterRoute()),
        <Override>[selfRegistrationRepositoryProvider.overrideWithValue(reg)],
      );
      await tester.ensureVisible(find.byKey(RegisterKeys.submit));
      await tester.tap(find.byKey(RegisterKeys.submit));
      await tester.pumpAndSettle();
      expect(reg.calls, 0);
      expect(find.text('Enter your employee ID.'), findsOneWidget);

      await tester.enterText(
        find.descendant(
          of: find.byKey(RegisterKeys.username),
          matching: find.byType(TextField),
        ),
        'ali.khan',
      );
      await tester.enterText(
        find.descendant(
          of: find.byKey(RegisterKeys.employeeId),
          matching: find.byType(TextField),
        ),
        'E100',
      );
      const List<Key> secrets = <Key>[
        RegisterKeys.password,
        RegisterKeys.confirm,
      ];
      for (final Key key in secrets) {
        await tester.enterText(
          find.descendant(
            of: find.byKey(key),
            matching: find.byType(TextField),
          ),
          'longenough1',
        );
      }
      await tester.ensureVisible(find.byKey(RegisterKeys.submit));
      await tester.tap(find.byKey(RegisterKeys.submit));
      await tester.pumpAndSettle();
      expect(reg.calls, 1);
      expect(find.byKey(RegisterKeys.done), findsOneWidget);
    });
  });

  group('Repair request', () {
    testWidgets('nothing is sent until the machine and fault are given', (
      WidgetTester tester,
    ) async {
      final _FakeRepair repo = _FakeRepair();
      await _pump(
        tester,
        const RepairRequestScreen(route: RepairRequestRoute()),
        <Override>[repairRequestRepositoryProvider.overrideWithValue(repo)],
      );
      await tester.ensureVisible(find.byKey(RepairRequestKeys.submit));
      await tester.tap(find.byKey(RepairRequestKeys.submit));
      await tester.pumpAndSettle();
      expect(repo.rows, isEmpty);
      expect(
        find.text('Choose the machine that has the fault.'),
        findsOneWidget,
      );
    });

    testWidgets('a deep-linked asset fills from the register and submits', (
      WidgetTester tester,
    ) async {
      final _FakeRepair repo = _FakeRepair();
      await _pump(
        tester,
        const RepairRequestScreen(
          route: RepairRequestRoute(assetNo: AssetNo('TM514')),
        ),
        <Override>[
          repairRequestRepositoryProvider.overrideWithValue(repo),
          vehicleFleetRepositoryProvider.overrideWithValue(
            VehicleFleetRepository(_FakeFleetSource()),
          ),
        ],
      );
      expect(find.text('TM514'), findsOneWidget);
      expect(find.text('Plate 1234 ABC'), findsOneWidget);
      await tester.enterText(
        find.descendant(
          of: find.byKey(RepairRequestKeys.description),
          matching: find.byType(TextField),
        ),
        'Hydraulic leak',
      );
      await tester.ensureVisible(find.byKey(RepairRequestKeys.submit));
      await tester.tap(find.byKey(RepairRequestKeys.submit));
      await tester.pumpAndSettle();
      final Map<String, Object?> row = repo.rows.single;
      expect(row['asset_no'], 'TM514');
      expect(row['site'], 'DIRIYAH-G1');
      expect(row['plate_no'], '1234 ABC');
      expect(row['country'], 'KSA');
      expect(row['reported_by'], 'user-1');
      expect(find.byKey(RepairRequestKeys.success), findsOneWidget);
      expect(
        find.text('The workshop has it as GC/RFR/0001/0926.'),
        findsOneWidget,
      );
    });
  });
}
