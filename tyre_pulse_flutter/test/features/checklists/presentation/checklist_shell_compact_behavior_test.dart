import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/checklists/presentation/checklist_fill_screen.dart';
import 'package:tyre_pulse/features/checklists/presentation/checklist_history_screen.dart';
import 'package:tyre_pulse/features/checklists/presentation/checklists_home_screen.dart';

Future<void> _pumpCompact(
  WidgetTester tester, {
  required Widget screen,
  required Locale locale,
}) async {
  tester.view.physicalSize = const Size(320, 640);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workspaceContextProvider.overrideWithValue(null),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: screen,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('checklist home localizes retry state on compact Arabic', (
    WidgetTester tester,
  ) async {
    await _pumpCompact(
      tester,
      screen: const ChecklistsHomeScreen(),
      locale: const Locale('ar'),
    );

    expect(
      find.text('لا تزال مساحة العمل قيد التحميل. حاول مرة أخرى بعد قليل.'),
      findsOneWidget,
    );
    expect(
      Directionality.of(tester.element(find.byType(ChecklistsHomeScreen))),
      TextDirection.rtl,
    );

    await tester.tap(find.text('أعد المحاولة'));
    await tester.pumpAndSettle();

    expect(find.text('أعد المحاولة'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('checklist history localizes retry state on compact Urdu', (
    WidgetTester tester,
  ) async {
    await _pumpCompact(
      tester,
      screen: const ChecklistHistoryScreen(),
      locale: const Locale('ur'),
    );

    expect(
      find.text(
        'آپ کا ورک اسپیس ابھی لوڈ ہو رہا ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
      ),
      findsOneWidget,
    );
    expect(
      Directionality.of(tester.element(find.byType(ChecklistHistoryScreen))),
      TextDirection.rtl,
    );

    await tester.tap(find.text('دوبارہ کوشش کریں'));
    await tester.pumpAndSettle();

    expect(find.text('دوبارہ کوشش کریں'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('checklist runner localizes its controller failure', (
    WidgetTester tester,
  ) async {
    await _pumpCompact(
      tester,
      screen: const ChecklistFillScreen(
        route: ChecklistFillRoute(templateId: TemplateId('template-1')),
      ),
      locale: const Locale('ar'),
    );

    expect(
      find.text('لا تزال مساحة العمل قيد التحميل. حاول مرة أخرى بعد قليل.'),
      findsOneWidget,
    );
    expect(find.text('Your workspace is still loading.'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
