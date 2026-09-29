import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';
import 'package:tyre_pulse/features/assets/domain/asset_timeline.dart';
import 'package:tyre_pulse/features/assets/domain/fleet_class_groups.dart';

AssetCostLine _line(
  String date, {
  double spare = 0,
  double oil = 0,
  double tyre = 0,
  String currency = 'SAR',
  String? wo,
}) =>
    AssetCostLine.fromRow(<String, dynamic>{
      'event_date': date,
      'spare_cost': spare,
      'oil_cost': oil,
      'tyre_cost': tyre,
      'currency': currency,
      'work_order_no': wo,
      'item_description': 'Item',
    })!;

void main() {
  final AssetCostPeriod ytd = AssetCostPeriod.yearToDate(DateTime(2026, 8, 28));

  test('buckets, maintenance excludes tyres, labour from job cards', () {
    final AssetFinancialSummary s = computeAssetFinancials(
      period: ytd,
      lines: <AssetCostLine>[
        _line('2026-03-01', spare: 100),
        _line('2026-03-02', oil: 50),
        _line('2026-04-01', tyre: 200),
        _line('2025-12-31', spare: 999), // outside the period
      ],
      jobCards: <AssetJobCard>[
        AssetJobCard.fromRow(<String, dynamic>{
          'id': 'w1',
          'opened_at': '2026-03-05T08:00:00Z',
          'labour_cost': 30,
          'breakdown_hours': 6,
        })!,
      ],
    );
    expect(s.currency, 'SAR');
    expect(s.spare, 100);
    expect(s.lubricants, 50);
    expect(s.tyres, 200);
    expect(s.labour, 30);
    expect(s.total, 380);
    expect(s.maintenance, 180);
    expect(s.downtimeHours, 6);
    expect(s.monthly.length, 8);
    expect(s.monthly[2].total, 180); // March: 100 + 50 + 30 labour
  });

  test('outside repairs are their own bucket, counted as maintenance', () {
    final AssetFinancialSummary s = computeAssetFinancials(
      period: ytd,
      lines: <AssetCostLine>[_line('2026-03-01', spare: 100)],
      jobCards: <AssetJobCard>[
        AssetJobCard.fromRow(<String, dynamic>{
          'id': 'w1',
          'opened_at': '2026-03-05T08:00:00Z',
          'outside_repair_cost': 40,
        })!,
      ],
    );
    expect(s.external, 40);
    expect(s.labour, isNull);
    expect(s.amountOf(AssetCostBucket.external), 40);
    expect(s.maintenance, 140);
    expect(s.total, 140);
    expect(s.monthly[2].total, 140);

    final AssetFinancialSummary none = computeAssetFinancials(
      period: ytd,
      lines: <AssetCostLine>[_line('2026-03-01', spare: 100)],
    );
    // Not recorded is null, not a zero.
    expect(none.external, isNull);
  });

  test(
      'comparison is against the same window a year earlier, null when '
      'nothing was recorded then', () {
    final AssetFinancialSummary withPrior = computeAssetFinancials(
      period: ytd,
      lines: <AssetCostLine>[
        _line('2026-02-01', spare: 110),
        _line('2025-02-01', spare: 100),
      ],
    );
    expect(withPrior.previousTotal, 100);
    expect(withPrior.totalChangePct, closeTo(10, 0.001));

    final AssetFinancialSummary noPrior = computeAssetFinancials(
      period: ytd,
      lines: <AssetCostLine>[_line('2026-02-01', spare: 110)],
    );
    expect(noPrior.previousTotal, isNull);
    expect(noPrior.totalChangePct, isNull);
  });

  test('currencies are never added together', () {
    final AssetFinancialSummary s = computeAssetFinancials(
      period: ytd,
      lines: <AssetCostLine>[
        _line('2026-02-01', spare: 10),
        _line('2026-02-02', spare: 10, currency: 'AED'),
      ],
    );
    expect(s.isMixed, isTrue);
    expect(s.currency, isNull);
    expect(s.mixedCurrencies, <String>['AED', 'SAR']);
  });

  test('money with no currency is never labelled with a currency', () {
    final AssetFinancialSummary s = computeAssetFinancials(
      period: ytd,
      lines: <AssetCostLine>[
        _line('2026-02-01', spare: 10),
        AssetCostLine.fromRow(<String, dynamic>{
          'event_date': '2026-02-02',
          'spare_cost': 25,
          'oil_cost': 0,
          'tyre_cost': 0,
          'currency': null,
        })!,
      ],
    );
    expect(s.hasUnlabelledCurrency, isTrue);
    expect(s.unlabelledLineCount, 1);
    expect(s.currency, isNull);
  });

  test('cost per km needs two readings and a positive distance', () {
    final List<AssetCostLine> lines = <AssetCostLine>[
      _line('2026-02-01', spare: 1000),
    ];
    final AssetFinancialSummary none = computeAssetFinancials(
      period: ytd,
      lines: lines,
      odometer: <AssetMeterReading>[
        AssetMeterReading(date: DateTime(2026, 3), value: 5000),
      ],
    );
    expect(none.costPerKm, isNull);

    final AssetFinancialSummary measured = computeAssetFinancials(
      period: ytd,
      lines: lines,
      odometer: <AssetMeterReading>[
        AssetMeterReading(date: DateTime(2026, 3), value: 5000),
        AssetMeterReading(date: DateTime(2026, 7), value: 7000),
      ],
    );
    expect(measured.distanceKm, 2000);
    expect(measured.costPerKm, 0.5);
  });

  test('entries group grid lines by day and work order, newest first', () {
    final AssetFinancialSummary s = computeAssetFinancials(
      period: ytd,
      lines: <AssetCostLine>[
        _line('2026-05-01', spare: 10, wo: 'A'),
        _line('2026-05-01', spare: 5, wo: 'A'),
        _line('2026-06-01', oil: 7, wo: 'B'),
      ],
    );
    expect(s.entries.length, 2);
    expect(s.entries.first.workOrderNo, 'B');
    expect(s.entries.last.amount, 15);
    expect(s.entries.last.lineCount, 2);
  });

  test('a line with no event date is dropped, not dated today', () {
    expect(
      AssetCostLine.fromRow(<String, dynamic>{'spare_cost': 5}),
      isNull,
    );
  });

  test('money formatting', () {
    expect(formatAssetMoney(42680.4), '42,680');
    expect(formatAssetMoney(0.623, decimals: 2), '0.62');
    expect(formatAssetCompact(12345), '12.3K');
  });

  test('timeline sorts newest first and a tyre row yields fit + removal', () {
    final List<AssetTimelineEvent> tyre = AssetTimelineEvent.tyre(
      <String, dynamic>{
        'issue_date': '2026-01-01',
        'removal_date': '2026-06-01',
        'serial_no': 'S1',
        'position': 'LHF1',
      },
    );
    expect(tyre.length, 2);
    final List<AssetTimelineEvent> sorted = sortTimeline(tyre);
    expect(sorted.first.kind, AssetTimelineKind.tyreRemoved);
    expect(sorted.first.matches(AssetTimelineFilter.tyres), isTrue);
    expect(sorted.first.matches(AssetTimelineFilter.washes), isFalse);
  });

  test('class groups are decided by prefix and never guessed', () {
    expect(fleetClassGroupOf('TM514'), FleetClassGroup.vehicles);
    expect(fleetClassGroupOf('WL027'), FleetClassGroup.plant);
    expect(fleetClassGroupOf('GN021'), FleetClassGroup.stationary);
    expect(fleetClassGroupOf('BN004'), isNull);
    expect(fleetClassGroupOf(null), isNull);
  });
}
