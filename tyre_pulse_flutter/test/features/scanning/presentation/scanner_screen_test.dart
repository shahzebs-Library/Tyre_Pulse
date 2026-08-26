/// Renders [ScannerScreen] behind a real [MaterialApp.router] and a fake
/// [ScanLookupSource], and checks each state it can be in shows the right
/// thing.
///
/// Deliberately does not assert that tapping an action COMPLETES a
/// navigation and shows the destination screen - that destination is owned
/// by a different feature (assets, tyres) still in flight, per this
/// feature's package boundary. What is asserted is that this screen's own
/// states render correctly and that pressing an action does not throw -
/// which already requires a real [GoRouter] ancestor for `context.push` to
/// resolve against, so one is provided.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_lookup.dart';
import 'package:tyre_pulse/features/scanning/presentation/scanner_controller.dart';
import 'package:tyre_pulse/features/scanning/presentation/scanner_screen.dart';

import '../fake_scan_lookup_source.dart';

/// A minimal real router: `/scan` plus the two destinations a resolved
/// match can push to, so `context.push` always has somewhere real to land.
GoRouter _testRouter() {
  return GoRouter(
    initialLocation: '/scan',
    routes: <RouteBase>[
      GoRoute(
        path: '/scan',
        builder: (BuildContext context, GoRouterState state) =>
            const ScannerScreen(),
      ),
      GoRoute(
        path: '/vehicles',
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('vehicles screen')),
      ),
      GoRoute(
        path: '/serial-search',
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('serial search screen')),
      ),
      GoRoute(
        path: '/inspect/new',
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('new inspection screen')),
      ),
    ],
  );
}

Future<void> _pumpScanner(
  WidgetTester tester,
  FakeScanLookupSource fake,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        scanLookupRepositoryProvider.overrideWithValue(fake),
      ],
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        routerConfig: _testRouter(),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'idle: shows the camera-unavailable notice and the manual-entry field',
    (WidgetTester tester) async {
      await _pumpScanner(tester, FakeScanLookupSource());

      expect(find.byIcon(Icons.qr_code_scanner), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Look up'), findsOneWidget);
    },
  );

  testWidgets(
    'an empty field does nothing when Look up is pressed - the source is '
    'never called',
    (WidgetTester tester) async {
      final FakeScanLookupSource fake = FakeScanLookupSource();
      await _pumpScanner(tester, fake);

      await tester.tap(find.widgetWithText(FilledButton, 'Look up'));
      await tester.pumpAndSettle();

      expect(fake.calls, isEmpty);
      expect(find.byType(TextField), findsOneWidget);
    },
  );

  testWidgets('a matched asset shows its number and an action to view it', (
    WidgetTester tester,
  ) async {
    final FakeScanLookupSource fake = FakeScanLookupSource();
    fake.exactAssetByCode['TM514'] = const AssetLookupRecord(
      id: 'a1',
      assetNo: 'TM514',
      site: 'NHC',
      vehicleType: 'Tr-Mixer',
    );
    await _pumpScanner(tester, fake);

    await tester.enterText(find.byType(TextField), 'TM514');
    await tester.tap(find.widgetWithText(FilledButton, 'Look up'));
    await tester.pumpAndSettle();

    // Not asserting `find.text('TM514')` here: `find.text` also matches
    // the `EditableText` inside the manual-entry field, which still
    // reads 'TM514' at this point, so that assertion would ambiguously
    // match two widgets rather than the one intended. The action labels
    // below are unambiguous and are what actually proves the match
    // rendered.
    expect(find.text('View asset'), findsOneWidget);
    expect(find.text('Start inspection'), findsOneWidget);
  });

  testWidgets(
    'a matched tyre with no fitted asset offers only the view action',
    (WidgetTester tester) async {
      final FakeScanLookupSource fake = FakeScanLookupSource();
      fake.tyreBySerial['EP0604207'] = const TyreLookupRecord(
        id: 't1',
        brand: 'Bridgestone',
      );
      await _pumpScanner(tester, fake);

      await tester.enterText(find.byType(TextField), 'EP0604207');
      await tester.tap(find.widgetWithText(FilledButton, 'Look up'));
      await tester.pumpAndSettle();

      expect(find.text('View tyre'), findsOneWidget);
      expect(find.text('Start inspection'), findsNothing);
    },
  );

  testWidgets(
    'a code matching nothing offers the honest no-match state, not the '
    'error state',
    (WidgetTester tester) async {
      final FakeScanLookupSource fake = FakeScanLookupSource();
      await _pumpScanner(tester, fake);

      await tester.enterText(find.byType(TextField), 'NOTHING-HERE');
      await tester.tap(find.widgetWithText(FilledButton, 'Look up'));
      await tester.pumpAndSettle();

      expect(find.text('No match for that code'), findsOneWidget);
      expect(find.text('Open Serial Search'), findsOneWidget);
    },
  );

  testWidgets(
    'a lookup failure shows the error state with a retry action, never a '
    'silent miss',
    (WidgetTester tester) async {
      final FakeScanLookupSource fake = FakeScanLookupSource()
        ..errorToThrow = Exception('offline');
      await _pumpScanner(tester, fake);

      await tester.enterText(find.byType(TextField), 'TM514');
      await tester.tap(find.widgetWithText(FilledButton, 'Look up'));
      await tester.pumpAndSettle();

      expect(find.text('Something went wrong'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
      // The manual fallback is never withdrawn just because a lookup
      // failed - item 6 of this feature's exit criterion.
      expect(find.text('Open Serial Search'), findsOneWidget);
    },
  );

  testWidgets('look up another (offered on a match card) returns the screen to '
      'idle, clearing the field', (WidgetTester tester) async {
    // A match card is what offers this action - see _MatchCard - so an
    // asset match is used here rather than the no-match state, which
    // relies on the always-present field instead of a dedicated button.
    final FakeScanLookupSource fake = FakeScanLookupSource();
    fake.exactAssetByCode['TM514'] = const AssetLookupRecord(
      id: 'a1',
      assetNo: 'TM514',
    );
    await _pumpScanner(tester, fake);

    await tester.enterText(find.byType(TextField), 'TM514');
    await tester.tap(find.widgetWithText(FilledButton, 'Look up'));
    await tester.pumpAndSettle();
    expect(find.text('View asset'), findsOneWidget);

    await tester.tap(find.text('Look up another'));
    await tester.pumpAndSettle();

    expect(find.text('View asset'), findsNothing);
    final TextField field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, isEmpty);
  });
}
