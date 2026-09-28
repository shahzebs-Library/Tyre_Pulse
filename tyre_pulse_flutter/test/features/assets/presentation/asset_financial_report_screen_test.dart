import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_timeline.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_financial_report_screen.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_insights_providers.dart';

class _Source implements AssetInsightsSource {
  _Source(this.lines, {this.withLabour = true});

  final List<Map<String, dynamic>> lines;
  final bool withLabour;
  AssetScope? lastScope;

  @override
  Future<List<Map<String, dynamic>>> costLines(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  }) async {
    lastScope = scope;
    return lines;
  }

  @override
  Future<List<Map<String, dynamic>>> jobCards(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  }) async =>
      <Map<String, dynamic>>[
        if (withLabour)
          <String, dynamic>{
            'id': 'w1',
            'opened_at': '2026-08-10T08:00:00Z',
            'labour_cost': 100,
            'breakdown_hours': 12,
          },
      ];

  @override
  Future<List<Map<String, dynamic>>> meterReadings(
    AssetScope scope, {
    required bool engineHours,
    required String fromIso,
    required String toIso,
  }) async =>
      const <Map<String, dynamic>>[];

  @override
  Future<List<Map<String, dynamic>>> timelineRows(
    AssetScope scope,
    AssetTimelineFilter source, {
    required String fromIso,
  }) async =>
      const <Map<String, dynamic>>[];
}

const VehicleAsset _asset = VehicleAsset(
  id: 'v1',
  assetNo: 'MP045',
  make: 'SANY',
  model: 'Concrete Pump',
  site: 'NHC',
  country: 'KSA',
);

Future<void> _pump(WidgetTester tester, _Source source) async {
  tester.view.physicalSize = const Size(430, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        assetInsightsSourceProvider.overrideWith((Ref ref) => source),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: AssetFinancialReportScreen(
          asset: _asset,
          clock: () => DateTime(2026, 8, 28),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
      'real grid lines and job card labour render KPIs in the '
      "data's own currency, scoped to the asset's country", (
    WidgetTester tester,
  ) async {
    final _Source source = _Source(<Map<String, dynamic>>[
      <String, dynamic>{
        'id': 'a',
        'event_date': '2026-08-15',
        'currency': 'SAR',
        'spare_cost': 300,
        'oil_cost': 0,
        'tyre_cost': 600,
        'work_order_no': 'GCKR/JC/1',
        'item_description': 'Tyre 315/80R22.5',
      },
    ]);
    await _pump(tester, source);

    expect(source.lastScope, (assetNo: 'MP045', country: 'KSA'));
    expect(find.byKey(AssetFinancialReportKeys.kpis), findsOneWidget);
    expect(find.text('SAR 1,000'), findsOneWidget); // total incl. labour
    expect(find.text('SAR 400'), findsOneWidget); // maintenance
    expect(find.text('Not measurable'), findsOneWidget); // no km readings
    expect(find.text('12 hours'), findsOneWidget);
    expect(find.text('No data for comparison'), findsNWidgets(2));
    expect(find.byKey(AssetFinancialReportKeys.export), findsOneWidget);
  });

  testWidgets('an empty period is an empty state, never a row of zeros', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _Source(const <Map<String, dynamic>>[], withLabour: false),
    );
    expect(find.byKey(TpStateKeys.empty), findsOneWidget);
    expect(find.byKey(AssetFinancialReportKeys.kpis), findsNothing);
  });

  testWidgets('mixed currencies are refused, not summed', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _Source(<Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'a',
          'event_date': '2026-08-15',
          'currency': 'SAR',
          'spare_cost': 1,
        },
        <String, dynamic>{
          'id': 'b',
          'event_date': '2026-08-16',
          'currency': 'AED',
          'spare_cost': 1,
        },
      ]),
    );
    expect(find.byKey(AssetFinancialReportKeys.mixed), findsOneWidget);
    expect(find.byKey(AssetFinancialReportKeys.kpis), findsNothing);
  });
}
