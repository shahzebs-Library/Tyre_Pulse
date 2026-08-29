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
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicles_list_screen.dart';

Future<void> _pump(
  WidgetTester tester,
  Override override, {
  String? initialSearchTerm,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[override],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
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
    'loaded tyre-carrying assets render one card each, with no full-screen '
    'state widget in the way',
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
      expect(find.byKey(VehiclesListScreenKeys.asset('v3')), findsNothing);
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

      // BUS is not a tyre-carrying class, so the production default filter
      // correctly keeps it hidden until the user asks to browse every asset.
      await tester.tap(find.widgetWithText(ChoiceChip, 'All'));
      await tester.pumpAndSettle();

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
    'typing a search term narrows the list to matches across the whole '
    'set, ignoring the active class filter - a chip only shapes browsing '
    'and must never hide a real match',
    (WidgetTester tester) async {
      await _pump(
        tester,
        _resolved(
          const VehicleFleetListLoaded(
            assets: <VehicleAsset>[
              VehicleAsset(id: 'v1', assetNo: 'TM514', make: 'Sinotruk'),
              // Not in a tyre-carrying class, so it is hidden by the
              // screen's default filter until the search matches it.
              VehicleAsset(id: 'v2', assetNo: 'GN101', make: 'Cummins'),
            ],
            truncated: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsOneWidget);
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
      'the All chip lifts the default tyre-only filter, revealing a '
      'non-tyre-carrying asset that was hidden', (WidgetTester tester) async {
    await _pump(
      tester,
      _resolved(
        const VehicleFleetListLoaded(
          assets: <VehicleAsset>[
            VehicleAsset(id: 'v1', assetNo: 'TM514'),
            VehicleAsset(id: 'v2', assetNo: 'GN101'),
          ],
          truncated: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsOneWidget);
    expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsNothing);

    await tester.tap(find.widgetWithText(ChoiceChip, 'All'));
    await tester.pumpAndSettle();

    expect(find.byKey(VehiclesListScreenKeys.asset('v1')), findsOneWidget);
    expect(find.byKey(VehiclesListScreenKeys.asset('v2')), findsOneWidget);
  });
}
