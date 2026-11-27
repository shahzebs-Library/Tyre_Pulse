/// The redesigned per-wheel editor: safe area, fitted tyre prefill and the
/// swap warning, the plain-language position header with its mini map,
/// sections, range validation, the previous reading, the image-ready
/// condition tiles, and a light/dark x en/ar/ur x text-scale sweep at 360dp.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_previous_tyre_readings.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_editor_sheet.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_mini_map.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_glyph.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';

final TyreFitment _fitted = TyreFitment(
  id: 't1',
  serialNo: 'YMA55312',
  positionCode: 'LHCO',
  brand: 'Michelin',
  size: '315/80 R22.5',
  issueDate: DateTime(2026, 3, 4),
  kmAtFitment: 40000,
);

Widget _app({
  required Widget home,
  ThemeData? theme,
  Locale locale = const Locale('en'),
  double textScale = 1,
}) {
  return ProviderScope(
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: theme ?? TpTheme.light,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: home,
    ),
  );
}

Widget _editor({
  required TyrePositionReading reading,
  required ValueChanged<TyrePositionReading> onChanged,
  TyreFitment? fitted,
  bool unavailable = false,
  PreviousTyreReading? previous,
  String? assetNo = 'TM514',
}) {
  return TyrePositionEditorSheet(
    reading: reading,
    positionLabel: 'LHCO',
    vehicleType: 'Tri-mixer',
    assetNo: assetNo,
    installedTyre: fitted,
    installedTyreUnavailable: unavailable,
    currentOdometerKm: 52000,
    previousReading: previous,
    onChanged: onChanged,
    onCapturePhoto: (PhotoCaptureSource _) {},
  );
}

Future<void> _pumpStateful(
  WidgetTester tester, {
  required TyrePositionReading Function() get,
  required void Function(TyrePositionReading) set,
  TyreFitment? fitted,
  bool unavailable = false,
  PreviousTyreReading? previous,
  String? assetNo = 'TM514',
}) async {
  tester.view.physicalSize = const Size(430, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    _app(
      home: Scaffold(
        body: StatefulBuilder(
          builder: (BuildContext context, StateSetter setState) => _editor(
            reading: get(),
            fitted: fitted,
            unavailable: unavailable,
            previous: previous,
            assetNo: assetNo,
            onChanged: (TyrePositionReading next) => setState(() => set(next)),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'a full-height sheet on a tall iPhone keeps its header below the status '
    'bar / Dynamic Island',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(430 * 3, 932 * 3);
      tester.view.devicePixelRatio = 3;
      tester.view.padding = const FakeViewPadding(top: 59 * 3, bottom: 34 * 3);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _app(
          // Large text makes the content taller than the screen, so the
          // sheet grows to its maximum height - the case that clipped.
          textScale: 1.6,
          home: Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: FilledButton(
                  onPressed: () => TpBottomSheet.show<void>(
                    context: context,
                    builder: (BuildContext _) => _editor(
                      reading: TyrePositionReading.seed('R1Lo'),
                      fitted: _fitted,
                      onChanged: (TyrePositionReading _) {},
                    ),
                  ),
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      final Rect header =
          tester.getRect(find.byKey(TyrePositionEditorSheetKeys.header));
      expect(header.top, greaterThanOrEqualTo(59));
      final Rect sheet = tester.getRect(find.byType(BottomSheet));
      expect(sheet.top, greaterThanOrEqualTo(59));
      expect(
        find.byKey(TyrePositionEditorSheetKeys.closeAction).hitTestable(),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'the fitted tyre is shown, pre-filled, carried on the first change and a '
    'different serial raises the swap warning',
    (WidgetTester tester) async {
      TyrePositionReading reading = TyrePositionReading.seed('R1Lo');
      await _pumpStateful(
        tester,
        get: () => reading,
        set: (TyrePositionReading r) => reading = r,
        fitted: _fitted,
      );

      expect(
        find.byKey(TyrePositionEditorSheetKeys.fittedTyreCard),
        findsOneWidget,
      );
      expect(find.text('Fitted tyre'), findsOneWidget);
      expect(find.textContaining('Michelin'), findsOneWidget);
      expect(find.textContaining('315/80 R22.5'), findsWidgets);
      expect(find.textContaining('40,000 km at fitment'), findsOneWidget);
      // 52,000 typed in the header - 40,000 at fitment.
      expect(
        find.textContaining('12,000 km run since fitment'),
        findsOneWidget,
      );

      final TextField serial =
          tester.widgetList<TextField>(find.byType(TextField)).elementAt(2);
      expect(serial.controller!.text, 'YMA55312');
      expect(reading.serialNumber, isNull);

      await tester.tap(find.text('Good'));
      await tester.pump();
      expect(reading.serialNumber, 'YMA55312');
      expect(reading.checked, isFalse, reason: 'the fake does not stamp it');

      await tester.enterText(find.byType(TextField).at(2), 'YMA99999');
      await tester.pump();
      expect(reading.serialNumber, 'YMA99999');
      expect(
        find.byKey(TyrePositionEditorSheetKeys.serialDiffers),
        findsOneWidget,
      );
      expect(
        find.textContaining('Different from the tyre on record'),
        findsOneWidget,
      );

      // Same tyre typed differently is not a swap.
      await tester.enterText(find.byType(TextField).at(2), 'yma 55312');
      await tester.pump();
      expect(
        find.byKey(TyrePositionEditorSheetKeys.serialDiffers),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('offline register says not loaded, never "no tyre"', (
    WidgetTester tester,
  ) async {
    TyrePositionReading reading = TyrePositionReading.seed('R1Lo');
    await _pumpStateful(
      tester,
      get: () => reading,
      set: (TyrePositionReading r) => reading = r,
      unavailable: true,
    );
    expect(find.text('Fitted tyre not loaded'), findsOneWidget);
    expect(find.text('No tyre on record for this position'), findsNothing);
  });

  testWidgets('a loaded register with no fitment says so', (
    WidgetTester tester,
  ) async {
    TyrePositionReading reading = TyrePositionReading.seed('R1Lo');
    await _pumpStateful(
      tester,
      get: () => reading,
      set: (TyrePositionReading r) => reading = r,
    );
    expect(find.text('No tyre on record for this position'), findsOneWidget);
  });

  testWidgets(
    'header names the wheel in plain language with a mini axle map, and the '
    'sections are titled',
    (WidgetTester tester) async {
      TyrePositionReading reading = TyrePositionReading.seed('R1Lo');
      await _pumpStateful(
        tester,
        get: () => reading,
        set: (TyrePositionReading r) => reading = r,
        fitted: _fitted,
      );
      expect(find.text('Left, centre axle, outer'), findsOneWidget);
      expect(find.byType(TyrePositionMiniMap), findsOneWidget);
      expect(find.text('Not recorded'), findsOneWidget);
      for (final String title in <String>[
        'Condition',
        'Measurements',
        'Tyre',
        'Photo',
      ]) {
        expect(find.text(title), findsWidgets, reason: title);
      }
    },
  );

  testWidgets(
    'pressure and tread: out of range is refused and not stored, unusual is '
    'stored with a warning, units sit in the fields',
    (WidgetTester tester) async {
      TyrePositionReading reading = const TyrePositionReading(
        position: 'R1Lo',
        pressurePsi: 110,
        checked: true,
      );
      await _pumpStateful(
        tester,
        get: () => reading,
        set: (TyrePositionReading r) => reading = r,
      );
      expect(find.text('psi'), findsOneWidget);
      expect(find.text('mm'), findsOneWidget);

      await tester.enterText(find.byType(TextField).at(0), '1100');
      await tester.pump();
      expect(find.text('Enter a pressure from 0 to 200 psi.'), findsOneWidget);
      expect(reading.pressurePsi, isNull);

      await tester.enterText(find.byType(TextField).at(0), '0');
      await tester.pump();
      expect(reading.pressurePsi, 0);
      expect(
        find.text('Unusual pressure for a tyre. Check the reading.'),
        findsOneWidget,
      );

      await tester.enterText(find.byType(TextField).at(1), 'abc');
      await tester.pump();
      expect(find.text('Enter a number.'), findsOneWidget);
      expect(reading.treadDepthMm, isNull);

      await tester.enterText(find.byType(TextField).at(1), '35');
      await tester.pump();
      expect(find.text('Enter a tread depth from 0 to 30 mm.'), findsOneWidget);

      await tester.enterText(find.byType(TextField).at(1), '8.5');
      await tester.pump();
      expect(reading.treadDepthMm, 8.5);
      expect(find.text('Enter a tread depth from 0 to 30 mm.'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('the previous inspection reading for this wheel is shown', (
    WidgetTester tester,
  ) async {
    TyrePositionReading reading = TyrePositionReading.seed('R1Lo');
    await _pumpStateful(
      tester,
      get: () => reading,
      set: (TyrePositionReading r) => reading = r,
      previous: PreviousTyreReading(
        inspectionDate: DateTime(2026, 11, 12),
        pressurePsi: 110,
        treadDepthMm: 8.5,
      ),
    );
    expect(find.textContaining('Last inspection'), findsOneWidget);
    expect(find.textContaining('110 psi · 8.5 mm'), findsOneWidget);
  });

  testWidgets(
    'condition tiles fall back to the glyph without a picture and show a '
    'check badge only on the selected one',
    (WidgetTester tester) async {
      TyrePositionReading reading = const TyrePositionReading(
        position: 'R1Lo',
        condition: TyreReadingCondition.worn,
        checked: true,
      );
      await _pumpStateful(
        tester,
        get: () => reading,
        set: (TyrePositionReading r) => reading = r,
      );
      // One glyph per condition tile while no PNG is in the folder.
      expect(find.byType(TyreConditionGlyph), findsNWidgets(6));
      expect(find.byIcon(Icons.check_rounded), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey<String>('tyre-condition-Worn')),
          matching: find.byIcon(Icons.check_rounded),
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Flat'));
      await tester.pump();
      expect(
        find.descendant(
          of: find.byKey(const ValueKey<String>('tyre-condition-Flat')),
          matching: find.byIcon(Icons.check_rounded),
        ),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.check_rounded), findsOneWidget);
    },
  );

  group('no overflow at 360dp', () {
    for (final (String, ThemeData) theme in <(String, ThemeData)>[
      ('light', TpTheme.light),
      ('dark', TpTheme.dark),
    ]) {
      for (final Locale locale in const <Locale>[
        Locale('en'),
        Locale('ar'),
        Locale('ur'),
      ]) {
        for (final double scale in const <double>[1, 2]) {
          testWidgets('${theme.$1} ${locale.languageCode} x$scale', (
            WidgetTester tester,
          ) async {
            tester.view.physicalSize = const Size(360, 800);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.reset);
            await tester.pumpWidget(
              _app(
                theme: theme.$2,
                locale: locale,
                textScale: scale,
                home: Scaffold(
                  body: _editor(
                    reading: const TyrePositionReading(
                      position: 'R1Lo',
                      condition: TyreReadingCondition.puncture,
                      pressurePsi: 0,
                      checked: true,
                    ),
                    fitted: _fitted,
                    previous: PreviousTyreReading(
                      inspectionDate: DateTime(2026, 11, 12),
                      pressurePsi: 110,
                      treadDepthMm: 8.5,
                    ),
                    onChanged: (TyrePositionReading _) {},
                  ),
                ),
              ),
            );
            await tester.pump();
            expect(tester.takeException(), isNull);
            // Walk the whole sheet so every section lays out at least once.
            final Finder scroll = find.descendant(
              of: find.byKey(TyrePositionEditorSheetKeys.scrollBody),
              matching: find.byType(Scrollable),
            );
            for (int i = 0; i < 12; i++) {
              await tester.drag(scroll.first, const Offset(0, -300));
              await tester.pump();
              expect(tester.takeException(), isNull);
            }
          });
        }
      }
    }
  });
}
