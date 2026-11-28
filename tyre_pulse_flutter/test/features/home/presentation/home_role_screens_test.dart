/// Each role's Home (`domain/home_role_plan.dart`) pumped at 360x640 with a
/// 2.0 text scale, asserting nothing overflows and the plan's tiles render.
///
/// With `TP_HOME_SCREENSHOTS=1` (and a host font with Latin and Arabic
/// glyphs: macOS "Arial Unicode", or TP_SCREENSHOT_FONT=/path) it also writes
/// review screenshots at 360x800 - English light, Arabic dark and English at
/// 2x text - to TP_HOME_SCREENSHOT_DIR (default `build/home_role_shots`).
/// Nothing is compared; those are for a person to look at.
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/auth/auth_providers.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/alerts/alerts_providers.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/home/data/home_role_repository.dart';
import 'package:tyre_pulse/features/home/domain/home_role_plan.dart';
import 'package:tyre_pulse/features/home/domain/home_work.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/home/presentation/home_screen.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';
import 'package:tyre_pulse/features/my_work/my_work_providers.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';

import '../../../core/database/database_test_support.dart';

final DateTime _now = DateTime(2026, 11, 27, 9, 30);

/// The modules a role-matrix-only role (no phone token) is given in the
/// tests, mirroring live role-matrix rows.
Map<ModuleKey, bool> _matrix(List<ModuleKey> keys) =>
    <ModuleKey, bool>{for (final ModuleKey k in keys) k: true};

/// One role under test: a file-name slug and its access.
final List<(String, AccessState)> _roles = <(String, AccessState)>[
  ('driver', const AccessState(role: UserRole.known(RoleId.driver))),
  ('manager', const AccessState(role: UserRole.known(RoleId.manager))),
  (
    'fleet_supervisor',
    const AccessState(role: UserRole.known(RoleId.fleetSupervisor)),
  ),
  ('admin', const AccessState(role: UserRole.known(RoleId.admin))),
  ('reporter', const AccessState(role: UserRole.known(RoleId.reporter))),
  ('inspector', const AccessState(role: UserRole.known(RoleId.inspector))),
  (
    'workshop_supervisor',
    const AccessState(role: UserRole.known(RoleId.workshopSupervisor)),
  ),
  (
    'plant_trade',
    AccessState(
      role: const UserRole.unknown('Ice Plant Technician'),
      roleMatrix: _matrix(const <ModuleKey>[
        ModuleKey.workshop,
        ModuleKey.checklists,
        ModuleKey.scan,
        ModuleKey.meter,
        ModuleKey.vehicles,
        ModuleKey.serial,
        ModuleKey.reportIssue,
      ]),
    ),
  ),
  ('vehicle_trade', const AccessState(role: UserRole.known(RoleId.mechanic))),
  ('tyre_man', const AccessState(role: UserRole.known(RoleId.tyreMan))),
  (
    'tyre_data_collector',
    const AccessState(role: UserRole.known(RoleId.tyreDataCollector)),
  ),
  (
    'data_monitor_officer',
    AccessState(
      role: const UserRole.unknown('Data Monitor Officer'),
      roleMatrix: _matrix(const <ModuleKey>[
        ModuleKey.alerts,
        ModuleKey.accidents,
        ModuleKey.pm,
      ]),
    ),
  ),
  (
    'tire_planning_engineer',
    AccessState(
      role: const UserRole.unknown('Tire Planning Engineer'),
      roleMatrix: _matrix(const <ModuleKey>[
        ModuleKey.alerts,
        ModuleKey.pm,
        ModuleKey.stock,
      ]),
    ),
  ),
];

const TyreAlert _alert = TyreAlert(
  id: 'a1',
  riskLevel: 'critical',
  assetNo: 'TM514',
  position: 'LHF1',
  site: 'NHC',
  treadDepthMm: 3.2,
  issueDate: '2026-11-20',
);

ChecklistTemplateRecord _template(String id, String name, String role) =>
    ChecklistTemplateRecord(
      template: ChecklistTemplate(
        id: id,
        name: name,
        assigneeRoles: <String>[role],
      ),
    );

List<Override> _overrides(AccessState access, {bool failPm = false}) {
  final WorkspaceContext workspace = WorkspaceContext(
    userId: 'user-1',
    role: access.role,
    effectivePermissions: access,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: 'org-1',
    tenantId: 'org-1',
    legacySite: 'NHC',
    fullName: 'Mohammed Ali',
  );
  final String role = access.role.rawValue.isEmpty
      ? access.role.id?.databaseName ?? ''
      : access.role.rawValue;
  return <Override>[
    accessStateProvider.overrideWithValue(access),
    accessLoadFailedProvider.overrideWithValue(false),
    retryAccessLoadProvider.overrideWithValue(null),
    workspaceContextProvider.overrideWithValue(workspace),
    unreadNotificationsCountProvider.overrideWithValue(
      const AsyncData<int>(2),
    ),
    homeHeaderClockProvider.overrideWithValue(() => _now),
    homeRoleClockProvider.overrideWithValue(() => _now),
    myWorkClockProvider.overrideWithValue(() => _now),
    homePendingSyncCountProvider.overrideWith((Ref ref) async => 1),
    homeLatestInspectionDraftProvider.overrideWith(
      (Ref ref) => Stream<InspectionDraftSummary?>.value(
        InspectionDraftSummary(
          draftKey: 'user-1::TM514',
          assetNo: 'TM514',
          vehicleType: 'Transit Mixer',
          site: 'NHC',
          filled: 6,
          total: 12,
          updatedAt: _now.subtract(const Duration(minutes: 20)),
        ),
      ),
    ),
    tyreAlertsProvider
        .overrideWith((Ref ref) async => const <TyreAlert>[_alert, _alert]),
    homePendingInspectionApprovalsProvider.overrideWith(
      (Ref ref) async => HomePendingApprovals(count: 4, newestAt: _now),
    ),
    myWorkSnapshotProvider.overrideWith(
      (Ref ref) async =>
          MyWorkSnapshot(items: const <MyWorkItem>[], loadedAt: _now),
    ),
    stockItemsProvider.overrideWith(
      (Ref ref) async => const <StockItem>[
        StockItem(id: 's1', quantity: 1, minimum: 4),
      ],
    ),
    homeRecentAssetsProvider
        .overrideWith((Ref ref) async => const <HomeRecentAsset>[]),
    homeMeterTodayProvider.overrideWith(
      (Ref ref) async => HomeMeterToday(
        assetNo: 'TM514',
        km: 184230,
        at: _now.subtract(const Duration(hours: 2)),
      ),
    ),
    homeMyVehicleProvider.overrideWith(
      (Ref ref) async => HomeMyVehicle(
        assetNo: 'TM514',
        site: 'NHC',
        lastWash: _now.subtract(const Duration(days: 3)),
      ),
    ),
    homeOffRoadCountProvider.overrideWith((Ref ref) async => 7),
    homeOpenAccidentsCountProvider.overrideWith((Ref ref) async => 3),
    homeMaintenanceOverdueCountProvider.overrideWith(
      (Ref ref) async => failPm ? throw StateError('offline') : 12,
    ),
    homeChecklistsToSignCountProvider.overrideWith((Ref ref) async => 5),
    homeChecklistsAllPendingCountProvider.overrideWith((Ref ref) async => 6),
    homeUnassignedJobsProvider
        .overrideWith((Ref ref) async => const HomeCount(49)),
    homeTeamNowProvider.overrideWith(
      (Ref ref) async => const HomeTeamNow(
        working: 8,
        waiting: 3,
        free: 2,
        waitingParts: 2,
        blockedOver30: 1,
      ),
    ),
    homeMyJobsProvider.overrideWith(
      (Ref ref) async => const <WorkshopJob>[
        WorkshopJob(id: 'j1', workOrderNo: 'GCKR/JC/1/26', assetNo: 'TM514'),
        WorkshopJob(id: 'j2', workOrderNo: 'GCKR/JC/2/26', role: 'helper'),
      ],
    ),
    homeHandoversToSignProvider
        .overrideWith((Ref ref) async => const HomeCount(2)),
    homeChecklistsDueProvider.overrideWith(
      (Ref ref) async => <ChecklistTemplateRecord>[
        _template('t1', 'Ice Plant Daily', role),
        _template('t2', 'Workshop Daily Checklist', role),
      ],
    ),
  ];
}

Future<GlobalKey> _pump(
  WidgetTester tester,
  AccessState access, {
  required Size size,
  double textScale = 1,
  Locale locale = const Locale('en'),
  Brightness brightness = Brightness.light,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final db = newMemoryDatabase();
  addTearDown(db.close);
  final GlobalKey shot = GlobalKey();
  await tester.pumpWidget(
    RepaintBoundary(
      key: shot,
      child: ProviderScope(
        overrides: <Override>[
          ..._overrides(access),
          appDatabaseProvider.overrideWithValue(db),
        ],
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: brightness == Brightness.dark ? TpTheme.dark : TpTheme.light,
          locale: locale,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: TextScaler.linear(textScale)),
            child: child!,
          ),
          home: const HomeScreen(route: HomeRoute()),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return shot;
}

String? _textFont() {
  final String? env = Platform.environment['TP_SCREENSHOT_FONT'];
  if (env != null && File(env).existsSync()) return env;
  const String mac = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
  return File(mac).existsSync() ? mac : null;
}

Future<void> _load(String family, String path) async {
  final ByteData bytes =
      ByteData.view(Uint8List.fromList(File(path).readAsBytesSync()).buffer);
  await (FontLoader(family)..addFont(Future<ByteData>.value(bytes))).load();
}

void main() {
  group('the plan', () {
    test('no role has more than two big tiles', () {
      for (final HomePersona p in HomePersona.values) {
        expect(
          homeRolePlanFor(p).big.length,
          lessThanOrEqualTo(2),
          reason: p.name,
        );
      }
    });

    test('trade titles group into plant and vehicle trades', () {
      expect(
        homePersonaFor(const UserRole.unknown('Ice Plant Technician')),
        HomePersona.plantTrade,
      );
      expect(
        homePersonaFor(
          const UserRole.unknown('Senior Plant & Chiller Technician'),
        ),
        HomePersona.plantTrade,
      );
      expect(
        homePersonaFor(const UserRole.unknown('Welder Cum Fabricator')),
        HomePersona.vehicleTrade,
      );
      expect(
        homePersonaFor(const UserRole.known(RoleId.mechanic)),
        HomePersona.vehicleTrade,
      );
      expect(
        homePersonaFor(const UserRole.unknown('Data Monitor Officer')),
        HomePersona.dataMonitor,
      );
      expect(
        homePersonaFor(const UserRole.unknown('Tire Planning Engineer')),
        HomePersona.tyrePlanner,
      );
      // No plan: the original Home stays.
      expect(homePersonaFor(const UserRole.known(RoleId.director)), isNull);
      expect(homePersonaFor(const UserRole.known(RoleId.storeKeeper)), isNull);
    });

    test('team now counts working, waiting, free and blocked from events', () {
      final HomeTeamNow t = teamNowFromEvents(
        <Map<String, dynamic>>[
          <String, dynamic>{
            'user_id': 'a',
            'event_type': 'check_in',
            'at': '2026-11-27T05:00:00Z',
          },
          <String, dynamic>{
            'user_id': 'a',
            'event_type': 'start_job',
            'at': '2026-11-27T05:10:00Z',
          },
          <String, dynamic>{
            'user_id': 'b',
            'event_type': 'check_in',
            'at': '2026-11-27T05:00:00Z',
          },
          <String, dynamic>{
            'user_id': 'c',
            'event_type': 'check_in',
            'at': '2026-11-27T05:00:00Z',
          },
          <String, dynamic>{
            'user_id': 'c',
            'event_type': 'request_parts',
            'at': '2026-11-27T05:20:00Z',
          },
        ],
        now: DateTime.utc(2026, 11, 27, 6),
      );
      expect(t.working, 1);
      expect(t.free, 1);
      expect(t.waiting, 1);
      expect(t.waitingParts, 1);
      expect(t.blockedOver30, 1);
    });
  });

  group('every role\'s Home fits 360x640 at 2x text', () {
    for (final (String slug, AccessState access) in _roles) {
      testWidgets(slug, (WidgetTester tester) async {
        await _pump(tester, access, size: const Size(360, 640), textScale: 2);
        expect(tester.takeException(), isNull);
        // Admin keeps the full original Home (owner 2026-11-28); it must
        // fit too, but it has no role panel.
        expect(
          find.byKey(HomeScreenKeys.rolePanel),
          slug == 'admin' ? findsNothing : findsOneWidget,
        );
        await tester.drag(find.byType(ListView).first, const Offset(0, -1600));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  });

  testWidgets('driver sees meter and problem tiles, no More', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const AccessState(role: UserRole.known(RoleId.driver)),
      size: const Size(360, 1400),
    );
    expect(find.byKey(HomeScreenKeys.roleBig('meterToday')), findsOneWidget);
    expect(find.byKey(HomeScreenKeys.roleChip('more')), findsNothing);
    expect(find.byKey(HomeScreenKeys.newInspection), findsNothing);
  });

  testWidgets('a failed count reads "-" and Could not check, never 0', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(360, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final db = newMemoryDatabase();
    addTearDown(db.close);
    const AccessState access = AccessState(
      role: UserRole.unknown('Data Monitor Officer'),
      roleMatrix: <ModuleKey, bool>{ModuleKey.pm: true},
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          ..._overrides(access, failPm: true),
          appDatabaseProvider.overrideWithValue(db),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: HomeScreen(route: HomeRoute()),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final Finder row = find.byKey(HomeScreenKeys.roleRow('maintenanceDue'));
    expect(row, findsOneWidget);
    expect(find.descendant(of: row, matching: find.text('-')), findsOneWidget);
    expect(
      find.descendant(of: row, matching: find.text('Could not check')),
      findsOneWidget,
    );
    expect(find.descendant(of: row, matching: find.text('0')), findsNothing);
  });

  testWidgets('a super admin with the Manager role gets the full Home', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const AccessState(
        role: UserRole.known(RoleId.manager),
        isSuperAdmin: true,
      ),
      size: const Size(360, 1400),
    );
    expect(find.byKey(HomeScreenKeys.rolePanel), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a non-signer Manager still opens Inspection Approvals in More', (
    WidgetTester tester,
  ) async {
    // A Manager reaches Approvals through the role matrix, but is not a
    // V606 signer.
    await _pump(
      tester,
      const AccessState(
        role: UserRole.known(RoleId.manager),
        roleMatrix: <ModuleKey, bool>{ModuleKey.approvals: true},
      ),
      size: const Size(360, 1400),
    );
    expect(find.byKey(HomeScreenKeys.rolePanel), findsOneWidget);
    final Finder more = find.byKey(HomeScreenKeys.roleChip('more'));
    await tester.ensureVisible(more);
    await tester.tap(more);
    await tester.pumpAndSettle();
    final Finder tile =
        find.byKey(const Key('home.services.tile.inspectionApprovals'));
    await tester.scrollUntilVisible(
      tile,
      200,
      scrollable: find.descendant(
        of: find.byKey(HomeScreenKeys.action('servicesSheet')),
        matching: find.byType(Scrollable),
      ),
    );
    expect(tile, findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the role Home header menu icon opens All services', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const AccessState(
        role: UserRole.known(RoleId.manager),
        roleMatrix: <ModuleKey, bool>{ModuleKey.approvals: true},
      ),
      size: const Size(360, 1400),
    );
    expect(find.byKey(HomeScreenKeys.rolePanel), findsOneWidget);
    await tester.tap(find.byKey(HomeScreenKeys.action('menu')));
    await tester.pumpAndSettle();
    expect(find.text('All services'), findsOneWidget);
    expect(find.byKey(HomeScreenKeys.action('servicesSheet')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  // Review screenshots, only when asked.
  final bool shots =
      Platform.environment['TP_HOME_SCREENSHOTS'] == '1' && _textFont() != null;
  final String outDir =
      Platform.environment['TP_HOME_SCREENSHOT_DIR'] ?? 'build/home_role_shots';

  group('screenshots', () {
    setUpAll(() async {
      if (!shots) return;
      final String root = Platform.environment['FLUTTER_ROOT'] ?? '';
      await _load('Roboto', _textFont()!);
      await _load(
        'MaterialIcons',
        '$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
      );
    });

    for (final (String slug, AccessState access) in _roles) {
      for (final (String variant, Locale locale, Brightness b, double scale)
          in <(String, Locale, Brightness, double)>[
        ('en_light', const Locale('en'), Brightness.light, 1),
        ('ar_dark', const Locale('ar'), Brightness.dark, 1),
        ('en_light_2x', const Locale('en'), Brightness.light, 2),
      ]) {
        testWidgets('$slug $variant', skip: !shots,
            (WidgetTester tester) async {
          final GlobalKey shot = await _pump(
            tester,
            access,
            size: const Size(360, 800),
            textScale: scale,
            locale: locale,
            brightness: b,
          );
          expect(tester.takeException(), isNull);
          final RenderRepaintBoundary boundary =
              shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          await tester.runAsync(() async {
            final ui.Image image = await boundary.toImage(pixelRatio: 2);
            final ByteData? png =
                await image.toByteData(format: ui.ImageByteFormat.png);
            Directory(outDir).createSync(recursive: true);
            File('$outDir/${slug}_$variant.png')
                .writeAsBytesSync(png!.buffer.asUint8List());
          });
        });
      }
    }
  });
}
