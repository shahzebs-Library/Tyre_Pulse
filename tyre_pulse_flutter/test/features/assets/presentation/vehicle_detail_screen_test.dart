/// Renders [VehicleDetailScreen] behind a real [MaterialApp], driving both
/// the outer [TpModuleGuard]'s decision (via [moduleAccessResolverProvider])
/// and the inner seven-state mapping (via [vehicleDetailProvider]).
///
/// [canAccessModuleProvider] must be overridden in EVERY test that reaches
/// `_DetailView`: it is watched unconditionally by that widget to decide
/// whether "Start inspection" shows, and its real dependency chain -
/// `moduleAccessProvider` -> `accessStateProvider` - throws
/// `UnimplementedError` by default (`permission_providers.dart`'s own doc:
/// "Override it at the composition root ... It throws rather than
/// returning a permissive default"). Overriding the family member directly
/// bypasses that whole chain, which is the correct scope for a test of
/// THIS screen rather than of the permission resolver.
///
/// Like `vehicles_list_screen_test.dart`, a plain [MaterialApp] is enough:
/// this screen's [TpScaffold] carries no `backFallback` at all (see the
/// screen's own library comment for why), and "Start inspection" is
/// asserted only for PRESENCE, never tapped - tapping it calls
/// `context.go(NewInspectionRoute(...).location)`, and proving that route
/// resolves belongs to whichever feature owns it, not this one.
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
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_detail_screen.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';

const String _assetNo = 'TM514';

Future<void> _pump(
  WidgetTester tester,
  List<Override> overrides, {
  String assetNo = _assetNo,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: VehicleDetailScreen(assetNo: assetNo),
      ),
    ),
  );
}

/// The override every test that reaches `_DetailView` needs. See the
/// library comment.
Override _canStartInspection(bool value) =>
    canAccessModuleProvider(ModuleKey.inspect).overrideWith((Ref ref) => value);

Override _resolved(VehicleDetailOutcome outcome, {String assetNo = _assetNo}) =>
    vehicleDetailProvider(assetNo).overrideWith((Ref ref) async => outcome);

void main() {
  testWidgets('loading renders TpLoadingState', (WidgetTester tester) async {
    await _pump(tester, <Override>[
      vehicleDetailProvider(_assetNo)
          .overrideWith((Ref ref) => Completer<VehicleDetailOutcome>().future),
      _canStartInspection(false),
    ]);
    await tester.pump();

    expect(find.byKey(TpStateKeys.loading), findsOneWidget);
  });

  testWidgets('a provider failure (defensive only) renders TpErrorState', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <Override>[
      vehicleDetailProvider(_assetNo).overrideWith(
        (Ref ref) => Future<VehicleDetailOutcome>.error(
          Exception('provider construction bug'),
        ),
      ),
      _canStartInspection(false),
    ]);
    await tester.pumpAndSettle();

    expect(find.byKey(TpStateKeys.error), findsOneWidget);
  });

  testWidgets(
      'a loaded vehicle shows its identity and every field, joined and '
      'formatted the way the production screen expects', (
    WidgetTester tester,
  ) async {
    const VehicleAsset asset = VehicleAsset(
      id: 'v1',
      assetNo: _assetNo,
      fleetNumber: 'FN-88',
      make: 'Sinotruk',
      model: 'HOWO',
      vehicleType: 'TR-MIXER',
      site: 'NHC',
      status: 'Active',
      operatorName: 'A. Rahman',
      tyreSize: '315/80R22.5',
      currentKm: 128000,
      country: 'KSA',
      department: 'Operations',
      region: 'Central',
      registrationNo: 'ABC-1234',
      year: 2019,
    );
    await _pump(tester, <Override>[
      _resolved(const VehicleDetailLoaded(asset)),
      _canStartInspection(false),
    ]);
    await tester.pumpAndSettle();

    // The header identity goes through TpIdentifierText (bidi isolate
    // marks), so textContaining rather than an exact match - see
    // vehicles_list_screen_test.dart's identical note.
    expect(find.textContaining(_assetNo), findsWidgets);
    expect(find.text('FN-88'), findsNWidgets(2));
    // make + model, joined with a single space by _DetailView's own
    // _join - NOT the comma-separated join the list screen's summary
    // uses. Getting this separator wrong is exactly the kind of thing
    // that would silently pass a looser assertion.
    expect(find.text('Sinotruk HOWO'), findsOneWidget);
    expect(find.text('2019'), findsOneWidget);
    expect(find.text('128,000 km'), findsNWidgets(2));
    expect(find.text('A. Rahman'), findsOneWidget);
    expect(find.text('Operations'), findsOneWidget);
    expect(find.text('NHC'), findsNWidgets(2));
    expect(find.text('Central'), findsOneWidget);
    expect(find.text('KSA'), findsOneWidget);
    expect(find.text('315/80R22.5'), findsNWidgets(2));
    expect(find.text('ABC-1234'), findsOneWidget);
    expect(find.text('TR-MIXER'), findsNWidgets(2));
    expect(
      find.byKey(
        const ValueKey<String>(
          'assets/vehicle_photos/tri_mixer_perspective.webp',
        ),
      ),
      findsOneWidget,
    );
    _expectNoStateWidget();
  });

  testWidgets(
    'a field with no value renders the design system\'s "not measured" '
    'placeholder, never a blank line or a fabricated value',
    (WidgetTester tester) async {
      const VehicleAsset asset = VehicleAsset(id: 'v1', assetNo: _assetNo);
      await _pump(tester, <Override>[
        _resolved(const VehicleDetailLoaded(asset)),
        _canStartInspection(false),
      ]);
      await tester.pumpAndSettle();

      // All twelve grid fields are unset, so all twelve render the
      // placeholder - see the class comment for the full field list.
      expect(find.text('-'), findsNWidgets(12));
    },
  );

  testWidgets(
    'Start inspection shows only when the inspect module is reachable',
    (WidgetTester tester) async {
      const VehicleAsset asset = VehicleAsset(id: 'v1', assetNo: _assetNo);

      await _pump(tester, <Override>[
        _resolved(const VehicleDetailLoaded(asset)),
        _canStartInspection(true),
      ]);
      await tester.pumpAndSettle();

      // "Start inspection" is the LAST item in the body's ListView, past
      // the twelve field rows above it - beyond the default viewport plus
      // cache extent in this 800x600 test window, a sliver list never
      // builds an Element for it at all (not merely off-screen, genuinely
      // absent from the tree), so a bare find.text finds nothing to match.
      // scrollUntilVisible scrolls the list a little at a time, retrying
      // the finder after each step, which is what lets the lazily-built
      // item come into existence.
      await tester.scrollUntilVisible(
        find.text('Start inspection'),
        200,
      );
      expect(find.text('Start inspection'), findsOneWidget);
    },
  );

  testWidgets(
      'Start inspection is withheld when the inspect module is not '
      'reachable, rather than shown disabled', (WidgetTester tester) async {
    const VehicleAsset asset = VehicleAsset(id: 'v1', assetNo: _assetNo);

    await _pump(tester, <Override>[
      _resolved(const VehicleDetailLoaded(asset)),
      _canStartInspection(false),
    ]);
    await tester.pumpAndSettle();
    expect(find.text('Start inspection'), findsNothing);
  });

  testWidgets(
      'a failed live read with a usable cached copy renders '
      'TpOfflineCachedState', (WidgetTester tester) async {
    const VehicleAsset asset = VehicleAsset(id: 'v1', assetNo: _assetNo);
    await _pump(tester, <Override>[
      _resolved(
        VehicleDetailFromCache(
          asset: asset,
          cachedAt: DateTime.utc(2026, 8, 20, 9),
        ),
      ),
      _canStartInspection(false),
    ]);
    await tester.pumpAndSettle();

    expect(find.byKey(TpStateKeys.offlineCached), findsOneWidget);
  });

  testWidgets(
      'a genuine not-found (the query ran and matched nothing) renders '
      'TpEmptyState, not TpErrorState - this is a fact about the fleet, '
      'not a malfunction', (WidgetTester tester) async {
    await _pump(tester, <Override>[
      _resolved(const VehicleDetailNotFound()),
      _canStartInspection(false),
    ]);
    await tester.pumpAndSettle();

    expect(find.byKey(TpStateKeys.empty), findsOneWidget);
    expect(find.byKey(TpStateKeys.error), findsNothing);
  });

  testWidgets(
      'a network-classified failure with no cache renders '
      'TpBackendUnavailableState', (WidgetTester tester) async {
    await _pump(tester, <Override>[
      _resolved(const VehicleDetailFailed(AppError.network())),
      _canStartInspection(false),
    ]);
    await tester.pumpAndSettle();

    expect(find.byKey(TpStateKeys.backendUnavailable), findsOneWidget);
  });

  testWidgets(
    'a non-network failure with no cache renders the plain TpErrorState',
    (WidgetTester tester) async {
      await _pump(tester, <Override>[
        _resolved(
          const VehicleDetailFailed(
            AppError(
              kind: AppErrorKind.validation,
              message: 'A vehicle record could not be read.',
            ),
          ),
        ),
        _canStartInspection(false),
      ]);
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.error), findsOneWidget);
      expect(find.byKey(TpStateKeys.backendUnavailable), findsNothing);
    },
  );

  testWidgets(
    'the outer TpModuleGuard renders TpPermissionDeniedState when the '
    'vehicles module itself is denied - this state belongs to the guard, '
    'not to the outcome switch inside _DetailView',
    (WidgetTester tester) async {
      await _pump(tester, <Override>[
        moduleAccessResolverProvider.overrideWith(
          (Ref ref) => const _AlwaysDenyResolver(),
        ),
        // _DetailView never mounts on a denial, so vehicleDetailProvider is
        // deliberately left un-overridden here - reaching its real body
        // would need a live Supabase client, and a guard that is doing its
        // job must never let that body run at all.
        _canStartInspection(false),
      ]);
      await tester.pumpAndSettle();

      expect(find.byKey(TpStateKeys.permissionDenied), findsOneWidget);
      _expectNoStateWidget(except: TpStateKeys.permissionDenied);
    },
  );
}

/// A [ModuleAccessResolver] that refuses everything, for the one test that
/// exercises [TpModuleGuard] itself rather than [vehicleDetailProvider].
class _AlwaysDenyResolver implements ModuleAccessResolver {
  const _AlwaysDenyResolver();

  @override
  ModuleAccessDecision decide(RouteGuard guard) =>
      const ModuleAccessDenied(ModuleDenialReason.notGranted);
}

/// Asserts that none of the seven state keys render, [except] the one under
/// test.
void _expectNoStateWidget({Key? except}) {
  for (final Key key in <Key>[
    TpStateKeys.loading,
    TpStateKeys.empty,
    TpStateKeys.offlineCached,
    TpStateKeys.permissionDenied,
    TpStateKeys.backendUnavailable,
    TpStateKeys.notConfigured,
    TpStateKeys.error,
  ]) {
    if (key == except) continue;
    expect(find.byKey(key), findsNothing, reason: '$key should not render');
  }
}
