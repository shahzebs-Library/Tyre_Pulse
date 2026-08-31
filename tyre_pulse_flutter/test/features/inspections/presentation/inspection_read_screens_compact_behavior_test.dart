import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/inspections/presentation/inspection_detail_screen.dart';
import 'package:tyre_pulse/features/inspections/presentation/inspection_history_screen.dart';

Future<void> _pumpCompact(
  WidgetTester tester, {
  required Widget screen,
  required Locale locale,
  required List<Override> overrides,
}) async {
  tester.view.physicalSize = const Size(320, 640);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: overrides,
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
  testWidgets('inspection detail localizes load failure on compact Arabic', (
    WidgetTester tester,
  ) async {
    await _pumpCompact(
      tester,
      screen: const InspectionDetailScreen(
        route: InspectionDetailRoute(
          inspectionId: InspectionId('inspection-1'),
        ),
      ),
      locale: const Locale('ar'),
      overrides: [
        inspectionSubmissionQueueProvider.overrideWith(
          (ref) => throw StateError('offline'),
        ),
      ],
    );

    expect(
      find.text(
        'تعذر تحميل هذا الفحص. تحقق من اتصالك وحاول مرة أخرى.',
      ),
      findsOneWidget,
    );

    await tester.tap(find.text('أعد المحاولة'));
    await tester.pumpAndSettle();

    expect(find.text('أعد المحاولة'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('inspection history never disguises a failure as empty', (
    WidgetTester tester,
  ) async {
    await _pumpCompact(
      tester,
      screen: const InspectionHistoryScreen(),
      locale: const Locale('ur'),
      overrides: [
        inspectionSyncEngineProvider.overrideWith(
          (ref) => throw StateError('sync unavailable'),
        ),
        inspectionDraftRepositoryProvider.overrideWith(
          (ref) => throw StateError('storage unavailable'),
        ),
      ],
    );

    expect(
      find.text(
        'آپ کے معائنے لوڈ نہیں ہو سکے۔ دوبارہ کوشش کے لیے نیچے کھینچیں۔',
      ),
      findsOneWidget,
    );
    expect(find.text('ابھی کوئی معائنہ نہیں'), findsNothing);

    await tester.tap(find.text('دوبارہ کوشش کریں'));
    await tester.pumpAndSettle();

    expect(find.text('دوبارہ کوشش کریں'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
