import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart'
    show PagedRows;
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';
import 'package:tyre_pulse/features/assets/domain/asset_timeline.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_financial_report_screen.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_insights_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/asset_cost_widgets.dart';

class _Source implements AssetInsightsSource {
  _Source(this.lines, {this.withLabour = true, this.truncated = false});

  final List<Map<String, dynamic>> lines;
  final bool withLabour;

  /// Simulates the grid read stopping at its row cap.
  final bool truncated;
  AssetScope? lastScope;

  @override
  Future<PagedRows<Map<String, dynamic>>> costLines(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  }) async {
    lastScope = scope;
    return PagedRows<Map<String, dynamic>>(rows: lines, truncated: truncated);
  }

  @override
  Future<PagedRows<Map<String, dynamic>>> jobCards(
    AssetScope scope, {
    required String fromIso,
    required String toIso,
  }) async =>
      PagedRows<Map<String, dynamic>>(
        truncated: false,
        rows: <Map<String, dynamic>>[
          if (withLabour)
            <String, dynamic>{
              'id': 'w1',
              'opened_at': '2026-08-10T08:00:00Z',
              'labour_cost': 100,
              'breakdown_hours': 12,
            },
        ],
      );

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

  testWidgets(
      'a capped read refuses totals and export instead of publishing an '
      'understated ledger as complete', (WidgetTester tester) async {
    await _pump(
      tester,
      _Source(
        <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'a',
            'event_date': '2026-08-15',
            'currency': 'SAR',
            'spare_cost': 300,
            'oil_cost': 0,
            'tyre_cost': 600,
          },
        ],
        truncated: true,
      ),
    );

    expect(find.byKey(AssetFinancialReportKeys.incomplete), findsOneWidget);
    expect(find.text('Figures are incomplete'), findsOneWidget);
    expect(find.textContaining('more than 5000 entries'), findsOneWidget);
    expect(find.byKey(AssetFinancialReportKeys.kpis), findsNothing);
    expect(find.text('SAR 1,000'), findsNothing);
    expect(find.byKey(AssetFinancialReportKeys.export), findsNothing);
    final IconButton icon = tester.widget<IconButton>(
      find.byKey(AssetFinancialReportKeys.exportIcon),
    );
    expect(icon.onPressed, isNull);
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

  test('Last 12 months is twelve calendar months starting on the 1st', () {
    final AssetCostPeriod p =
        AssetReportPeriod.last12Months.resolve(DateTime(2026, 8, 28));
    expect(p.from, DateTime(2025, 9));
    expect(p.to, DateTime(2026, 8, 28));
    final AssetFinancialSummary s =
        computeAssetFinancials(period: p, lines: const <AssetCostLine>[]);
    expect(s.monthly, hasLength(12));
  });

  testWidgets(
      'the monthly chart draws every month, fits at 2x text and reads as '
      'one summary', (WidgetTester tester) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    final List<AssetMonthlyCost> monthly = <AssetMonthlyCost>[
      for (int m = 1; m <= 13; m++)
        AssetMonthlyCost(month: DateTime(2025, m), total: m * 100.0),
    ];
    await tester.pumpWidget(
      MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(360, 800),
            textScaler: TextScaler.linear(2),
          ),
          child: Scaffold(
            body: Center(child: AssetMonthlyBars(monthly: monthly)),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
      find.bySemanticsLabel(RegExp('Monthly cost chart, 13 months')),
      findsOneWidget,
    );
    semantics.dispose();
  });
}
