import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/preventive_maintenance/data/pm_repository.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';
import 'package:tyre_pulse/features/preventive_maintenance/pm_providers.dart';
import 'package:tyre_pulse/features/preventive_maintenance/presentation/pm_screen.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/create_work_order_sheet.dart';

void main() {
  testWidgets('maintenance centre fits compact screens and filters real plans',
      (
    WidgetTester tester,
  ) async {
    final _PmRepository repository = _PmRepository();
    await _pump(tester, repository);

    expect(find.text('Maintenance Control Center'), findsWidgets);
    expect(find.byKey(const Key('pm.plan.overdue')), findsOneWidget);
    expect(find.byKey(const Key('pm.plan.ok')), findsNothing);
    await expectLater(
      find.byType(PreventiveMaintenanceScreen),
      matchesGoldenFile('goldens/pm_compact_en.png'),
    );

    await tester.tap(find.text('All plans'));
    await tester.pump();
    expect(find.byKey(const Key('pm.plan.overdue')), findsOneWidget);
    expect(find.byKey(const Key('pm.plan.ok')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'record service sheet validates and writes through the repository', (
    WidgetTester tester,
  ) async {
    final _PmRepository repository = _PmRepository();
    await _pump(tester, repository);

    await tester.ensureVisible(find.byKey(const Key('pm.record.overdue')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pm.record.overdue')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pm.save')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('pm.meter')), 'not-a-number');
    await tester.tap(find.byKey(const Key('pm.save')));
    await tester.pump();
    expect(find.text('Enter valid numeric values.'), findsOneWidget);
    expect(repository.saved, isEmpty);

    await tester.enterText(find.byKey(const Key('pm.meter')), '128450');
    await tester.ensureVisible(find.text('Partially completed'));
    await tester.tap(find.text('Partially completed'));
    await tester.ensureVisible(find.byKey(const Key('pm.save')));
    await tester.tap(find.byKey(const Key('pm.save')));
    await tester.pumpAndSettle();

    expect(repository.saved, hasLength(1));
    expect(repository.saved.single.meterReading, 128450);
    expect(repository.saved.single.outcome, PmServiceOutcome.partial);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping a queue row opens the record service sheet', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _PmRepository());

    await tester.ensureVisible(find.byKey(const Key('pm.plan.soon')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pm.plan.soon')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('pm.save')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('bell badge is hidden when there are no unread notifications', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _PmRepository());

    final Badge badge =
        tester.widget<Badge>(find.byKey(const Key('pm.notificationsBadge')));
    expect(badge.isLabelVisible, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('bell badge shows the real unread count', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _PmRepository(),
      unread: const AsyncData<int>(3),
    );

    final Badge badge =
        tester.widget<Badge>(find.byKey(const Key('pm.notificationsBadge')));
    expect(badge.isLabelVisible, isTrue);
    expect(
      find.descendant(
        of: find.byKey(const Key('pm.notificationsBadge')),
        matching: find.text('3'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('bell badge stays hidden while the inbox cannot be read', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _PmRepository(),
      unread: AsyncError<int>(StateError('inbox'), StackTrace.empty),
    );

    final Badge badge =
        tester.widget<Badge>(find.byKey(const Key('pm.notificationsBadge')));
    expect(badge.isLabelVisible, isFalse);
  });

  testWidgets('avatar shows the signed-in user initials', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _PmRepository());

    expect(
      find.descendant(
        of: find.byKey(const Key('pm.avatar')),
        matching: find.text('MS'),
      ),
      findsOneWidget,
    );
  });

  test('pmInitials takes first and last initials and never invents one', () {
    expect(pmInitials('Mohammed Saleh'), 'MS');
    expect(pmInitials('  anum  '), 'A');
    expect(pmInitials('Ali bin Omar'), 'AO');
    expect(pmInitials(''), isNull);
    expect(pmInitials(null), isNull);
  });

  testWidgets('create work order action opens the real creation workflow', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _PmRepository());

    await tester.tap(find.byKey(const Key('pm.createWorkOrder')));
    await tester.pumpAndSettle();

    expect(find.byType(CreateWorkOrderSheet), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Future<void> _pump(
  WidgetTester tester,
  PmRepository repository, {
  AsyncValue<int> unread = const AsyncData<int>(0),
}) async {
  const AccessState access = AccessState(role: UserRole.known(RoleId.admin));
  final WorkspaceContext workspace = WorkspaceContext(
    userId: 'user-1',
    role: access.role,
    effectivePermissions: access,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: 'org-1',
    tenantId: 'org-1',
    fullName: 'Mohammed Saleh',
  );
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        pmRepositoryProvider.overrideWithValue(repository),
        accessStateProvider.overrideWithValue(access),
        workspaceContextProvider.overrideWithValue(workspace),
        unreadNotificationsCountProvider.overrideWithValue(unread),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const PreventiveMaintenanceScreen(
          route: PreventiveMaintenanceRoute(),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();

  // Golden tests can reach a settled widget tree before the raster codecs
  // finish their first decode. Warm the two truthful vehicle-class assets
  // used by the fixture, then repaint so the priority queue is captured with
  // the same equipment artwork users see on device.
  final BuildContext context = tester.element(
    find.byType(PreventiveMaintenanceScreen),
  );
  await tester.runAsync(() async {
    await Future.wait(<Future<void>>[
      precacheImage(
        const AssetImage(
          'assets/vehicle_photos/tri_mixer_perspective.webp',
        ),
        context,
      ),
      precacheImage(
        const AssetImage('assets/vehicle_photos/concrete_pump.png'),
        context,
      ),
    ]);
  });
  await tester.pump();
}

final class _PmRepository implements PmRepository {
  final List<RecordPmServiceInput> saved = <RecordPmServiceInput>[];

  @override
  Future<List<PmPlan>> listActive({String? country}) async {
    final DateTime now = DateTime.now();
    return <PmPlan>[
      PmPlan(
        id: 'overdue',
        name: 'Mixer 3821 10,000 km service',
        assetNo: 'TM-3821',
        assetCategory: 'Transit Mixer',
        site: 'Qiddiya',
        status: 'active',
        meterSource: 'odometer',
        nextDue: now.subtract(const Duration(days: 4)),
        nextDueMeter: 128500,
      ),
      PmPlan(
        id: 'soon',
        name: 'Pump 3012 quarterly service',
        assetNo: 'CP-3012',
        assetCategory: 'Concrete Pump',
        site: 'Diriyah',
        status: 'active',
        meterSource: 'engine_hours',
        nextDue: now.add(const Duration(days: 8)),
        nextDueMeter: 3150,
      ),
      PmPlan(
        id: 'ok',
        name: 'Loader 509 annual service',
        assetNo: 'WL-0509',
        assetCategory: 'Wheel Loader',
        site: 'Qiddiya',
        status: 'active',
        nextDue: now.add(const Duration(days: 60)),
      ),
    ];
  }

  @override
  Future<void> recordService(RecordPmServiceInput input) async {
    saved.add(input);
  }
}
