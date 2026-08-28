import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';

void main() {
  testWidgets('Arabic accident copy is localized and rendered RTL', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ar'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Builder(
          builder: (BuildContext context) => Text(
            AccidentCopy.of(context)('dashboardTitle'),
            key: const Key('accident.localized.title'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final Finder title = find.byKey(const Key('accident.localized.title'));
    expect(title, findsOneWidget);
    expect(find.text('مركز قيادة الحوادث'), findsOneWidget);
    expect(Directionality.of(tester.element(title)), TextDirection.rtl);
  });

  testWidgets('Urdu accident copy does not fall back to English', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ur'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Builder(
          builder: (BuildContext context) => Text(
            AccidentCopy.of(context)('reportTitle'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('حادثہ رپورٹ کریں'), findsOneWidget);
    expect(find.text('Report an accident'), findsNothing);
  });
}
