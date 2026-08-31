import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/inspection_signature_pad.dart';

const String _onePixelPng = 'data:image/png;base64,'
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

Future<void> _pump(
  WidgetTester tester, {
  required Widget child,
}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      theme: TpTheme.light,
      locale: const Locale('en'),
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: child,
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'read-only recorded signature has no redraw or clear control',
    (WidgetTester tester) async {
      await _pump(
        tester,
        child: const InspectionSignaturePad(
          value: _onePixelPng,
          readOnly: true,
        ),
      );

      expect(find.byType(Image), findsOneWidget);
      expect(find.text('Draw a new signature'), findsNothing);
      expect(find.text('Clear'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'editable recorded signature still offers redraw',
    (WidgetTester tester) async {
      bool changed = false;
      await _pump(
        tester,
        child: InspectionSignaturePad(
          value: _onePixelPng,
          onChanged: (InspectionSignatureCapture? value) => changed = true,
        ),
      );

      await tester.tap(find.text('Draw a new signature'));
      await tester.pump();

      expect(changed, isTrue);
      expect(find.text('Clear'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
