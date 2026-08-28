/// Widget coverage for the pre-authentication PMV scope summary.
///
/// The summary is informational: it names real product areas without
/// claiming that the signed-out person can access them and without inventing
/// live counts. Authentication and workspace permissions remain authoritative.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/auth/presentation/widgets/login_operations_scope.dart';

Future<void> _pump(
  WidgetTester tester, {
  required Locale locale,
  double width = 320,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: TpTheme.light,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(
        body: Align(
          alignment: Alignment.topCenter,
          child: SizedBox(
            width: width,
            child: const LoginOperationsScope(),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows five truthful operation areas without controls', (
    WidgetTester tester,
  ) async {
    await _pump(tester, locale: const Locale('en'));

    expect(find.byKey(LoginOperationsScopeKeys.panel), findsOneWidget);
    expect(find.byKey(LoginOperationsScopeKeys.fleetAssets), findsOneWidget);
    expect(find.byKey(LoginOperationsScopeKeys.tyres), findsOneWidget);
    expect(
      find.byKey(LoginOperationsScopeKeys.inspectionsChecklists),
      findsOneWidget,
    );
    expect(
      find.byKey(LoginOperationsScopeKeys.maintenanceWorkshop),
      findsOneWidget,
    );
    expect(find.byKey(LoginOperationsScopeKeys.accidents), findsOneWidget);

    expect(find.text('Fleet & assets'), findsOneWidget);
    expect(find.text('Tyres'), findsOneWidget);
    expect(find.text('Inspections & checklists'), findsOneWidget);
    expect(find.text('Maintenance & workshop'), findsOneWidget);
    expect(find.text('Accidents'), findsOneWidget);
    expect(find.byType(InkWell), findsNothing);
    expect(find.byType(IconButton), findsNothing);
    expect(tester.takeException(), isNull);
  });

  for (final Locale locale in <Locale>[
    const Locale('en'),
    const Locale('ar'),
    const Locale('ur'),
  ]) {
    testWidgets(
      'wraps without overflow at 320dp in ${locale.languageCode}',
      (WidgetTester tester) async {
        await _pump(tester, locale: locale);

        expect(find.byKey(LoginOperationsScopeKeys.panel), findsOneWidget);
        expect(tester.takeException(), isNull);

        final BuildContext context = tester.element(
          find.byKey(LoginOperationsScopeKeys.panel),
        );
        expect(
          Directionality.of(context),
          TpLocalizations.directionOf(locale),
        );
      },
    );
  }
}
