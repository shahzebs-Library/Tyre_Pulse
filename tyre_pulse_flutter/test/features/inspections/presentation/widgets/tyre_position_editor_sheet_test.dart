import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_editor_sheet.dart';

void main() {
  testWidgets('flat and puncture are explicit selectable stored conditions', (
    WidgetTester tester,
  ) async {
    TyrePositionReading reading = TyrePositionReading.seed('R1Li');

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: StatefulBuilder(
            builder: (BuildContext context, StateSetter setState) {
              return TyrePositionEditorSheet(
                reading: reading,
                onChanged: (TyrePositionReading next) {
                  setState(() => reading = next);
                },
                onCapturePhoto: (PhotoCaptureSource source) {},
              );
            },
          ),
        ),
      ),
    );

    expect(find.text('Flat'), findsOneWidget);
    expect(find.text('Puncture'), findsOneWidget);

    await tester.tap(find.text('Flat'));
    await tester.pump();
    expect(reading.condition, TyreReadingCondition.flat);

    await tester.tap(find.text('Puncture'));
    await tester.pump();
    expect(reading.condition, TyreReadingCondition.puncture);
  });

  testWidgets('condition choices expose selected and severity semantics', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: TyrePositionEditorSheet(
            reading: const TyrePositionReading(
              position: 'R1Li',
              condition: TyreReadingCondition.puncture,
            ),
            onChanged: (TyrePositionReading reading) {},
            onCapturePhoto: (PhotoCaptureSource source) {},
          ),
        ),
      ),
    );

    final SemanticsNode puncture = tester.getSemantics(
      find.bySemanticsLabel('Puncture, Critical'),
    );
    expect(puncture.flagsCollection.isSelected, Tristate.isTrue);
    await tester.scrollUntilVisible(
      find.text('Flat'),
      100,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pump();
    final Iterable<Semantics> flatSemantics = tester.widgetList<Semantics>(
      find.ancestor(of: find.text('Flat'), matching: find.byType(Semantics)),
    );
    expect(
      flatSemantics.any(
        (Semantics widget) =>
            widget.properties.label?.toString() == 'Flat, Attention',
      ),
      isTrue,
    );

    handle.dispose();
  });

  testWidgets(
    'editing condition, PSI, tread, serial, notes and evidence preserves one '
    'unchanged inner-wheel position',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(720, 1560);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      TyrePositionReading reading = TyrePositionReading.seed('RHR1-I');
      PhotoCaptureSource? capturedFrom;

      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: TpTheme.light,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(
            body: StatefulBuilder(
              builder: (BuildContext context, StateSetter setState) {
                return TyrePositionEditorSheet(
                  reading: reading,
                  onChanged: (TyrePositionReading next) {
                    setState(() => reading = next);
                  },
                  onCapturePhoto: (PhotoCaptureSource source) {
                    capturedFrom = source;
                    setState(
                      () => reading = reading.copyWith(
                        photoLocalPath: 'C:\\inspection-evidence.jpg',
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ),
      );
      await tester.pump();

      await tester.tap(find.text('Puncture'));
      await tester.pump();
      await tester.enterText(find.byType(TextField).at(0), '0');
      await tester.pump();
      await tester.enterText(find.byType(TextField).at(1), '4.5');
      await tester.pump();
      await tester.enterText(find.byType(TextField).at(2), 'YMA55312');
      await tester.pump();
      await tester.enterText(
        find.byType(TextField).at(3),
        'Inner sidewall cut',
      );
      await tester.pump();

      await tester.scrollUntilVisible(
        find.text('Camera'),
        180,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Camera'));
      await tester.pump();

      expect(capturedFrom, PhotoCaptureSource.camera);
      expect(reading.position, 'RHR1-I');
      expect(reading.condition, TyreReadingCondition.puncture);
      expect(reading.pressurePsi, 0);
      expect(reading.treadDepthMm, 4.5);
      expect(reading.serialNumber, 'YMA55312');
      expect(reading.notes, 'Inner sidewall cut');
      expect(reading.photoLocalPath, 'C:\\inspection-evidence.jpg');
      expect(find.text('Pressure (psi)'), findsOneWidget);
      expect(find.textContaining('bar'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '720x1560 Arabic layout keeps the outer-wheel identifier LTR and has no '
    'overflow',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(720, 1560);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: TpTheme.light,
          locale: const Locale('ar'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(
            body: TyrePositionEditorSheet(
              reading: TyrePositionReading.seed('RHR2-O'),
              onChanged: (TyrePositionReading reading) {},
              onCapturePhoto: (PhotoCaptureSource source) {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final Finder identifier = find.text(TpDirection.isolateLtr('RHR2-O'));
      expect(identifier, findsOneWidget);
      final Directionality identifierDirection = tester.widget<Directionality>(
        find
            .ancestor(of: identifier, matching: find.byType(Directionality))
            .first,
      );
      expect(identifierDirection.textDirection, TextDirection.ltr);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '720x1560 device keeps the sticky Close action fully visible and tappable',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(720, 1560);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);

      bool sheetClosed = false;
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: TpTheme.light,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: FilledButton(
                  onPressed: () async {
                    await TpBottomSheet.show<void>(
                      context: context,
                      builder: (BuildContext sheetContext) =>
                          TyrePositionEditorSheet(
                        reading: TyrePositionReading.seed('RHR1-I'),
                        onChanged: (TyrePositionReading reading) {},
                        onCapturePhoto: (PhotoCaptureSource source) {},
                      ),
                    );
                    sheetClosed = true;
                  },
                  child: const Text('Open editor'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open editor'));
      await tester.pumpAndSettle();

      final Finder action = find.byKey(TyrePositionEditorSheetKeys.closeAction);
      expect(action, findsOneWidget);
      expect(action.hitTestable(), findsOneWidget);
      final Rect actionRect = tester.getRect(action);
      final Size logicalViewport =
          tester.view.physicalSize / tester.view.devicePixelRatio;
      expect(actionRect.height, greaterThanOrEqualTo(48));
      expect(actionRect.left, greaterThanOrEqualTo(0));
      expect(actionRect.right, lessThanOrEqualTo(logicalViewport.width));
      expect(actionRect.top, greaterThanOrEqualTo(0));
      expect(actionRect.bottom, lessThanOrEqualTo(logicalViewport.height));
      expect(
        find.byKey(TyrePositionEditorSheetKeys.scrollBody),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);

      await tester.tap(action);
      await tester.pumpAndSettle();
      expect(sheetClosed, isTrue);
      expect(action, findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
