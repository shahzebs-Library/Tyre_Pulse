/// Renders [VehiclesListScreen] behind a real [MaterialApp] with the app's
/// own theme and localisation delegates, driving [vehicleFleetListProvider]
/// through a [ProviderScope] override for each of the seven states plus the
/// screen's own search and class-filter behaviour.
///
/// A plain [MaterialApp] (not `.router`) is enough here: `TpScaffold`'s
/// `backFallback` resolves through `TpBack.of(context)`, which reads
/// `GoRouter.maybeOf(context)` and degrades to a safe default with NO router
/// ancestor at all - `tp_back.dart`'s own comment names exactly this
/// situation ("a design system widget rendered in a test harness with no
/// router must produce `BackOutcome.unavailable`, not an exception").
/// [VehiclesListScreen._openDetail] pushes onto the ambient [Navigator]
/// directly, never through GoRouter, so `MaterialApp`'s own root Navigator
/// is all a card-tap test would need - though tapping through to the detail
/// screen is deliberately NOT exercised here (see the note on the omitted
/// tap-navigation test below), matching the scanning feature's own
/// `scanner_screen_test.dart`, which draws the same boundary for the same
/// reason: a destination screen is a different feature's responsibility to
/// verify.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// `Override` is deliberately not exported by the main flutter_riverpod
// barrel in Riverpod 3.x (it carries a `@publicInMisc` marker in the
// package's own source) - `misc.dart` is the sanctioned escape hatch for
// naming it explicitly, which this file's helper signatures below do.
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/assets/data/fleet_signals_repository.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/fleet_class_groups.dart';
import 'package:tyre_pulse/features/assets/domain/fleet_signals.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicles_list_screen.dart';

Future<void> _pump(
  WidgetTester tester,
  Override override, {
  String? initialSearchTerm,
  bool dark = false,
  List<Override> extra = const <Override>[],
}) async {
  // A tall default surface: the list now carries the mock's group tabs,
  // scope line and bottom scan bar, so the default 600pt test surface
  // leaves room for only one card. Tests that pin a phone size set their
  // own view size before calling this helper.
  if (tester.view.physicalSize == const Size(2400, 1800)) {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[override, ...extra],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: dark ? TpTheme.dark : TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: VehiclesListScreen(initialSearchTerm: initialSearchTerm),
      ),
    ),
  );
}

Override _resolved(VehicleFleetListOutcome outcome) =>
    vehicleFleetListProvider.overrideWith((Ref ref) async => outcome);

/// No state key means this is real content, not one of the seven
/// full-screen fallback states.
void _expectNoStateWidget() {
  for (final Key key in <Key>[
    TpStateKeys.loading,
    TpStateKeys.empty,
    TpStateKeys.offlineCached,
    TpStateKeys.permissionDenied,
    TpStateKeys.backendUnavailable,
    TpStateKeys.notConfigured,
    TpStateKeys.error,
  ]) {
    expect(find.byKey(key), findsNothing, reason: '$key should not render');
  }
}

void main() {
  testWidgets(
      'loading renders TpLoadingState and nothing else - the only '
      'widget in the design system allowed to spin', (
    WidgetTester tester,
  ) async {
    // Never completes, so the future stays pending for the life of this
    // test. Do NOT pumpAndSettle: the progress indicator schedules its own
    // animation frames forever and that call would time out.
    await _pump(
      tester,
      vehicleFleetListProvider.overrideWith(
        (Ref ref) => Completer<VehicleFleetListOutcome>().future,
      ),
    );
    await tester.pump();

    expect(find.byKey(TpStateKeys.loading), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets(
    'a provider failure (defensive only - loadAll itself never throws) '
    'renders TpErrorState',
    (WidgetTester tester) async {
      await _pump(
        tester,
        vehicleFleetListProvider.overrideWith(
          (Ref ref) => Future<VehicleFleetListOutcome>.error(
            Exception('provider construction bug'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.error), findsOneWidget);
    },
  );

  testWidgets(
    'a genuinely empty fleet renders TpEmptyState, not a blank list',
    (WidgetTester tester) async {
      await _pump(
        tester,
        _resolved(
          const VehicleFleetListLoaded(
            assets: <VehicleAsset>[],
            truncated: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.empty), findsOneWidget);
      expect(find.byKey(VehiclesListScreenKeys.asset('missing')), findsNothing);
    },
  );

  testWidgets(
    'loaded register opens on All so vehicles and stationary PMV assets '
    'remain visible together',
    (WidgetTester tester) async {
      await _pump(
        tester,
        _resolved(
          const VehicleFleetListLoaded(
            assets: <VehicleAsset>[
              VehicleAsset(
                id: 'v1',
                assetNo: 'TM514',
                site: 'NHC',
                vehicleType: 'Concrete Pump',
              ),
              VehicleAsset(id: 'v2', assetNo: 'MP093', site: 'NHC'),
              VehicleAsset(
                id: 'v3',
                assetNo: 'BUS-062',
                site: 'NHC',
                vehicleType: '32-Seater Bus',
              ),
            ],
            truncated: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsOneWidget);
      expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsOneWidget);
      expect(find.byKey(VehiclesListScreenKeys.asset('v3')), findsOneWidget);
      final Image vehiclePhoto = tester.widget<Image>(
        find.descendant(
          of: find.byKey(VehiclesListScreenKeys.asset('v1')),
          matching: find.byType(Image),
        ),
      );
      expect(
        (vehiclePhoto.image as AssetImage).assetName,
        'assets/vehicle_photos/concrete_pump.png',
      );
      expect(vehiclePhoto.fit, BoxFit.contain);

      final Image busPhoto = tester.widget<Image>(
        find.descendant(
          of: find.byKey(VehiclesListScreenKeys.asset('v3')),
          matching: find.byType(Image),
        ),
      );
      expect(
        (busPhoto.image as AssetImage).assetName,
        'assets/vehicle_photos/staff_bus.png',
      );
      expect(
        Theme.of(
          tester.element(find.byKey(VehiclesListScreenKeys.asset('v1'))),
        ).brightness,
        Brightness.light,
      );
      _expectNoStateWidget();
    },
  );

  testWidgets(
      'truncated is a slim notice ABOVE a still-usable list, never a '
      'full-screen state - there is real content underneath it', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _resolved(
        const VehicleFleetListLoaded(
          assets: <VehicleAsset>[VehicleAsset(id: 'v1', assetNo: 'TM514')],
          truncated: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text(
        'Showing part of the fleet. Narrow your search to find a '
        'specific vehicle.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsOneWidget);
    _expectNoStateWidget();
  });

  testWidgets(
      'a failed live read with a usable cached copy renders '
      'TpOfflineCachedState, distinct from the empty and error states', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _resolved(
        VehicleFleetListFromCache(
          assets: const <VehicleAsset>[
            VehicleAsset(id: 'v1', assetNo: 'TM514'),
          ],
          cachedAt: DateTime.utc(2026, 8, 20, 9),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(TpStateKeys.offlineCached), findsOneWidget);
    expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsNothing);
  });

  testWidgets(
      'a network-classified failure with no cache renders '
      'TpBackendUnavailableState, not the plain error state', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _resolved(const VehicleFleetListFailed(AppError.network())),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(TpStateKeys.backendUnavailable), findsOneWidget);
  });

  testWidgets(
    'a non-network failure with no cache renders the plain TpErrorState, '
    'not TpBackendUnavailableState - the two must not be conflated',
    (WidgetTester tester) async {
      await _pump(
        tester,
        _resolved(
          const VehicleFleetListFailed(
            AppError(
              kind: AppErrorKind.validation,
              message: 'A vehicle record could not be read.',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.error), findsOneWidget);
      expect(find.byKey(TpStateKeys.backendUnavailable), findsNothing);
    },
  );

  testWidgets(
    'typing a search term narrows the list across the whole set, ignoring '
    'an active vehicle-type browse filter',
    (WidgetTester tester) async {
      await _pump(
        tester,
        _resolved(
          const VehicleFleetListLoaded(
            assets: <VehicleAsset>[
              VehicleAsset(
                id: 'v1',
                assetNo: 'TM514',
                make: 'Sinotruk',
                vehicleType: 'TR-MIXER',
              ),
              VehicleAsset(
                id: 'v2',
                assetNo: 'GN101',
                make: 'Cummins',
                vehicleType: 'GENERATOR',
              ),
            ],
            truncated: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsOneWidget);
      expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsOneWidget);

      await tester.tap(find.widgetWithText(ChoiceChip, 'TR-MIXER (1)'));
      await tester.pumpAndSettle();
      expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsNothing);

      await tester.enterText(find.byType(TextField), 'GN101');
      await tester.pumpAndSettle();

      expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsOneWidget);
      // Not find.text('GN101'): the fleet card draws the identifier through
      // TpIdentifierText, which wraps it in invisible bidi isolate marks
      // (U+2066/U+2069) so it can never be reordered next to Arabic or
      // Urdu text - see tp_direction.dart. find.text does an exact match
      // against the rendered string and would find nothing; textContaining
      // matches the substring inside the isolate marks. Scoped to the
      // card, not the whole tree: the search field's own EditableText now
      // ALSO literally contains "GN101" (what was just typed into it), so
      // an unscoped textContaining matches both and findsOneWidget fails
      // as "too many" - scoping proves the CARD shows it, which is the
      // actual thing under test.
      expect(
        find.descendant(
          of: find.byKey(VehiclesListScreenKeys.asset('v2')),
          matching: find.textContaining('GN101'),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'initialSearchTerm - the scanner hand-off - pre-fills the field and '
    'narrows the list on the very first frame, with no typing at all',
    (WidgetTester tester) async {
      await _pump(
        tester,
        _resolved(
          const VehicleFleetListLoaded(
            assets: <VehicleAsset>[
              VehicleAsset(id: 'v1', assetNo: 'TM514'),
              VehicleAsset(id: 'v2', assetNo: 'TM515'),
            ],
            truncated: false,
          ),
        ),
        initialSearchTerm: 'TM515',
      );
      await tester.pumpAndSettle();

      expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsNothing);
      expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsOneWidget);
      final TextField field = tester.widget<TextField>(find.byType(TextField));
      expect(field.controller?.text, 'TM515');
    },
  );

  testWidgets(
      'a vehicle-type filter can narrow an All-assets register and All widens '
      'it again', (WidgetTester tester) async {
    await _pump(
      tester,
      _resolved(
        const VehicleFleetListLoaded(
          assets: <VehicleAsset>[
            VehicleAsset(
              id: 'v1',
              assetNo: 'TM514',
              vehicleType: 'TR-MIXER',
            ),
            VehicleAsset(
              id: 'v2',
              assetNo: 'GN101',
              vehicleType: 'GENERATOR',
            ),
          ],
          truncated: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsOneWidget);
    expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'TR-MIXER (1)'));
    await tester.pumpAndSettle();
    expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsOneWidget);
    expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsNothing);

    await tester.tap(find.widgetWithText(ChoiceChip, 'All (2)'));
    await tester.pumpAndSettle();

    expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsOneWidget);
    expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsOneWidget);
  });

  testWidgets(
    'dark assets mock contract keeps the compact header, search, QR, '
    'All-first filters and dense image rows above the fold',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(393, 852);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pump(
        tester,
        _resolved(
          const VehicleFleetListLoaded(
            assets: <VehicleAsset>[
              VehicleAsset(
                id: 'mixer',
                assetNo: 'TM2841',
                fleetNumber: 'MIX-2841',
                make: 'Concrete Mixer',
                vehicleType: 'Mixer Truck',
                status: 'Active',
              ),
              VehicleAsset(
                id: 'pump',
                assetNo: 'MP112',
                fleetNumber: 'PMP-112',
                vehicleType: 'Pump Truck',
                status: 'Active',
              ),
              VehicleAsset(
                id: 'loader',
                assetNo: 'WL509',
                fleetNumber: 'WL-509',
                vehicleType: 'Wheel Loader',
                status: 'Active',
              ),
              VehicleAsset(
                id: 'trailer',
                assetNo: 'TR09',
                fleetNumber: 'TR-09',
                vehicleType: 'Trailer',
                status: 'Active',
              ),
              VehicleAsset(
                id: 'generator',
                assetNo: 'GN66',
                fleetNumber: 'GEN-66',
                vehicleType: 'Generator',
                status: 'Active',
              ),
            ],
            truncated: false,
          ),
        ),
        dark: true,
      );
      await tester.pumpAndSettle();

      expect(find.text('Fleet & assets'), findsOneWidget);
      expect(find.byKey(VehiclesListScreenKeys.classFilters), findsOneWidget);
      expect(find.byKey(VehiclesListScreenKeys.search), findsOneWidget);
      expect(find.byKey(VehiclesListScreenKeys.scanner), findsOneWidget);
      expect(find.text('All (5)'), findsOneWidget);
      // The mock places group tabs, a scope line and the bottom scan bar
      // around the list, so three dense rows sit above the fold and the
      // rest are one scroll away.
      expect(
        find.byKey(VehiclesListScreenKeys.asset('loader')),
        findsOneWidget,
      );
      await tester.scrollUntilVisible(
        find.byKey(VehiclesListScreenKeys.asset('generator')),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(
        find.byKey(VehiclesListScreenKeys.asset('generator')),
        findsOneWidget,
      );

      final ChoiceChip all = tester.widget<ChoiceChip>(
        find.widgetWithText(ChoiceChip, 'All (5)'),
      );
      expect(all.selected, isTrue);
      expect(all.selectedColor, TpPalette.dark.primary);

      final RenderBox card = tester.renderObject<RenderBox>(
        find.byKey(VehiclesListScreenKeys.asset('generator')),
      );
      expect(card.size.height, 124);

      final BuildContext cardContext =
          tester.element(find.byKey(VehiclesListScreenKeys.asset('generator')));
      expect(Theme.of(cardContext).brightness, Brightness.dark);
      expect(TpPalette.of(cardContext).surface, TpPalette.dark.surface);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
      'the Stationary tab narrows to stationary classes, the header counts '
      'active assets and the scope line names the sites', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _resolved(
        const VehicleFleetListLoaded(
          assets: <VehicleAsset>[
            VehicleAsset(id: 'v1', assetNo: 'TM514', status: 'Active'),
            VehicleAsset(id: 'v2', assetNo: 'GN101', status: 'Active'),
            VehicleAsset(id: 'v3', assetNo: 'BN004', status: 'Inactive'),
          ],
          truncated: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('2 active assets'), findsOneWidget);
    expect(find.text('All countries · All authorized sites'), findsOneWidget);

    await tester.tap(
      find.byKey(VehiclesListScreenKeys.groupTab(FleetClassGroup.stationary)),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsNothing);
    expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsOneWidget);
    // An unmapped class is never guessed into a group.
    expect(find.byKey(VehiclesListScreenKeys.asset('v3')), findsNothing);

    await tester.tap(find.byKey(VehiclesListScreenKeys.groupTab(null)));
    await tester.pumpAndSettle();
    expect(find.byKey(VehiclesListScreenKeys.asset('v3')), findsOneWidget);
    expect(find.byKey(VehiclesListScreenKeys.scanner), findsOneWidget);
  });

  testWidgets(
      'group tabs announce selection, keep a minimum (not fixed) height at a '
      'large text scale, and read as unselected while a search bypasses them',
      (WidgetTester tester) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await _pump(
      tester,
      _resolved(
        const VehicleFleetListLoaded(
          assets: <VehicleAsset>[
            VehicleAsset(id: 'v1', assetNo: 'TM514', status: 'Active'),
            VehicleAsset(id: 'v2', assetNo: 'GN101', status: 'Active'),
          ],
          truncated: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    final Finder stationary =
        find.byKey(VehiclesListScreenKeys.groupTab(FleetClassGroup.stationary));
    expect(tester.getSize(stationary).height, greaterThanOrEqualTo(44));
    // At 2x the tab row scrolls horizontally; bring the tab on screen.
    await tester.ensureVisible(stationary);
    await tester.pumpAndSettle();
    await tester.tap(stationary);
    await tester.pumpAndSettle();
    expect(
      tester.getSemantics(stationary),
      matchesSemantics(
        isButton: true,
        isSelected: true,
        hasSelectedState: true,
        isEnabled: true,
        hasEnabledState: true,
        isInMutuallyExclusiveGroup: true,
        hasTapAction: true,
        hasFocusAction: true,
        isFocusable: true,
        label: 'Stationary',
      ),
    );

    await tester.enterText(find.byType(TextField), 'TM514');
    await tester.pumpAndSettle();
    expect(
      tester.getSemantics(stationary),
      matchesSemantics(
        isButton: true,
        hasSelectedState: true,
        hasEnabledState: true,
        isInMutuallyExclusiveGroup: true,
        label: 'Stationary',
      ),
    );
    semantics.dispose();
  });

  group('Fleet & assets mock parity (Fleet_&_Assets.jpg)', () {
    // Next PM for "pump" is 320 km away (68,740 - 68,420); "gen" is a
    // calendar plan a year out; "bus" has no plan at all.
    final DateTime inAYear = DateTime.now().add(const Duration(days: 365));
    final String inAYearIso =
        '${inAYear.year}-${inAYear.month.toString().padLeft(2, '0')}-'
        '${inAYear.day.toString().padLeft(2, '0')}';
    final FleetSignals signals = FleetSignals.fromRows(
      pmRows: <Map<String, dynamic>>[
        const <String, dynamic>{
          'id': 'p1',
          'asset_no': 'cp-045',
          'status': 'active',
          'meter_source': 'odometer',
          'next_due_meter': 68740,
        },
        <String, dynamic>{
          'id': 'p2',
          'asset_no': 'GEN-021',
          'status': 'active',
          'next_due': inAYearIso,
        },
      ],
      actionRows: const <Map<String, dynamic>>[
        <String, dynamic>{'id': 'a1', 'asset_no': 'CP-045', 'status': 'open'},
        <String, dynamic>{'id': 'a2', 'asset_no': 'CP-045', 'status': null},
        <String, dynamic>{
          'id': 'a3',
          'asset_no': 'CP-045',
          'status': 'closed',
        },
      ],
    );
    const VehicleFleetListLoaded register = VehicleFleetListLoaded(
      assets: <VehicleAsset>[
        VehicleAsset(id: 'bus', assetNo: 'BUS-062', status: 'Active'),
        VehicleAsset(id: 'gen', assetNo: 'GEN-021', status: 'Active'),
        VehicleAsset(
          id: 'pump',
          assetNo: 'CP-045',
          status: 'Active',
          currentKm: 68420,
        ),
      ],
      truncated: false,
    );

    Override signalsOverride(FleetSignalsOutcome outcome) =>
        fleetSignalsProvider.overrideWith((Ref ref) async => outcome);

    testWidgets(
        'rows carry the real service-due and open tyre-action lines, and '
        'an asset with neither carries no line at all', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _resolved(register),
        extra: <Override>[signalsOverride(FleetSignalsLoaded(signals))],
      );
      await tester.pumpAndSettle();

      expect(
        find.descendant(
          of: find.byKey(VehiclesListScreenKeys.serviceDue('pump')),
          matching: find.text('Service due in 320 km'),
        ),
        findsOneWidget,
      );
      // Two open (one with a blank status, which V496 treats as open) and
      // one closed: the closed one is never counted.
      expect(
        find.descendant(
          of: find.byKey(VehiclesListScreenKeys.tyreActions('pump')),
          matching: find.text('2 tyre actions'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(VehiclesListScreenKeys.serviceDue('bus')),
        findsNothing,
      );
      expect(
        find.byKey(VehiclesListScreenKeys.tyreActions('bus')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'Due soon narrows to overdue or near services and the filter badge '
        'counts it', (WidgetTester tester) async {
      await _pump(
        tester,
        _resolved(register),
        extra: <Override>[signalsOverride(FleetSignalsLoaded(signals))],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(VehiclesListScreenKeys.dueSoon));
      await tester.pumpAndSettle();

      expect(find.byKey(VehiclesListScreenKeys.asset('pump')), findsOneWidget);
      // A plan a year out is not due soon; no plan is not due at all.
      expect(find.byKey(VehiclesListScreenKeys.asset('gen')), findsNothing);
      expect(find.byKey(VehiclesListScreenKeys.asset('bus')), findsNothing);
      expect(
        find.descendant(
          of: find.byKey(VehiclesListScreenKeys.filter),
          matching: find.text('1'),
        ),
        findsOneWidget,
      );

      // The sheet's Clear filters widens the list back.
      await tester.tap(find.byKey(VehiclesListScreenKeys.filter));
      await tester.pumpAndSettle();
      expect(find.byKey(VehiclesListScreenKeys.filterSheet), findsOneWidget);
      await tester.tap(find.text('Clear filters'));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(find.byKey(VehiclesListScreenKeys.asset('bus')), findsOneWidget);
    });

    testWidgets(
        'an unavailable due read disables Due soon instead of showing an '
        'empty "nothing due" list, and draws no due lines', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _resolved(register),
        extra: <Override>[signalsOverride(const FleetSignalsUnavailable())],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(VehiclesListScreenKeys.dueSoon));
      await tester.pumpAndSettle();
      expect(find.byKey(VehiclesListScreenKeys.asset('bus')), findsOneWidget);
      expect(
        find.byKey(VehiclesListScreenKeys.serviceDue('pump')),
        findsNothing,
      );
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pump();
      // The disabled pill says WHY it cannot filter, not just that it is off.
      expect(
        find.bySemanticsLabel(
          RegExp('Due soon. Due items could not be checked'),
        ),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('Service due first puts the nearest service at the top', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _resolved(register),
        extra: <Override>[signalsOverride(FleetSignalsLoaded(signals))],
      );
      await tester.pumpAndSettle();
      double top(String id) =>
          tester.getTopLeft(find.byKey(VehiclesListScreenKeys.asset(id))).dy;
      expect(top('bus'), lessThan(top('pump')));

      await tester.tap(find.byKey(VehiclesListScreenKeys.sort));
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(
          CheckedPopupMenuItem<FleetSortOrder>,
          'Service due first',
        ),
      );
      await tester.pumpAndSettle();

      expect(top('pump'), lessThan(top('gen')));
      expect(top('gen'), lessThan(top('bus')));
    });

    testWidgets(
        'the header shows the real queue state - a waiting count, never a '
        'hard-coded Synced', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _resolved(register),
        extra: <Override>[
          fleetPendingSyncCountProvider.overrideWith(
            (Ref ref) => Stream<int>.value(3),
          ),
        ],
      );
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byKey(VehiclesListScreenKeys.sync),
          matching: find.text('3 waiting to sync'),
        ),
        findsOneWidget,
      );
      expect(find.text('Synced'), findsNothing);
    });
  });
}
