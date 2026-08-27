/// [HomeScreen] rendered over a real [AccessState], the same override shape
/// `main.dart` wires at the composition root
/// (`accessStateProvider.overrideWith((ref) =>
/// ref.watch(workspaceContextProvider)?.effectivePermissions ??
/// AccessState.signedOut)`).
///
/// # Why this file exists
///
/// No widget test ever pumped [HomeScreen] before this one -
/// `test/features/home/home_layout_test.dart` covers only the pure
/// `visibleHomeSections` function, which takes no `BuildContext` and builds
/// no render tree. That gap is what let a real layout defect ship and stay
/// live: the stat-card `Row` (`crossAxisAlignment: CrossAxisAlignment
/// .stretch`) sits inside this `ListView`'s main axis, which hands every
/// item an UNBOUNDED height constraint - and `stretch` then asks each
/// `Expanded` stat card to fill a height the Row has none to give. That
/// throws `RenderFlex.performLayout`'s "BoxConstraints forces an infinite
/// height" - reproduced here before the fix by pumping this exact screen
/// with a real Admin `AccessState` (`tester.takeException()` returned a
/// non-null `_TypeError`/assertion instead of `null`). Because a
/// `RenderSliverList` cannot lay out anything below a child whose own
/// layout threw, the failure was not local to the Row: the WHOLE
/// `ListView` - greeting, both quick-action buttons, every stat card, the
/// section grid, the empty-state fallback - rendered as a blank rectangle
/// under an otherwise perfectly normal app bar, for EVERY signed-in role,
/// because the stat-card Row is unconditional. `home_screen.dart` now
/// wraps it in `IntrinsicHeight`; `_takeNoException` below is what a
/// regression on that wrapper would fail.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/presentation/'
    'vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/home/presentation/home_screen.dart';

import '../../../core/database/database_test_support.dart';

/// A trivial fleet source: an empty page for every read, never a Supabase
/// call. `vehicleFleetSourceProvider`'s real default reads
/// `supabaseClientProvider`, which throws until `Supabase.initialize` has
/// run - never true in a widget test - so any role this suite gives
/// `ModuleKey.vehicles` access to needs this override or the pump never
/// reaches a settled frame at all.
class _EmptyVehicleFleetSource implements VehicleFleetSource {
  @override
  Future<List<Map<String, dynamic>>> fetchPage({
    required int from,
    required int to,
    required String? country,
  }) async =>
      <Map<String, dynamic>>[];

  @override
  Future<Map<String, dynamic>?> fetchByAssetNo({
    required String assetNo,
    required String? country,
  }) async =>
      null;
}

const AccessState _admin = AccessState(role: UserRole.known(RoleId.admin));
const AccessState _tyreMan = AccessState(role: UserRole.known(RoleId.tyreMan));

Future<void> _pumpHome(
  WidgetTester tester, {
  required AccessState access,
  String? legacySite = 'NHC',
}) async {
  final WorkspaceContext workspace = WorkspaceContext(
    userId: 'user-1',
    role: access.role,
    effectivePermissions: access,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: 'org-1',
    tenantId: 'org-1',
    legacySite: legacySite,
  );

  final db = newMemoryDatabase();
  addTearDown(db.close);

  final List<Override> overrides = <Override>[
    accessStateProvider.overrideWithValue(access),
    workspaceContextProvider.overrideWithValue(workspace),
    appDatabaseProvider.overrideWithValue(db),
    vehicleFleetSourceProvider.overrideWith(
      (Ref ref) => _EmptyVehicleFleetSource(),
    ),
  ];

  await tester.pumpWidget(
    ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const HomeScreen(route: HomeRoute()),
      ),
    ),
  );
  // Deliberately not `pumpAndSettle`: the app bar's `NavigationBar`-style
  // ripple/scale animations elsewhere in this app never fully quiesce on
  // their own within a bounded pump, matching the reasoning
  // `profile_screen_test.dart` gives for the same choice. Two bounded pumps
  // is enough for the fleet `FutureProvider` to resolve and the stat cards
  // to settle into their final state.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

void main() {
  testWidgets(
    'an Admin renders the full Home hub with no layout exception: '
    'greeting, both quick-action buttons, the stat-card row and every '
    'section - never a blank body under a normal app bar',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin);

      expect(
        tester.takeException(),
        isNull,
        reason: 'the stat-card Row must never throw a layout exception - '
            'see this file\'s own library comment for the defect this guards',
      );

      expect(find.text('Welcome back'), findsOneWidget);
      expect(find.text('New inspection'), findsOneWidget);
      expect(find.text('Scan'), findsOneWidget);
      expect(find.byType(TpStatCard), findsWidgets);
      expect(find.byType(GridView), findsWidgets);
      // The Admin break-glass allows every module, so there is never a
      // reason to fall back to the "nothing available" empty state.
      expect(
        find.text(
          'Nothing is available to you here yet. Contact your '
          'administrator if you need access to a feature.',
        ),
        findsNothing,
      );
    },
  );

  testWidgets(
    'a role scoped to only some modules still renders the unconditional '
    'header content with no layout exception',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _tyreMan);

      expect(tester.takeException(), isNull);
      expect(find.text('Welcome back'), findsOneWidget);
      expect(find.byType(TpStatCard), findsWidgets);
      // Tyre Man reaches ModuleKey.inspect and ModuleKey.scan by role
      // default, so both quick-action buttons are still expected.
      expect(find.text('New inspection'), findsOneWidget);
      expect(find.text('Scan'), findsOneWidget);
    },
  );

  testWidgets(
    'no site on the profile renders the honest "unavailable" stat card, '
    'not a fabricated one, and still no layout exception',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin, legacySite: null);

      expect(tester.takeException(), isNull);
      expect(find.byKey(TpStatCardKeys.unavailable), findsWidgets);
    },
  );
}
