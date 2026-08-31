library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/alerts/alerts_providers.dart';
import 'package:tyre_pulse/features/alerts/data/alerts_repository.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/alerts/presentation/alerts_screen.dart';

final class _FakeAlertsRepository implements AlertsRepository {
  _FakeAlertsRepository(this._result);

  final Future<List<TyreAlert>> Function() _result;
  int calls = 0;
  String? lastCountry;

  @override
  Future<List<TyreAlert>> listActiveRiskAlerts({String? country}) {
    calls += 1;
    lastCountry = country;
    return _result();
  }
}

const List<TyreAlert> _alerts = <TyreAlert>[
  TyreAlert(
    id: 'critical',
    riskLevel: 'Critical',
    assetNo: 'Mixer 2841',
    position: 'R3 O',
    treadDepthMm: 2.8,
    issueDate: '2026-08-28',
  ),
  TyreAlert(
    id: 'warning',
    riskLevel: 'High',
    assetNo: 'Wheel Loader 509',
    site: 'Qiddiya G2',
    position: 'FL',
    issueDate: '2026-08-27',
  ),
];

Future<void> _pump(
  WidgetTester tester,
  AlertsRepository repository, {
  Locale locale = const Locale('en'),
  ThemeData? theme,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        alertsRepositoryProvider.overrideWithValue(repository),
        activeCountryProvider.overrideWithValue('KSA'),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: theme ?? TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const AlertsScreen(backFallback: '/'),
      ),
    ),
  );
}

void main() {
  testWidgets('matches the four-tab alert hierarchy with real tyre readings', (
    WidgetTester tester,
  ) async {
    final _FakeAlertsRepository repository = _FakeAlertsRepository(
      () async => _alerts,
    );
    await _pump(tester, repository);
    await tester.pumpAndSettle();

    expect(find.text('Tyre Alerts'), findsOneWidget);
    for (final String filter in <String>[
      'all',
      'critical',
      'warnings',
      'info',
    ]) {
      expect(find.byKey(Key('alerts.filter.$filter')), findsOneWidget);
    }
    expect(find.textContaining('Mixer 2841'), findsOneWidget);
    expect(find.textContaining('Wheel Loader 509'), findsOneWidget);
    expect(find.text('2.8 mm'), findsOneWidget);
    expect(find.textContaining('bar'), findsNothing);
    expect(find.textContaining('acknowledge'), findsNothing);
    expect(repository.lastCountry, 'KSA');
  });

  testWidgets('Critical, Warnings and Info tabs all change the feed', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeAlertsRepository(() async => _alerts),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('alerts.filter.critical')));
    await tester.pump();
    expect(find.textContaining('Mixer 2841'), findsOneWidget);
    expect(find.textContaining('Wheel Loader 509'), findsNothing);

    await tester.tap(find.byKey(const Key('alerts.filter.warnings')));
    await tester.pump();
    expect(find.textContaining('Mixer 2841'), findsNothing);
    expect(find.textContaining('Wheel Loader 509'), findsOneWidget);

    await tester.tap(find.byKey(const Key('alerts.filter.info')));
    await tester.pump();
    expect(find.byKey(TpStateKeys.empty), findsOneWidget);
    expect(find.text('No alerts match this filter.'), findsOneWidget);
  });

  testWidgets('the header filter action opens a working filter sheet', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeAlertsRepository(() async => _alerts),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('alerts.filter.action')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('alerts.sheet.warnings')), findsOneWidget);

    await tester.tap(find.byKey(const Key('alerts.sheet.warnings')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Wheel Loader 509'), findsOneWidget);
    expect(find.textContaining('Mixer 2841'), findsNothing);
  });

  testWidgets('loading, empty and localized error states stay distinct', (
    WidgetTester tester,
  ) async {
    final Completer<List<TyreAlert>> loading = Completer<List<TyreAlert>>();
    await _pump(tester, _FakeAlertsRepository(() => loading.future));
    await tester.pump();
    expect(find.byKey(TpStateKeys.loading), findsOneWidget);
    loading.complete(const <TyreAlert>[]);
    await tester.pumpAndSettle();
    expect(find.byKey(TpStateKeys.empty), findsOneWidget);

    await _pump(
      tester,
      _FakeAlertsRepository(
        () => Future<List<TyreAlert>>.error(
          const AppError(
            kind: AppErrorKind.validation,
            message: 'technical source message',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(TpStateKeys.error), findsOneWidget);
    expect(
      find.text('Could not load alerts. Pull down to retry.'),
      findsOneWidget,
    );
    expect(find.text('technical source message'), findsNothing);
  });

  testWidgets('pull to refresh requests the current country feed again', (
    WidgetTester tester,
  ) async {
    final _FakeAlertsRepository repository = _FakeAlertsRepository(
      () async => _alerts,
    );
    await _pump(tester, repository);
    await tester.pumpAndSettle();
    expect(repository.calls, 1);

    await tester.fling(
      find.byKey(const Key('alerts.list')),
      const Offset(0, 400),
      1000,
    );
    await tester.pumpAndSettle();
    expect(repository.calls, 2);
  });

  testWidgets('Arabic copy and layout are truly RTL', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeAlertsRepository(() async => _alerts),
      locale: const Locale('ar'),
    );
    await tester.pumpAndSettle();

    final Finder title = find.text('تنبيهات الإطارات');
    expect(title, findsOneWidget);
    expect(
      Directionality.of(tester.element(title)),
      TextDirection.rtl,
    );
    expect(find.text('تحذيرات'), findsOneWidget);
  });

  testWidgets('the mock hierarchy uses the night-shift palette in dark mode', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pump(
      tester,
      _FakeAlertsRepository(() async => _alerts),
      theme: TpTheme.dark,
    );
    await tester.pumpAndSettle();

    final Finder selectedTab = find.byKey(const Key('alerts.filter.all'));
    final Material tabSurface = tester.widget<Material>(
      find.ancestor(of: selectedTab, matching: find.byType(Material)).first,
    );
    expect(tabSurface.color, const Color(0xFFFFD400));
    expect(find.byKey(const Key('alerts.list')), findsOneWidget);
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/alerts_compact_dark.png'),
    );
  });
}
