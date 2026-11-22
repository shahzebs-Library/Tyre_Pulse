// Physical inventory capture screen: existing stores are picked (never typed
// or created), a TP:LOC label selects the bin, the big quantity stepper fills
// the quantity and Save and next sits in the bottom bar.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_theme.dart';
import 'package:tyre_pulse/features/inventory/presentation/physical_inventory_screen.dart';

const InventoryPlace _storeA = InventoryPlace(
  id: 'wh-a',
  site: 'DEMO YARD',
  code: 'DEMO-WH-A',
  name: 'Store A',
  locationType: 'warehouse',
  country: 'KSA',
);
const InventoryPlace _storeB = InventoryPlace(
  id: 'wh-b',
  site: 'DEMO YARD',
  code: 'DEMO-WH-B',
  locationType: 'warehouse',
  country: 'KSA',
);

final class _Repo implements PhysicalInventoryRepository {
  String? startedLocation;

  @override
  Future<List<InventoryPlace>> stores() async =>
      const <InventoryPlace>[_storeA, _storeB];

  @override
  Future<InventoryPlace?> placeById(String id) async => id == 'bin-7'
      ? const InventoryPlace(
          id: 'bin-7',
          site: 'DEMO YARD',
          code: 'BIN-7',
          locationType: 'bin',
          country: 'KSA',
        )
      : null;

  @override
  Future<PhysicalSession> startSession({
    required String idempotencyKey,
    required String country,
    required String site,
    String? locationId,
  }) async {
    startedLocation = locationId;
    return PhysicalSession(
      id: 's1',
      reference: 'PI-1',
      site: site,
      status: 'open',
      country: country,
      locationId: locationId,
    );
  }

  @override
  Future<List<PhysicalSession>> openSessions() async =>
      const <PhysicalSession>[];

  @override
  Future<List<MaterialPick>> search(String query) async =>
      const <MaterialPick>[];

  @override
  Future<Map<String, Object?>> capture(Map<String, Object?> payload) =>
      throw UnimplementedError();

  @override
  Future<void> upload(String path, Uint8List bytes) =>
      throw UnimplementedError();

  @override
  Future<void> attachPhoto(Map<String, Object?> payload) =>
      throw UnimplementedError();
}

Future<_Repo> _pumpCapture(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
  double textScale = 1,
  ThemeData? theme,
}) async {
  final _Repo repo = _Repo();
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        workspaceContextProvider.overrideWithValue(null as WorkspaceContext?),
        physicalInventoryRepositoryProvider.overrideWithValue(repo),
        openPhysicalSessionsProvider
            .overrideWith((Ref ref) async => const <PhysicalSession>[]),
      ],
      child: MaterialApp(
        locale: locale,
        theme: theme,
        localizationsDelegates: TpLocalizations.delegates,
        supportedLocales: TpLocalizations.supportedLocales,
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScale),
          ),
          child: child!,
        ),
        home: const PhysicalInventoryScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return repo;
}

/// Scrolls the screen's list (either way) until [f] is built and on screen.
Future<void> _reveal(WidgetTester tester, Finder f) async {
  final Finder list = find
      .descendant(
        of: find.byType(ListView),
        matching: find.byType(Scrollable),
      )
      .first;
  if (f.evaluate().isEmpty) {
    await tester.scrollUntilVisible(f, 200, scrollable: list);
  }
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
}

Future<void> _tapVisible(WidgetTester tester, Finder f) async {
  await _reveal(tester, f);
  await tester.tap(f);
  await tester.pumpAndSettle();
}

Future<void> _startStoreA(WidgetTester tester) async {
  await _tapVisible(tester, find.byKey(const Key('pi.store.wh-a')));
  await _tapVisible(tester, find.byKey(const Key('pi.start')));
  // Back to the top of the capture form.
  await tester.drag(find.byType(ListView), const Offset(0, 5000));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('stores are picked from the list; a bin label selects the bin',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(800, 3200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final _Repo repo = await _pumpCapture(tester);

    // No free-text store field: existing stores only, and Start waits for one.
    expect(find.byKey(const Key('pi.store')), findsNothing);
    expect(find.byKey(const Key('pi.store.wh-a')), findsOneWidget);
    expect(find.byKey(const Key('pi.store.wh-b')), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('pi.store.wh-a'))).height,
      greaterThanOrEqualTo(48),
    );

    await _startStoreA(tester);
    expect(repo.startedLocation, 'wh-a');

    // Mockup layout: title + connection pill, location bar, search, fields.
    expect(find.text('Initial Physical Inventory'), findsOneWidget);
    expect(find.byKey(const Key('pi.connection')), findsOneWidget);
    expect(find.byKey(const Key('pi.location')), findsOneWidget);
    expect(find.textContaining('Store A'), findsWidgets);
    expect(find.byKey(const Key('pi.classification')), findsOneWidget);
    expect(find.byKey(const Key('pi.ownership')), findsOneWidget);
    for (final String c in <String>['new', 'used', 'repairable', 'damaged']) {
      expect(find.byKey(Key('pi.cond.$c')), findsOneWidget);
    }
    for (final String r in <String>['item', 'label', 'location']) {
      expect(find.byKey(Key('pi.photo.$r')), findsOneWidget);
    }
    expect(find.byKey(const Key('pi.photo.damage')), findsNothing);

    // Save & count next is in the bottom bar, at least 56dp tall.
    final Finder save = find.byKey(const Key('pi.save'));
    expect(save, findsOneWidget);
    expect(tester.getSize(save).height, greaterThanOrEqualTo(56));
    expect(
      tester.getBottomLeft(save).dy,
      greaterThan(
        tester.view.physicalSize.height / tester.view.devicePixelRatio * 0.8,
      ),
    );

    // The big stepper fills the quantity (tap = 1, hold = 10), never < 0.
    final Finder plus = find.byKey(const Key('pi.qty.plus'));
    await _reveal(tester, plus);
    expect(tester.getSize(plus).height, greaterThanOrEqualTo(56));
    await tester.longPress(plus);
    await tester.pump();
    await tester.tap(plus);
    await tester.pump();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('pi.qty')))
          .controller!
          .text,
      '11',
    );
    for (int i = 0; i < 2; i++) {
      await tester.longPress(find.byKey(const Key('pi.qty.minus')));
      await tester.pump();
    }
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('pi.qty')))
          .controller!
          .text,
      '0',
    );

    // A damaged item opens the damage photo slot.
    await _tapVisible(tester, find.byKey(const Key('pi.cond.damaged')));
    expect(find.byKey(const Key('pi.photo.damage')), findsOneWidget);

    // Saving without a photo is refused with a clear message.
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pi.message')), findsOneWidget);
    expect(find.text('Take at least one photo before saving.'), findsOneWidget);

    // A TP:LOC label selects the bin (shown in the location bar).
    final Finder scan = find.byKey(const Key('inventory.scan.field')).first;
    await _reveal(tester, scan);
    await tester.enterText(scan, 'TP:LOC:bin-7');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pi.bin')), findsOneWidget);
    expect(find.textContaining('BIN-7'), findsOneWidget);
  });

  for (final Locale locale in const <Locale>[Locale('en'), Locale('ar')]) {
    testWidgets(
        'capture layout fits a small phone at 2x text (${locale.languageCode})',
        (WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 690);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await _pumpCapture(tester, locale: locale, textScale: 2);
      await _startStoreA(tester);
      if (locale.languageCode == 'ar') {
        expect(
          Directionality.of(tester.element(find.byKey(const Key('pi.save')))),
          TextDirection.rtl,
        );
      }
      // Scroll the whole form: every section must lay out without overflow.
      for (final String k in <String>[
        'pi.location',
        'pi.classification',
        'pi.qty.plus',
        'pi.cond.scrap',
        'pi.ownership',
        'pi.photo.location',
        'pi.remarks',
        'pi.describe',
      ]) {
        await _reveal(tester, find.byKey(Key(k)));
        expect(tester.takeException(), isNull, reason: k);
      }
      expect(
        tester.getSize(find.byKey(const Key('pi.save'))).height,
        greaterThanOrEqualTo(56),
      );
    });
  }

  test('inventory accent palettes meet WCAG AA', () {
    for (final TpPalette p in <TpPalette>[
      inventoryLightPalette,
      TpPalette.dark,
    ]) {
      final String b = p.brightness.name;
      // Text on the yellow fill (buttons, selected chips, badges).
      expect(
        contrastRatio(p.onPrimary, p.primary),
        greaterThan(4.5),
        reason: b,
      );
      for (final Color bg in <Color>[p.background, p.surface, p.surfaceAlt]) {
        expect(contrastRatio(p.text, bg), greaterThan(4.5), reason: b);
        expect(contrastRatio(p.textMuted, bg), greaterThan(4.5), reason: b);
        expect(contrastRatio(p.controlBorder, bg), greaterThan(3), reason: b);
        expect(contrastRatio(p.focus, bg), greaterThan(3), reason: b);
      }
      // The location bar: its fill, its ink and the accent pin.
      final Color bar =
          p.brightness == Brightness.dark ? p.surface : p.primarySoft;
      expect(contrastRatio(p.text, bar), greaterThan(4.5), reason: b);
      expect(
        contrastRatio(inventoryAccentInk(p), bar),
        greaterThan(3),
        reason: b,
      );
    }
    // Yellow on white fails AA: it must never be used as ink there.
    expect(contrastRatio(inventoryYellow, Colors.white), lessThan(3));
    expect(inventoryAccentInk(inventoryLightPalette), isNot(inventoryYellow));
  });

  testWidgets('light theme: the capture screen uses the yellow accent, scoped',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(800, 3200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await _pumpCapture(tester, theme: TpTheme.light);
    await _startStoreA(tester);

    // Outside the screen the app's light theme is untouched (fleet green).
    expect(
      TpPalette.of(tester.element(find.byType(PhysicalInventoryScreen))),
      same(TpPalette.light),
    );
    // Inside, the inventory light palette with the safety-yellow accent.
    final TpPalette inside =
        TpPalette.of(tester.element(find.byKey(const Key('pi.save'))));
    expect(inside, same(inventoryLightPalette));
    expect(inside.primary, inventoryYellow);
    expect(inside.brightness, Brightness.light);

    // Selected condition chip is a yellow fill.
    expect(
      tester.widget<Material>(find.byKey(const Key('pi.cond.new'))).color,
      inventoryYellow,
    );
    // The Save & count button sits on yellow with dark ink.
    final Material saveFill = tester
        .widgetList<Material>(
          find.descendant(
            of: find.byKey(const Key('pi.save')),
            matching: find.byType(Material),
          ),
        )
        .firstWhere((Material m) => m.color == inventoryYellow);
    expect(saveFill.color, inventoryYellow);
    // The location bar carries the yellow outline.
    final Material bar = tester.widget<Material>(
      find
          .descendant(
            of: find.byKey(const Key('pi.location')),
            matching: find.byType(Material),
          )
          .first,
    );
    expect(
      (bar.shape! as RoundedRectangleBorder).side.color,
      inventoryYellow,
    );

    // Never yellow text: no painted run of text uses the accent as ink.
    // (Icon glyphs live in the Private Use Area and are excluded: a yellow
    // icon is allowed on a dark-ink fill, e.g. the scan camera button.)
    bool isWords(String t) => t.runes.any((int r) => r < 0xE000 || r > 0xF8FF);
    void noYellow(InlineSpan span, Color? inherited) {
      final Color? ink = span.style?.color ?? inherited;
      final String text = span is TextSpan ? (span.text ?? '') : '';
      if (isWords(text)) {
        expect(ink, isNot(inventoryYellow), reason: text);
      }
      if (span is TextSpan) {
        for (final InlineSpan c in span.children ?? const <InlineSpan>[]) {
          noYellow(c, ink);
        }
      }
    }

    for (final RichText t
        in tester.widgetList<RichText>(find.byType(RichText))) {
      noYellow(t.text, null);
    }
  });
}
