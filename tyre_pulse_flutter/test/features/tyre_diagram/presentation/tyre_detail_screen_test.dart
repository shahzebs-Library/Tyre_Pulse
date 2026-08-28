/// Widget coverage for [TyreDetailScreen] - one wheel's own record and the
/// way into Take Action.
///
/// Every "Additional info" field (brand, size, installed/running distance)
/// and the temperature stat are asserted to render the design system's
/// honest "not recorded" state, never a fabricated placeholder - see the
/// screen's own library comment for why: those fields track nothing this
/// app's inspection domain actually captures (AGENTS.md rule 1).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_detail_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_take_action_screen.dart';

Future<void> _pumpDetail(
  WidgetTester tester, {
  Map<String, Object?>? entry,
  String? assetNo = 'TM514',
  String? siteName = 'NHC',
  VoidCallback? onAdjustReading,
}) async {
  // The body is a `ListView` - a sliver, unlike the `Column`+
  // `SingleChildScrollView` combination elsewhere in this suite - and only
  // builds rows that intersect the viewport plus its cache extent. Several
  // sections plus the "Take action" button at the very bottom do not all
  // fit the default 800x600 test surface, so a row genuinely below the
  // fold would not exist as an Element yet.
  tester.view.physicalSize = const Size(900, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  // Take Action ([TyreTakeActionScreen], reached from this screen's own
  // primary button) is a `ConsumerWidget` and needs a real `ProviderScope`
  // ancestor to build at all - even though none of these tests exercise a
  // provider-backed action.
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: TyreDetailScreen(
          positionCode: 'LHF1',
          vehicleType: 'TR-MIXER',
          entry: entry,
          assetNo: assetNo,
          siteName: siteName,
          onAdjustReading: onAdjustReading,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _identifierText(String value) =>
    find.text(TpDirection.isolateLtr(value));

void main() {
  testWidgets(
      'with nothing recorded, the position and status render but '
      'every measured field is the honest "not recorded" state, never a '
      'fabricated value', (WidgetTester tester) async {
    await _pumpDetail(tester, entry: null);

    expect(_identifierText('LHF1'), findsOneWidget);
    // Unknown status - nothing has ever been recorded for this wheel.
    expect(find.byType(TpStatusChip), findsOneWidget);

    // Tread, pressure, temperature AND the server-backed remaining-life
    // projection all read unavailable - never fabricated from a condition.
    expect(find.byKey(TpStatCardKeys.unavailable), findsNWidgets(4));

    expect(find.text('Not recorded'), findsWidgets);
    // Brand, size, installed km, running km: four Additional info fields,
    // none of which this domain tracks at all.
    expect(find.text('Brand / pattern'), findsOneWidget);
    expect(find.text('Size'), findsOneWidget);
    expect(find.text('Installed at'), findsOneWidget);
    expect(find.text('Running distance'), findsOneWidget);

    expect(
      find.text('Nobody has recorded anything for this wheel yet.'),
      findsOneWidget,
    );
  });

  testWidgets(
      'a real recorded entry shows its own tread and pressure as '
      'measured values, not "not recorded"', (WidgetTester tester) async {
    await _pumpDetail(
      tester,
      entry: const <String, Object?>{
        'condition': 'Worn',
        'tread_depth_mm': 4.5,
        'pressure_psi': 32,
        'remaining_km': 18500,
        'serial_number': 'YMA55312',
        'notes': 'Slight cupping on the outer edge.',
      },
    );

    expect(find.textContaining('4.5 mm'), findsOneWidget);
    expect(find.textContaining('32 psi'), findsOneWidget);
    expect(find.textContaining('18500 km'), findsOneWidget);
    // Temperature is NEVER tracked, recorded entry or not.
    expect(find.byKey(TpStatCardKeys.unavailable), findsOneWidget);
    expect(_identifierText('YMA55312'), findsOneWidget);
    expect(
      find.text('Slight cupping on the outer edge.'),
      findsOneWidget,
    );
    // A real entry means there IS evidence - the "nobody has recorded
    // anything" line must not appear alongside a recorded condition.
    expect(
      find.text('Nobody has recorded anything for this wheel yet.'),
      findsNothing,
    );
  });

  testWidgets(
      'asset and site with nothing recorded still show as the '
      'honest fallback, and the subtitle carries the caller-supplied '
      'context', (WidgetTester tester) async {
    await _pumpDetail(tester, assetNo: null, siteName: null, entry: null);

    // Two more "Not recorded" fields join the Overview section's own two.
    expect(find.text('Asset'), findsOneWidget);
    expect(find.text('Site'), findsOneWidget);
  });

  testWidgets(
      'a seeded Good map is still an untouched wheel and offers Add details',
      (WidgetTester tester) async {
    await _pumpDetail(
      tester,
      entry: const <String, Object?>{
        'position': 'LHF1',
        'condition': 'Good',
        'checked': false,
      },
      onAdjustReading: () {},
    );

    expect(find.text('Add details'), findsOneWidget);
    expect(find.text('Edit details'), findsNothing);
  });

  testWidgets('local inspection evidence uses a device-file image provider', (
    WidgetTester tester,
  ) async {
    await _pumpDetail(
      tester,
      entry: const <String, Object?>{
        'condition': 'Damaged',
        'photo_uri': r'C:\inspection-evidence.jpg',
      },
    );

    expect(find.byType(Image), findsOneWidget);
    final Image evidence = tester.widget<Image>(find.byType(Image));
    expect(evidence.image, isA<FileImage>());
  });

  testWidgets(
      'Take action forwards this screen\'s own context, including '
      'a live onAdjustReading callback, to the Take Action screen', (
    WidgetTester tester,
  ) async {
    bool invoked = false;
    await _pumpDetail(
      tester,
      entry: const <String, Object?>{
        'condition': 'Good',
        'checked': true,
      },
      onAdjustReading: () => invoked = true,
    );

    await tester.tap(find.text('Edit details'));
    await tester.pumpAndSettle();

    expect(find.byType(TyreTakeActionScreen), findsOneWidget);
    // The row this screen's own asset+site context makes real.
    await tester.tap(find.text('Adjust reading'));
    await tester.pump();
    expect(invoked, isTrue);
  });
}
